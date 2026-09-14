/**
 * Asking for an account, and an administrator deciding.
 *
 * The property that matters is not that requests are stored. It is that
 * storing one grants nothing: the endpoint that accepts them is open to
 * anybody who can reach the web address, and the records behind the sign-in
 * screen are people's medical records. A request has to be inert until a
 * person approves it, and reading or deciding requests has to need the
 * device key that only a trusted device holds.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashPin } from '../src/core/crypto'
// @ts-expect-error - plain JS build script, no type declarations
import { buildCloudSchema } from '../scripts/cloud-schema.mjs'

const SYNC_TOKEN = 'requests-test-token'
let dir: string
let client: Client
let auth: (request: Request) => Promise<Response>

function post(body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers['x-sync-token'] = token
  return auth(
    new Request('https://nug.test/api/auth', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

async function ask(username: string, fullName: string, pin = '4821', extra = {}) {
  const pinRecord = await hashPin(pin)
  return post({
    action: 'request',
    uuid: `req-${username}-${Math.random().toString(36).slice(2, 8)}`,
    username,
    fullName,
    pinRecord,
    deviceId: `device-${username}`,
    ...extra,
  })
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nug-requests-'))
  const url = `file:${join(dir, 'cloud.db').replace(/\\/g, '/')}`

  process.env.TURSO_DATABASE_URL = url
  process.env.TURSO_AUTH_TOKEN = ''
  process.env.SYNC_TOKEN = SYNC_TOKEN

  client = createClient({ url })
  await buildCloudSchema(client)

  const now = '2026-12-29T09:00:00.000+01:00'
  await client.execute({
    sql: `INSERT INTO projects (uuid, code, name, status, participant_prefix, currency,
                                is_active, is_demo, created_at, updated_at, version)
          VALUES ('proj-1', 'PRJ-LIVE', 'Test Outreach', 'PLANNING', 'NUG', 'NGN', 1, 0, ?, ?, 1)`,
    args: [now, now],
  })
  const derived = await hashPin('4821')
  await client.execute({
    sql: `INSERT INTO users (uuid, username, full_name, role_code, pin_hash, pin_salt,
                             pin_iterations, is_active, must_change_pin, failed_attempts,
                             created_at, updated_at, version)
          VALUES ('u-ada', 'ada', 'Ada Admin', 'ADMINISTRATOR', ?, ?, ?, 1, 0, 0, ?, ?, 1)`,
    args: [derived.hash, derived.salt, derived.iterations, now, now],
  })

  auth = (await import('../api/auth')).webHandler
})

afterAll(() => {
  client?.close()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* already gone */
  }
})

describe('asking for an account', () => {
  it('needs no credentials, because a new nurse has none', async () => {
    const res = await ask('ngozi', 'Nurse Ngozi')
    expect(res.status).toBe(200)
    expect((await res.json()).submitted).toBe(true)
  })

  it('creates no account and no way in', async () => {
    await ask('chancer', 'Someone Uninvited')

    // The thing that must not have happened: an account.
    const users = await client.execute({
      sql: 'SELECT COUNT(*) AS n FROM users WHERE username = ?',
      args: ['chancer'],
    })
    expect(Number(users.rows[0].n)).toBe(0)

    // And signing in as them must fail exactly as before.
    const res = await post({ username: 'chancer', pin: '4821', deviceId: 'device-chancer' })
    expect(res.status).toBe(401)
  })

  it('never carries the PIN itself, only its derivation', async () => {
    await ask('careful', 'Careful Person', '9182')
    const row = await client.execute({
      sql: 'SELECT pin_hash, pin_salt, pin_iterations FROM account_requests WHERE username = ?',
      args: ['careful'],
    })
    const stored = JSON.stringify(row.rows[0])
    expect(stored).not.toContain('9182')
    expect(Number(row.rows[0].pin_iterations)).toBeGreaterThanOrEqual(10_000)
  })

  it('refuses a request whose PIN was not prepared properly', async () => {
    const res = await post({
      action: 'request',
      username: 'sloppy',
      fullName: 'Sloppy Client',
      pinRecord: { hash: 'x', salt: 'y', iterations: 3 },
    })
    expect(res.status).toBe(400)
  })

  it('refuses a PIN derivation that is not one', async () => {
    // The endpoint accepts writes from anyone who can reach the address, so an
    // unbounded string here is a way to fill a clinical system's database from
    // the outside. A real derivation is 44 characters and its salt 24.
    const huge = 'A'.repeat(200_000)
    const res = await post({
      action: 'request',
      username: 'floods',
      fullName: 'Flooding Attempt',
      pinRecord: { hash: huge, salt: huge, iterations: 150000 },
    })
    expect(res.status).toBe(400)

    const stored = await client.execute({
      sql: 'SELECT COUNT(*) AS n FROM account_requests WHERE username = ?',
      args: ['floods'],
    })
    expect(Number(stored.rows[0].n)).toBe(0)
  })

  it('refuses a derivation containing something other than base64', async () => {
    const res = await post({
      action: 'request',
      username: 'sneaky',
      fullName: 'Sneaky Person',
      pinRecord: { hash: "'; DROP TABLE users; --aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", salt: 'abcdefghijklmnop', iterations: 150000 },
    })
    expect(res.status).toBe(400)
  })

  it('bounds the identifier the caller chooses', async () => {
    const pinRecord = await hashPin('4821')
    await post({
      action: 'request',
      uuid: 'x'.repeat(5000),
      username: 'longid',
      fullName: 'Long Identifier',
      pinRecord,
    })
    const row = await client.execute({
      sql: 'SELECT uuid FROM account_requests WHERE username = ?',
      args: ['longid'],
    })
    expect(String(row.rows[0]?.uuid ?? '').length).toBeLessThanOrEqual(64)
  })

  it('needs a name and a username', async () => {
    const pinRecord = await hashPin('4821')
    const res = await post({ action: 'request', username: '', fullName: '', pinRecord })
    expect(res.status).toBe(400)
  })

  it('does not reveal whether a username already exists', async () => {
    // Otherwise the open endpoint becomes a way to enumerate the team.
    const taken = await ask('ada', 'Impostor Pretending To Be Ada')
    const free = await ask('nobody.at.all', 'Somebody Else')
    expect(taken.status).toBe(free.status)
    expect(await taken.json()).toEqual(await free.json())
  })

  it('replaces an earlier request from the same person rather than stacking them', async () => {
    await ask('twice', 'Asked Twice')
    await ask('twice', 'Asked Twice')
    const rows = await client.execute({
      sql: "SELECT COUNT(*) AS n FROM account_requests WHERE username = ? AND status = 'PENDING'",
      args: ['twice'],
    })
    expect(Number(rows.rows[0].n)).toBe(1)
  })
})

