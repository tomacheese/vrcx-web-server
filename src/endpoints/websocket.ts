import { BaseRouter } from './index'
import { Logger } from '@book000/node-utils'
import { ENV } from '../environments'
import DatabaseConstructor from 'better-sqlite3'
import fs from 'node:fs'

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
  data: any
}

export class WebSocketRouter extends BaseRouter {
  private logger = Logger.configure('WebSocketRouter')
  private clients = new Set<any>()
  private lastModifiedTimes = new Map<string, number>()
  private watchInterval: NodeJS.Timeout | null = null

  async init(): Promise<void> {
    this.logger.info('Initializing WebSocket router')

    await this.fastify.register(
      async (fastify) => {
        fastify.get('/ws', { websocket: true }, (connection) => {
          this.handleConnection(connection)
        })
      },
      { prefix: '/api' }
    )

    // Start monitoring for database changes
    this.startDatabaseMonitoring()
  }

  private handleConnection(connection: any): void {
    this.logger.info('WebSocket client connected')
    this.clients.add(connection)

    connection.on('message', (message: Buffer) => {
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

    connection.on('error', (error: Error) => {
      this.logger.error('WebSocket error:', error)
      this.clients.delete(connection)
    })

    // Send initial data
    this.sendInitialData(connection)
  }

  private handleMessage(connection: any, message: WebSocketMessage): void {
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

  private async sendInitialData(connection: any): Promise<void> {
    try {
      const feedData = await this.getFeedData()
      const gamelogData = await this.getGamelogData()

      connection.send(
        JSON.stringify({
          type: 'initial_data',
          data: {
            feed: feedData,
            gamelog: gamelogData,
          },
        })
      )
    } catch (error) {
      this.logger.error('Error sending initial data:', error as Error)
    }
  }

  private startDatabaseMonitoring(): void {
    // Check for database changes every 2 seconds
    this.watchInterval = setInterval(() => {
      this.checkForDatabaseChanges()
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

      const lastModTime = this.lastModifiedTimes.get(path)!
      if (currentModTime > lastModTime) {
        this.logger.info('Database change detected, broadcasting updates')
        this.lastModifiedTimes.set(path, currentModTime)
        await this.broadcastUpdates()
      }
    } catch (error) {
      this.logger.error('Error checking database changes:', error as Error)
    }
  }

  private async broadcastUpdates(): Promise<void> {
    try {
      const feedData = await this.getFeedData()
      const gamelogData = await this.getGamelogData()

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
    } catch (error) {
      this.logger.error('Error broadcasting updates:', error as Error)
    }
  }

  private async getFeedData(): Promise<DataRecord[]> {
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

      const userId = (configRecords[0] as any).value
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

          for (const record of records as any[]) {
            let details = ''
            let displayType = type

            switch (type) {
            case 'status': {
              details = `${record.status_description} (${record.status})`
            
            break;
            }
            case 'online_offline': {
              details = this.getWorldName(record)
              displayType = record.type?.toLowerCase() || type
            
            break;
            }
            case 'gps': {
              details = this.getWorldName(record)
            
            break;
            }
            // No default
            }

            feedData.push({
              id: `${type}-${record.id}`,
              created_at: record.created_at,
              type: displayType,
              display_name: record.display_name || '',
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

  private async getGamelogData(): Promise<DataRecord[]> {
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

          for (const record of records as any[]) {
            let details = ''
            let displayType = type
            let id = `${type}-${record.id}`

            switch (type) {
            case 'location': {
              details = this.getWorldName(record)
            
            break;
            }
            case 'join_leave': {
              displayType = record.type?.toLowerCase() || type
              id = `${record.type}-${record.id}`
            
            break;
            }
            case 'video_play': {
              details = record.video_name || ''
            
            break;
            }
            // No default
            }

            gamelogData.push({
              id,
              created_at: record.created_at,
              type: displayType,
              display_name: record.display_name || '',
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

  private getWorldName(item: any): string {
    const worldName = item.world_name
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

  async destroy(): Promise<void> {
    if (this.watchInterval) {
      clearInterval(this.watchInterval)
      this.watchInterval = null
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
