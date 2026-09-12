/**
 * End-to-end check against the REAL cloud database.
 *
 *   npm run cloud:verify
 *
 * Skipped by default. `npm test` must never touch a live database or mutate
 * an outreach's records, so this only runs when CLOUD_VERIFY=1, which the
 * cloud:verify script sets after loading .env.local.
 *
 * It pushes one clearly-marked test record through the same handler Vercel
 * runs, pulls it back as a second device, then deletes it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type Client } from '@libsql/client'

const LIVE = process.env.CLOUD_VERIFY === '1'
const TEST_UUID = 'verify-0000-0000-0000-000000000000'

let client: Client
let handler: (request: Request) => Promise<Response>
let startCursor = 0

function post(body: unknown, key = process.env.SYNC_TOKEN): Promise<Response> {
  return handler(
    new Request('https://local.test/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-token': key ?? '' },
      body: JSON.stringify(body),
    }),
  )
}

function projectRecord(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString()
  return {
    table: 'projects',
    uuid: TEST_UUID,
    updated_at: now,
    version: 1,
    deleted: false,
    // Every column a real device would send. The cloud copy keeps the
    // schema's NOT NULL constraints, so a partial record is correctly
    // refused - which is the behaviour we want.
    row: {
      uuid: TEST_UUID,
      code: 'PRJ-VERIFY',
      name: 'CONNECTION TEST - safe to delete',
      status: 'PLANNING',
      participant_prefix: 'NUG',
      currency: 'NGN',
      is_active: 0,
      is_demo: 1,
      created_at: now,
      updated_at: now,
      version: 1,
      deleted_at: null,
    },
    ...overrides,
  }
}

describe.skipIf(!LIVE)('the live cloud database', () => {
  beforeAll(async () => {
    const url = process.env.TURSO_DATABASE_URL
    if (!url) throw new Error('TURSO_DATABASE_URL is not set')
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
    handler = (await import('../api/sync')).default

    const ping = await (await post({ action: 'ping', deviceId: 'verify' })).json()
    startCursor = Number(ping.cursor ?? 0)
    console.log(`\n    connected to ${url}`)
    console.log(`    current change cursor: ${startCursor}`)
  })

  afterAll(async () => {
    // Always clean up, even if a check failed.
    if (!client) return
    await client.execute({ sql: 'DELETE FROM projects WHERE uuid = ?', args: [TEST_UUID] })
    await client.execute({ sql: 'DELETE FROM sync_changes WHERE row_uuid = ?', args: [TEST_UUID] })
    client.close()
    console.log('    test record removed')
  })

  it('has all 28 synchronised tables', async () => {
    const expected = [
      'projects', 'stations', 'team_members', 'attendance', 'tasks', 'users',
      'participants', 'consents', 'vitals', 'glucose_results', 'clinical_encounters',
      'wounds', 'wound_assessments', 'breast_examinations', 'facilities', 'referrals',
      'followups', 'queue_events', 'suppliers', 'budget_categories', 'budget_items',
      'expenses', 'inventory_items', 'inventory_transactions', 'procurement',
      'mobilisation_activities', 'logistics_items', 'event_checklists',
    ]
    const result = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    const present = new Set(result.rows.map((r) => String(r.name)))
    const missing = expected.filter((t) => !present.has(t))
    expect(missing, `missing tables: ${missing.join(', ')}`).toEqual([])
    expect(present.has('sync_changes')).toBe(true)
  })

  it('rejects an incorrect device key', async () => {
    const res = await post({ action: 'ping', deviceId: 'verify' }, 'definitely-wrong')
    expect(res.status).toBe(401)
  })

  it('accepts the configured device key', async () => {
    const res = await post({ action: 'ping', deviceId: 'verify' })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('stores a pushed record in the cloud database', async () => {
    const body = await (
      await post({ action: 'push', deviceId: 'verify-device-a', records: [projectRecord()] })
    ).json()
    expect(body.rejected).toEqual([])
    expect(body.accepted).toBe(1)

    const row = await client.execute({
      sql: 'SELECT name, code, sync_device FROM projects WHERE uuid = ?',
      args: [TEST_UUID],
    })
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].code).toBe('PRJ-VERIFY')
    expect(row.rows[0].sync_device).toBe('verify-device-a')
  })

  it('refuses a record missing a required column', async () => {
    const body = await (
      await post({
        action: 'push',
        deviceId: 'verify-device-a',
        records: [
          {
            table: 'projects',
            uuid: 'verify-incomplete-0000-0000-000000000000',
            updated_at: new Date().toISOString(),
            version: 1,
            deleted: false,
            row: { uuid: 'verify-incomplete-0000-0000-000000000000', name: 'No timestamps' },
          },
        ],
      })
    ).json()
    expect(body.accepted).toBe(0)
    expect(body.rejected[0].reason).toMatch(/NOT NULL|constraint/i)
  })

  it('delivers the change to a second device', async () => {
    const body = await (
      await post({ action: 'pull', deviceId: 'verify-device-b', cursor: startCursor, limit: 50 })
    ).json()
    const found = body.records?.find((r: { uuid: string }) => r.uuid === TEST_UUID)
    expect(found, 'the test record was not delivered').toBeDefined()
    expect(found.row.code).toBe('PRJ-VERIFY')
  })

  it('does not send a device its own change back', async () => {
    const body = await (
      await post({ action: 'pull', deviceId: 'verify-device-a', cursor: startCursor, limit: 50 })
    ).json()
    const echoed = body.records?.filter((r: { uuid: string }) => r.uuid === TEST_UUID) ?? []
    expect(echoed).toHaveLength(0)
  })

  it('refuses an out-of-date copy', async () => {
    const body = await (
      await post({
        action: 'push',
        deviceId: 'verify-device-b',
        records: [
          projectRecord({
            updated_at: '2020-01-01T00:00:00.000Z',
            row: {
              uuid: TEST_UUID,
              code: 'PRJ-VERIFY',
              name: 'STALE - must not win',
              status: 'PLANNING',
              participant_prefix: 'NUG',
              currency: 'NGN',
              is_active: 0,
              is_demo: 1,
              created_at: '2020-01-01T00:00:00.000Z',
              updated_at: '2020-01-01T00:00:00.000Z',
              version: 1,
              deleted_at: null,
            },
          }),
        ],
      })
    ).json()
    expect(body.accepted).toBe(0)

    const row = await client.execute({
      sql: 'SELECT name FROM projects WHERE uuid = ?',
      args: [TEST_UUID],
    })
    expect(String(row.rows[0].name)).not.toContain('STALE')
  })
})
