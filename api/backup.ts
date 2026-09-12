/**
 * Optional off-site backup (spec S49).
 *
 * A backup on the phone that took it protects against a corrupted database.
 * It does not protect against the phone being lost, stolen, dropped in water
 * or simply left in a taxi — which, on a field outreach, is the likelier of
 * the two. This endpoint keeps a copy somewhere else.
 *
 * What arrives here is already sealed with AES-256-GCM under a passphrase the
 * server has never seen and cannot derive. This table therefore holds
 * ciphertext and nothing else: whoever reads the cloud database learns the
 * size of a file and the name of a device, and not one clinical record. That
 * is the whole reason the encryption happens on the device rather than here.
 *
 * A backup is far larger than a single serverless request, so it travels in
 * chunks and is only offered for restore once every chunk has arrived.
 *
 * Environment: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, SYNC_TOKEN
 */
import { createClient, type Client } from '@libsql/client'
import { corsHeaders } from './_shared/http.js'

export const config = { runtime: 'nodejs' }

/** Backups retained per device. Old ones are pruned as new ones complete. */
const KEEP_PER_DEVICE = 3

/** Refuses a chunk larger than this, so one request cannot exhaust memory. */
const MAX_CHUNK_CHARS = 700_000

/** A whole backup larger than this is almost certainly a mistake. */
const MAX_BACKUP_BYTES = 200 * 1024 * 1024

let client: Client | null = null
function db(): Client {
  if (client) return client
  const url = process.env.TURSO_DATABASE_URL
  if (!url) throw new Error('TURSO_DATABASE_URL is not configured on the server.')
  client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
  return client
}

/**
 * Keeps only the newest few complete backups for a device.
 *
 * Without this the free tier fills up quietly and the next backup — the one
 * that was going to matter — is the one that fails.
 */
async function prune(deviceId: string): Promise<number> {
  const old = await db().execute({
    sql: `SELECT uuid FROM cloud_backups
           WHERE device_id = ? AND complete = 1
           ORDER BY created_at DESC
           LIMIT -1 OFFSET ?`,
    args: [deviceId, KEEP_PER_DEVICE],
  })
  for (const row of old.rows) {
    const uuid = String(row.uuid)
    await db().execute({ sql: 'DELETE FROM cloud_backup_chunks WHERE backup_uuid = ?', args: [uuid] })
    await db().execute({ sql: 'DELETE FROM cloud_backups WHERE uuid = ?', args: [uuid] })
  }

  // Incomplete uploads are abandoned attempts; they hold space and can never
  // be restored, so they go as soon as a later one succeeds.
  const stale = await db().execute({
    sql: `SELECT uuid FROM cloud_backups WHERE device_id = ? AND complete = 0`,
    args: [deviceId],
  })
  for (const row of stale.rows) {
    const uuid = String(row.uuid)
    await db().execute({ sql: 'DELETE FROM cloud_backup_chunks WHERE backup_uuid = ?', args: [uuid] })
    await db().execute({ sql: 'DELETE FROM cloud_backups WHERE uuid = ?', args: [uuid] })
  }

  return old.rows.length + stale.rows.length
}

