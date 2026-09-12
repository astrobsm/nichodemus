/**
 * The generated cloud schema, exercised with records shaped exactly as a
 * device sends them.
 *
 * tests/syncServer.test.ts uses a small hand-written cloud schema, which is
 * fine for testing the endpoint's logic but says nothing about the schema the
 * setup script actually produces. That gap let a real failure reach
 * production: the cloud tables kept `project_id INTEGER NOT NULL` from the
 * device schema while devices send `project_id__ref` instead, so every record
 * with a parent was rejected and only the two parentless tables synced.
 *
 * This builds the real schema and pushes real-shaped records through it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error - plain JS build script, no type declarations
import { buildCloudSchema, brokenForeignKeyColumns, missingTables, SYNCED_TABLES, FOREIGN_KEY_COLUMNS } from '../scripts/cloud-schema.mjs'

const TOKEN = 'schema-test-token'
let dir: string
let client: Client
let handler: (request: Request) => Promise<Response>

const NOW = '2026-12-29T09:00:00.000+01:00'
const PROJECT_UUID = 'proj-0000-0000-0000-000000000001'

function post(body: unknown): Promise<Response> {
  return handler(
    new Request('https://local.test/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-token': TOKEN },
      body: JSON.stringify(body),
    }),
  )
}

/** A record shaped the way src/services/sync.ts builds one. */
function record(table: string, uuid: string, row: Record<string, unknown>) {
  return {
    table,
    uuid,
    updated_at: NOW,
    version: 1,
    deleted: false,
    row: {
      uuid,
      created_at: NOW,
      updated_at: NOW,
      device_id: 'device-a',
      created_by: 'ada',
      updated_by: 'ada',
      version: 1,
      deleted_at: null,
      ...row,
    },
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nug-schema-'))
  const url = `file:${join(dir, 'cloud.db').replace(/\\/g, '/')}`

  process.env.TURSO_DATABASE_URL = url
  process.env.TURSO_AUTH_TOKEN = ''
  process.env.SYNC_TOKEN = TOKEN

  client = createClient({ url })
  await buildCloudSchema(client)
  handler = (await import('../api/sync')).webHandler
})

afterAll(() => {
  client?.close()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* already gone */
  }
})

describe('the generated cloud schema', () => {
  it('creates every synchronised table', async () => {
    expect(await missingTables(client)).toEqual([])
  })

  it('leaves no foreign key column required', async () => {
    // This is the check that would have caught the production failure.
    expect(await brokenForeignKeyColumns(client)).toEqual([])
  })

  it('adds a uuid reference column beside every foreign key', async () => {
    for (const table of SYNCED_TABLES as string[]) {
      const info = await client.execute(`PRAGMA table_info(${table})`)
      const columns = new Set(info.rows.map((r) => String(r.name)))
      for (const fk of (FOREIGN_KEY_COLUMNS as Record<string, string[]>)[table] ?? []) {
        expect(columns.has(`${fk}__ref`), `${table}.${fk}__ref missing`).toBe(true)
      }
      expect(columns.has('sync_device'), `${table}.sync_device missing`).toBe(true)
    }
  })

  it('keeps uuid unique so the endpoint can upsert on it', async () => {
    for (const table of SYNCED_TABLES as string[]) {
      const indexes = await client.execute(`PRAGMA index_list(${table})`)
      let uniqueOnUuid = false
      for (const idx of indexes.rows) {
        if (Number(idx.unique) !== 1) continue
        const cols = await client.execute(`PRAGMA index_info(${String(idx.name)})`)
        if (cols.rows.length === 1 && String(cols.rows[0].name) === 'uuid') uniqueOnUuid = true
      }
      expect(uniqueOnUuid, `${table} has no unique index on uuid`).toBe(true)
    }
  })
})

