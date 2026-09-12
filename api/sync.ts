/**
 * Cloud synchronisation endpoint (Vercel serverless function).
 *
 * The Turso credentials live only here, in server environment variables.
 * They are never shipped to a device, so a lost phone cannot be used to read
 * or rewrite the shared database - it only holds a sync token, which an
 * administrator can revoke by changing SYNC_TOKEN.
 *
 * Environment:
 *   TURSO_DATABASE_URL   libsql://<name>-<org>.turso.io
 *   TURSO_AUTH_TOKEN     database token from "turso db tokens create"
 *   SYNC_TOKEN           shared secret each device presents
 */
import { createClient, type Client } from '@libsql/client'
import {
  APPLY_ORDER,
  incomingWins,
  type SyncRecord,
  // The explicit .js extension matters: without it the compiled function
  // emits a bare specifier that Node's ESM loader cannot resolve at runtime.
} from './_shared/syncModel.js'
import { corsHeaders } from './_shared/http.js'

export const config = { runtime: 'nodejs' }

const SYNCABLE = new Set(APPLY_ORDER)
const MAX_RECORDS = 500

let client: Client | null = null
function db(): Client {
  if (client) return client
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url) throw new Error('TURSO_DATABASE_URL is not configured on the server.')
  client = createClient({ url, authToken })
  return client
}

/** Columns the cloud copy of a table actually has. */
const columnCache = new Map<string, Set<string>>()
async function columnsOf(table: string): Promise<Set<string>> {
  const cached = columnCache.get(table)
  if (cached) return cached
  const result = await db().execute(`PRAGMA table_info(${table})`)
  const cols = new Set(result.rows.map((r) => String(r.name)))
  columnCache.set(table, cols)
  return cols
}

/**
 * Upserts one record. The cloud keeps the same uuid-referenced shape the
 * devices send, so no id translation is needed here - the reference columns
 * are stored verbatim alongside the data.
 */
async function upsert(record: SyncRecord, deviceId: string): Promise<'accepted' | 'stale'> {
  const table = record.table
  const existing = await db().execute({
    sql: `SELECT version, updated_at, uuid FROM ${table} WHERE uuid = ?`,
    args: [record.uuid],
  })

  const current = existing.rows.length
    ? {
        version: Number(existing.rows[0].version),
        updated_at: String(existing.rows[0].updated_at),
        uuid: String(existing.rows[0].uuid),
      }
    : null

  if (!incomingWins(record, current)) return 'stale'

  const allowed = await columnsOf(table)
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record.row)) {
    if (allowed.has(key)) data[key] = value ?? null
  }
  data.uuid = record.uuid
  data.sync_device = deviceId
  data.sync_updated_at = new Date().toISOString()

  const cols = Object.keys(data)
  const placeholders = cols.map(() => '?').join(', ')
  const updates = cols.filter((c) => c !== 'uuid').map((c) => `${c} = excluded.${c}`)

  await db().execute({
    sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
          ON CONFLICT(uuid) DO UPDATE SET ${updates.join(', ')}`,
    args: cols.map((c) => data[c] as never),
  })

  // The change log is what devices page through when pulling.
  await db().execute({
    sql: `INSERT INTO sync_changes (table_name, row_uuid, version, updated_at, deleted, device_id, payload)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      table,
      record.uuid,
      record.version,
      record.updated_at,
      record.deleted ? 1 : 0,
      deviceId,
      JSON.stringify(record.row),
    ],
  })

  return 'accepted'
}
/**
 * Records which participant-number block a device is issuing from.
 *
 * The device that sets the outreach up chooses its block offline, long before
 * a cloud exists, and never signs in through /api/auth - so without this the
 * allocator there would hand that same block to the first member of staff who
 * joined, and two devices would issue the same participant number to two
 * different people. That is not repairable afterwards, so every sync claims
 * the block the device is actually using.
 */
