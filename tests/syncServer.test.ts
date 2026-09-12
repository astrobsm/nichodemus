/**
 * The cloud synchronisation endpoint.
 *
 * Runs the real handler from api/sync.ts against a real libSQL database (a
 * local file, which is the same engine Turso runs), so authentication,
 * conflict resolution, the change log and paging are all exercised rather
 * than mocked.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SyncRecord } from '../src/services/syncModel'

const TOKEN = 'test-sync-token'
let dir: string
let client: Client
let handler: (request: Request) => Promise<Response>

/** Minimal cloud schema: uuid-keyed tables plus the change log. */
const CLOUD_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS projects (
     id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE, code TEXT,
     name TEXT, updated_at TEXT, version INTEGER, deleted_at TEXT,
     sync_device TEXT, sync_updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS participants (
     id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE,
     participant_code TEXT, first_name TEXT, last_name TEXT, phone TEXT,
     updated_at TEXT, version INTEGER, deleted_at TEXT,
     project_id__ref TEXT, current_station_id__ref TEXT,
     sync_device TEXT, sync_updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS sync_changes (
     seq INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL,
     row_uuid TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0, device_id TEXT, payload TEXT NOT NULL,
     received_at TEXT NOT NULL DEFAULT (datetime('now')))`,
]

function post(body: unknown, token: string | null = TOKEN): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token !== null) headers['x-sync-token'] = token
  return handler(
    new Request('https://example.test/api/sync', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

function participantRecord(
  uuid: string,
  overrides: Partial<SyncRecord> & { row?: Record<string, unknown> } = {},
): SyncRecord {
  return {
    table: 'participants',
    uuid,
    updated_at: '2026-12-29T09:00:00.000+01:00',
    version: 1,
    deleted: false,
    row: {
      uuid,
      participant_code: 'NUG-0001',
      first_name: 'Ngozi',
      last_name: 'Okeke',
      phone: '08031234567',
      updated_at: '2026-12-29T09:00:00.000+01:00',
      version: 1,
      deleted_at: null,
      project_id__ref: 'project-uuid-1',
      ...(overrides.row ?? {}),
    },
    ...overrides,
  } as SyncRecord
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nug-cloud-'))
  const url = `file:${join(dir, 'cloud.db').replace(/\\/g, '/')}`

  process.env.TURSO_DATABASE_URL = url
  process.env.TURSO_AUTH_TOKEN = ''
  process.env.SYNC_TOKEN = TOKEN

  client = createClient({ url })
  for (const statement of CLOUD_SCHEMA) await client.execute(statement)

  // Imported after the environment is set: the module builds its client lazily
  // but reads the variables on first use.
  handler = (await import('../api/sync')).webHandler
})

afterAll(() => {
  client?.close()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* the temporary directory is already gone */
  }
})

describe('authentication', () => {
  it('refuses a request with no device key', async () => {
    const res = await post({ action: 'ping', deviceId: 'a' }, null)
    expect(res.status).toBe(401)
    expect((await res.json()).ok).toBe(false)
  })

  it('refuses a request with the wrong device key', async () => {
    const res = await post({ action: 'ping', deviceId: 'a' }, 'not-the-token')
    expect(res.status).toBe(401)
  })

  it('accepts the configured device key', async () => {
    const res = await post({ action: 'ping', deviceId: 'a' })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('refuses anything but POST', async () => {
    const res = await handler(new Request('https://example.test/api/sync', { method: 'GET' }))
    expect(res.status).toBe(405)
  })
})

describe('push', () => {
  it('stores a record and logs the change', async () => {
    const res = await post({
      action: 'push',
      deviceId: 'device-a',
      records: [participantRecord('p-1')],
    })
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.accepted).toBe(1)
    expect(body.rejected).toEqual([])

    const row = await client.execute({
      sql: 'SELECT participant_code, first_name, project_id__ref, sync_device FROM participants WHERE uuid = ?',
      args: ['p-1'],
    })
    expect(row.rows[0].participant_code).toBe('NUG-0001')
    expect(row.rows[0].project_id__ref).toBe('project-uuid-1')
    expect(row.rows[0].sync_device).toBe('device-a')

    const log = await client.execute('SELECT COUNT(*) AS n FROM sync_changes')
    expect(Number(log.rows[0].n)).toBeGreaterThan(0)
  })

  it('updates an existing record when the version is newer', async () => {
    await post({
      action: 'push',
      deviceId: 'device-a',
      records: [
        participantRecord('p-2', {
          version: 2,
          updated_at: '2026-12-29T10:00:00.000+01:00',
          row: { version: 2, phone: '08099999999', updated_at: '2026-12-29T10:00:00.000+01:00' },
        }),
      ],
    })
    const res = await post({
      action: 'push',
      deviceId: 'device-b',
      records: [
        participantRecord('p-2', {
          version: 3,
          updated_at: '2026-12-29T11:00:00.000+01:00',
          row: { version: 3, phone: '08055555555', updated_at: '2026-12-29T11:00:00.000+01:00' },
        }),
      ],
    })
    expect((await res.json()).accepted).toBe(1)

    const row = await client.execute({
      sql: 'SELECT phone, version FROM participants WHERE uuid = ?',
      args: ['p-2'],
    })
    expect(row.rows[0].phone).toBe('08055555555')
    expect(Number(row.rows[0].version)).toBe(3)
  })

  it('rejects a stale record without overwriting the newer one', async () => {
    const res = await post({
      action: 'push',
      deviceId: 'device-c',
      records: [
        participantRecord('p-2', {
          version: 1,
          updated_at: '2026-12-01T08:00:00.000+01:00',
          row: { version: 1, phone: '08000000000', updated_at: '2026-12-01T08:00:00.000+01:00' },
        }),
      ],
    })
    const body = await res.json()
    expect(body.accepted).toBe(0)
    expect(body.rejected[0].reason).toMatch(/superseded/i)

    const row = await client.execute({
      sql: 'SELECT phone FROM participants WHERE uuid = ?',
      args: ['p-2'],
    })
    expect(row.rows[0].phone).toBe('08055555555')
  })

  it('refuses a table it does not know about', async () => {
    const res = await post({
      action: 'push',
      deviceId: 'device-a',
      records: [{ ...participantRecord('p-x'), table: 'secret_table' }],
    })
    const body = await res.json()
    expect(body.accepted).toBe(0)
    expect(body.rejected[0].reason).toMatch(/unknown table/i)
  })

  it('refuses a record with no uuid', async () => {
    const res = await post({
      action: 'push',
      deviceId: 'device-a',
      records: [{ ...participantRecord(''), uuid: '' }],
    })
    expect((await res.json()).rejected[0].reason).toMatch(/no uuid/i)
  })

  it('caps how much can be sent at once', async () => {
    const many = Array.from({ length: 501 }, (_, i) => participantRecord(`bulk-${i}`))
    const res = await post({ action: 'push', deviceId: 'device-a', records: many })
    expect(res.status).toBe(413)
  })
})

describe('pull', () => {
  it('returns changes made by other devices', async () => {
    const res = await post({ action: 'pull', deviceId: 'device-z', cursor: 0, limit: 100 })
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.records.length).toBeGreaterThan(0)
    expect(body.records[0].table).toBe('participants')
    expect(body.records[0].row).toBeTypeOf('object')
    expect(body.cursor).toBeGreaterThan(0)
  })

  it('never returns a device its own changes', async () => {
    const res = await post({ action: 'pull', deviceId: 'device-a', cursor: 0, limit: 200 })
    const body = await res.json()
    const fromSelf = body.records.filter((r: { uuid: string }) => r.uuid === 'p-1')
    expect(fromSelf).toHaveLength(0)
  })

  it('pages through with a cursor and reports when more remain', async () => {
    const first = await (await post({ action: 'pull', deviceId: 'device-z', cursor: 0, limit: 1 })).json()
    expect(first.records).toHaveLength(1)
    expect(first.more).toBe(true)

    const second = await (
      await post({ action: 'pull', deviceId: 'device-z', cursor: first.cursor, limit: 1 })
    ).json()
    expect(second.records).toHaveLength(1)
    expect(second.records[0].seq).toBeGreaterThan(first.records[0].seq)
  })

  it('returns nothing once the cursor has caught up', async () => {
    const all = await (
      await post({ action: 'pull', deviceId: 'device-z', cursor: 0, limit: 500 })
    ).json()
    const caughtUp = await (
      await post({ action: 'pull', deviceId: 'device-z', cursor: all.cursor, limit: 500 })
    ).json()
    expect(caughtUp.records).toHaveLength(0)
    expect(caughtUp.more).toBe(false)
  })
})

describe('the Node adapter Vercel actually calls', () => {
  /**
   * Vercel's Node runtime passes a Node request/response pair, not a web
   * Request. The deployed function failed on every call until this path
   * existed, so it is tested directly rather than only through the web
   * adapter the other tests use.
   */
  function nodeCall(
    method: string,
    token: string | null,
    body: unknown,
    { preparsed = true }: { preparsed?: boolean } = {},
  ): Promise<{ status: number; body: any; contentType: string }> {
    return new Promise(async (resolve) => {
      const listeners: Record<string, ((chunk?: unknown) => void)[]> = {}
      const request = {
        method,
        headers: token === null ? {} : { 'x-sync-token': token },
        ...(preparsed ? { body } : {}),
        on(event: string, listener: (chunk?: unknown) => void) {
          ;(listeners[event] ??= []).push(listener)
        },
      }
      const headers: Record<string, string> = {}
      const response = {
        statusCode: 0,
        setHeader(name: string, value: string) {
          headers[name] = value
        },
        end(payload: string) {
          resolve({
            status: response.statusCode,
            body: JSON.parse(payload),
            contentType: headers['content-type'],
          })
        },
      }

      const nodeHandler = (await import('../api/sync')).default
      const done = nodeHandler(request as never, response as never)

      if (!preparsed) {
        // Stream the body the way an unparsed Node request would.
        queueMicrotask(() => {
          listeners.data?.forEach((l) => l(Buffer.from(JSON.stringify(body))))
          listeners.end?.forEach((l) => l())
        })
      }
      await done
    })
  }

  it('answers a ping with a JSON body and the right status', async () => {
    const res = await nodeCall('POST', TOKEN, { action: 'ping', deviceId: 'node-a' })
    expect(res.status).toBe(200)
    expect(res.contentType).toBe('application/json')
    expect(res.body.ok).toBe(true)
  })

  it('refuses a wrong key', async () => {
    const res = await nodeCall('POST', 'nope', { action: 'ping', deviceId: 'node-a' })
    expect(res.status).toBe(401)
  })

  it('refuses a missing key', async () => {
    const res = await nodeCall('POST', null, { action: 'ping', deviceId: 'node-a' })
    expect(res.status).toBe(401)
  })

  it('refuses anything but POST', async () => {
    const res = await nodeCall('GET', TOKEN, null)
    expect(res.status).toBe(405)
  })

  it('reads a body the platform has not parsed', async () => {
    const res = await nodeCall(
      'POST',
      TOKEN,
      { action: 'ping', deviceId: 'node-stream' },
      { preparsed: false },
    )
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('pushes and pulls through the Node path', async () => {
    const push = await nodeCall('POST', TOKEN, {
      action: 'push',
      deviceId: 'node-writer',
      records: [participantRecord('node-1')],
    })
    expect(push.body.accepted).toBe(1)

    const pull = await nodeCall('POST', TOKEN, {
      action: 'pull',
      deviceId: 'node-reader',
      cursor: 0,
      limit: 200,
    })
    expect(pull.body.records.some((r: { uuid: string }) => r.uuid === 'node-1')).toBe(true)
  })
})

describe('error handling', () => {
  it('reports an unknown action rather than guessing', async () => {
    const res = await post({ action: 'destroy', deviceId: 'a' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/unknown action/i)
  })

  it('handles a malformed body', async () => {
    const res = await handler(
      new Request('https://example.test/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sync-token': TOKEN },
        body: 'not json at all',
      }),
    )
    expect(res.status).toBe(400)
  })

  it('does not leak database detail to the client', async () => {
    // A column that does not exist causes a database error inside upsert.
    const res = await post({
      action: 'push',
      deviceId: 'device-a',
      records: [participantRecord('p-err', { row: { nonexistent_column: 'x' } })],
    })
    const body = await res.json()
    const text = JSON.stringify(body)
    expect(text).not.toMatch(/libsql|TURSO|authToken|file:/i)
  })
})
