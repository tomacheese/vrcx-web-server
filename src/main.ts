import { Logger } from '@book000/node-utils'
import { buildApp } from './server'
import { ENV } from './environments'

async function main() {
  const logger = Logger.configure('main')

  logger.info('🔄 Loading configuration')

  const app = await buildApp()
  const host = ENV.API_HOST
  const port = ENV.API_PORT ? Number.parseInt(ENV.API_PORT, 10) : 8000
  app.listen({ host, port }, (error, address) => {
    if (error) {
      logger.error('❌ Fastify.listen error', error)
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1)
    }
    logger.info(`✅ Server listening at ${address}`)
  })
}

;(async () => {
  await main()
})()
