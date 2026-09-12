/**
 * Cloud sign-in and CORS.
 *
 * Both matter more than they look:
 *
 *   - Sign-in is what lets a nurse open the application on a device it has
 *     never run on and simply work, instead of being walked through setting
 *     up an outreach that already exists.
 *   - CORS is what lets the Android and desktop builds talk to the API at
 *     all. They run from https://localhost and app://local, so every call is
 *     cross-origin with a custom header, and the browser refuses it before it
 *     reaches the server unless the preflight is answered.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashPin } from '../src/core/crypto'
// @ts-expect-error - plain JS build script, no type declarations
import { buildCloudSchema } from '../scripts/cloud-schema.mjs'

const SYNC_TOKEN = 'auth-test-sync-token'
const PIN = '4821'
let dir: string
let client: Client
let auth: (request: Request) => Promise<Response>
let sync: (request: Request) => Promise<Response>

function post(
  handler: (r: Request) => Promise<Response>,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return handler(
    new Request('https://nug.test/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

async function seedUser(username: string, role: string, pin = PIN, active = 1) {
  const derived = await hashPin(pin)
  const now = '2026-12-29T09:00:00.000+01:00'
  await client.execute({
    sql: `INSERT INTO users (uuid, username, full_name, role_code, pin_hash, pin_salt,
                             pin_iterations, is_active, must_change_pin, failed_attempts,
                             created_at, updated_at, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 1)`,
    args: [
      `user-${username}`,
      username,
      `${username} Test`,
      role,
      derived.hash,
      derived.salt,
      derived.iterations,
      active,
      now,
      now,
    ],
  })
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nug-auth-'))
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

  await seedUser('ada', 'ADMINISTRATOR')
  await seedUser('nurse.b', 'NURSE')
  await seedUser('pharm.c', 'PHARMACY')
  await seedUser('gone.d', 'DOCTOR', PIN, 0)

  auth = (await import('../api/auth')).webHandler
  sync = (await import('../api/sync')).webHandler
})

afterAll(() => {
  client?.close()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* already gone */
  }
})

describe('discovering an outreach', () => {
  it('reports that one is ready without revealing who works on it', async () => {
    const body = await (await post(auth, { action: 'probe' })).json()
    expect(body.ok).toBe(true)
    expect(body.ready).toBe(true)
    expect(body.outreach).toBe('Test Outreach')
    expect(JSON.stringify(body)).not.toMatch(/ada|nurse|pin|hash/i)
  })
})

describe('signing in', () => {
  it('accepts a correct username and PIN and returns what the device needs', async () => {
    const body = await (
      await post(auth, { username: 'ada', pin: PIN, deviceId: 'device-a' })
    ).json()
    expect(body.ok).toBe(true)
    expect(body.syncToken).toBe(SYNC_TOKEN)
    expect(typeof body.serialBlock).toBe('number')
    expect(body.user.role).toBe('ADMINISTRATOR')
    expect(body.user.fullName).toBe('ada Test')
  })

  it('never sends the PIN or its derivation back', async () => {
    const body = await (
      await post(auth, { username: 'ada', pin: PIN, deviceId: 'device-a' })
    ).json()
    const text = JSON.stringify(body)
    expect(text).not.toContain(PIN)
    expect(text).not.toMatch(/pin_hash|pin_salt|iterations/i)
  })

  it('signs in each role the outreach uses', async () => {
    for (const [username, role] of [
      ['nurse.b', 'NURSE'],
      ['pharm.c', 'PHARMACY'],
    ]) {
      const body = await (
        await post(auth, { username, pin: PIN, deviceId: `device-${username}` })
      ).json()
      expect(body.ok, `${username} could not sign in`).toBe(true)
      expect(body.user.role).toBe(role)
    }
  })

  it('refuses a wrong PIN', async () => {
    const res = await post(auth, { username: 'nurse.b', pin: '0000', deviceId: 'device-x' })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/not correct/i)
  })

  it('gives the same answer for an unknown username as for a wrong PIN', async () => {
    const unknown = await (
      await post(auth, { username: 'nobody', pin: PIN, deviceId: 'device-x' })
    ).json()
    expect(unknown.error).toMatch(/username or PIN is not correct/i)
  })

  it('refuses a deactivated account', async () => {
    const res = await post(auth, { username: 'gone.d', pin: PIN, deviceId: 'device-x' })
    expect(res.status).toBe(401)
  })

  it('locks an account after repeated wrong PINs', async () => {
    for (let i = 0; i < 5; i++) {
      await post(auth, { username: 'pharm.c', pin: 'wrong', deviceId: 'device-lock' })
    }
    const res = await post(auth, { username: 'pharm.c', pin: PIN, deviceId: 'device-lock' })
    expect(res.status).toBe(429)
    expect((await res.json()).error).toMatch(/locked/i)
  })

  it('needs a device identity', async () => {
    const res = await post(auth, { username: 'ada', pin: PIN })
    expect(res.status).toBe(400)
  })
})

