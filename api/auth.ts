/**
 * Cloud sign-in.
 *
 * Exists so that a member of staff opening the web address does not have to
 * set up an outreach, or be handed a device key, before they can work. They
 * type the username and PIN the administrator gave them; if that matches an
 * account in the shared database, this hands back the synchronisation key and
 * a participant-number block reserved for their device.
 *
 * The PIN is checked against the same PBKDF2 derivation the phones use. It is
 * never stored here and never travels back.
 *
 * Environment:
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, SYNC_TOKEN
 */
import { createClient, type Client } from '@libsql/client'
import { corsHeaders } from './_shared/http.js'
import { verifyPin } from './_shared/pin.js'

export const config = { runtime: 'nodejs' }

const MAX_FAILURES = 5
const LOCKOUT_MINUTES = 5

let client: Client | null = null
function db(): Client {
  if (client) return client
  const url = process.env.TURSO_DATABASE_URL
  if (!url) throw new Error('TURSO_DATABASE_URL is not configured on the server.')
  client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
  return client
}

/** Reserves a participant-number block for this device, once and for good. */
async function blockFor(deviceId: string, username: string): Promise<number> {
  const now = new Date().toISOString()

  const existing = await db().execute({
    sql: 'SELECT serial_block FROM sync_devices WHERE device_id = ?',
    args: [deviceId],
  })
  if (existing.rows.length > 0) {
    await db().execute({
      sql: 'UPDATE sync_devices SET last_seen = ?, username = ? WHERE device_id = ?',
      args: [now, username, deviceId],
    })
    return Number(existing.rows[0].serial_block)
  }

  // The next unused block. Allocating centrally is what stops two devices
  // issuing the same participant number to different people — the failure
  // that cannot be repaired after the fact.
  const max = await db().execute(
    'SELECT COALESCE(MAX(serial_block), -1) AS highest FROM sync_devices',
  )
  const block = Number(max.rows[0].highest) + 1

  await db().execute({
    sql: `INSERT INTO sync_devices (device_id, serial_block, username, first_seen, last_seen)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(device_id) DO UPDATE SET last_seen = excluded.last_seen`,
    args: [deviceId, block, username, now, now],
  })

  // Re-read: if two devices raced, one of them lost and must use the block
  // that was actually stored rather than the one it calculated.
  const confirmed = await db().execute({
    sql: 'SELECT serial_block FROM sync_devices WHERE device_id = ?',
    args: [deviceId],
  })
  return Number(confirmed.rows[0].serial_block)
}

async function lockState(username: string): Promise<{ locked: boolean; failures: number }> {
  const row = await db().execute({
    sql: 'SELECT failures, locked_until FROM auth_attempts WHERE username = ?',
    args: [username],
  })
  if (row.rows.length === 0) return { locked: false, failures: 0 }
  const lockedUntil = row.rows[0].locked_until ? String(row.rows[0].locked_until) : null
  const locked = Boolean(lockedUntil) && new Date(lockedUntil as string).getTime() > Date.now()
  return { locked, failures: Number(row.rows[0].failures ?? 0) }
}

async function recordFailure(username: string): Promise<number> {
  const { failures } = await lockState(username)
  const next = failures + 1
  const lockedUntil =
    next >= MAX_FAILURES ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null
  await db().execute({
    sql: `INSERT INTO auth_attempts (username, failures, locked_until) VALUES (?, ?, ?)
          ON CONFLICT(username) DO UPDATE SET failures = excluded.failures,
                                              locked_until = excluded.locked_until`,
    args: [username, next, lockedUntil],
  })
  return next
}

async function clearFailures(username: string): Promise<void> {
  await db().execute({
    sql: `INSERT INTO auth_attempts (username, failures, locked_until) VALUES (?, 0, NULL)
          ON CONFLICT(username) DO UPDATE SET failures = 0, locked_until = NULL`,
    args: [username],
  })
}

// ------------------------------------------------------- account requests

/** Pending requests kept at once, so an open endpoint cannot fill the table. */
const MAX_PENDING = 200

