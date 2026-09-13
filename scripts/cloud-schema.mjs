/**
 * Builds the cloud copy of the schema from the same src/db/schema.sql the
 * devices use, so the two can never drift apart.
 *
 * The cloud copy differs in three deliberate ways:
 *
 *   1. REFERENCES clauses are dropped. Foreign keys travel as the referenced
 *      row's uuid (column__ref), because a local integer id means nothing on
 *      another device.
 *   2. The integer foreign-key columns lose NOT NULL. They are never
 *      populated in the cloud - keeping the constraint rejected every record
 *      that had a parent, which is almost all of them.
 *   3. Composite UNIQUE constraints are dropped. They assume one device's
 *      numbering.
 *
 * Exported separately from cloud-setup.mjs so the tests can build a real
 * cloud schema rather than a hand-written approximation of one. That
 * approximation is exactly how (2) reached production unnoticed.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const SYNCED_TABLES = [
  'projects', 'stations', 'team_members', 'attendance', 'tasks', 'users',
  'participants', 'consents', 'vitals', 'glucose_results', 'clinical_encounters',
  'wounds', 'wound_assessments', 'breast_examinations', 'facilities', 'referrals',
  'followups', 'queue_events', 'suppliers', 'budget_categories', 'budget_items',
  'expenses', 'inventory_items', 'inventory_transactions', 'procurement',
  'mobilisation_activities', 'logistics_items', 'event_checklists',
  'clinical_photos',
]

export const FOREIGN_KEY_COLUMNS = {
  projects: [],
  stations: ['project_id'],
  team_members: ['project_id', 'assigned_station_id'],
  attendance: ['project_id', 'team_member_id', 'station_id'],
  tasks: ['project_id', 'assignee_id'],
  users: ['team_member_id'],
  participants: ['project_id', 'current_station_id'],
  consents: ['participant_id'],
  vitals: ['participant_id', 'project_id', 'station_id'],
  glucose_results: ['participant_id', 'project_id', 'station_id'],
  clinical_encounters: ['participant_id', 'project_id'],
  wounds: ['participant_id', 'project_id'],
  wound_assessments: ['wound_id', 'participant_id', 'project_id'],
  breast_examinations: ['participant_id', 'project_id'],
  facilities: ['project_id'],
  referrals: ['participant_id', 'project_id', 'facility_id'],
  followups: ['participant_id', 'project_id', 'referral_id'],
  queue_events: ['participant_id', 'project_id', 'station_id'],
  suppliers: ['project_id'],
  budget_categories: ['project_id'],
  budget_items: ['project_id', 'category_id'],
  expenses: ['project_id', 'category_id', 'budget_item_id', 'procurement_id'],
  inventory_items: ['project_id', 'supplier_id'],
  inventory_transactions: ['item_id', 'project_id', 'station_id'],
  procurement: ['project_id', 'inventory_item_id', 'supplier_id', 'budget_category_id'],
  mobilisation_activities: ['project_id'],
  logistics_items: ['project_id'],
  event_checklists: ['project_id'],
  clinical_photos: ['participant_id', 'project_id', 'wound_id'],
}

export const CHANGE_LOG = `
CREATE TABLE IF NOT EXISTS sync_changes (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name  TEXT NOT NULL,
  row_uuid    TEXT NOT NULL,
  version     INTEGER NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  device_id   TEXT,
  payload     TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_changes_seq ON sync_changes(seq);
CREATE INDEX IF NOT EXISTS idx_changes_device ON sync_changes(device_id, seq);

-- Which participant-number block each device owns. Allocated centrally on
-- first sign-in, because two devices sharing a block would issue the same
-- participant number to different people - a mistake no later merge can
-- repair.
CREATE TABLE IF NOT EXISTS sync_devices (
  device_id    TEXT PRIMARY KEY,
  serial_block INTEGER NOT NULL,
  username     TEXT,
  first_seen   TEXT NOT NULL,
  last_seen    TEXT NOT NULL
);

-- Failed sign-in counters, so the cloud locks an account out just as a device
-- does. Without it the PIN could be attacked from anywhere, at any rate.
CREATE TABLE IF NOT EXISTS auth_attempts (
  username     TEXT PRIMARY KEY,
  failures     INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

-- Optional off-site copy of the encrypted backup file.
--
-- The bytes arriving here are already sealed with AES-256-GCM under a
-- passphrase the server never sees, so this table holds ciphertext and
-- nothing else: losing the database would not expose one record. The file is
-- split into chunks because a whole backup is far larger than one request.
CREATE TABLE IF NOT EXISTS cloud_backups (
  uuid        TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL,
  filename    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  checksum    TEXT,
  chunk_count INTEGER NOT NULL,
  chunks_in   INTEGER NOT NULL DEFAULT 0,
  complete    INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT,
  record_counts TEXT,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cloud_backups_device ON cloud_backups(device_id, created_at);

-- People asking to be given an account, and the administrator's decision.
--
-- Anyone who can open the web address can submit one of these, so a row here
-- grants nothing at all: it is an application, not an account. The account
-- itself is only ever created by an administrator, on their own device, in
-- the ordinary audited way.
--
-- The PIN is hashed on the requester's device with the same PBKDF2 derivation
-- used everywhere else and is never sent in the clear. Carrying the hash lets
-- an approved person sign in with the PIN they already chose, instead of
-- being handed a temporary one over the phone.
CREATE TABLE IF NOT EXISTS account_requests (
  uuid           TEXT PRIMARY KEY,
  username       TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  role_requested TEXT,
  phone          TEXT,
  reason         TEXT,
  pin_hash       TEXT NOT NULL,
  pin_salt       TEXT NOT NULL,
  pin_iterations INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'PENDING',
  requested_at   TEXT NOT NULL,
  device_id      TEXT,
  decided_at     TEXT,
  decided_by     TEXT,
  decision_note  TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON account_requests(status, requested_at);

CREATE TABLE IF NOT EXISTS cloud_backup_chunks (
  backup_uuid TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  data        TEXT NOT NULL,
  PRIMARY KEY (backup_uuid, seq)
);
`

export function readDeviceSchema() {
  return readFileSync(resolve(root, 'src/db/schema.sql'), 'utf8')
}

export function splitStatements(sql) {
  return sql
    .split(';')
    .map((statement) =>
      // Strip line comments first. Discarding any chunk that merely *starts*
      // with one would throw away every table preceded by a comment banner -
      // which is most of them.
      statement
        .split('\n')
        .filter((line) => !/^\s*--/.test(line))
        .join('\n')
        .trim(),
    )
    .filter((statement) => statement.length > 0)
}

export function cloudify(statement, table) {
  let out = statement
    .replace(/\s+REFERENCES\s+\w+\s*\([^)]*\)(\s+ON DELETE CASCADE)?/gi, '')
    .replace(/,\s*UNIQUE\s*\([^)]*\)/gi, '')

  // Foreign-key columns are never filled in the cloud - the uuid reference
  // beside them carries the relationship - so they must not be required.
  for (const column of FOREIGN_KEY_COLUMNS[table] ?? []) {
    out = out.replace(
      new RegExp(`(\\b${column}\\s+INTEGER)\\s+NOT\\s+NULL`, 'i'),
      '$1',
    )
  }
  return out
}

export function targetOf(statement) {
  const table = statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)
  const index = statement.match(/CREATE INDEX IF NOT EXISTS \w+ ON (\w+)/i)
  return { table: table?.[1] ?? null, target: table?.[1] ?? index?.[1] ?? null }
}

/**
 * Creates the cloud schema on `client`. Returns what it did so the caller can
 * report it - and verify it, rather than assume it worked.
 */
