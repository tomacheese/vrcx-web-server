import { BaseRouter } from './index'
import { Logger } from '@book000/node-utils'
import { ENV } from '../environments'
import DatabaseConstructor from 'better-sqlite3'
import fs from 'node:fs'

// @types/ws is required for @fastify/websocket types even though not directly imported
// This prevents TypeScript error: Could not find a declaration file for module 'ws'

interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping'
  data?: {
    feed?: boolean
    gamelog?: boolean
  }
}

interface DataRecord {
  id: string
  created_at: string
  type: string
  display_name: string
  details: string
  data: unknown
}

// Type for WebSocket connection from @fastify/websocket
interface FastifyWebSocketConnection {
  send: (data: string) => void
  on: (event: string, handler: (...args: unknown[]) => void) => void
  close: () => void
}

export class WebSocketRouter extends BaseRouter {
  private logger = Logger.configure('WebSocketRouter')
  private clients = new Set<FastifyWebSocketConnection>()
  private lastModifiedTimes = new Map<string, number>()
  private watchInterval: NodeJS.Timeout | undefined

  async init(): Promise<void> {
    this.logger.info('Initializing WebSocket router')

    await this.fastify.register(
      (fastify) => {
        fastify.get('/ws', { websocket: true }, (connection) => {
          this.handleConnection(connection as FastifyWebSocketConnection)
        })
      },
      { prefix: '/api' }
    )

    // Start monitoring for database changes
    this.startDatabaseMonitoring()
  }

  private handleConnection(connection: FastifyWebSocketConnection): void {
    this.logger.info('WebSocket client connected')
    this.clients.add(connection)

    connection.on('message', (...args: unknown[]) => {
      const message = args[0] as Buffer
      try {
        const data: WebSocketMessage = JSON.parse(message.toString())
        this.handleMessage(connection, data)
      } catch (error) {
        this.logger.error('Error parsing WebSocket message:', error as Error)
      }
    })

    connection.on('close', () => {
      this.logger.info('WebSocket client disconnected')
      this.clients.delete(connection)
    })

    connection.on('error', (...args: unknown[]) => {
      const error = args[0] as Error
      this.logger.error('WebSocket error:', error)
      this.clients.delete(connection)
    })

    // Send initial data
    this.sendInitialData(connection).catch((error: unknown) => {
      this.logger.error('Error sending initial data:', error as Error)
    })
  }

  private handleMessage(
    connection: FastifyWebSocketConnection,
    message: WebSocketMessage
  ): void {
    switch (message.type) {
      case 'ping': {
        connection.send(JSON.stringify({ type: 'pong' }))
        break
      }
      case 'subscribe': {
        // Client is subscribing - already handled by being connected
        this.logger.info('Client subscribed to updates')
        break
      }
      case 'unsubscribe': {
        // Client wants to unsubscribe but stay connected
        this.logger.info('Client unsubscribed from updates')
        break
      }
      default: {
        this.logger.warn('Unknown WebSocket message type:', message.type)
      }
    }
  }

  private sendInitialData(
    connection: FastifyWebSocketConnection
  ): Promise<void> {
    return new Promise((resolve) => {
      try {
        const feedData = this.getFeedData()
        const gamelogData = this.getGamelogData()

        connection.send(
          JSON.stringify({
            type: 'initial_data',
            data: {
              feed: feedData,
              gamelog: gamelogData,
            },
          })
        )
        resolve()
      } catch (error) {
        this.logger.error('Error sending initial data:', error as Error)
        resolve()
      }
    })
  }

  private startDatabaseMonitoring(): void {
    // Check for database changes every 2 seconds
    this.watchInterval = setInterval(() => {
      this.checkForDatabaseChanges().catch((error: unknown) => {
        this.logger.error('Error checking database changes:', error as Error)
      })
    }, 2000)

    this.logger.info('Started database monitoring')
  }

  private async checkForDatabaseChanges(): Promise<void> {
    if (this.clients.size === 0) {
      return // No clients connected, skip monitoring
    }

    try {
      const username = process.env.USERNAME
      const defaultPath = `C:\\Users\\${username}\\AppData\\Roaming\\VRCX\\VRCX.sqlite3`
      const path = ENV.VRCX_SQLITE_FILEPATH || defaultPath

      if (!fs.existsSync(path)) {
        return // Database file doesn't exist
      }

      const stats = fs.statSync(path)
      const currentModTime = stats.mtime.getTime()

      if (!this.lastModifiedTimes.has(path)) {
        this.lastModifiedTimes.set(path, currentModTime)
        return
      }

      const lastModTime = this.lastModifiedTimes.get(path)
      if (lastModTime && currentModTime > lastModTime) {
        this.logger.info('Database change detected, broadcasting updates')
        this.lastModifiedTimes.set(path, currentModTime)
        await this.broadcastUpdates()
      }
    } catch (error) {
      this.logger.error('Error checking database changes:', error as Error)
    }
  }

