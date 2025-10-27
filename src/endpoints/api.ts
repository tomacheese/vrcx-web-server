import { FastifyReply, FastifyRequest } from 'fastify'
import { BaseRouter } from '.'
import DatabaseConstructor from 'better-sqlite3'
import { openDatabase } from '../database'

export class ApiRouter extends BaseRouter {
  async init(): Promise<void> {
    await this.fastify.register(
      (fastify, _, done) => {
        fastify.get('/:tableName', this.routeGet.bind(this))
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
        page?: number
        limit?: number
      }
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const database = openDatabase({
      readonly: true,
    })

    const tableName = request.params.tableName

    const tables = this.getTables(database)
    const tableNames = tables.map((table) => table.name)

    if (!tableName) {
      // list tables
      const tableRecordCounts = this.getTableRecordCounts(database, tables)
      await reply.send(tableRecordCounts)
      return
    }

    // list records
    const page = request.query.page ?? 1
    const limit = request.query.limit ?? 10
    if (page < 1 || limit < 1) {
      await reply.send({ error: 'Invalid page or limit' })
      return
    }
    if (!tableNames.includes(tableName)) {
      await reply.send({ error: 'Table not found' })
      return
    }
    const records = this.getRecords(database, tableName, page, limit)

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
        >(`SELECT COUNT(*) AS count FROM ${table.name}`)
        .get() ?? { count: 0 }
      return { name: table.name, count: result.count }
    })
  }

  private getRecords(
    database: DatabaseConstructor.Database,
    tableName: string,
    page: number,
    limit: number
  ) {
    return database
      .prepare(
        `SELECT * FROM ${tableName} ORDER BY rowid DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`
      )
      .all()
  }
}
