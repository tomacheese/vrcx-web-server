import { Logger } from '@book000/node-utils'
import DatabaseConstructor from 'better-sqlite3'
import { openDatabase } from './database'

export type RealtimeScope = 'feed' | 'gamelog'

type DatabaseRecord = Record<string, unknown> & { id?: unknown }

export interface RealtimeRecordMessage {
  event: 'record'
  scope: RealtimeScope
  type: string
  record: DatabaseRecord
}

interface TableWatcher {
  scope: RealtimeScope
  type: string
  tableName: string
  lastId: number
}

type RealtimeListener = (payload: RealtimeRecordMessage) => void

/**
 * SQLite データベースをポーリングし、更新を WebSocket に配信するためのクラス
 */
export class RealtimeNotifier {
  private readonly logger = Logger.configure('RealtimeNotifier')
  private database: DatabaseConstructor.Database | undefined
  private watchers: Map<string, TableWatcher> = new Map<string, TableWatcher>()
  private pollTimer: NodeJS.Timeout | undefined
  private currentUserId: string | undefined
  private readonly listeners: Set<RealtimeListener> =
    new Set<RealtimeListener>()

  constructor(private readonly pollIntervalMs = 1000) {}

  private logError(message: string, error: unknown): void {
    if (error instanceof Error) {
      this.logger.error(message, error)
    } else {
      this.logger.error(message, new Error(String(error)))
    }
  }

  /**
   * ポーリングを開始する
   */
  start(): void {
    if (this.pollTimer) {
      return
    }

    try {
      this.database = openDatabase({
        readonly: true,
        timeout: 1000,
      })
    } catch (error) {
      this.logError('❌ Failed to open database for realtime notifier', error)
      return
    }

    this.refreshWatchers()
    this.pollTimer = setInterval(() => {
      try {
        this.refreshWatchers()
        this.pollUpdates()
      } catch (error) {
        this.logError('❌ Realtime polling error', error)
      }
    }, this.pollIntervalMs)
  }