/**
 * Someone asking to be given an account.
 *
 * This endpoint is deliberately unauthenticated - a new nurse has no
 * credentials yet, which is the whole point - so it must grant nothing. It
 * writes an application and no more. The account is created later by an
 * administrator on their own device, audited like every other account.
 *
 * It also must not become a way to find out which usernames exist. A request
 * for a name already in use is accepted exactly like any other; the clash is
 * shown to the administrator at the moment of approval, where it can be
 * judged by someone who is allowed to know.
 */
async function submitRequest(body: {
  uuid?: string
  username?: string
  fullName?: string
  roleRequested?: string
  phone?: string
  reason?: string
  pin?: { hash?: string; salt?: string; iterations?: number }
  deviceId?: string
}): Promise<AuthResult> {
  const reply = (b: unknown, status = 200) => ({ status, body: b })

  const username = String(body.username ?? '').trim().slice(0, 60)
  const fullName = String(body.fullName ?? '').trim().slice(0, 120)
  const hash = String(body.pin?.hash ?? '')
  const salt = String(body.pin?.salt ?? '')
  const iterations = Number(body.pin?.iterations ?? 0)

  if (!username || !fullName) {
    return reply({ ok: false, error: 'Enter your full name and the username you would like.' }, 400)
  }
  if (!hash || !salt || !(iterations >= 10_000 && iterations <= 1_000_000)) {
    return reply({ ok: false, error: 'The PIN was not prepared correctly on this device.' }, 400)
  }

  const pending = await db().execute(
    "SELECT COUNT(*) AS n FROM account_requests WHERE status = 'PENDING'",
  )
  if (Number(pending.rows[0].n) >= MAX_PENDING) {
    return reply(
      { ok: false, error: 'There are too many requests waiting. Ask your administrator directly.' },
      429,
    )
  }

  // One outstanding request per username: asking twice replaces the first
  // rather than giving the administrator the same person twice over.
  await db().execute({
    sql: `DELETE FROM account_requests WHERE username = ? COLLATE NOCASE AND status = 'PENDING'`,
    args: [username],
  })

  await db().execute({
    sql: `INSERT INTO account_requests (uuid, username, full_name, role_requested, phone, reason,
                                        pin_hash, pin_salt, pin_iterations, status, requested_at,
                                        device_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    args: [
      String(body.uuid ?? `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`),
      username,
      fullName,
      body.roleRequested ? String(body.roleRequested).slice(0, 40) : null,
      body.phone ? String(body.phone).slice(0, 40) : null,
      body.reason ? String(body.reason).slice(0, 500) : null,
      hash,
      salt,
      iterations,
      new Date().toISOString(),
      body.deviceId ? String(body.deviceId).slice(0, 64) : null,
    ],
  })

  return reply({
    ok: true,
    submitted: true,
    message:
      'Your request has been sent. An administrator has to approve it before you can sign in. Ask them to look under Settings, Users.',
  })
}

/** Lists what is waiting. Administrators only - this carries names and roles. */
async function listRequests(): Promise<AuthResult> {
  const result = await db().execute(
    `SELECT uuid, username, full_name, role_requested, phone, reason, requested_at, device_id
       FROM account_requests
      WHERE status = 'PENDING'
      ORDER BY requested_at`,
  )

  // Which of these names are already taken, so the administrator is not shown
  // a request that would collide with an existing account.
  const existing = await db().execute('SELECT username FROM users WHERE deleted_at IS NULL')
  const taken = new Set(existing.rows.map((r) => String(r.username).toLowerCase()))

  return {
    status: 200,
    body: {
      ok: true,
      requests: result.rows.map((r) => ({
        uuid: String(r.uuid),
        username: String(r.username),
        fullName: String(r.full_name),
        roleRequested: r.role_requested ? String(r.role_requested) : null,
        phone: r.phone ? String(r.phone) : null,
        reason: r.reason ? String(r.reason) : null,
        requestedAt: String(r.requested_at),
        deviceId: r.device_id ? String(r.device_id) : null,
        usernameTaken: taken.has(String(r.username).toLowerCase()),
      })),
    },
  }
}

/**
 * Hands the administrator's device the PIN derivation for a request it is
 * approving, so the new account keeps the PIN the person already chose.
 */
async function claimRequest(uuid: string): Promise<AuthResult> {
  const result = await db().execute({
    sql: `SELECT username, full_name, role_requested, phone, pin_hash, pin_salt, pin_iterations
            FROM account_requests WHERE uuid = ? AND status = 'PENDING'`,
    args: [uuid],
  })
  if (result.rows.length === 0) {
    return { status: 404, body: { ok: false, error: 'That request is no longer waiting.' } }
  }
  const r = result.rows[0]
  return {
    status: 200,
    body: {
      ok: true,
      request: {
        uuid,
        username: String(r.username),
        fullName: String(r.full_name),
        roleRequested: r.role_requested ? String(r.role_requested) : null,
        phone: r.phone ? String(r.phone) : null,
        pin: {
          hash: String(r.pin_hash),
          salt: String(r.pin_salt),
          iterations: Number(r.pin_iterations),
        },
      },
    },
  }
}

/** Records what the administrator decided. */
async function decideRequest(
  uuid: string,
  status: 'APPROVED' | 'REJECTED',
  by: string,
  note: string | null,
): Promise<AuthResult> {
  const result = await db().execute({
    sql: `UPDATE account_requests
             SET status = ?, decided_at = ?, decided_by = ?, decision_note = ?
           WHERE uuid = ? AND status = 'PENDING'`,
    args: [status, new Date().toISOString(), by.slice(0, 120), note, uuid],
  })
  if (result.rowsAffected === 0) {
    return { status: 404, body: { ok: false, error: 'That request is no longer waiting.' } }
  }
  return { status: 200, body: { ok: true, uuid, status } }
}


export interface AuthResult {
  status: number
  body: unknown
}

export async function handleAuth(input: {
  method: string
  body: unknown
  /** x-sync-token, present only on a device an administrator already trusts. */
  token?: string | null
}): Promise<AuthResult> {
  const reply = (body: unknown, status = 200) => ({ status, body })
  if (input.method !== 'POST') return reply({ ok: false, error: 'Use POST.' }, 405)

  const syncToken = process.env.SYNC_TOKEN
  if (!syncToken) {
    return reply({ ok: false, error: 'The server has no SYNC_TOKEN configured.' }, 500)
  }

  const body = input.body as {
    action?: string
    username?: string
    pin?: string
    deviceId?: string
    uuid?: string
    fullName?: string
    roleRequested?: string
    phone?: string
    reason?: string
    note?: string
    decidedBy?: string
    status?: string
    pinRecord?: { hash?: string; salt?: string; iterations?: number }
  }
  if (!body || typeof body !== 'object') {
    return reply({ ok: false, error: 'Malformed request.' }, 400)
  }

  // Lets a device discover whether it is talking to an outreach at all,
  // without revealing anything about who works on it.
  if (body.action === 'probe') {
    try {
      const projects = await db().execute(
        'SELECT COUNT(*) AS n FROM projects WHERE deleted_at IS NULL',
      )
      const accounts = await db().execute(
        'SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND is_active = 1',
      )
      const project = await db().execute(
        'SELECT name FROM projects WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1',
      )
      return reply({
        ok: true,
        ready: Number(projects.rows[0].n) > 0 && Number(accounts.rows[0].n) > 0,
        outreach: project.rows.length > 0 ? String(project.rows[0].name) : null,
      })
    } catch {
      return reply({ ok: false, error: 'The cloud database is not reachable.' }, 503)
    }
  }

  // --- account requests -------------------------------------------------
  //
  // Submitting one needs no credentials: a new nurse has none yet. Reading or
  // deciding one does, because those carry names and grant access.
  if (body.action === 'request') {
    try {
      return await submitRequest({
        uuid: body.uuid,
        username: body.username,
        fullName: body.fullName,
        roleRequested: body.roleRequested,
        phone: body.phone,
        reason: body.reason,
        pin: body.pinRecord,
        deviceId: body.deviceId,
      })
    } catch (err) {
      console.error('[auth:request]', err)
      return reply({ ok: false, error: 'The request could not be sent.' }, 500)
    }
  }

  const ADMIN_ACTIONS = ['requests', 'claimRequest', 'decideRequest']
  if (ADMIN_ACTIONS.includes(body.action ?? '')) {
    if (input.token !== syncToken) {
      return reply({ ok: false, error: 'Only a connected device may do that.' }, 401)
    }
    try {
      if (body.action === 'requests') return await listRequests()
      if (body.action === 'claimRequest') {
        return await claimRequest(String(body.uuid ?? ''))
      }
      const decision = body.status === 'APPROVED' ? 'APPROVED' : 'REJECTED'
      return await decideRequest(
        String(body.uuid ?? ''),
        decision,
        String(body.decidedBy ?? 'an administrator'),
        body.note ? String(body.note).slice(0, 500) : null,
      )
    } catch (err) {
      console.error('[auth:requests]', err)
      return reply({ ok: false, error: 'The cloud could not complete the request.' }, 500)
    }
  }

  const username = String(body.username ?? '').trim()
  const pin = String(body.pin ?? '')
  const deviceId = String(body.deviceId ?? '').trim().slice(0, 64)

  if (!username || !pin) return reply({ ok: false, error: 'Enter your username and PIN.' }, 400)
  if (!deviceId) return reply({ ok: false, error: 'This device did not identify itself.' }, 400)

  try {
    // An outreach with no accounts at all cannot be signed in to by anybody,
    // and answering "that username or PIN is not correct" sends the person
    // looking for a typing mistake that does not exist. There is nothing to
    // conceal here either: with no accounts, saying so reveals nothing about
    // anyone. Tell the truth and say what to do instead.
    const accounts = await db().execute(
      'SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND is_active = 1',
    )
    if (Number(accounts.rows[0].n) === 0) {
      return reply(
        {
          ok: false,
          reason: 'NO_OUTREACH',
          error:
            'No outreach has been set up at this address yet, so there are no accounts to sign in to. Someone has to choose "Set up a new outreach" on one device first, then synchronise.',
        },
        409,
      )
    }

    const { locked } = await lockState(username)
    if (locked) {
      return reply(
        {
          ok: false,
          error: `This account is locked for ${LOCKOUT_MINUTES} minutes after repeated incorrect PIN entries.`,
        },
        429,
      )
    }

    const result = await db().execute({
      sql: `SELECT username, full_name, role_code, pin_hash, pin_salt, pin_iterations,
                   is_active, must_change_pin
              FROM users
             WHERE username = ? COLLATE NOCASE AND deleted_at IS NULL`,
      args: [username],
    })

    const row = result.rows[0]
    // The same answer whether the account is unknown, inactive or the PIN is
    // wrong: anything more tells an attacker which usernames exist.
    const invalid = reply({ ok: false, error: 'That username or PIN is not correct.' }, 401)

    if (!row || Number(row.is_active) !== 1) {
      await recordFailure(username)
      return invalid
    }

    const ok = await verifyPin(pin, {
      hash: String(row.pin_hash),
      salt: String(row.pin_salt),
      iterations: Number(row.pin_iterations),
    })
    if (!ok) {
      const failures = await recordFailure(username)
      const remaining = MAX_FAILURES - failures
      return reply(
        {
          ok: false,
          error:
            remaining > 0
              ? `That username or PIN is not correct. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
              : `That PIN is not correct. This account is now locked for ${LOCKOUT_MINUTES} minutes.`,
        },
        401,
      )
    }

    await clearFailures(username)
    const serialBlock = await blockFor(deviceId, username)

    return reply({
      ok: true,
      syncToken,
      serialBlock,
      user: {
        username: String(row.username),
        fullName: String(row.full_name),
        role: String(row.role_code),
        mustChangePin: Number(row.must_change_pin) === 1,
      },
    })
  } catch (err) {
    console.error('[auth]', err)
    return reply({ ok: false, error: 'The cloud could not complete the request.' }, 500)
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
  const result = await handleAuth({
    method: request.method,
    body: parsed,
    token: request.headers.get('x-sync-token'),
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

  const tokenHeader = request.headers['x-sync-token']
  const token = Array.isArray(tokenHeader) ? (tokenHeader[0] ?? null) : (tokenHeader ?? null)
  const result = await handleAuth({
    method,
    body: method === 'POST' ? await readBody(request) : null,
    token,
  })
  response.statusCode = result.status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(result.body))
}
