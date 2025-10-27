import { FastifyReply, FastifyRequest } from 'fastify'
import { BaseRouter } from '.'
import { Logger } from '@book000/node-utils'
import { VrcxSqliteService } from '../services/vrcx-sqlite.service'

export class ApiRouter extends BaseRouter {
  private readonly logger = Logger.configure('ApiRouter')

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
    try {
      const tableName = request.params.tableName

      if (!tableName) {
        const tableRecordCounts = VrcxSqliteService.getTableRecordCounts()
        await reply.send(tableRecordCounts)
        return
      }

      const page = request.query.page ?? 1
      const limit = request.query.limit ?? 10

      if (page < 1 || limit < 1) {
        await reply.send({ error: 'Invalid page or limit' })
        return
      }

      const tables = VrcxSqliteService.listTables()
      const tableNames = tables.map((table) => table.name)

      if (!tableNames.includes(tableName)) {
        await reply.send({ error: 'Table not found' })
        return
      }

      const records = VrcxSqliteService.getRecords(tableName, page, limit)

      await reply.send(records)
    } catch (error) {
      this.logger.error(
        'Failed to handle API request',
        error instanceof Error ? error : new Error(String(error))
      )
      await reply.status(500).send({ error: 'Internal Server Error' })
    }
  }
}
