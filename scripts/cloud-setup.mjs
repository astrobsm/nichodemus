#!/usr/bin/env node
/**
 * Prepares the cloud database.
 *
 *   npm run cloud:setup              create or update the tables
 *   npm run cloud:setup -- --rebuild drop and recreate them
 *
 * Builds the Turso tables from the same schema.sql the phones use, adds the
 * change log the sync endpoint pages through, verifies the result, and prints
 * the environment variables to paste into Vercel.
 *
 * Reads TURSO_DATABASE_URL and TURSO_AUTH_TOKEN from the environment or from
 * a .env.local file beside package.json. Safe to run repeatedly.
 */
import { createClient } from '@libsql/client'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import {
  SYNCED_TABLES,
  buildCloudSchema,
  dropCloudSchema,
  missingTables,
  brokenForeignKeyColumns,
} from './cloud-schema.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rebuild = process.argv.includes('--rebuild')

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

    1. Sign up at https://app.turso.tech/signup

    2. Install the CLI
         Windows : irm get.tur.so/install.ps1 | iex
         macOS   : brew install tursodatabase/tap/turso
         Linux   : curl -sSfL https://get.tur.so/install.sh | bash

    3. Create the database
         turso auth login
         turso db create nug-outreach
         turso db show nug-outreach --url
         turso db tokens create nug-outreach

    4. Put both in ${resolve(root, '.env.local')}

         TURSO_DATABASE_URL=libsql://nug-outreach-<your-org>.turso.io
         TURSO_AUTH_TOKEN=<the token>

    5. Run this again:  npm run cloud:setup
`)
  process.exit(1)
}

const client = createClient({ url, authToken })

console.log(`\n  Connecting to ${url}`)
try {
  await client.execute('SELECT 1')
} catch (err) {
  console.error(`\n  ✗ Could not connect: ${err.message}\n`)
  process.exit(1)
}

// ------------------------------------------------------------- rebuild

if (rebuild) {
  let rows = 0
  for (const table of SYNCED_TABLES) {
    try {
      const r = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`)
      rows += Number(r.rows[0].n)
    } catch {
      /* table not present */
    }
  }
  console.log(`\n  --rebuild: dropping ${SYNCED_TABLES.length} tables holding ${rows} row(s)`)
  console.log('  Devices keep their own copies and push everything back on the next')
  console.log('  synchronisation. The change log is cleared, so each device restarts')
  console.log('  from cursor 0 and re-sends what it has.')
  await dropCloudSchema(client)
  await client.execute('DROP TABLE IF EXISTS sync_changes')
}

// -------------------------------------------------------------- schema

const errors = []
const { created, columns } = await buildCloudSchema(client, {
  onError: (table, err) => errors.push(`${table}: ${err.message}`),
})
for (const e of errors) console.error(`  ! ${e}`)

console.log(`  ${created.length} tables ready`)
console.log(`  ${columns} synchronisation columns added`)
console.log('  change log ready')

const cursor = await client.execute('SELECT COALESCE(MAX(seq), 0) AS seq FROM sync_changes')
console.log(`  current change cursor: ${cursor.rows[0].seq}`)

// ---------------------------------------------------------- verify it

const missing = await missingTables(client)
if (missing.length > 0) {
  console.error(`
  ✗ ${missing.length} of ${SYNCED_TABLES.length} tables were not created:

      ${missing.join(', ')}

  The cloud database is incomplete and records from those tables would be
  rejected. Run this again; if it keeps failing, report the errors above.
`)
  client.close()
  process.exit(1)
}

// A foreign key still marked NOT NULL rejects every record that has a parent
// - which is nearly all of them - while the endpoint keeps reporting success
// for the handful that do not.
const broken = await brokenForeignKeyColumns(client)
if (broken.length > 0) {
  console.error(`
  ✗ ${broken.length} foreign key column(s) are still required:

      ${broken.join(', ')}

  Devices send these as uuid references, never as numbers, so every record
  with a parent would be refused. This happens when the tables were created
  by an older version of this script.

  Rebuild them:

      npm run cloud:setup -- --rebuild

  Devices keep their own data and will push it all back afterwards.
`)
  client.close()
  process.exit(1)
}

console.log(`  verified: all ${SYNCED_TABLES.length} tables present, foreign keys optional`)

const suggested = randomBytes(24).toString('base64url')

console.log(`
  ────────────────────────────────────────────────────────────────────
  Next: put these three variables into Vercel
  (Project → Settings → Environment Variables)

    TURSO_DATABASE_URL   ${url}
    TURSO_AUTH_TOKEN     ${authToken ? '<the token you already have>' : '<turso db tokens create>'}
    SYNC_TOKEN           ${process.env.SYNC_TOKEN ?? suggested}

  SYNC_TOKEN is the key each device presents. Keep it secret, and put the
  same value into every device under Settings → Cloud sync. Changing it on
  Vercel immediately locks out every device - which is how you revoke a
  lost phone.

  Then deploy:   npm run cloud:deploy
  ────────────────────────────────────────────────────────────────────
`)

client.close()