  /**
   * ポーリングを停止し、リソースを解放する
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }

    if (this.database) {
      this.database.close()
      this.database = undefined
    }

    this.watchers.clear()
  }

  addListener(listener: RealtimeListener): void {
    this.listeners.add(listener)
  }

  removeListener(listener: RealtimeListener): void {
    this.listeners.delete(listener)
  }

  private refreshWatchers(): void {
    if (!this.database) {
      return
    }

    const newUserId = this.getLastUserId()
    if (newUserId !== this.currentUserId) {
      this.currentUserId = newUserId
      // ユーザーが変わった場合、既存の Feed ウォッチャーをリセットする
      const feedTableNamesToRemove: string[] = []
      for (const [tableName, watcher] of this.watchers) {
        if (watcher.scope === 'feed') {
          feedTableNamesToRemove.push(tableName)
        }
      }
      for (const tableName of feedTableNamesToRemove) {
        this.watchers.delete(tableName)
      }
    }

    const activeConfigs = [
      ...this.buildGamelogWatchers(),
      ...this.buildFeedWatchers(this.currentUserId),
    ]

    const activeTableNames = new Set(
      activeConfigs.map((config) => config.tableName)
    )

    // 新しいウォッチャーを追加
    for (const config of activeConfigs) {
      if (this.watchers.has(config.tableName)) {
        continue
      }
      const lastId = this.getCurrentMaxId(config.tableName)
      this.watchers.set(config.tableName, {
        ...config,
        lastId,
      })
    }

    // 存在しなくなったテーブルのウォッチャーを削除
    const obsoleteTableNames: string[] = []
    for (const tableName of this.watchers.keys()) {
      if (!activeTableNames.has(tableName)) {
        obsoleteTableNames.push(tableName)
      }
    }
    for (const tableName of obsoleteTableNames) {
      this.watchers.delete(tableName)
    }
  }

  private buildGamelogWatchers(): Omit<TableWatcher, 'lastId'>[] {
    if (!this.database) {
      return []
    }

    const tableTypes: { type: string; tableName: string }[] = [
      { type: 'location', tableName: 'gamelog_location' },
      { type: 'join_leave', tableName: 'gamelog_join_leave' },
      { type: 'video_play', tableName: 'gamelog_video_play' },
      { type: 'event', tableName: 'gamelog_event' },
    ]

    return tableTypes
      .filter((candidate) => this.tableExists(candidate.tableName))
      .map((candidate) => ({
        scope: 'gamelog' as const,
        type: candidate.type,
        tableName: candidate.tableName,
      }))
  }

  private buildFeedWatchers(
    userId: string | undefined
  ): Omit<TableWatcher, 'lastId'>[] {
    if (!this.database || !userId) {
      return []
    }

    const sanitized = userId.replaceAll(/[_-]/gu, '')
    if (!sanitized || !/^[A-Za-z0-9]+$/.test(sanitized)) {
      return []
    }

    const feedTables: { type: string; tableName: string }[] = [
      { type: 'gps', tableName: `${sanitized}_feed_gps` },
      { type: 'status', tableName: `${sanitized}_feed_status` },
      { type: 'bio', tableName: `${sanitized}_feed_bio` },
      { type: 'avatar', tableName: `${sanitized}_feed_avatar` },
      { type: 'online_offline', tableName: `${sanitized}_feed_online_offline` },
    ]

    return feedTables
      .filter((candidate) => this.tableExists(candidate.tableName))
      .map((candidate) => ({
        scope: 'feed' as const,
        type: candidate.type,
        tableName: candidate.tableName,
      }))
  }

  private getCurrentMaxId(tableName: string): number {
    if (!this.database) {
      return 0
    }

    try {
      const row = this.database
        .prepare<
          unknown[],
          { maxId: number | null }
        >(`SELECT MAX(id) AS maxId FROM ${tableName}`)
        .get()
      const maxId = row?.maxId
      if (typeof maxId !== 'number') {
        return 0
      }
      return maxId
    } catch (error) {
      this.logError(`❌ Failed to fetch MAX(id) from ${tableName}`, error)
      return 0
    }
  }

  private pollUpdates(): void {
    if (!this.database) {
      return
    }

    for (const watcher of this.watchers.values()) {
      try {
        const rows = this.database
          .prepare<
            unknown[],
            DatabaseRecord
          >(`SELECT * FROM ${watcher.tableName} WHERE id > ? ORDER BY id ASC`)
          .all(watcher.lastId)

        if (rows.length === 0) {
          continue
        }

        const lastRow = rows.at(-1)
        if (!lastRow) {
          continue
        }
        const lastIdNumber = Number(lastRow.id)
        const lastId = Number.isFinite(lastIdNumber)
          ? lastIdNumber
          : watcher.lastId
        watcher.lastId = lastId

        for (const record of rows) {
          const payload: RealtimeRecordMessage = {
            event: 'record',
            scope: watcher.scope,
            type: watcher.type,
            record,
          }
          this.emitMessage(payload)
        }
      } catch (error) {
        this.logError(
          `❌ Failed to fetch incremental records from ${watcher.tableName}`,
          error
        )
      }
    }
  }

  private tableExists(tableName: string): boolean {
    if (!this.database) {
      return false
    }

    try {
      const row = this.database
        .prepare<
          unknown[],
          { name: string }
        >(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(tableName)
      return Boolean(row?.name)
    } catch (error) {
      this.logError(`❌ Failed to check table existence: ${tableName}`, error)
      return false
    }
  }

  private getLastUserId(): string | undefined {
    if (!this.database || !this.tableExists('configs')) {
      return undefined
    }

    try {
      const row = this.database
        .prepare<
          unknown[],
          { value?: string }
        >(`SELECT value FROM configs WHERE key = ? ORDER BY rowid DESC LIMIT 1`)
        .get('config:lastuserloggedin')
      return row?.value
    } catch (error) {
      this.logError('❌ Failed to fetch last user id from configs table', error)
      return undefined
    }
  }

  private emitMessage(payload: RealtimeRecordMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(payload)
      } catch (error) {
        this.logError('❌ Realtime listener error', error)
      }
    }
  }
}
