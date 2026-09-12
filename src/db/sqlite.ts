/**
 * SQLite engine wrapper.
 *
 * The database is a real SQLite file held in memory by sql.js (SQLite
 * compiled to WebAssembly) and flushed to device storage after every
 * committed write. There is no server and no network call anywhere in
 * this module.
 */
import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic, SqlValue } from 'sql.js'
import { readBytes, writeBytes, requestPersistentStorage, currentBackend } from './persistence'

export type Row = Record<string, SqlValue>
export type Params = SqlValue[] | Record<string, SqlValue>

let SQL: SqlJsStatic | null = null
let db: Database | null = null
let persistEnabled = true

/** Set false in tests to keep everything in memory. */
export function setPersistence(enabled: boolean): void {
  persistEnabled = enabled
}

async function loadEngine(): Promise<SqlJsStatic> {
  if (SQL) return SQL
  SQL = await initSqlJs({
    locateFile: (file: string) => {
      if (typeof window === 'undefined') {
        // Node (tests): resolve out of node_modules relative to the working
        // directory. Deliberately built from plain strings rather than
        // `new URL(..., import.meta.url)`, which would make the bundler treat
        // the whole sql.js dist folder as assets and ship every build variant.
        const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd() ?? '.'
        return `${cwd}/node_modules/sql.js/dist/${file}`
      }
      // Browser: served from our own origin, cached by the service worker.
      return `${import.meta.env.BASE_URL ?? '/'}${file}`
    },
  })
  return SQL
}

export function isOpen(): boolean {
  return db !== null
}

export function handle(): Database {
  if (!db) throw new Error('Database is not open. Call openDatabase() first.')
  return db
}

/** Opens the on-device database, restoring the saved file if one exists. */
export async function openDatabase(): Promise<{ created: boolean }> {
  if (db) return { created: false }
  const engine = await loadEngine()

  let bytes: Uint8Array | null = null
  if (persistEnabled) {
    await requestPersistentStorage()
    bytes = await readBytes()
  }

  let created = false
  if (bytes && bytes.byteLength > 0) {
    try {
      db = new engine.Database(bytes)
      // Cheap corruption probe - a damaged image fails here rather than
      // halfway through the first clinical write.
      db.exec('SELECT count(*) FROM sqlite_master')
    } catch (err) {
      db?.close()
      db = null
      throw new DatabaseCorruptError(
        'The saved database file could not be opened. Restore from a backup to continue.',
        err,
      )
    }
  } else {
    db = new engine.Database()
    created = true
  }

  db.run('PRAGMA foreign_keys = ON')
  return { created }
}

export class DatabaseCorruptError extends Error {
  cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'DatabaseCorruptError'
    this.cause = cause
  }
}

export async function closeDatabase(): Promise<void> {
  if (!db) return
  await flush()
  db.close()
  db = null
}

// --------------------------------------------------------------- flushing

let flushPending: Promise<void> | null = null
let flushQueued = false
let lastFlushAt: string | null = null
const flushListeners = new Set<(at: string) => void>()

export function onFlush(fn: (at: string) => void): () => void {
  flushListeners.add(fn)
  return () => flushListeners.delete(fn)
}

export function lastFlush(): string | null {
  return lastFlushAt
}

/**
 * Writes the current database image to device storage. Concurrent callers
 * coalesce onto a single trailing write so a burst of inserts produces one
 * file write, but no caller returns before its own data is on disk.
 */
export async function flush(): Promise<void> {
  if (!db || !persistEnabled) return
  if (flushPending) {
    flushQueued = true
    await flushPending
    return
  }
  flushPending = (async () => {
    try {
      do {
        flushQueued = false
        const bytes = handle().export()
        await writeBytes(bytes)
        lastFlushAt = new Date().toISOString()
      } while (flushQueued)
    } finally {
      flushPending = null
    }
  })()
  await flushPending
  if (lastFlushAt) flushListeners.forEach((fn) => fn(lastFlushAt as string))
}

export function databaseSizeBytes(): number {
  if (!db) return 0
  return db.export().byteLength
}

export function backendName(): string {
  return currentBackend()
}

// ---------------------------------------------------------------- queries

