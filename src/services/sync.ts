/**
 * Synchronisation between the on-device database and the cloud.
 *
 * THE RULE THIS FILE EXISTS TO PROTECT
 * ------------------------------------
 * The local SQLite database remains the source of truth. Nothing here is on
 * the path of registering a participant or recording a reading. Sync is a
 * background reconciliation that runs when a connection happens to exist; if
 * it never runs, the outreach still works exactly as it did before.
 *
 * Rows are matched on uuid, never on the local autoincrement id, and every
 * foreign key is carried as the referenced row's uuid (see syncModel.ts).
 * Conflicts resolve last-write-wins by version then updated_at, decided
 * identically on both sides.
 */
import { query, queryOne, run, transaction, count } from '../db/sqlite'
export { SERIAL_BLOCK_SIZE, serialRange } from '../core/constants'
export { nextSerialForDevice, deviceSerialBlock } from '../db/repo/participants'
import { SYNCABLE_TABLES } from '../db/repo/base'
import { getSetting, setSetting } from '../db/repo/settings'
import { audit } from '../core/audit'
import { nowIso } from '../core/datetime'
import { deviceId } from '../core/ids'
import {
  APPLY_ORDER,
  FOREIGN_KEYS,
  REF_SUFFIX,
  incomingWins,
  type PullResponse,
  type PushResponse,
  type SyncRecord,
} from './syncModel'

export const SYNC_KEYS = {
  ENABLED: 'sync.enabled',
  ENDPOINT: 'sync.endpoint',
  TOKEN: 'sync.token',
  CURSOR: 'sync.cursor',
  LAST_AT: 'sync.last_at',
  LAST_OK: 'sync.last_ok',
  SERIAL_BLOCK: 'sync.serial_block',
} as const

export interface SyncConfig {
  enabled: boolean
  endpoint: string
  token: string
  cursor: number
  serialBlock: number
}

export function syncConfig(): SyncConfig {
  return {
    enabled: getSetting(SYNC_KEYS.ENABLED) === 'true',
    endpoint: (getSetting(SYNC_KEYS.ENDPOINT) ?? '').replace(/\/+$/, ''),
    token: getSetting(SYNC_KEYS.TOKEN) ?? '',
    cursor: Number(getSetting(SYNC_KEYS.CURSOR) ?? 0),
    serialBlock: Number(getSetting(SYNC_KEYS.SERIAL_BLOCK) ?? 0),
  }
}

export function isSyncConfigured(): boolean {
  const c = syncConfig()
  return c.enabled && c.endpoint !== '' && c.token !== ''
}

export function saveSyncConfig(patch: Partial<SyncConfig>): void {
  if (patch.enabled !== undefined) setSetting(SYNC_KEYS.ENABLED, patch.enabled ? 'true' : 'false')
  if (patch.endpoint !== undefined) setSetting(SYNC_KEYS.ENDPOINT, patch.endpoint.trim())
  if (patch.token !== undefined) setSetting(SYNC_KEYS.TOKEN, patch.token.trim())
  if (patch.cursor !== undefined) setSetting(SYNC_KEYS.CURSOR, patch.cursor)
  if (patch.serialBlock !== undefined) setSetting(SYNC_KEYS.SERIAL_BLOCK, patch.serialBlock)
}

// ------------------------------------------------------------- outbox

export function pendingCount(): number {
  try {
    return count('SELECT COUNT(*) AS c FROM sync_outbox')
  } catch {
    return 0
  }
}

/** Columns to transmit: everything the table has except the local id. */
function columnsOf(table: string): string[] {
  const cols = query<{ name: string }>(`PRAGMA table_info(${table})`)
  return cols.map((c) => c.name).filter((n) => n !== 'id')
}

const columnCache = new Map<string, string[]>()
function cachedColumns(table: string): string[] {
  let cols = columnCache.get(table)
  if (!cols) {
    cols = columnsOf(table)
    columnCache.set(table, cols)
  }
  return cols
}

