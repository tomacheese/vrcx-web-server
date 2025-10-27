import { FastifyReply, FastifyRequest } from 'fastify'
import { BaseRouter } from '.'
import {
  getRecords,
  getTableRecordCounts,
  listTables,
  openDatabase,
} from '../lib/vrcx-database'

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
    const database = openDatabase()

    const tableName = request.params.tableName

    const tables = listTables(database)
    const tableNames = tables.map((table) => table.name)

    if (!tableName) {
      // list tables
      const tableRecordCounts = getTableRecordCounts(database, tables)
      database.close()
      await reply.send(tableRecordCounts)
      return
    }

    // list records
    const page = request.query.page ?? 1
    const limit = request.query.limit ?? 10
    if (page < 1 || limit < 1) {
      database.close()
      await reply.send({ error: 'Invalid page or limit' })
      return
    }
    if (!tableNames.includes(tableName)) {
      database.close()
      await reply.send({ error: 'Table not found' })
      return
    }
    const records = getRecords(database, tableName, page, limit)

    database.close()

    await reply.send(records)
  }
}
