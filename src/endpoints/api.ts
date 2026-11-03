import { FastifyReply, FastifyRequest } from 'fastify'
import { BaseRouter } from '.'
import DatabaseConstructor from 'better-sqlite3'
import { ENV } from '../environments'

/**
 * Maximum number of records returned per request.
 */
const MAX_LIMIT = 1000

/**
 * Wrap a SQL identifier in double quotes, escaping any embedded double quotes.
 *
 * @param name Identifier (table name)
 * @returns The quoted identifier
 */
function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/**
 * Calculate the OFFSET value from page and limit.
 *
 * Schema validation alone lets Infinity through, so safe integers and ranges
 * are validated again here.
 *
 * @param page Page number (1-based)
 * @param limit Records per page
 * @returns The OFFSET value, or null if page / limit is invalid
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

    // Keep all DB work inside the try block and send the reply after finally,
    // so the connection is closed even on early return or exceptions
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
   * Return the table list or the records of a table, depending on the request.
   * The caller is responsible for closing the database connection.
   * @param database Open database connection
   * @param tableName Table name. If omitted, the table list is returned
   * @param limit Records per page (validated)
   * @param offset Start position (validated)
   * @returns The value to send as the response
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
