import { FastifyReply, FastifyRequest } from 'fastify'
import { BaseRouter } from '.'
import DatabaseConstructor from 'better-sqlite3'
import { ENV } from '../environments'

/**
 * 1 リクエストで取得できるレコード数の上限
 */
const MAX_LIMIT = 1000

/**
 * SQL 識別子をダブルクオートで囲み、内部のダブルクオートをエスケープする
 *
 * @param name 識別子（テーブル名）
 * @returns クオート済みの識別子
 */
function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/**
 * page と limit から OFFSET 値を算出する
 *
 * スキーマ検証だけでは Infinity が通過するため、ここで安全な整数と範囲を再検証する。
 *
 * @param page ページ番号（1 始まり）
 * @param limit 1 ページあたりの件数
 * @returns OFFSET 値。page / limit が不正な場合は null
 */
function calculateOffset(page: number, limit: number): number | null {
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit)) {
    return null
  }
  if (page < 1 || limit < 1 || limit > MAX_LIMIT) {
    return null
  }
  const offset = (page - 1) * limit
  return Number.isSafeInteger(offset) ? offset : null
}

export class ApiRouter extends BaseRouter {
  async init(): Promise<void> {
    await this.fastify.register(
      (fastify, _, done) => {
        fastify.get(
          '/:tableName',
          {
            schema: {
              querystring: {
                type: 'object',
                properties: {
                  page: { type: 'integer', minimum: 1, default: 1 },
                  limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: MAX_LIMIT,
                    default: 10,
                  },
                },
              },
            },
            attachValidation: true,
          },
          this.routeGet.bind(this)
        )
        done()
      },
      { prefix: '/api' }
    )
  }

  async routeGet(
    request: FastifyRequest<{
      Params: {
        tableName?: string
      }
      Querystring: {
        page: number
        limit: number
      }
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const tableName = request.params.tableName

    let offset = 0
    if (tableName) {
      const validatedOffset = request.validationError
        ? null
        : calculateOffset(request.query.page, request.query.limit)
      if (validatedOffset === null) {
        await reply.code(400).send({ error: 'Invalid page or limit' })
        return
      }
      offset = validatedOffset
    }

    const username = process.env.USERNAME
    const defaultPath = `C:\\Users\\${username}\\AppData\\Roaming\\VRCX\\VRCX.sqlite3`

    const path = ENV.VRCX_SQLITE_FILEPATH || defaultPath
    const database = new DatabaseConstructor(path, {
      readonly: true,
    })

    // 早期 return や例外が発生しても接続を確実に閉じるため、
    // DB を使う処理はすべて try ブロック内で完結させ、応答の送信は finally の後に行う
    let response: unknown
    try {
      response = this.handleRequest(
        database,
        tableName,
        request.query.limit,
        offset
      )
    } finally {
      database.close()
    }

    await reply.send(response)
  }

  /**
   * リクエストに応じてテーブル一覧またはレコード一覧を取得する。
   * データベース接続のクローズは呼び出し元が行う。
   * @param database オープン済みのデータベース接続
   * @param tableName テーブル名。未指定の場合はテーブル一覧を返す
   * @param limit 1 ページあたりの件数（検証済み）
   * @param offset 取得開始位置（検証済み）
   * @returns 応答として返す値
   */
  private handleRequest(
    database: DatabaseConstructor.Database,
    tableName: string | undefined,
    limit: number,
    offset: number
  ): unknown {
    const tables = this.getTables(database)
    const tableNames = tables.map((table) => table.name)

    if (!tableName) {
      // list tables
      return this.getTableRecordCounts(database, tables)
    }

    // list records
    return tableNames.includes(tableName)
      ? this.getRecords(database, tableName, limit, offset)
      : { error: 'Table not found' }
  }

  private getTables(database: DatabaseConstructor.Database) {
    return database
      .prepare<
        unknown[],
        {
          name: string
        }
      >(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
  }

  private getTableRecordCounts(
    database: DatabaseConstructor.Database,
    tables: { name: string }[]
  ) {
    return tables.map((table) => {
      const result = database
        .prepare<
          unknown[],
          {
            count: number
          }
        >(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}`)
        .get() ?? { count: 0 }
      return { name: table.name, count: result.count }
    })
  }

  private getRecords(
    database: DatabaseConstructor.Database,
    tableName: string,
    limit: number,
    offset: number
  ) {
    return database
      .prepare(
        `SELECT * FROM ${quoteIdentifier(tableName)} ORDER BY rowid DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset)
  }
}