describe('who may look at requests', () => {
  it('refuses a device with no key', async () => {
    const res = await post({ action: 'requests' })
    expect(res.status).toBe(401)
  })

  it('refuses a device with the wrong key', async () => {
    const res = await post({ action: 'requests' }, 'not-the-key')
    expect(res.status).toBe(401)
  })

  it('refuses to hand over a PIN derivation without the key', async () => {
    // Otherwise anyone could collect the derivations of everyone who applied.
    const res = await post({ action: 'claimRequest', uuid: 'anything' })
    expect(res.status).toBe(401)
  })

  it('refuses to decide a request without the key', async () => {
    const res = await post({ action: 'decideRequest', uuid: 'anything', status: 'APPROVED' })
    expect(res.status).toBe(401)
  })

  it('lists what is waiting for a device that has the key', async () => {
    const body = await (await post({ action: 'requests' }, SYNC_TOKEN)).json()
    expect(body.ok).toBe(true)
    expect(body.requests.some((r: { username: string }) => r.username === 'ngozi')).toBe(true)
  })

  it('flags a request that would collide with an existing account', async () => {
    const body = await (await post({ action: 'requests' }, SYNC_TOKEN)).json()
    const impostor = body.requests.find((r: { username: string }) => r.username === 'ada')
    expect(impostor.usernameTaken).toBe(true)
  })

  it('does not put PIN derivations in the list', async () => {
    // The list is for deciding, not for collecting credentials.
    const text = JSON.stringify(await (await post({ action: 'requests' }, SYNC_TOKEN)).json())
    expect(text).not.toMatch(/pin_hash|pin_salt|"hash"/i)
  })
})

describe('deciding', () => {
  it('hands the derivation over only for a request still waiting', async () => {
    const listed = await (await post({ action: 'requests' }, SYNC_TOKEN)).json()
    const target = listed.requests.find((r: { username: string }) => r.username === 'ngozi')

    const claimed = await (
      await post({ action: 'claimRequest', uuid: target.uuid }, SYNC_TOKEN)
    ).json()
    expect(claimed.request.username).toBe('ngozi')
    expect(claimed.request.pin.iterations).toBeGreaterThanOrEqual(10_000)

    await post(
      { action: 'decideRequest', uuid: target.uuid, status: 'APPROVED', decidedBy: 'Ada Admin' },
      SYNC_TOKEN,
    )

    // Once decided it is gone from the queue and can no longer be claimed.
    const again = await post({ action: 'claimRequest', uuid: target.uuid }, SYNC_TOKEN)
    expect(again.status).toBe(404)
  })

  it('records who decided and when', async () => {
    const row = await client.execute({
      sql: 'SELECT status, decided_by, decided_at FROM account_requests WHERE username = ?',
      args: ['ngozi'],
    })
    expect(String(row.rows[0].status)).toBe('APPROVED')
    expect(String(row.rows[0].decided_by)).toBe('Ada Admin')
    expect(String(row.rows[0].decided_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('approving in the cloud still does not create the account there', async () => {
    // The account is created on the administrator's device, audited, and
    // arrives here by ordinary synchronisation. The cloud never mints one.
    const users = await client.execute({
      sql: 'SELECT COUNT(*) AS n FROM users WHERE username = ?',
      args: ['ngozi'],
    })
    expect(Number(users.rows[0].n)).toBe(0)
  })

  it('declining leaves no account and closes the request', async () => {
    const listed = await (await post({ action: 'requests' }, SYNC_TOKEN)).json()
    const target = listed.requests.find((r: { username: string }) => r.username === 'chancer')
    await post(
      {
        action: 'decideRequest',
        uuid: target.uuid,
        status: 'REJECTED',
        decidedBy: 'Ada Admin',
        note: 'Nobody knows this person',
      },
      SYNC_TOKEN,
    )

    const row = await client.execute({
      sql: 'SELECT status, decision_note FROM account_requests WHERE username = ?',
      args: ['chancer'],
    })
    expect(String(row.rows[0].status)).toBe('REJECTED')
    expect(String(row.rows[0].decision_note)).toMatch(/Nobody knows/)

    const users = await client.execute({
      sql: 'SELECT COUNT(*) AS n FROM users WHERE username = ?',
      args: ['chancer'],
    })
    expect(Number(users.rows[0].n)).toBe(0)
  })

  it('cannot decide the same request twice', async () => {
    const row = await client.execute({
      sql: 'SELECT uuid FROM account_requests WHERE username = ?',
      args: ['chancer'],
    })
    const res = await post(
      { action: 'decideRequest', uuid: String(row.rows[0].uuid), status: 'APPROVED' },
      SYNC_TOKEN,
    )
    expect(res.status).toBe(404)
  })
})
