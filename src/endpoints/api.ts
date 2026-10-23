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

    const tables = this.getTables(database)
    const tableNames = tables.map((table) => table.name)

    if (!tableName) {
      // list tables
      const tableRecordCounts = this.getTableRecordCounts(database, tables)
      await reply.send(tableRecordCounts)
      return
    }

    // list records
    if (!tableNames.includes(tableName)) {
      await reply.send({ error: 'Table not found' })
      return
    }
    const records = this.getRecords(
      database,
      tableName,
      request.query.limit,
      offset
    )

    database.close()

    await reply.send(records)
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