/** Reads a local row and converts its foreign keys into uuid references. */
function toRecord(table: string, rowUuid: string): SyncRecord | null {
  const row = queryOne<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE uuid = ?`,
    [rowUuid],
  )
  if (!row) return null

  const fks = FOREIGN_KEYS[table] ?? {}
  const out: Record<string, unknown> = {}
  for (const col of cachedColumns(table)) {
    if (col in fks) continue // replaced by its uuid reference below
    out[col] = row[col] ?? null
  }
  for (const [col, refTable] of Object.entries(fks)) {
    const localId = row[col]
    if (localId === null || localId === undefined) {
      out[col + REF_SUFFIX] = null
      continue
    }
    const ref = queryOne<{ uuid: string }>(`SELECT uuid FROM ${refTable} WHERE id = ?`, [
      Number(localId),
    ])
    out[col + REF_SUFFIX] = ref?.uuid ?? null
  }

  return {
    table,
    uuid: rowUuid,
    updated_at: String(row.updated_at ?? nowIso()),
    version: Number(row.version ?? 1),
    deleted: row.deleted_at !== null && row.deleted_at !== undefined,
    row: out,
  }
}

export function collectOutbox(limit = 400): { records: SyncRecord[]; keys: { table_name: string; row_uuid: string }[] } {
  let pending: { table_name: string; row_uuid: string }[] = []
  try {
    pending = query<{ table_name: string; row_uuid: string }>(
      'SELECT table_name, row_uuid FROM sync_outbox ORDER BY changed_at LIMIT ?',
      [limit],
    )
  } catch {
    return { records: [], keys: [] }
  }

  const records: SyncRecord[] = []
  const keys: { table_name: string; row_uuid: string }[] = []
  for (const p of pending) {
    const record = toRecord(p.table_name, p.row_uuid)
    keys.push(p)
    if (record) records.push(record)
    // A missing row means it was hard-deleted locally; drop it from the
    // outbox rather than retrying forever.
  }
  return { records, keys }
}

function clearOutbox(keys: { table_name: string; row_uuid: string }[]): void {
  for (const k of keys) {
    run('DELETE FROM sync_outbox WHERE table_name = ? AND row_uuid = ?', [
      k.table_name,
      k.row_uuid,
    ])
  }
}

// -------------------------------------------------------------- applying

/** Resolves a uuid reference to a local integer id. */
function localIdOf(table: string, rowUuid: unknown): number | null | undefined {
  if (rowUuid === null || rowUuid === undefined) return null
  const row = queryOne<{ id: number }>(`SELECT id FROM ${table} WHERE uuid = ?`, [
    String(rowUuid),
  ])
  // undefined means "referenced row not here yet" - the caller defers.
  return row ? Number(row.id) : undefined
}

export interface ApplyResult {
  applied: number
  skipped: number
  deferred: number
  /** Records the local database refused, with the reason. */
  rejected: { uuid: string; table: string; reason: string }[]
}

/**
 * Writes incoming records into the local database.
 *
 * Deliberately uses raw statements rather than the repository helpers: those
 * write to the outbox, which would bounce every received change straight back
 * to the server in an endless loop.
 */
export function applyRecords(records: (SyncRecord & { seq?: number })[]): ApplyResult {
  const byTable = new Map<string, (SyncRecord & { seq?: number })[]>()
  for (const r of records) {
    if (!byTable.has(r.table)) byTable.set(r.table, [])
    byTable.get(r.table)!.push(r)
  }

  const ordered: (SyncRecord & { seq?: number })[] = []
  for (const table of APPLY_ORDER) {
    const rows = byTable.get(table)
    if (rows) ordered.push(...rows)
  }
  // Anything from a table this build does not know about is ignored, not
  // guessed at.
  const known = new Set(APPLY_ORDER)
  const unknownTables = [...byTable.keys()].filter((t) => !known.has(t))

  let applied = 0
  let skipped = unknownTables.reduce((n, t) => n + (byTable.get(t)?.length ?? 0), 0)
  const rejected: { uuid: string; table: string; reason: string }[] = []
  let pending = ordered

  // Up to three passes: a record whose parent arrives later in the same
  // batch succeeds on a subsequent pass.
  for (let pass = 0; pass < 3 && pending.length > 0; pass++) {
    const deferred: (SyncRecord & { seq?: number })[] = []
    for (const record of pending) {
      let outcome: 'applied' | 'skipped' | 'deferred'
      try {
        outcome = applyOne(record)
      } catch (err) {
        // A single unusable record - a constraint this build does not expect,
        // a table from a newer version - must not discard the rest of the
        // batch. Note it and carry on.
        rejected.push({ uuid: record.uuid, table: record.table, reason: String(err) })
        outcome = 'skipped'
      }
      if (outcome === 'applied') applied++
      else if (outcome === 'skipped') skipped++
      else deferred.push(record)
    }
    if (deferred.length === pending.length) {
      pending = deferred
      break // no progress; stop rather than spin
    }
    pending = deferred
  }

  return { applied, skipped, deferred: pending.length, rejected }
}

function applyOne(record: SyncRecord): 'applied' | 'skipped' | 'deferred' {
  const { table } = record
  if (!SYNCABLE_TABLES.includes(table as (typeof SYNCABLE_TABLES)[number])) return 'skipped'

  const existing = queryOne<{ id: number; version: number; updated_at: string; uuid: string }>(
    `SELECT id, version, updated_at, uuid FROM ${table} WHERE uuid = ?`,
    [record.uuid],
  )

  if (!incomingWins(record, existing ?? null)) return 'skipped'

  // Resolve every uuid reference back to a local id.
  const data: Record<string, unknown> = {}
  const columns = new Set(cachedColumns(table))
  for (const [key, value] of Object.entries(record.row)) {
    if (key.endsWith(REF_SUFFIX)) {
      const col = key.slice(0, -REF_SUFFIX.length)
      const refTable = FOREIGN_KEYS[table]?.[col]
      if (!refTable) continue
      const resolved = localIdOf(refTable, value)
      if (resolved === undefined) return 'deferred'
      data[col] = resolved
    } else if (columns.has(key)) {
      data[key] = value
    }
  }

  const cols = Object.keys(data)
  if (cols.length === 0) return 'skipped'
  const values = cols.map((c) => data[c] as never)

  if (existing) {
    run(
      `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...values, existing.id] as never,
    )
  } else {
    run(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      values as never,
    )
  }
  return 'applied'
}