  private broadcastUpdates(): Promise<void> {
    return new Promise((resolve) => {
      try {
        const feedData = this.getFeedData()
        const gamelogData = this.getGamelogData()

        const message = JSON.stringify({
          type: 'data_update',
          data: {
            feed: feedData,
            gamelog: gamelogData,
          },
        })

        // Broadcast to all connected clients
        for (const client of this.clients) {
          try {
            client.send(message)
          } catch (error) {
            this.logger.error('Error sending to client:', error as Error)
            this.clients.delete(client)
          }
        }
        resolve()
      } catch (error) {
        this.logger.error('Error broadcasting updates:', error as Error)
        resolve()
      }
    })
  }

  private getFeedData(): DataRecord[] {
    const username = process.env.USERNAME
    const defaultPath = `C:\\Users\\${username}\\AppData\\Roaming\\VRCX\\VRCX.sqlite3`
    const path = ENV.VRCX_SQLITE_FILEPATH || defaultPath

    if (!fs.existsSync(path)) {
      return []
    }

    const database = new DatabaseConstructor(path, { readonly: true })

    try {
      // Get user ID first
      const configRecords = database
        .prepare('SELECT * FROM configs WHERE key = ? LIMIT 1')
        .all('config:lastuserloggedin')

      if (configRecords.length === 0) {
        return []
      }

      const userId = (configRecords[0] as { value: string }).value
      const pathUserId = userId.replaceAll(/[_-]/g, '')

      const feedData: DataRecord[] = []

      // Fetch different types of feed data
      const feedTypes = ['gps', 'status', 'bio', 'avatar', 'online_offline']

      for (const type of feedTypes) {
        try {
          const tableName = `${pathUserId}_feed_${type}`
          const records = database
            .prepare(
              `SELECT * FROM ${tableName} ORDER BY created_at DESC LIMIT 1000`
            )
            .all()

          for (const record of records) {
            const recordData = record as {
              id: string
              created_at: string
              display_name?: string
              status_description?: string
              status?: string
              type?: string
              world_name?: string
            }

            let details = ''
            let displayType = type

            if (
              type === 'status' &&
              recordData.status_description &&
              recordData.status
            ) {
              details = `${recordData.status_description} (${recordData.status})`
            } else if (type === 'online_offline') {
              details = this.getWorldName(record)
              displayType = recordData.type?.toLowerCase() ?? type
            } else if (type === 'gps') {
              details = this.getWorldName(record)
            }

            feedData.push({
              id: `${type}-${recordData.id}`,
              created_at: recordData.created_at,
              type: displayType,
              display_name: recordData.display_name ?? '',
              details,
              data: record,
            })
          }
        } catch {
          // Table might not exist, skip silently
        }
      }

      return feedData.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    } finally {
      database.close()
    }
  }

  private getGamelogData(): DataRecord[] {
    const username = process.env.USERNAME
    const defaultPath = `C:\\Users\\${username}\\AppData\\Roaming\\VRCX\\VRCX.sqlite3`
    const path = ENV.VRCX_SQLITE_FILEPATH || defaultPath

    if (!fs.existsSync(path)) {
      return []
    }

    const database = new DatabaseConstructor(path, { readonly: true })

    try {
      const gamelogData: DataRecord[] = []

      // Fetch different types of game log data
      const gamelogTypes = ['location', 'join_leave', 'video_play', 'event']

      for (const type of gamelogTypes) {
        try {
          const tableName = `gamelog_${type}`
          const records = database
            .prepare(
              `SELECT * FROM ${tableName} ORDER BY created_at DESC LIMIT 1000`
            )
            .all()

          for (const record of records) {
            const recordData = record as {
              id: string
              created_at: string
              display_name?: string
              type?: string
              video_name?: string
            }

            let details = ''
            let displayType = type
            let id = `${type}-${recordData.id}`

            switch (type) {
              case 'location': {
                details = this.getWorldName(record)
                break
              }
              case 'join_leave': {
                displayType = recordData.type?.toLowerCase() ?? type
                id = `${recordData.type ?? type}-${recordData.id}`
                break
              }
              case 'video_play': {
                details = recordData.video_name ?? ''
                break
              }
            }

            gamelogData.push({
              id,
              created_at: recordData.created_at,
              type: displayType,
              display_name: recordData.display_name ?? '',
              details,
              data: record,
            })
          }
        } catch {
          // Table might not exist, skip silently
        }
      }

      return gamelogData.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    } finally {
      database.close()
    }
  }

  private getWorldName(item: unknown): string {
    const itemData = item as { world_name?: string }
    const worldName = itemData.world_name
    if (!worldName) {
      return ''
    }

    // Extract world name from full path
    const worldNameParts = worldName.split(' ')
    if (worldNameParts.length > 1) {
      return worldNameParts.slice(1).join(' ')
    }
    return worldName
  }

  destroy(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval)
      this.watchInterval = undefined
    }

    // Close all WebSocket connections
    for (const client of this.clients) {
      try {
        client.close()
      } catch (error) {
        this.logger.error('Error closing WebSocket connection:', error as Error)
      }
    }
    this.clients.clear()

    this.logger.info('WebSocket router destroyed')
  }
}
