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
  FOREIGN_KEYS,
  REF_SUFFIX,
  incomingWins,
  type SyncRecord,
} from '../src/services/syncModel'

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
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

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405)

  const expected = process.env.SYNC_TOKEN
  if (!expected) return json({ ok: false, error: 'The server has no SYNC_TOKEN configured.' }, 500)
  if (request.headers.get('x-sync-token') !== expected) {
    return json({ ok: false, error: 'Unauthorised device.' }, 401)
  }

  let body: { action?: string; deviceId?: string; records?: SyncRecord[]; cursor?: number; limit?: number }
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'Malformed request.' }, 400)
  }

  const deviceId = String(body.deviceId ?? 'unknown').slice(0, 64)

  try {
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
      return json({ ok: true, accepted, rejected, cursor: Number(seq.rows[0].seq) })
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
      return json({ ok: true, records, cursor: nextCursor, more })
    }

    if (body.action === 'ping') {
      const r = await db().execute('SELECT COALESCE(MAX(seq), 0) AS seq FROM sync_changes')
      return json({ ok: true, cursor: Number(r.rows[0].seq) })
    }

    return json({ ok: false, error: `Unknown action: ${body.action}` }, 400)
  } catch (err) {
    // Never leak connection strings or SQL into a client-visible message.
    console.error('[sync]', err)
    return json({ ok: false, error: 'The cloud could not complete the request.' }, 500)
  }
}

export { FOREIGN_KEYS, REF_SUFFIX }
