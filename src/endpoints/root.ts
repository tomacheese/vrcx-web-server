import { FastifyReply, FastifyRequest } from 'fastify'
import { BaseRouter } from '.'

export class RootRouter extends BaseRouter {
  async init(): Promise<void> {
    await this.fastify.register(
      (fastify, _, done) => {
        fastify.get('/', this.routeGet.bind(this))
        done()
      },
      { prefix: '/' }
    )
  }

  async routeGet(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await reply.send({ service: 'VRCX Web Server' })
  }
}
