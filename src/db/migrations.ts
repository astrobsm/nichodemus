/**
 * Versioned schema migrations. Every migration runs inside one transaction
 * and is recorded in schema_migrations, so an interrupted upgrade either
 * applies completely or not at all.
 */
import baselineSql from './schema.sql?raw'
import syncSql from './migrations-sync.sql?raw'
import { exec, query, run, transactionSync, handle } from './sqlite'
import { nowIso } from '../core/datetime'
import { uuid } from '../core/ids'
import {
  PERMISSION_CATALOGUE,
  ROLE_DEFINITIONS,
} from '../core/permissions'
import { DEFAULT_THRESHOLDS, THRESHOLD_METADATA } from '../core/clinicalRules'

export interface Migration {
  version: number
  name: string
  up: () => void
}

function seedRolesAndPermissions(): void {
  const now = nowIso()
  for (const p of PERMISSION_CATALOGUE) {
    run('INSERT OR REPLACE INTO permissions (code, name, category) VALUES (?, ?, ?)', [
      p.code,
      p.name,
      p.category,
    ])
  }
  ROLE_DEFINITIONS.forEach((r, index) => {
    run(
      `INSERT OR REPLACE INTO roles (code, name, description, sort_order, is_system)
       VALUES (?, ?, ?, ?, 1)`,
      [r.code, r.name, r.description, index],
    )
    run('DELETE FROM role_permissions WHERE role_code = ?', [r.code])
    for (const perm of r.permissions) {
      run(
        'INSERT OR IGNORE INTO role_permissions (role_code, permission_code) VALUES (?, ?)',
        [r.code, perm],
      )
    }
  })
  run(
    `INSERT OR REPLACE INTO app_settings (key, value, updated_at, updated_by)
     VALUES ('roles.seeded_at', ?, ?, 'system')`,
    [now, now],
  )
}

function seedClinicalConfiguration(): void {
  const now = nowIso()
  for (const meta of THRESHOLD_METADATA) {
    const value = String(DEFAULT_THRESHOLDS[meta.key])
    run(
      `INSERT OR IGNORE INTO clinical_configurations
         (uuid, key, value, value_type, label, description, group_name, unit,
          created_at, updated_at, created_by, updated_by, version)
       VALUES (?, ?, ?, 'NUMBER', ?, ?, ?, ?, ?, ?, 'system', 'system', 1)`,
      [uuid(), meta.key, value, meta.label, meta.description, meta.group, meta.unit, now, now],
    )
  }
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'baseline schema',
    up: () => {
      exec(baselineSql)
    },
  },
  {
    version: 2,
    name: 'seed roles, permissions and clinical thresholds',
    up: () => {
      seedRolesAndPermissions()
      seedClinicalConfiguration()
    },
  },
  {
    version: 3,
    name: 'synchronisation outbox and run history',
    up: () => {
      exec(syncSql)
    },
  },
]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

function appliedVersions(): Set<number> {
  const tableExists = query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  )
  if (tableExists.length === 0) return new Set()
  return new Set(
    query<{ version: number }>('SELECT version FROM schema_migrations').map((r) =>
      Number(r.version),
    ),
  )
}

export interface MigrationReport {
  applied: number[]
  alreadyCurrent: boolean
  version: number
}

/** Brings the open database up to LATEST_VERSION. Idempotent. */
export function migrate(): MigrationReport {
  const done = appliedVersions()
  const applied: number[] = []

  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue
    transactionSync(() => {
      m.up()
      run(
        'INSERT OR REPLACE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        [m.version, m.name, nowIso()],
      )
    })
    applied.push(m.version)
  }

  // Re-seed roles/permissions on every start so a permission added in a new
  // build of the app reaches existing databases without a schema bump.
  if (applied.length === 0) {
    transactionSync(() => seedRolesAndPermissions())
  }

  handle().run('PRAGMA foreign_keys = ON')
  return {
    applied,
    alreadyCurrent: applied.length === 0,
    version: LATEST_VERSION,
  }
}

export function currentSchemaVersion(): number {
  const rows = query<{ v: number }>('SELECT MAX(version) AS v FROM schema_migrations')
  return Number(rows[0]?.v ?? 0)
}
