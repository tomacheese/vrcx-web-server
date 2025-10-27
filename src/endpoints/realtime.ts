import { FastifyRequest } from 'fastify'
import { BaseRouter } from '.'
import { Logger } from '@book000/node-utils'
import type WebSocket from 'ws'
import {
  FeedTablePayload,
  GameLogTablePayload,
  VrcxSqliteService,
} from '../services/vrcx-sqlite.service'

interface RealtimeQuerystring {
  channel?: 'feed' | 'gamelog'
  userId?: string
  limit?: string
}

interface FeedMessage {
  type: 'feed'
  data: FeedTablePayload
}

interface GameLogMessage {
  type: 'gamelog'
  data: GameLogTablePayload
}

interface ErrorMessage {
  type: 'error'
  message: string
}

export class RealtimeRouter extends BaseRouter {
  private readonly logger = Logger.configure('RealtimeRouter')
  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }

  async init(): Promise<void> {
    await this.fastify.register(
      (fastify, _, done) => {
        fastify.get('/', { websocket: true }, this.routeRealtime.bind(this))
        done()
      },
      { prefix: '/ws' }
    )
  }

  private routeRealtime(
    socket: WebSocket,
    request: FastifyRequest<{ Querystring: RealtimeQuerystring }>
  ): void {
    const channel = request.query.channel
    const limit = this.parseLimit(request.query.limit, 1000)

    if (channel === 'feed') {
      const userId = request.query.userId
      if (!userId) {
        this.safeSendError(socket, 'userId is required')
        return
      }
      this.handleFeedChannel(socket, userId, limit)
      return
    }

    if (channel === 'gamelog') {
      this.handleGameLogChannel(socket, limit)
      return
    }

    this.safeSendError(socket, 'channel must be "feed" or "gamelog"')
  }

  private handleFeedChannel(socket: WebSocket, userId: string, limit: number) {
    let closed = false
    let latestTimestamp: number | undefined
    let hasSentInitial = false

    const sendUpdates = () => {
      try {
        const payload = VrcxSqliteService.getFeedTables(userId, limit)
        const currentTimestamp = this.getLatestTimestampFromPayload(payload)
        if (
          !hasSentInitial ||
          this.isNewerTimestamp(currentTimestamp, latestTimestamp)
        ) {
          const message: FeedMessage = { type: 'feed', data: payload }
          socket.send(JSON.stringify(message))
          hasSentInitial = true
          if (currentTimestamp !== undefined) {
            latestTimestamp = currentTimestamp
          }
        }
      } catch (error) {
        this.logger.error('Failed to broadcast feed data', this.toError(error))
        this.safeSendError(socket, 'Failed to read feed data')
      }
    }

    const timer = setInterval(sendUpdates, 2000)
    socket.on('close', () => {
      closed = true
      clearInterval(timer)
    })

    socket.on('error', (error: Error) => {
      this.logger.error('WebSocket error on feed channel', error)
      if (!closed) {
        clearInterval(timer)
      }
    })

    sendUpdates()
  }

  private handleGameLogChannel(socket: WebSocket, limit: number) {
    let closed = false
    let latestTimestamp: number | undefined
    let hasSentInitial = false

    const sendUpdates = () => {
      try {
        const payload = VrcxSqliteService.getGameLogTables(limit)
        const currentTimestamp = this.getLatestTimestampFromPayload(payload)
        if (
          !hasSentInitial ||
          this.isNewerTimestamp(currentTimestamp, latestTimestamp)
        ) {
          const message: GameLogMessage = { type: 'gamelog', data: payload }
          socket.send(JSON.stringify(message))
          hasSentInitial = true
          if (currentTimestamp !== undefined) {
            latestTimestamp = currentTimestamp
          }
        }
      } catch (error) {
        this.logger.error(
          'Failed to broadcast game log data',
          this.toError(error)
        )
        this.safeSendError(socket, 'Failed to read game log data')
      }
    }

    const timer = setInterval(sendUpdates, 2000)
    socket.on('close', () => {
      closed = true
      clearInterval(timer)
    })

    socket.on('error', (error: Error) => {
      this.logger.error('WebSocket error on game log channel', error)
      if (!closed) {
        clearInterval(timer)
      }
    })

    sendUpdates()
  }

  private safeSendError(socket: WebSocket, message: string) {
    try {
      const payload: ErrorMessage = { type: 'error', message }
      socket.send(JSON.stringify(payload))
    } catch (error) {
      this.logger.error(
        'Failed to send websocket error message',
        this.toError(error)
      )
    } finally {
      socket.close(1011, message)
    }
  }

  private parseLimit(value: string | undefined, defaultValue: number): number {
    if (!value) {
      return defaultValue
    }

    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed) || parsed <= 0) {
      return defaultValue
    }

    return parsed
  }

  private isNewerTimestamp(
    current: number | undefined,
    latest: number | undefined
  ) {
    if (current === undefined) {
      return false
    }
    if (latest === undefined) {
      return true
    }
    return current > latest
  }

  private getLatestTimestampFromPayload(
    payload: FeedTablePayload | GameLogTablePayload
  ) {
    let timestamp: number | undefined

    for (const records of Object.values(payload)) {
      for (const record of records) {
        const createdAt = this.extractCreatedAt(record)
        if (
          createdAt !== undefined &&
          (timestamp === undefined || createdAt > timestamp)
        ) {
          timestamp = createdAt
        }
      }
    }

    return timestamp
  }

  private extractCreatedAt(record: unknown) {
    if (typeof record !== 'object' || record === null) {
      return undefined
    }

    const value = (record as Record<string, unknown>).created_at
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value)
      const timestamp = date.getTime()
      if (!Number.isNaN(timestamp)) {
        return timestamp
      }
    }

    return undefined
  }
}