export async function handleBackup(input: {
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
    uuid?: string
    filename?: string
    createdAt?: string
    sizeBytes?: number
    checksum?: string
    chunkCount?: number
    createdBy?: string
    recordCounts?: string
    seq?: number
    data?: string
  }
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'Malformed request.' }, 400)

  const deviceId = String(body.deviceId ?? '').slice(0, 64)

  try {
    if (body.action === 'begin') {
      const uuid = String(body.uuid ?? '').slice(0, 64)
      const size = Number(body.sizeBytes ?? 0)
      const chunkCount = Number(body.chunkCount ?? 0)
      if (!uuid || !deviceId) return json({ ok: false, error: 'Malformed request.' }, 400)
      if (!(size > 0) || !(chunkCount > 0)) {
        return json({ ok: false, error: 'An empty backup cannot be uploaded.' }, 400)
      }
      if (size > MAX_BACKUP_BYTES) {
        return json({ ok: false, error: 'That backup is too large to store in the cloud.' }, 413)
      }

      // Starting over replaces any earlier attempt with the same identity,
      // so a retry after a dropped connection does not duplicate chunks.
      await db().execute({ sql: 'DELETE FROM cloud_backup_chunks WHERE backup_uuid = ?', args: [uuid] })
      await db().execute({
        sql: `INSERT INTO cloud_backups (uuid, device_id, filename, created_at, size_bytes,
                                         checksum, chunk_count, chunks_in, complete, created_by,
                                         record_counts, received_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
              ON CONFLICT(uuid) DO UPDATE SET
                filename = excluded.filename, size_bytes = excluded.size_bytes,
                checksum = excluded.checksum, chunk_count = excluded.chunk_count,
                chunks_in = 0, complete = 0, received_at = excluded.received_at`,
        args: [
          uuid,
          deviceId,
          String(body.filename ?? 'backup.nugbak').slice(0, 200),
          String(body.createdAt ?? new Date().toISOString()),
          size,
          body.checksum ? String(body.checksum) : null,
          chunkCount,
          body.createdBy ? String(body.createdBy).slice(0, 120) : null,
          body.recordCounts ? String(body.recordCounts).slice(0, 4000) : null,
          new Date().toISOString(),
        ],
      })
      return json({ ok: true, uuid })
    }

    if (body.action === 'chunk') {
      const uuid = String(body.uuid ?? '')
      const seq = Number(body.seq ?? -1)
      const data = String(body.data ?? '')
      if (!uuid || seq < 0 || !data) return json({ ok: false, error: 'Malformed chunk.' }, 400)
      if (data.length > MAX_CHUNK_CHARS) return json({ ok: false, error: 'Chunk too large.' }, 413)

      await db().execute({
        sql: `INSERT INTO cloud_backup_chunks (backup_uuid, seq, data) VALUES (?, ?, ?)
              ON CONFLICT(backup_uuid, seq) DO UPDATE SET data = excluded.data`,
        args: [uuid, seq, data],
      })
      const counted = await db().execute({
        sql: 'SELECT COUNT(*) AS n FROM cloud_backup_chunks WHERE backup_uuid = ?',
        args: [uuid],
      })
      const received = Number(counted.rows[0].n)
      await db().execute({
        sql: 'UPDATE cloud_backups SET chunks_in = ? WHERE uuid = ?',
        args: [received, uuid],
      })
      return json({ ok: true, received })
    }

    if (body.action === 'complete') {
      const uuid = String(body.uuid ?? '')
      const row = await db().execute({
        sql: 'SELECT device_id, chunk_count FROM cloud_backups WHERE uuid = ?',
        args: [uuid],
      })
      if (row.rows.length === 0) return json({ ok: false, error: 'No such backup.' }, 404)

      const counted = await db().execute({
        sql: 'SELECT COUNT(*) AS n FROM cloud_backup_chunks WHERE backup_uuid = ?',
        args: [uuid],
      })
      const received = Number(counted.rows[0].n)
      const wanted = Number(row.rows[0].chunk_count)

      // A backup that is only mostly there is worse than none at all: it
      // would be offered for restore and fail at the moment of need.
      if (received !== wanted) {
        return json(
          { ok: false, error: `Incomplete upload: ${received} of ${wanted} parts arrived.` },
          409,
        )
      }

      await db().execute({ sql: 'UPDATE cloud_backups SET complete = 1 WHERE uuid = ?', args: [uuid] })
      const pruned = await prune(String(row.rows[0].device_id))
      return json({ ok: true, uuid, chunks: received, pruned })
    }

    if (body.action === 'list') {
      const result = await db().execute({
        sql: `SELECT uuid, device_id, filename, created_at, size_bytes, checksum,
                     chunk_count, created_by, record_counts
                FROM cloud_backups
               WHERE complete = 1
               ORDER BY created_at DESC
               LIMIT 50`,
        args: [],
      })
      return json({
        ok: true,
        backups: result.rows.map((r) => ({
          uuid: String(r.uuid),
          deviceId: String(r.device_id),
          filename: String(r.filename),
          createdAt: String(r.created_at),
          sizeBytes: Number(r.size_bytes),
          checksum: r.checksum ? String(r.checksum) : null,
          chunkCount: Number(r.chunk_count),
          createdBy: r.created_by ? String(r.created_by) : null,
          recordCounts: r.record_counts ? String(r.record_counts) : null,
        })),
      })
    }

    if (body.action === 'fetch') {
      const uuid = String(body.uuid ?? '')
      const seq = Number(body.seq ?? -1)
      if (!uuid || seq < 0) return json({ ok: false, error: 'Malformed request.' }, 400)
      const result = await db().execute({
        sql: 'SELECT data FROM cloud_backup_chunks WHERE backup_uuid = ? AND seq = ?',
        args: [uuid, seq],
      })
      if (result.rows.length === 0) return json({ ok: false, error: 'No such part.' }, 404)
      return json({ ok: true, seq, data: String(result.rows[0].data) })
    }

    if (body.action === 'delete') {
      const uuid = String(body.uuid ?? '')
      if (!uuid) return json({ ok: false, error: 'Malformed request.' }, 400)
      await db().execute({ sql: 'DELETE FROM cloud_backup_chunks WHERE backup_uuid = ?', args: [uuid] })
      await db().execute({ sql: 'DELETE FROM cloud_backups WHERE uuid = ?', args: [uuid] })
      return json({ ok: true })
    }

    return json({ ok: false, error: `Unknown action: ${body.action}` }, 400)
  } catch (err) {
    console.error('[backup]', err)
    return json({ ok: false, error: 'The cloud could not complete the request.' }, 500)
  }
}

// --------------------------------------------------------------- adapters

export async function webHandler(request: Request): Promise<Response> {
  const cors = corsHeaders(request.headers.get('origin'))
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
  const result = await handleBackup({
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

export default async function handler(
  request: NodeRequest,
  response: NodeResponse,
): Promise<void> {
  const header = request.headers['x-sync-token']
  const token = Array.isArray(header) ? (header[0] ?? null) : (header ?? null)
  const originHeader = request.headers.origin
  const origin = Array.isArray(originHeader) ? (originHeader[0] ?? null) : (originHeader ?? null)
  const method = request.method ?? 'GET'

  for (const [name, value] of Object.entries(corsHeaders(origin))) {
    response.setHeader(name, value)
  }
  if (method === 'OPTIONS') {
    response.statusCode = 204
    response.end('')
    return
  }

  const result = await handleBackup({
    method,
    token,
    body: method === 'POST' ? await readBody(request) : null,
  })
  response.statusCode = result.status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(result.body))
}
