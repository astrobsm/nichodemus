/**
 * Shared helpers for repositories: the sync envelope every record carries,
 * soft deletion, and generic insert/update builders.
 */
import { run, query, queryOne, count, type Row } from '../sqlite'
import { nowIso } from '../../core/datetime'
import { uuid, deviceId } from '../../core/ids'
import { auditActor } from '../../core/audit'

export type Value = string | number | null

/** Columns stamped on every insert (spec S91). */
export function insertEnvelope(): Record<string, Value> {
  const now = nowIso()
  const actor = auditActor().username
  return {
    uuid: uuid(),
    created_at: now,
    updated_at: now,
    device_id: deviceId(),
    created_by: actor,
    updated_by: actor,
    version: 1,
  }
}

export function updateEnvelope(currentVersion: number | null | undefined): Record<string, Value> {
  return {
    updated_at: nowIso(),
    updated_by: auditActor().username,
    device_id: deviceId(),
    version: Number(currentVersion ?? 0) + 1,
  }
}

/**
 * Tables whose rows are replicated to the cloud when synchronisation is
 * configured. Everything else - audit_logs, backups, app_settings, the sync
 * bookkeeping itself - stays on the device it was written on.
 *
 * A table is listed here only if its rows carry the sync envelope (uuid,
 * updated_at, version, deleted_at) from schema migration 001.
 */
export const SYNCABLE_TABLES = [
  'projects',
  'stations',
  'team_members',
  'attendance',
  'tasks',
  'users',
  'participants',
  'consents',
  'vitals',
  'glucose_results',
  'clinical_encounters',
  'wounds',
  'wound_assessments',
  'breast_examinations',
  'facilities',
  'referrals',
  'followups',
  'queue_events',
  'suppliers',
  'budget_categories',
  'budget_items',
  'expenses',
  'inventory_items',
  'inventory_transactions',
  'procurement',
  'mobilisation_activities',
  'logistics_items',
  'event_checklists',
] as const

const SYNCABLE = new Set<string>(SYNCABLE_TABLES)

/**
 * Records that a row changed locally, so the sync engine knows to push it.
 *
 * This sits inside insertRow/updateRow deliberately: every repository in the
 * application already writes through these two functions, so a new module
 * cannot forget to register its changes. Failing to record a change would
 * mean a clinical record silently never leaving the device.
 */
function markChanged(table: string, rowUuid: unknown): void {
  if (!SYNCABLE.has(table)) return
  if (typeof rowUuid !== 'string' || rowUuid === '') return
  try {
    run(
      `INSERT INTO sync_outbox (table_name, row_uuid, changed_at) VALUES (?, ?, ?)
       ON CONFLICT(table_name, row_uuid) DO UPDATE SET changed_at = excluded.changed_at`,
      [table, rowUuid, nowIso()],
    )
  } catch {
    // A database created before migration 003 has no outbox yet. Never let
    // sync bookkeeping break a clinical write.
  }
}

/** Looks up a row's uuid when the caller did not supply one. */
function uuidOf(table: string, id: number): string | null {
  try {
    const row = queryOne<{ uuid: string }>(`SELECT uuid FROM ${table} WHERE id = ?`, [id])
    return row?.uuid ?? null
  } catch {
    return null
  }
}

export function insertRow(table: string, data: Record<string, Value>): number {
  const cols = Object.keys(data)
  const placeholders = cols.map(() => '?').join(', ')
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`
  const { id } = run(sql, cols.map((c) => data[c]))
  markChanged(table, data.uuid)
  return id
}

export function updateRow(table: string, id: number, data: Record<string, Value>): number {
  const cols = Object.keys(data)
  if (cols.length === 0) return 0
  const assignments = cols.map((c) => `${c} = ?`).join(', ')
  const params = cols.map((c) => data[c])
  params.push(id)
  const { changes } = run(`UPDATE ${table} SET ${assignments} WHERE id = ?`, params)
  if (changes > 0) markChanged(table, data.uuid ?? uuidOf(table, id))
  return changes
}

/**
 * Soft delete: clinical records are never removed from the file (spec S51),
 * they are marked and then excluded by every read path.
 */
export function softDelete(table: string, id: number): number {
  return updateRow(table, id, {
    ...updateEnvelope(currentVersion(table, id)),
    deleted_at: nowIso(),
  })
}

export function undelete(table: string, id: number): number {
  return updateRow(table, id, {
    ...updateEnvelope(currentVersion(table, id)),
    deleted_at: null,
  })
}

/**
 * A row's current version. Deleting and undeleting must increment it like any
 * other edit: version is how two devices decide whose change is newer, and a
 * deletion that left it unchanged could lose to the very row it deletes.
 */
function currentVersion(table: string, id: number): number {
  try {
    const row = queryOne<{ version: number }>(`SELECT version FROM ${table} WHERE id = ?`, [id])
    return Number(row?.version ?? 0)
  } catch {
    return 0
  }
}

export function findById<T = Row>(table: string, id: number): T | null {
  return queryOne<T>(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id])
}

export function findAll<T = Row>(
  table: string,
  where = '',
  params: Value[] = [],
  orderBy = 'id',
): T[] {
  const clause = where ? `AND ${where}` : ''
  return query<T>(
    `SELECT * FROM ${table} WHERE deleted_at IS NULL ${clause} ORDER BY ${orderBy}`,
    params,
  )
}

export function countWhere(table: string, where = '', params: Value[] = []): number {
  const clause = where ? `AND ${where}` : ''
  return count(`SELECT COUNT(*) AS c FROM ${table} WHERE deleted_at IS NULL ${clause}`, params)
}

/** Next value of a per-project sequence, derived from the table itself. */
export function nextSerial(table: string, column: string, projectId: number): number {
  const max = count(
    `SELECT COALESCE(MAX(${column}), 0) AS c FROM ${table} WHERE project_id = ?`,
    [projectId],
  )
  return max + 1
}

export function boolInt(v: boolean | null | undefined): number {
  return v ? 1 : 0
}

export function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === '1'
}

export function nullIfBlank(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const t = v.trim()
  return t === '' ? null : t
}

export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function intOrNull(v: unknown): number | null {
  const n = numOrNull(v)
  return n === null ? null : Math.round(n)
}
