import DatabaseConstructor from 'better-sqlite3'
import { ENV } from './environments'

/**
 * VRCX の SQLite データベースファイルのパスを解決する
 */
export function resolveDatabasePath(): string {
  const username = process.env.USERNAME
  const defaultPath = `C:\\Users\\${username}\\AppData\\Roaming\\VRCX\\VRCX.sqlite3`
  return ENV.VRCX_SQLITE_FILEPATH || defaultPath
}

/**
 * VRCX の SQLite データベースへ接続する
 */
export function openDatabase(
  options?: DatabaseConstructor.Options
): DatabaseConstructor.Database {
  const path = resolveDatabasePath()
  return new DatabaseConstructor(path, options)
}
