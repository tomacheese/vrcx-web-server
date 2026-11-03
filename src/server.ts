import fastify, { FastifyInstance } from 'fastify'
import { BaseRouter } from './endpoints'
import cors from '@fastify/cors'
import { Logger } from '@book000/node-utils'
import { ApiRouter } from './endpoints/api'
import { RootRouter } from './endpoints/root'
/**
 * Build the Fastify application.
 *
 * @returns The Fastify application
 */
export async function buildApp(): Promise<FastifyInstance> {
  const logger = Logger.configure('buildApp')

  const app = fastify()
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  })

  // routers
  const routers: BaseRouter[] = [new RootRouter(app), new ApiRouter(app)]

  for (const router of routers) {
    logger.info(`⏩ Initializing route: ${router.constructor.name}`)
    await router.init()
  }

  // print routes
  logger.info('📃 Routes:')
  for (const element of app.printRoutes().split('\n')) {
    logger.info(element)
  }

  return app
}