async function claimBlock(
  deviceId: string,
  block: number,
): Promise<{ block: number; conflict: boolean }> {
  const now = new Date().toISOString()

  const mine = await db().execute({
    sql: 'SELECT serial_block FROM sync_devices WHERE device_id = ?',
    args: [deviceId],
  })
  if (mine.rows.length > 0) {
    const held = Number(mine.rows[0].serial_block)
    await db().execute({
      sql: 'UPDATE sync_devices SET last_seen = ? WHERE device_id = ?',
      args: [now, deviceId],
    })
    // A device whose local block no longer matches the one reserved for it
    // has been renumbered by hand. Say so rather than let it drift.
    return { block: held, conflict: held !== block }
  }

  const taken = await db().execute({
    sql: 'SELECT device_id FROM sync_devices WHERE serial_block = ?',
    args: [block],
  })
  await db().execute({
    sql: `INSERT INTO sync_devices (device_id, serial_block, first_seen, last_seen)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(device_id) DO UPDATE SET last_seen = excluded.last_seen`,
    args: [deviceId, block, now, now],
  })
  return { block, conflict: taken.rows.length > 0 }
}

/**
 * The endpoint's logic, independent of how the request arrived.
 *
 * Vercel's Node runtime hands functions a Node request/response pair, while
 * tests (and any edge runtime) speak the web Request/Response standard.
 * Keeping the logic free of either means both adapters below are trivial and
 * the behaviour they share is tested once.
 */
export async function handleSync(input: {
  method: string
  token: string | null
  body: unknown
}): Promise<{ status: number; body: unknown }> {
  const json = (body: unknown, status = 200) => ({ status, body })

  if (input.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405)

  const expected = process.env.SYNC_TOKEN
  if (!expected) return json({ ok: false, error: 'The server has no SYNC_TOKEN configured.' }, 500)
  if (input.token !== expected) return json({ ok: false, error: 'Unauthorised device.' }, 401)

  const body = input.body as {
    action?: string
    deviceId?: string
    records?: SyncRecord[]
    cursor?: number
    limit?: number
    serialBlock?: number
  }
  if (!body || typeof body !== 'object') {
    return json({ ok: false, error: 'Malformed request.' }, 400)
  }

  const deviceId = String(body.deviceId ?? 'unknown').slice(0, 64)

  try {
    // Claiming happens before the action so that a device which only ever
    // pulls still reserves the block it is issuing numbers from.
    let blockConflict = false
    if (typeof body.serialBlock === 'number' && Number.isFinite(body.serialBlock)) {
      const claim = await claimBlock(deviceId, Math.max(0, Math.trunc(body.serialBlock)))
      blockConflict = claim.conflict
    }

    if (body.action === 'push') {
      const records = Array.isArray(body.records) ? body.records : []
      if (records.length > MAX_RECORDS) {
        return json({ ok: false, error: `Send at most ${MAX_RECORDS} records at a time.` }, 413)
      }

      // Parents before children, so a referenced row is always present.
      const ordered = [...records].sort(
        (a, b) => APPLY_ORDER.indexOf(a.table) - APPLY_ORDER.indexOf(b.table),
      )

      let accepted = 0
      const rejected: { uuid: string; reason: string }[] = []
      for (const record of ordered) {
        if (!SYNCABLE.has(record.table)) {
          rejected.push({ uuid: record.uuid, reason: `Unknown table ${record.table}` })
          continue
        }
        if (!record.uuid) {
          rejected.push({ uuid: '', reason: 'Record has no uuid' })
          continue
        }
        try {
          if ((await upsert(record, deviceId)) === 'accepted') accepted++
          else rejected.push({ uuid: record.uuid, reason: 'Superseded by a newer version' })
        } catch (err) {
          rejected.push({ uuid: record.uuid, reason: (err as Error).message })
        }
      }

      const seq = await db().execute('SELECT COALESCE(MAX(seq), 0) AS seq FROM sync_changes')
      return json({ ok: true, accepted, rejected, cursor: Number(seq.rows[0].seq), blockConflict })
    }

    if (body.action === 'pull') {
      const cursor = Number(body.cursor ?? 0)
      const limit = Math.min(Number(body.limit ?? 200), MAX_RECORDS)

      // A device never receives its own changes back.
      const result = await db().execute({
        sql: `SELECT seq, table_name, row_uuid, version, updated_at, deleted, payload
                FROM sync_changes
               WHERE seq > ? AND device_id <> ?
               ORDER BY seq LIMIT ?`,
        args: [cursor, deviceId, limit + 1],
      })

      const rows = result.rows.slice(0, limit)
      const more = result.rows.length > limit

      const records = rows.map((r) => ({
        seq: Number(r.seq),
        table: String(r.table_name),
        uuid: String(r.row_uuid),
        version: Number(r.version),
        updated_at: String(r.updated_at),
        deleted: Number(r.deleted) === 1,
        row: JSON.parse(String(r.payload)) as Record<string, unknown>,
      }))

      const nextCursor = records.length ? records[records.length - 1].seq : cursor
      return json({ ok: true, records, cursor: nextCursor, more, blockConflict })
    }

    if (body.action === 'ping') {
      const r = await db().execute('SELECT COALESCE(MAX(seq), 0) AS seq FROM sync_changes')
      return json({ ok: true, cursor: Number(r.rows[0].seq), blockConflict })
    }

    return json({ ok: false, error: `Unknown action: ${body.action}` }, 400)
  } catch (err) {
    // Never leak connection strings or SQL into a client-visible message.
    console.error('[sync]', err)
    return json({ ok: false, error: 'The cloud could not complete the request.' }, 500)
  }
}


