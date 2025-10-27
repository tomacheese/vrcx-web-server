import { Logger } from '@book000/node-utils'
import DatabaseConstructor from 'better-sqlite3'
import { ENV } from '../environments'

export interface FeedTablePayload {
  gps: unknown[]
  status: unknown[]
  bio: unknown[]
  avatar: unknown[]
  online_offline: unknown[]
}

export interface GameLogTablePayload {
  location: unknown[]
  join_leave: unknown[]
  video_play: unknown[]
  event: unknown[]
}

export class VrcxSqliteService {
  private static readonly logger = Logger.configure('VrcxSqliteService')
  private static toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }

  private static getDatabasePath(): string {
    const username = process.env.USERNAME
    const defaultPath = username
      ? `C:/Users/${username}/AppData/Roaming/VRCX/VRCX.sqlite3`
      : ''
    return ENV.VRCX_SQLITE_FILEPATH || defaultPath
  }

  private static openDatabase(): DatabaseConstructor.Database {
    const path = this.getDatabasePath()
    if (!path) {
      throw new Error('VRCX database path is not configured')
    }

    try {
      return new DatabaseConstructor(path, {
        readonly: true,
      })
    } catch (error) {
      this.logger.error('Failed to open database', this.toError(error))
      throw error
    }
  }

  private static withDatabase<T>(
    callback: (database: DatabaseConstructor.Database) => T
  ): T {
    const database = this.openDatabase()
    try {
      return callback(database)
    } finally {
      database.close()
    }
  }

  static listTables(): { name: string }[] {
    return this.withDatabase((database) => this.getTables(database))
  }

  static getTableRecordCounts(): { name: string; count: number }[] {
    return this.withDatabase((database) =>
      this.computeTableRecordCounts(database)
    )
  }

  static getRecords(tableName: string, page: number, limit: number): unknown[] {
    return this.withDatabase((database) => {
      return this.queryRecords(database, tableName, page, limit)
    })
  }

  static getFeedTables(userId: string, limit: number): FeedTablePayload {
    const sanitizedUserId = this.sanitizeUserId(userId)
    const tables = {
      gps: `${sanitizedUserId}_feed_gps`,
      status: `${sanitizedUserId}_feed_status`,
      bio: `${sanitizedUserId}_feed_bio`,
      avatar: `${sanitizedUserId}_feed_avatar`,
      online_offline: `${sanitizedUserId}_feed_online_offline`,
    }

    return this.withDatabase((database) => ({
      gps: this.queryRecords(database, tables.gps, 1, limit),
      status: this.queryRecords(database, tables.status, 1, limit),
      bio: this.queryRecords(database, tables.bio, 1, limit),
      avatar: this.queryRecords(database, tables.avatar, 1, limit),
      online_offline: this.queryRecords(
        database,
        tables.online_offline,
        1,
        limit
      ),
    }))
  }

  static getGameLogTables(limit: number): GameLogTablePayload {
    return this.withDatabase((database) => ({
      location: this.queryRecords(database, 'gamelog_location', 1, limit),
      join_leave: this.queryRecords(database, 'gamelog_join_leave', 1, limit),
      video_play: this.queryRecords(database, 'gamelog_video_play', 1, limit),
      event: this.queryRecords(database, 'gamelog_event', 1, limit),
    }))
  }

  private static sanitizeUserId(userId: string): string {
    return userId.replaceAll(/[_-]/g, '')
  }

  private static getTables(
    database: DatabaseConstructor.Database
  ): { name: string }[] {
    return database
      .prepare<
        unknown[],
        { name: string }
      >("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
  }

  private static computeTableRecordCounts(
    database: DatabaseConstructor.Database
  ) {
    const tables = this.getTables(database)
    return tables.map((table) => {
      try {
        const result = database
          .prepare<
            unknown[],
            { count: number }
          >(`SELECT COUNT(*) AS count FROM ${table.name}`)
          .get()
        return { name: table.name, count: result?.count ?? 0 }
      } catch (error) {
        this.logger.warn(
          `Failed to count records for table ${table.name}`,
          this.toError(error)
        )
        return { name: table.name, count: 0 }
      }
    })
  }

  private static queryRecords(
    database: DatabaseConstructor.Database,
    tableName: string,
    page: number,
    limit: number
  ): unknown[] {
    if (!tableName) {
      return []
    }

    const offset = (page - 1) * limit

    try {
      return database
        .prepare(
          `SELECT * FROM ${tableName} ORDER BY rowid DESC LIMIT $limit OFFSET $offset`
        )
        .all({ limit, offset })
    } catch (error) {
      if (error instanceof Error && error.message.includes('no such table')) {
        this.logger.warn(`Table not found: ${tableName}`)
        return []
      }
      this.logger.error(
        `Failed to query table ${tableName}`,
        this.toError(error)
      )
      throw error
    }
  }
}
