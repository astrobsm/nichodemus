/** Application settings and the clinical threshold configuration. */
import { query, queryOne, run } from '../sqlite'
import { nowIso } from '../../core/datetime'
import { audit, AUDIT_ACTIONS, auditActor } from '../../core/audit'
import {
  DEFAULT_THRESHOLDS,
  THRESHOLD_METADATA,
  type ClinicalThresholds,
} from '../../core/clinicalRules'
import { SETTING_KEYS } from '../../core/constants'
import { uuid } from '../../core/ids'

export function getSetting(key: string): string | null {
  const row = queryOne<{ value: string | null }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key],
  )
  return row?.value ?? null
}

export function getSettingNumber(key: string, fallback: number): number {
  const v = getSetting(key)
  if (v === null) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function getSettingBool(key: string, fallback = false): boolean {
  const v = getSetting(key)
  if (v === null) return fallback
  return v === 'true' || v === '1'
}

export function setSetting(key: string, value: string | number | boolean | null): void {
  run(
    `INSERT INTO app_settings (key, value, updated_at, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                    updated_at = excluded.updated_at,
                                    updated_by = excluded.updated_by`,
    [key, value === null ? null : String(value), nowIso(), auditActor().username],
  )
}

export function allSettings(): Record<string, string | null> {
  const rows = query<{ key: string; value: string | null }>('SELECT key, value FROM app_settings')
  const out: Record<string, string | null> = {}
  for (const r of rows) out[r.key] = r.value
  return out
}

// --------------------------------------------------- clinical thresholds

export interface ThresholdRow {
  key: string
  value: string
  label: string | null
  description: string | null
  group_name: string | null
  unit: string | null
  updated_at: string
  updated_by: string | null
}

export function loadThresholds(): ClinicalThresholds {
  const rows = query<{ key: string; value: string }>(
    'SELECT key, value FROM clinical_configurations WHERE deleted_at IS NULL',
  )
  const out = { ...DEFAULT_THRESHOLDS }
  for (const r of rows) {
    if (r.key in out) {
      const n = Number(r.value)
      if (Number.isFinite(n)) (out as Record<string, number>)[r.key] = n
    }
  }
  return out
}

export function listThresholdRows(): ThresholdRow[] {
  const rows = query<ThresholdRow>(
    `SELECT key, value, label, description, group_name, unit, updated_at, updated_by
       FROM clinical_configurations WHERE deleted_at IS NULL`,
  )
  const order = new Map(THRESHOLD_METADATA.map((m, i) => [m.key as string, i]))
  return rows.sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999))
}

/**
 * Updates one clinical threshold. Every change is audited with the previous
 * and new value (spec S70) - clinical governance depends on this trail.
 */
export function updateThreshold(key: string, value: number): void {
  const meta = THRESHOLD_METADATA.find((m) => m.key === key)
  if (!meta) throw new Error(`Unknown clinical threshold: ${key}`)
  if (!Number.isFinite(value)) throw new Error('The threshold must be a number.')

  const existing = queryOne<{ value: string }>(
    'SELECT value FROM clinical_configurations WHERE key = ?',
    [key],
  )
  const now = nowIso()
  const actor = auditActor().username

  if (existing) {
    run(
      `UPDATE clinical_configurations
          SET value = ?, updated_at = ?, updated_by = ?, version = version + 1
        WHERE key = ?`,
      [String(value), now, actor, key],
    )
  } else {
    run(
      `INSERT INTO clinical_configurations
         (uuid, key, value, value_type, label, description, group_name, unit,
          created_at, updated_at, created_by, updated_by, version)
       VALUES (?, ?, ?, 'NUMBER', ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [uuid(), key, String(value), meta.label, meta.description, meta.group, meta.unit, now, now, actor, actor],
    )
  }

  setSetting(SETTING_KEYS.CLINICAL_CONFIG_UPDATED_AT, now)
  setSetting(SETTING_KEYS.CLINICAL_CONFIG_UPDATED_BY, actor)

  audit({
    action: AUDIT_ACTIONS.CONFIG_CHANGE,
    entityType: 'clinical_configuration',
    entityId: key,
    summary: `Clinical threshold "${meta.label}" changed`,
    previousValue: existing?.value ?? null,
    newValue: String(value),
  })
}

export function resetThresholdsToDefault(): void {
  for (const meta of THRESHOLD_METADATA) {
    updateThreshold(meta.key, DEFAULT_THRESHOLDS[meta.key])
  }
}

export function clinicalConfigProvenance(): { at: string | null; by: string | null } {
  return {
    at: getSetting(SETTING_KEYS.CLINICAL_CONFIG_UPDATED_AT),
    by: getSetting(SETTING_KEYS.CLINICAL_CONFIG_UPDATED_BY),
  }
}
