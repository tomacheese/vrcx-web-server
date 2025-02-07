import { FastifyReply, FastifyRequest } from 'fastify'
import { BaseRouter } from '.'
import { promises } from 'node:fs'

export class RootRouter extends BaseRouter {
  async init(): Promise<void> {
    await this.fastify.register(
      (fastify, _, done) => {
        fastify.get('/:path', this.routeGet.bind(this))
        done()
      },
      { prefix: '/' }
    )
  }

  async routeGet(
    request: FastifyRequest<{
      Params: {
        path?: string
      }
    }>,
    reply: FastifyReply
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 空白の場合でもデフォルト値を使う
    const path = request.params.path || 'index.html'
    const mapping: Record<string, string> = {
      'index.html': 'text/html',
      'script.js': 'application/javascript',
    }

    if (mapping[path]) {
      reply.header('Content-Type', mapping[path])
    }

    const buffer = await promises.readFile(`./view/${path}`)
    reply.send(buffer)
  }
}