export function query<T = Row>(sql: string, params?: Params): T[] {
  const stmt = handle().prepare(sql)
  try {
    if (params) stmt.bind(params as never)
    const out: T[] = []
    while (stmt.step()) out.push(stmt.getAsObject() as unknown as T)
    return out
  } finally {
    stmt.free()
  }
}

export function queryOne<T = Row>(sql: string, params?: Params): T | null {
  const rows = query<T>(sql, params)
  return rows.length ? rows[0] : null
}

export function scalar<T = SqlValue>(sql: string, params?: Params): T | null {
  const row = queryOne<Row>(sql, params)
  if (!row) return null
  const keys = Object.keys(row)
  return keys.length ? (row[keys[0]] as unknown as T) : null
}

export function count(sql: string, params?: Params): number {
  const v = scalar<number>(sql, params)
  return typeof v === 'number' ? v : Number(v ?? 0)
}

/** Executes a statement. Returns lastInsertRowid and rows changed. */
export function run(sql: string, params?: Params): { id: number; changes: number } {
  const d = handle()
  const stmt = d.prepare(sql)
  try {
    if (params) stmt.bind(params as never)
    stmt.step()
  } finally {
    stmt.free()
  }
  const id = Number(scalar<number>('SELECT last_insert_rowid() AS id') ?? 0)
  const changes = Number(scalar<number>('SELECT changes() AS c') ?? 0)
  return { id, changes }
}

export function exec(sql: string): void {
  handle().exec(sql)
}

// ----------------------------------------------------------- transactions

let txDepth = 0

/**
 * Runs `fn` inside a SQLite transaction and flushes to device storage on
 * commit. Nested calls join the outer transaction. On any throw the whole
 * transaction rolls back, so a half-written participant can never persist.
 */
export async function transaction<T>(fn: () => T | Promise<T>): Promise<T> {
  const d = handle()
  if (txDepth > 0) {
    txDepth += 1
    try {
      return await fn()
    } finally {
      txDepth -= 1
    }
  }

  d.run('BEGIN IMMEDIATE')
  txDepth = 1
  let result: T
  try {
    result = await fn()
  } catch (err) {
    try {
      d.run('ROLLBACK')
    } catch {
      /* already rolled back */
    }
    txDepth = 0
    throw err
  }
  d.run('COMMIT')
  txDepth = 0
  await flush()
  return result
}

/** Synchronous transaction for code paths that cannot await. */
export function transactionSync<T>(fn: () => T): T {
  const d = handle()
  if (txDepth > 0) return fn()
  d.run('BEGIN IMMEDIATE')
  txDepth = 1
  let result: T
  try {
    result = fn()
  } catch (err) {
    try {
      d.run('ROLLBACK')
    } catch {
      /* already rolled back */
    }
    txDepth = 0
    throw err
  }
  d.run('COMMIT')
  txDepth = 0
  void flush()
  return result
}

// ------------------------------------------------------- backup / restore

export function exportBytes(): Uint8Array {
  return handle().export()
}

/** Replaces the live database with `bytes`. Used by restore. */
export async function replaceDatabase(bytes: Uint8Array): Promise<void> {
  const engine = await loadEngine()
  const candidate = new engine.Database(bytes)
  try {
    const check = candidate.exec('PRAGMA integrity_check')
    const verdict = String(check?.[0]?.values?.[0]?.[0] ?? '')
    if (verdict.toLowerCase() !== 'ok') {
      throw new Error(`Backup failed its integrity check: ${verdict}`)
    }
    candidate.exec('SELECT count(*) FROM participants')
  } catch (err) {
    candidate.close()
    throw new DatabaseCorruptError(
      'This backup file is not a valid outreach database, or it is damaged.',
      err,
    )
  }
  db?.close()
  db = candidate
  db.run('PRAGMA foreign_keys = ON')
  await flush()
}

export function integrityCheck(): { ok: boolean; details: string } {
  const res = handle().exec('PRAGMA integrity_check')
  const verdict = String(res?.[0]?.values?.[0]?.[0] ?? 'unknown')
  return { ok: verdict.toLowerCase() === 'ok', details: verdict }
}

export function foreignKeyCheck(): string[] {
  const res = handle().exec('PRAGMA foreign_key_check')
  if (!res.length) return []
  return res[0].values.map((v) => v.map((c) => String(c)).join(' / '))
}
