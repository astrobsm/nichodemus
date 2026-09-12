#!/usr/bin/env node
/**
 * Prepares the cloud database.
 *
 *   npm run cloud:setup
 *
 * Creates the Turso tables from the same schema.sql the phones use, adds the
 * change log the sync endpoint pages through, and prints the environment
 * variables to paste into Vercel.
 *
 * Reads TURSO_DATABASE_URL and TURSO_AUTH_TOKEN from the environment or from
 * a .env.local file beside package.json. Run it again any time: it is
 * idempotent.
 */
import { createClient } from '@libsql/client'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// --------------------------------------------------------------- config

function loadEnvFile() {
  const file = resolve(root, '.env.local')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) continue
    const value = match[2].replace(/^["']|["']$/g, '')
    if (!process.env[match[1]]) process.env[match[1]] = value
  }
}
loadEnvFile()

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN

if (!url) {
  console.error(`
  No TURSO_DATABASE_URL found.

  Create a free database first - it takes about two minutes:

    1. Install the CLI
         Windows : irm get.tur.so/install.ps1 | iex
         macOS   : brew install tursodatabase/tap/turso
         Linux   : curl -sSfL https://get.tur.so/install.sh | bash

    2. Sign up and create the database
         turso auth signup
         turso db create nug-outreach

    3. Read off its address and make a token
         turso db show nug-outreach --url
         turso db tokens create nug-outreach

    4. Put both in ${resolve(root, '.env.local')}

         TURSO_DATABASE_URL=libsql://nug-outreach-<your-org>.turso.io
         TURSO_AUTH_TOKEN=<the token>

    5. Run this again:  npm run cloud:setup
`)
  process.exit(1)
}

// --------------------------------------------------------------- schema

const schema = readFileSync(resolve(root, 'src/db/schema.sql'), 'utf8')

/**
 * The cloud copy differs from the device copy in exactly two ways, and both
 * are deliberate:
 *
 *   - `uuid` is UNIQUE on every table so the endpoint can upsert on it. The
 *     device schema already declares this.
 *   - foreign keys are stored as the referenced row's uuid (column__ref)
 *     rather than a local integer id, because local ids differ per device.
 *     Constraints are therefore not enforced server-side; the devices remain
 *     the authority on referential integrity.
 */
const CHANGE_LOG = `
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
`

const SYNCED_TABLES = [
  'projects', 'stations', 'team_members', 'attendance', 'tasks', 'users',
  'participants', 'consents', 'vitals', 'glucose_results', 'clinical_encounters',
  'wounds', 'wound_assessments', 'breast_examinations', 'facilities', 'referrals',
  'followups', 'queue_events', 'suppliers', 'budget_categories', 'budget_items',
  'expenses', 'inventory_items', 'inventory_transactions', 'procurement',
  'mobilisation_activities', 'logistics_items', 'event_checklists',
]

const FOREIGN_KEY_COLUMNS = {
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
}

function splitStatements(sql) {
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

/**
 * Strips the parts of the device schema the cloud copy must not keep:
 * REFERENCES clauses (local ids mean nothing here) and the composite UNIQUE
 * constraints that assume a single device's numbering.
 */
function cloudify(statement) {
  return statement
    .replace(/\s+REFERENCES\s+\w+\s*\([^)]*\)(\s+ON DELETE CASCADE)?/gi, '')
    .replace(/,\s*UNIQUE\s*\([^)]*\)/gi, '')
}

const client = createClient({ url, authToken })

console.log(`\n  Connecting to ${url.replace(/\/\/.*@/, '//')}`)

try {
  await client.execute('SELECT 1')
} catch (err) {
  console.error(`\n  ✗ Could not connect: ${err.message}\n`)
  process.exit(1)
}

let created = 0
for (const statement of splitStatements(schema)) {
  // Only the tables that take part in sync, plus their indexes.
  const tableMatch = statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)
  const indexMatch = statement.match(/CREATE INDEX IF NOT EXISTS \w+ ON (\w+)/i)
  const target = tableMatch?.[1] ?? indexMatch?.[1]
  if (!target || !SYNCED_TABLES.includes(target)) continue

  try {
    await client.execute(cloudify(statement))
    if (tableMatch) created++
  } catch (err) {
    console.error(`  ! ${target}: ${err.message}`)
  }
}
console.log(`  ${created} tables ready`)

// Reference columns, and the bookkeeping every row needs.
let added = 0
for (const [table, columns] of Object.entries(FOREIGN_KEY_COLUMNS)) {
  for (const column of [...columns.map((c) => `${c}__ref`), 'sync_device', 'sync_updated_at']) {
    try {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`)
      added++
    } catch {
      // Already present - this script is meant to be run repeatedly.
    }
  }
}
for (const table of ['projects']) {
  for (const column of ['sync_device', 'sync_updated_at']) {
    try {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`)
      added++
    } catch {
      /* already present */
    }
  }
}
console.log(`  ${added} synchronisation columns added`)

for (const statement of splitStatements(CHANGE_LOG)) {
  await client.execute(statement)
}
console.log('  change log ready')

const count = await client.execute('SELECT COALESCE(MAX(seq), 0) AS seq FROM sync_changes')
console.log(`  current change cursor: ${count.rows[0].seq}`)

// Confirm every table actually exists. A partially created cloud database
// would accept most records and silently reject the rest - the failure would
// only show up as missing clinical records weeks later.
const present = new Set(
  (
    await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    )
  ).rows.map((r) => String(r.name)),
)
const missing = SYNCED_TABLES.filter((t) => !present.has(t))
if (missing.length > 0) {
  console.error(`
  ✗ ${missing.length} of ${SYNCED_TABLES.length} tables were not created:

      ${missing.join(', ')}

  The cloud database is incomplete and records from those tables would be
  rejected. Run this script again; if it keeps failing, report the errors
  printed above.
`)
  client.close()
  process.exit(1)
}
console.log(`  verified: all ${SYNCED_TABLES.length} tables present`)

const suggested = randomBytes(24).toString('base64url')

console.log(`
  ────────────────────────────────────────────────────────────────────
  Next: put these three variables into Vercel
  (Project → Settings → Environment Variables)

    TURSO_DATABASE_URL   ${url}
    TURSO_AUTH_TOKEN     ${authToken ? '<the token you already have>' : '<create one with: turso db tokens create>'}
    SYNC_TOKEN           ${suggested}

  SYNC_TOKEN is the key each device presents. Keep it secret, and put the
  same value into every device under Settings → Cloud sync. Changing it on
  Vercel immediately locks out every device - which is how you revoke a
  lost phone.

  Then deploy:   npm run cloud:deploy
  ────────────────────────────────────────────────────────────────────
`)

client.close()
