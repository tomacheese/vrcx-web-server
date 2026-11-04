import { FastifyInstance } from 'fastify'

/**
 * Base class for REST API routers.
 */
export abstract class BaseRouter {
  protected fastify: FastifyInstance

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify
  }

  /**
   * Initialize the router by registering it with `this.fastify.register()`.
   */
  abstract init(): Promise<void>
}