describe('participant number blocks', () => {
  it('gives each device its own block, allocated centrally', async () => {
    const a = await (await post(auth, { username: 'ada', pin: PIN, deviceId: 'phone-1' })).json()
    const b = await (await post(auth, { username: 'ada', pin: PIN, deviceId: 'phone-2' })).json()
    const c = await (await post(auth, { username: 'ada', pin: PIN, deviceId: 'phone-3' })).json()

    const blocks = [a.serialBlock, b.serialBlock, c.serialBlock]
    expect(new Set(blocks).size, `blocks collided: ${blocks.join(', ')}`).toBe(3)
  })

  it('gives the same device the same block every time', async () => {
    const first = await (
      await post(auth, { username: 'ada', pin: PIN, deviceId: 'steady-phone' })
    ).json()
    const second = await (
      await post(auth, { username: 'nurse.b', pin: PIN, deviceId: 'steady-phone' })
    ).json()
    // Changing who signs in must not renumber a device that already has
    // participants registered against its block.
    expect(second.serialBlock).toBe(first.serialBlock)
  })
})

describe('cross-origin access', () => {
  const APP_ORIGINS = ['https://localhost', 'app://local', 'capacitor://localhost']

  it('answers the preflight the phone and desktop builds send', async () => {
    for (const origin of APP_ORIGINS) {
      const res = await sync(
        new Request('https://nug.test/api/sync', {
          method: 'OPTIONS',
          headers: {
            origin,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'x-sync-token',
          },
        }),
      )
      expect(res.status, `${origin} preflight`).toBe(204)
      expect(res.headers.get('access-control-allow-origin'), origin).toBe(origin)
      expect(res.headers.get('access-control-allow-headers')).toMatch(/x-sync-token/i)
      expect(res.headers.get('access-control-allow-methods')).toMatch(/POST/i)
    }
  })

  it('allows the real call from those origins too', async () => {
    for (const origin of APP_ORIGINS) {
      const res = await sync(
        new Request('https://nug.test/api/sync', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-sync-token': SYNC_TOKEN,
            origin,
          },
          body: JSON.stringify({ action: 'ping', deviceId: 'cors-probe' }),
        }),
      )
      expect(res.headers.get('access-control-allow-origin'), origin).toBe(origin)
      expect((await res.json()).ok).toBe(true)
    }
  })

  it('covers the sign-in endpoint as well', async () => {
    const res = await auth(
      new Request('https://nug.test/api/auth', {
        method: 'OPTIONS',
        headers: { origin: 'app://local' },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('app://local')
  })

  it('gives no origin header to a site that is not part of the application', async () => {
    const res = await sync(
      new Request('https://nug.test/api/sync', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sync-token': SYNC_TOKEN,
          origin: 'https://not-our-app.example.com',
        },
        body: JSON.stringify({ action: 'ping', deviceId: 'stranger' }),
      }),
    )
    // No header means the browser blocks the response, which is the point.
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('allows a deployment of this application on vercel', async () => {
    const res = await sync(
      new Request('https://nug.test/api/sync', {
        method: 'OPTIONS',
        headers: { origin: 'https://nichodemus.vercel.app' },
      }),
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('https://nichodemus.vercel.app')
  })
})

describe('the device that set the outreach up', () => {
  /**
   * It chose its number block offline, before any cloud existed, and never
   * signs in through /api/auth. If the cloud does not learn about that block
   * it will hand the same one to the first member of staff who joins, and two
   * devices will issue the same participant number to two different people.
   */
  async function syncAs(deviceId: string, serialBlock: number) {
    const res = await sync(
      new Request('https://nug.test/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sync-token': SYNC_TOKEN },
        body: JSON.stringify({ action: 'ping', deviceId, serialBlock }),
      }),
    )
    return res.json() as Promise<{ ok: boolean; blockConflict?: boolean }>
  }

  it('reserves its block by synchronising, so no one else is given it', async () => {
    await syncAs('founder-phone', 900)

    const joiner = await (
      await post(auth, { username: 'ada', pin: PIN, deviceId: 'joiner-phone' })
    ).json()
    expect(joiner.serialBlock).not.toBe(900)
    expect(joiner.serialBlock).toBeGreaterThan(900)
  })

  it('keeps the same block when that device later signs in', async () => {
    await syncAs('settled-phone', 950)
    const signedIn = await (
      await post(auth, { username: 'ada', pin: PIN, deviceId: 'settled-phone' })
    ).json()
    expect(signedIn.serialBlock).toBe(950)
  })

  it('says so when a second device claims a block that is already taken', async () => {
    const first = await syncAs('twin-a', 980)
    expect(first.blockConflict).toBe(false)

    const second = await syncAs('twin-b', 980)
    expect(second.blockConflict).toBe(true)
  })

  it('synchronises normally when no block is declared', async () => {
    const res = await sync(
      new Request('https://nug.test/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sync-token': SYNC_TOKEN },
        body: JSON.stringify({ action: 'ping', deviceId: 'quiet-phone' }),
      }),
    )
    expect((await res.json()).ok).toBe(true)
  })
})
