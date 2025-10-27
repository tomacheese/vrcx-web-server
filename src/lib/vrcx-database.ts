import DatabaseConstructor from 'better-sqlite3'
import { ENV } from '../environments'

const DEFAULT_LIMIT = 1000

function getDatabasePath(): string {
  const username = process.env.USERNAME
  const defaultPath = username
    ? `C:/Users/${username}/AppData/Roaming/VRCX/VRCX.sqlite3`
    : 'C:/Users/UNKNOWN/AppData/Roaming/VRCX/VRCX.sqlite3'
  return ENV.VRCX_SQLITE_FILEPATH || defaultPath
}

export function openDatabase(): DatabaseConstructor.Database {
  const path = getDatabasePath()
  return new DatabaseConstructor(path, { readonly: true })
}

interface TableRecord {
  name: string
}

interface CountRecord {
  count: number
}

interface ConfigRecord {
  value: string
}

type FeedRecordType = 'gps' | 'status' | 'bio' | 'avatar' | 'online_offline'

export type FeedRecords = Record<FeedRecordType, Record<string, unknown>[]>

const FEED_TABLE_SUFFIXES: Record<FeedRecordType, string> = {
  gps: 'feed_gps',
  status: 'feed_status',
  bio: 'feed_bio',
  avatar: 'feed_avatar',
  online_offline: 'feed_online_offline',
}

type GameLogRecordType = 'location' | 'join_leave' | 'video_play' | 'event'

export type GameLogRecords = Record<
  GameLogRecordType,
  Record<string, unknown>[]
>

const GAME_LOG_TABLE_SUFFIXES: Record<GameLogRecordType, string> = {
  location: 'gamelog_location',
  join_leave: 'gamelog_join_leave',
  video_play: 'gamelog_video_play',
  event: 'gamelog_event',
}

export function listTables(
  database: DatabaseConstructor.Database
): TableRecord[] {
  return database
    .prepare<
      unknown[],
      TableRecord
    >("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
}

export function getTableRecordCounts(
  database: DatabaseConstructor.Database,
  tables: TableRecord[]
): { name: string; count: number }[] {
  return tables.map((table) => {
    const result = database
      .prepare<
        unknown[],
        CountRecord
      >(`SELECT COUNT(*) AS count FROM ${table.name}`)
      .get() ?? { count: 0 }
    return { name: table.name, count: result.count }
  })
}

export function getRecords(
  database: DatabaseConstructor.Database,
  tableName: string,
  page: number,
  limit: number
): Record<string, unknown>[] {
  return database
    .prepare<
      unknown[],
      Record<string, unknown>
    >(`SELECT * FROM ${tableName} ORDER BY rowid DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`)
    .all()
}

function getLatestRecords(
  database: DatabaseConstructor.Database,
  tableName: string,
  limit: number
): Record<string, unknown>[] {
  return getRecords(database, tableName, 1, limit)
}

function getLastLoggedInUserId(
  database: DatabaseConstructor.Database
): string | undefined {
  const result = database
    .prepare<
      [string],
      ConfigRecord
    >('SELECT value FROM configs WHERE key = ? LIMIT 1')
    .get('config:lastuserloggedin')
  return result?.value
}

function sanitizeUserId(userId: string | undefined): string | undefined {
  if (!userId) {
    return undefined
  }
  return userId.replaceAll(/[_-]/g, '')
}

function tableExists(
  database: DatabaseConstructor.Database,
  tableName: string
): boolean {
  const result = database
    .prepare<
      [string],
      TableRecord
    >("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(tableName)
  return result !== undefined
}

function ensureValidLimit(limit: number | undefined): number {
  if (!limit || Number.isNaN(limit) || limit <= 0) {
    return DEFAULT_LIMIT
  }
  return Math.min(limit, DEFAULT_LIMIT)
}

export function fetchFeedRecords(
  database: DatabaseConstructor.Database,
  limit?: number
): FeedRecords {
  const sanitizedUserId = sanitizeUserId(getLastLoggedInUserId(database))
  if (!sanitizedUserId) {
    throw new Error('Last logged in user ID not found in configs table')
  }
  const actualLimit = ensureValidLimit(limit)

  const records = Object.fromEntries(
    Object.entries(FEED_TABLE_SUFFIXES).map(([type, suffix]) => {
      const tableName = `${sanitizedUserId}_${suffix}`
      if (!tableExists(database, tableName)) {
        return [type, []]
      }
      return [type, getLatestRecords(database, tableName, actualLimit)]
    })
  ) as FeedRecords

  return records
}

export function fetchGameLogRecords(
  database: DatabaseConstructor.Database,
  limit?: number
): GameLogRecords {
  const actualLimit = ensureValidLimit(limit)

  const records = Object.fromEntries(
    Object.entries(GAME_LOG_TABLE_SUFFIXES).map(([type, tableName]) => {
      if (!tableExists(database, tableName)) {
        return [type, []]
      }
      return [type, getLatestRecords(database, tableName, actualLimit)]
    })
  ) as GameLogRecords

  return records
}
