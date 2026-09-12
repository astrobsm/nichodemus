/**
 * Audit trail (spec S51/S89). Answers: who did what, to which record, when.
 *
 * Audit rows never contain clinical detail - only the identity of the record
 * and, where a value genuinely changed, a short before/after summary of the
 * changed fields. Patient names are not written into the audit log.
 */
import { run, query, count } from '../db/sqlite'
import { nowIso } from './datetime'
import { uuid, deviceId } from './ids'

export interface Actor {
  id: number | null
  username: string
  role: string
}

let currentActor: Actor = { id: null, username: 'system', role: 'SYSTEM' }
let currentProjectId: number | null = null

export function setAuditActor(actor: Actor): void {
  currentActor = actor
}

export function clearAuditActor(): void {
  currentActor = { id: null, username: 'system', role: 'SYSTEM' }
}

export function setAuditProject(projectId: number | null): void {
  currentProjectId = projectId
}

export function auditActor(): Actor {
  return currentActor
}

export const AUDIT_ACTIONS = {
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  LOCK: 'SESSION_LOCK',
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'SOFT_DELETE',
  RESTORE_RECORD: 'RESTORE_RECORD',
  REFERRAL_CREATE: 'REFERRAL_CREATE',
  REFERRAL_STATUS: 'REFERRAL_STATUS_CHANGE',
  BACKUP_CREATE: 'BACKUP_CREATE',
  BACKUP_RESTORE: 'BACKUP_RESTORE',
  EXPORT: 'EXPORT',
  CONFIG_CHANGE: 'CONFIG_CHANGE',
  DUPLICATE_OVERRIDE: 'DUPLICATE_OVERRIDE',
  PROJECT_CLOSE: 'PROJECT_CLOSE',
  DEMO_CLEAR: 'DEMO_DATA_CLEARED',
  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS] | string

export interface AuditEntry {
  action: AuditAction
  entityType?: string
  entityId?: string | number | null
  summary?: string
  previousValue?: unknown
  newValue?: unknown
}

function serialise(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value.slice(0, 2000)
  try {
    return JSON.stringify(value).slice(0, 2000)
  } catch {
    return String(value).slice(0, 2000)
  }
}

/** Writes one audit row. Called inside the caller's transaction. */
export function audit(entry: AuditEntry): void {
  run(
    `INSERT INTO audit_logs
       (uuid, occurred_at, user_id, username, user_role, action, entity_type,
        entity_id, summary, previous_value, new_value, device_id, project_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      nowIso(),
      currentActor.id,
      currentActor.username,
      currentActor.role,
      entry.action,
      entry.entityType ?? null,
      entry.entityId !== undefined && entry.entityId !== null ? String(entry.entityId) : null,
      entry.summary ?? null,
      serialise(entry.previousValue),
      serialise(entry.newValue),
      deviceId(),
      currentProjectId,
    ],
  )
}

/**
 * Compares two record snapshots and returns only the fields that changed,
 * so the audit trail records a diff rather than a whole clinical record.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T | null,
  after: T,
  fields: (keyof T)[],
): { previous: Record<string, unknown>; next: Record<string, unknown>; changed: string[] } {
  const previous: Record<string, unknown> = {}
  const next: Record<string, unknown> = {}
  const changed: string[] = []
  for (const f of fields) {
    const a = before ? before[f] : undefined
    const b = after[f]
    if (a !== b) {
      changed.push(String(f))
      previous[String(f)] = a ?? null
      next[String(f)] = b ?? null
    }
  }
  return { previous, next, changed }
}

export interface AuditRow {
  id: number
  occurred_at: string
  username: string
  user_role: string
  action: string
  entity_type: string | null
  entity_id: string | null
  summary: string | null
  previous_value: string | null
  new_value: string | null
  device_id: string | null
}

export interface AuditFilter {
  action?: string
  entityType?: string
  username?: string
  fromDate?: string
  toDate?: string
  limit?: number
  offset?: number
}

export function listAudit(filter: AuditFilter = {}): AuditRow[] {
  const where: string[] = []
  const params: (string | number)[] = []
  if (filter.action) {
    where.push('action = ?')
    params.push(filter.action)
  }
  if (filter.entityType) {
    where.push('entity_type = ?')
    params.push(filter.entityType)
  }
  if (filter.username) {
    where.push('username = ?')
    params.push(filter.username)
  }
  if (filter.fromDate) {
    where.push('occurred_at >= ?')
    params.push(filter.fromDate)
  }
  if (filter.toDate) {
    where.push('occurred_at <= ?')
    params.push(`${filter.toDate}T23:59:59`)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  params.push(filter.limit ?? 200, filter.offset ?? 0)
  return query<AuditRow>(
    `SELECT id, occurred_at, username, user_role, action, entity_type, entity_id,
            summary, previous_value, new_value, device_id
       FROM audit_logs ${clause}
      ORDER BY occurred_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    params,
  )
}

export function auditCount(filter: AuditFilter = {}): number {
  const where: string[] = []
  const params: (string | number)[] = []
  if (filter.action) {
    where.push('action = ?')
    params.push(filter.action)
  }
  if (filter.entityType) {
    where.push('entity_type = ?')
    params.push(filter.entityType)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return count(`SELECT COUNT(*) AS c FROM audit_logs ${clause}`, params)
}

/** History for one record, used by the participant History tab. */
export function auditForEntity(entityType: string, entityId: string | number): AuditRow[] {
  return query<AuditRow>(
    `SELECT id, occurred_at, username, user_role, action, entity_type, entity_id,
            summary, previous_value, new_value, device_id
       FROM audit_logs
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY occurred_at DESC, id DESC`,
    [entityType, String(entityId)],
  )
}

export function distinctAuditActions(): string[] {
  return query<{ action: string }>(
    'SELECT DISTINCT action FROM audit_logs ORDER BY action',
  ).map((r) => r.action)
}
