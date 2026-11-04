import { FastifyReply, FastifyRequest } from 'fastify'
import { BaseRouter } from '.'
import { promises } from 'node:fs'

/**
 * Allowlist of servable files and their Content-Type.
 *
 * Files not listed here are never served, which prevents reading outside the
 * view directory through an arbitrary path.
 */
const SERVABLE_FILES: ReadonlyMap<string, string> = new Map([
  ['index.html', 'text/html'],
  ['script.js', 'application/javascript'],
])

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
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- use the default value even when the path is empty
    const path = request.params.path || 'index.html'
    const contentType = SERVABLE_FILES.get(path)

    if (contentType === undefined) {
      reply.code(404).send({ error: `File not found: ${path}` })
      return
    }

    const buffer = await promises.readFile(`./view/${path}`)
    reply.header('Content-Type', contentType).send(buffer)
  }
}
