import fastify, { FastifyInstance } from 'fastify'
import { BaseRouter } from './endpoints'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import WebSocket from 'ws'
import { Logger } from '@book000/node-utils'
import { ApiRouter } from './endpoints/api'
import { RootRouter } from './endpoints/root'
import { RealtimeNotifier, RealtimeRecordMessage } from './realtime'
/**
 * Fastify アプリケーションを構築する
 *
 * @returns Fastify アプリケーション
 */
export async function buildApp(): Promise<FastifyInstance> {
  const logger = Logger.configure('buildApp')

  const app = fastify()
  await app.register(websocket)
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  })

  const notifier = new RealtimeNotifier()
  notifier.start()

  app.get('/ws', { websocket: true }, (socket: WebSocket) => {
    const listener = (payload: RealtimeRecordMessage) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload))
      }
    }

    notifier.addListener(listener)
    socket.on('close', () => {
      notifier.removeListener(listener)
    })
  })

  app.addHook('onClose', () => {
    notifier.stop()
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