export async function buildCloudSchema(client, { onError } = {}) {
  const created = []
  for (const statement of splitStatements(readDeviceSchema())) {
    const { table, target } = targetOf(statement)
    if (!target || !SYNCED_TABLES.includes(target)) continue
    try {
      await client.execute(cloudify(statement, target))
      if (table) created.push(table)
    } catch (err) {
      onError?.(target, err)
    }
  }

  // The uuid reference beside each foreign key, plus per-row bookkeeping.
  let columns = 0
  for (const table of SYNCED_TABLES) {
    const extra = [
      ...(FOREIGN_KEY_COLUMNS[table] ?? []).map((c) => `${c}__ref`),
      'sync_device',
      'sync_updated_at',
    ]
    for (const column of extra) {
      try {
        await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`)
        columns++
      } catch {
        // Already present - this is meant to be run repeatedly.
      }
    }
  }

  for (const statement of splitStatements(CHANGE_LOG)) await client.execute(statement)

  return { created, columns }
}

/** Drops the synced tables so they can be rebuilt from a corrected schema. */
export async function dropCloudSchema(client) {
  let dropped = 0
  // Reverse order keeps any future constraints happy.
  for (const table of [...SYNCED_TABLES].reverse()) {
    try {
      await client.execute(`DROP TABLE IF EXISTS ${table}`)
      dropped++
    } catch {
      /* not present */
    }
  }
  return dropped
}

export async function missingTables(client) {
  const result = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
  const present = new Set(result.rows.map((r) => String(r.name)))
  return SYNCED_TABLES.filter((t) => !present.has(t))
}

/**
 * Columns that would reject a real record: a foreign key still marked
 * NOT NULL. Devices never populate these, so any that remain will refuse
 * every record that has a parent.
 */
export async function brokenForeignKeyColumns(client) {
  const broken = []
  for (const table of SYNCED_TABLES) {
    let info
    try {
      info = await client.execute(`PRAGMA table_info(${table})`)
    } catch {
      continue
    }
    for (const row of info.rows) {
      const name = String(row.name)
      if (!(FOREIGN_KEY_COLUMNS[table] ?? []).includes(name)) continue
      if (Number(row.notnull) === 1) broken.push(`${table}.${name}`)
    }
  }
  return broken
}