// ------------------------------------------------------------ transport

export class SyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncError'
  }
}

async function call<T>(body: object): Promise<T> {
  const { endpoint, token, serialBlock } = syncConfig()
  if (!endpoint) throw new SyncError('No cloud address is configured.')

  let response: Response
  try {
    response = await fetch(`${endpoint}/api/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-token': token },
      // The block travels with every request so the cloud knows it is taken.
      // The device that set the outreach up chose its block offline and never
      // signed in, so this is the only thing that stops the allocator handing
      // the same block to the first member of staff to join.
      body: JSON.stringify({ ...body, serialBlock }),
    })
  } catch {
    throw new SyncError(
      'The cloud could not be reached. Your data is safe on this device; try again when there is a connection.',
    )
  }

  if (response.status === 401) throw new SyncError('The cloud rejected this device’s key.')
  if (!response.ok) throw new SyncError(`The cloud returned an error (${response.status}).`)

  const json = (await response.json()) as { ok: boolean; error?: string }
  if (!json.ok) throw new SyncError(json.error ?? 'The cloud reported a problem.')
  return json as T
}

// ------------------------------------------------------------ run cycle

export interface SyncOutcome {
  pushed: number
  pulled: number
  deferred: number
  cursor: number
  pendingAfter: number
  /**
   * True when another device has already reserved this device's participant
   * number block. Both would then issue the same number to different people,
   * which no later merge can undo, so it has to reach a human.
   */
  blockConflict: boolean
}

/**
 * One full reconciliation: push what this device changed, then pull what
 * everyone else did. Safe to call repeatedly and safe to interrupt - the
 * outbox is only cleared once the server has confirmed receipt.
 */
export async function runSync(): Promise<SyncOutcome> {
  if (!isSyncConfigured()) throw new SyncError('Synchronisation is not set up on this device.')

  const startedAt = nowIso()
  const device = deviceId()
  let pushed = 0
  let pulled = 0
  let deferred = 0
  let blockConflict = false

  const runId = await transaction(() => {
    const { id } = run(
      `INSERT INTO sync_runs (started_at, direction, actor, device_id) VALUES (?, 'BOTH', ?, ?)`,
      [startedAt, 'sync', device],
    )
    return id
  })

  try {
    // --- push -------------------------------------------------------
    for (;;) {
      const { records, keys } = collectOutbox()
      if (records.length === 0 && keys.length === 0) break

      if (records.length > 0) {
        const result = await call<PushResponse>({ action: 'push', deviceId: device, records })
        pushed += result.accepted
        if (result.blockConflict) blockConflict = true
      }
      await transaction(() => clearOutbox(keys))
      if (keys.length < 400) break
    }

    // --- pull -------------------------------------------------------
    for (;;) {
      const cursor = syncConfig().cursor
      const result = await call<PullResponse>({
        action: 'pull',
        deviceId: device,
        cursor,
        limit: 400,
      })
      if (result.blockConflict) blockConflict = true
      if (result.records.length > 0) {
        const outcome = await transaction(() => applyRecords(result.records))
        pulled += outcome.applied
        deferred += outcome.deferred
      }
      await transaction(() => saveSyncConfig({ cursor: result.cursor }))
      if (!result.more) break
    }

    const finalCursor = syncConfig().cursor
    const pendingAfter = pendingCount()

    await transaction(() => {
      run(
        `UPDATE sync_runs SET finished_at = ?, pushed = ?, pulled = ?, ok = 1,
                              server_cursor = ?, message = NULL
          WHERE id = ?`,
        [nowIso(), pushed, pulled, finalCursor, runId],
      )
      setSetting(SYNC_KEYS.LAST_AT, nowIso())
      setSetting(SYNC_KEYS.LAST_OK, 'true')
      audit({
        action: 'SYNC',
        entityType: 'sync',
        entityId: runId,
        summary: `Synchronised: ${pushed} sent, ${pulled} received`,
      })
    })

    return { pushed, pulled, deferred, cursor: finalCursor, pendingAfter, blockConflict }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Synchronisation failed.'
    await transaction(() => {
      run(
        `UPDATE sync_runs SET finished_at = ?, pushed = ?, pulled = ?, ok = 0, message = ?
          WHERE id = ?`,
        [nowIso(), pushed, pulled, message, runId],
      )
      setSetting(SYNC_KEYS.LAST_AT, nowIso())
      setSetting(SYNC_KEYS.LAST_OK, 'false')
      audit({
        action: 'SYNC_FAILED',
        entityType: 'sync',
        entityId: runId,
        summary: `Synchronisation failed: ${message}`,
      })
    })
    throw err
  }
}

export interface SyncRun {
  id: number
  started_at: string
  finished_at: string | null
  pushed: number
  pulled: number
  ok: number
  message: string | null
}

export function recentSyncRuns(limit = 10): SyncRun[] {
  try {
    return query<SyncRun>(
      'SELECT id, started_at, finished_at, pushed, pulled, ok, message FROM sync_runs ORDER BY id DESC LIMIT ?',
      [limit],
    )
  } catch {
    return []
  }
}

export function syncStatus(): {
  configured: boolean
  pending: number
  lastAt: string | null
  lastOk: boolean | null
} {
  const lastOk = getSetting(SYNC_KEYS.LAST_OK)
  return {
    configured: isSyncConfigured(),
    pending: pendingCount(),
    lastAt: getSetting(SYNC_KEYS.LAST_AT),
    lastOk: lastOk === null ? null : lastOk === 'true',
  }
}