describe('records shaped as a device sends them', () => {
  it('accepts a whole outreach: project, station, participant, vitals', async () => {
    const records = [
      record('projects', PROJECT_UUID, {
        code: 'PRJ-A1B2C3',
        name: 'Test Outreach',
        status: 'PLANNING',
        participant_prefix: 'NUG',
        currency: 'NGN',
        is_active: 1,
        is_demo: 0,
        expected_participants: 500,
      }),
      record('stations', 'stat-0000-0000-0000-000000000001', {
        code: 'REG',
        name: 'Registration',
        stage: 'REGISTERED',
        sort_order: 0,
        is_active: 1,
        project_id__ref: PROJECT_UUID,
      }),
      record('participants', 'part-0000-0000-0000-000000000001', {
        participant_code: 'NUG-0001',
        serial_no: 1,
        first_name: 'Ngozi',
        last_name: 'Okeke',
        sex: 'FEMALE',
        age_years: 54,
        age_is_estimated: 1,
        known_hypertension: 'UNKNOWN',
        known_diabetes: 'UNKNOWN',
        previous_breast_problem: 'UNKNOWN',
        workflow_status: 'REGISTERED',
        registered_at: NOW,
        is_demo: 0,
        project_id__ref: PROJECT_UUID,
        current_station_id__ref: 'stat-0000-0000-0000-000000000001',
      }),
      record('vitals', 'vit-0000-0000-0000-000000000001', {
        reading_index: 1,
        bp_systolic: 168,
        bp_diastolic: 96,
        recorded_at: NOW,
        recorded_by: 'ada',
        alert_level: 'ATTENTION',
        is_demo: 0,
        participant_id__ref: 'part-0000-0000-0000-000000000001',
        project_id__ref: PROJECT_UUID,
        station_id__ref: null,
      }),
    ]

    const body = await (await post({ action: 'push', deviceId: 'device-a', records })).json()
    expect(body.rejected, JSON.stringify(body.rejected)).toEqual([])
    expect(body.accepted).toBe(4)
  })

  it('stores the uuid reference, not a number, for each foreign key', async () => {
    const row = await client.execute({
      sql: 'SELECT project_id, project_id__ref FROM participants WHERE uuid = ?',
      args: ['part-0000-0000-0000-000000000001'],
    })
    expect(row.rows[0].project_id).toBeNull()
    expect(row.rows[0].project_id__ref).toBe(PROJECT_UUID)
  })

  it('delivers the whole set to a second device', async () => {
    const body = await (
      await post({ action: 'pull', deviceId: 'device-b', cursor: 0, limit: 100 })
    ).json()
    const tables = body.records.map((r: { table: string }) => r.table)
    expect(tables).toContain('projects')
    expect(tables).toContain('stations')
    expect(tables).toContain('participants')
    expect(tables).toContain('vitals')
  })

  it('accepts a record from every synchronised table', async () => {
    // A blunt check that no table has a constraint devices cannot satisfy.
    const refused: string[] = []
    for (const table of SYNCED_TABLES as string[]) {
      if (table === 'projects') continue // already covered, and it is the parent
      const info = await client.execute(`PRAGMA table_info(${table})`)
      const row: Record<string, unknown> = {}
      for (const col of info.rows) {
        const name = String(col.name)
        if (name === 'id') continue
        if (Number(col.notnull) !== 1 || col.dflt_value !== null) continue
        // Give every required column a plausible value of the right shape.
        row[name] = String(col.type).toUpperCase().includes('INT') ? 1 : NOW
      }
      row.uuid = `probe-${table}`
      for (const fk of (FOREIGN_KEY_COLUMNS as Record<string, string[]>)[table] ?? []) {
        row[`${fk}__ref`] = PROJECT_UUID
        delete row[fk]
      }
      const body = await (
        await post({
          action: 'push',
          deviceId: 'probe',
          records: [
            { table, uuid: `probe-${table}`, updated_at: NOW, version: 1, deleted: false, row },
          ],
        })
      ).json()
      if (body.accepted !== 1) refused.push(`${table}: ${JSON.stringify(body.rejected)}`)
    }
    expect(refused, refused.join('\n')).toEqual([])
  })
})
