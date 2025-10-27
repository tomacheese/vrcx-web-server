import websocketPlugin from '@fastify/websocket'
import { FastifyInstance, FastifyRequest } from 'fastify'
import { Logger } from '@book000/node-utils'
import WebSocket from 'ws'
import {
  FeedRecords,
  GameLogRecords,
  fetchFeedRecords,
  fetchGameLogRecords,
  openDatabase,
} from './lib/vrcx-database'

interface WebSocketQuery {
  limit?: string
}

type WebSocketResponse =
  | { type: 'feed'; items: FeedRecords }
  | { type: 'gamelog'; items: GameLogRecords }
  | { type: 'error'; message: string }

const logger = Logger.configure('websocket')

function parseLimit(limit?: string): number | undefined {
  if (!limit) {
    return undefined
  }
  const parsed = Number.parseInt(limit, 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    return undefined
  }
  return parsed
}

function sendMessage(socket: WebSocket, payload: WebSocketResponse): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return
  }

  try {
    socket.send(JSON.stringify(payload))
  } catch (error) {
    const handledError =
      error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to send WebSocket payload', handledError)
  }
}

function createFeedSender(limit?: number): () => WebSocketResponse | undefined {
  let lastPayload: string | undefined
  let lastError: string | undefined

  return () => {
    try {
      const database = openDatabase()
      try {
        const records = fetchFeedRecords(database, limit)
        const payload: WebSocketResponse = { type: 'feed', items: records }
        const serialized = JSON.stringify(payload)
        if (serialized !== lastPayload) {
          lastPayload = serialized
          lastError = undefined
          return payload
        }
        return undefined
      } finally {
        database.close()
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown error while fetching feed'
      if (message !== lastError) {
        lastError = message
        lastPayload = undefined
        const payload: WebSocketResponse = { type: 'error', message }
        return payload
      }
      return undefined
    }
  }
}

function createGameLogSender(
  limit?: number
): () => WebSocketResponse | undefined {
  let lastPayload: string | undefined
  let lastError: string | undefined

  return () => {
    try {
      const database = openDatabase()
      try {
        const records = fetchGameLogRecords(database, limit)
        const payload: WebSocketResponse = { type: 'gamelog', items: records }
        const serialized = JSON.stringify(payload)
        if (serialized !== lastPayload) {
          lastPayload = serialized
          lastError = undefined
          return payload
        }
        return undefined
      } finally {
        database.close()
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown error while fetching game log'
      if (message !== lastError) {
        lastError = message
        lastPayload = undefined
        const payload: WebSocketResponse = { type: 'error', message }
        return payload
      }
      return undefined
    }
  }
}

function registerFeedWebSocket(
  socket: WebSocket,
  request: FastifyRequest<{ Querystring: WebSocketQuery }>
): void {
  const limit = parseLimit(request.query.limit)
  const getPayload = createFeedSender(limit)

  const send = () => {
    const payload = getPayload()
    if (payload) {
      sendMessage(socket, payload)
    }
  }

  const interval = setInterval(send, 5000)
  socket.on('close', () => {
    clearInterval(interval)
  })
  socket.on('error', (error: Error) => {
    logger.error('Feed WebSocket error', error)
    clearInterval(interval)
  })

  send()
}

function registerGameLogWebSocket(
  socket: WebSocket,
  request: FastifyRequest<{ Querystring: WebSocketQuery }>
): void {
  const limit = parseLimit(request.query.limit)
  const getPayload = createGameLogSender(limit)

  const send = () => {
    const payload = getPayload()
    if (payload) {
      sendMessage(socket, payload)
    }
  }

  const interval = setInterval(send, 5000)
  socket.on('close', () => {
    clearInterval(interval)
  })
  socket.on('error', (error: Error) => {
    logger.error('Game log WebSocket error', error)
    clearInterval(interval)
  })

  send()
}

export async function registerWebSocketRoutes(
  app: FastifyInstance
): Promise<void> {
  await app.register(websocketPlugin)

  await app.register(
    (fastify) => {
      fastify.get<{ Querystring: WebSocketQuery }>(
        '/feed',
        { websocket: true },
        (socket: WebSocket, request) => {
          registerFeedWebSocket(socket, request)
        }
      )

      fastify.get<{ Querystring: WebSocketQuery }>(
        '/gamelog',
        { websocket: true },
        (socket: WebSocket, request) => {
          registerGameLogWebSocket(socket, request)
        }
      )
    },
    { prefix: '/ws' }
  )
}