// --------------------------------------------------------------- adapters

/** Web-standard adapter, used by the tests and by any edge runtime. */
export async function webHandler(request: Request): Promise<Response> {
  const origin = request.headers.get('origin')
  const cors = corsHeaders(origin)

  // Preflight: the phone and desktop builds send one before every sync,
  // because x-sync-token is a custom header on a cross-origin request.
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  let parsed: unknown = null
  if (request.method === 'POST') {
    try {
      parsed = await request.json()
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Malformed request.' }), {
        status: 400,
        headers: { ...cors, 'content-type': 'application/json' },
      })
    }
  }
  const result = await handleSync({
    method: request.method,
    token: request.headers.get('x-sync-token'),
    body: parsed,
  })
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}

interface NodeRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
  on(event: string, listener: (chunk?: unknown) => void): void
}

interface NodeResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body: string): void
}

/** Reads the body when the platform has not already parsed it. */
function readBody(request: NodeRequest): Promise<unknown> {
  if (request.body !== undefined && request.body !== null) {
    if (typeof request.body === 'string') {
      try {
        return Promise.resolve(JSON.parse(request.body))
      } catch {
        return Promise.resolve(null)
      }
    }
    return Promise.resolve(request.body)
  }
  // Nothing to stream from: resolve rather than wait for events that will
  // never arrive. A serverless function that hangs burns its whole timeout
  // and returns a gateway error instead of an answer.
  if (typeof request.on !== 'function') return Promise.resolve(null)

  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk as Buffer))
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(null)
      }
    })
    request.on('error', () => resolve(null))
  })
}

/** Default export: the shape Vercel's Node runtime calls. */
export default async function handler(
  request: NodeRequest,
  response: NodeResponse,
): Promise<void> {
  const header = request.headers['x-sync-token']
  const token = Array.isArray(header) ? (header[0] ?? null) : (header ?? null)
  const originHeader = request.headers.origin
  const origin = Array.isArray(originHeader) ? (originHeader[0] ?? null) : (originHeader ?? null)
  const method = request.method ?? 'GET'

  const cors = corsHeaders(origin)
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value)

  if (method === 'OPTIONS') {
    response.statusCode = 204
    response.end('')
    return
  }

  const result = await handleSync({
    method,
    token,
    // Only a POST carries a body. Reading one from a GET would wait on a
    // stream that never ends.
    body: method === 'POST' ? await readBody(request) : null,
  })
  response.statusCode = result.status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(result.body))
}
