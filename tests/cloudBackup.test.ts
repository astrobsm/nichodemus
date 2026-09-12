/**
 * The off-site backup endpoint.
 *
 * Two properties carry the weight here:
 *
 *   - What is stored is ciphertext. If this endpoint ever accepted, or could
 *     produce, a readable database, the whole design of encrypting on the
 *     device would be pointless.
 *   - A half-uploaded backup is never offered for restore. A backup that is
 *     only mostly there is worse than none, because it is trusted right up to
 *     the moment it is needed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error - plain JS build script, no type declarations
import { buildCloudSchema } from '../scripts/cloud-schema.mjs'

const SYNC_TOKEN = 'backup-test-token'
let dir: string
let client: Client
let backup: (request: Request) => Promise<Response>

function post(body: unknown, token: string | null = SYNC_TOKEN): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers['x-sync-token'] = token
  return backup(
    new Request('https://nug.test/api/backup', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T
}

/** Uploads a whole backup and returns its identifier. */
async function upload(
  deviceId: string,
  parts: string[],
  createdAt = '2026-12-29T09:00:00.000Z',
): Promise<string> {
  const uuid = `bk-${deviceId}-${createdAt}`
  await post({
    action: 'begin',
    deviceId,
    uuid,
    filename: 'nug-outreach-backup.nugbak',
    createdAt,
    sizeBytes: parts.join('').length,
    checksum: 'abc123',
    chunkCount: parts.length,
  })
  for (let seq = 0; seq < parts.length; seq++) {
    await post({ action: 'chunk', uuid, seq, data: parts[seq] })
  }
  await post({ action: 'complete', uuid })
  return uuid
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nug-backup-'))
  const url = `file:${join(dir, 'cloud.db').replace(/\\/g, '/')}`

  process.env.TURSO_DATABASE_URL = url
  process.env.TURSO_AUTH_TOKEN = ''
  process.env.SYNC_TOKEN = SYNC_TOKEN

  client = createClient({ url })
  await buildCloudSchema(client)

  backup = (await import('../api/backup')).webHandler
})

afterAll(() => {
  client?.close()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* already gone */
  }
})

describe('who may upload', () => {
  it('refuses a device with no key', async () => {
    const res = await post({ action: 'list' }, null)
    expect(res.status).toBe(401)
  })

  it('refuses a device with the wrong key', async () => {
    const res = await post({ action: 'list' }, 'not-the-key')
    expect(res.status).toBe(401)
  })

  it('refuses anything but POST', async () => {
    const res = await backup(new Request('https://nug.test/api/backup', { method: 'GET' }))
    expect(res.status).toBe(405)
  })

  it('answers the preflight the phone and desktop builds send', async () => {
    const res = await backup(
      new Request('https://nug.test/api/backup', {
        method: 'OPTIONS',
        headers: { origin: 'https://localhost' },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost')
  })
})

describe('uploading a backup', () => {
  it('stores it in parts and offers it back whole', async () => {
    const parts = ['cGFydDA=', 'cGFydDE=', 'cGFydDI=']
    const uuid = await upload('phone-a', parts)

    const listed = await json<{ backups: { uuid: string; chunkCount: number }[] }>(
      await post({ action: 'list' }),
    )
    const mine = listed.backups.find((b) => b.uuid === uuid)
    expect(mine?.chunkCount).toBe(3)

    const rebuilt: string[] = []
    for (let seq = 0; seq < 3; seq++) {
      const part = await json<{ data: string }>(await post({ action: 'fetch', uuid, seq }))
      rebuilt.push(part.data)
    }
    expect(rebuilt).toEqual(parts)
  })

  it('will not complete when a part never arrived', async () => {
    const uuid = 'bk-missing-part'
    await post({
      action: 'begin',
      deviceId: 'phone-b',
      uuid,
      filename: 'x.nugbak',
      sizeBytes: 100,
      chunkCount: 3,
    })
    await post({ action: 'chunk', uuid, seq: 0, data: 'YQ==' })
    await post({ action: 'chunk', uuid, seq: 2, data: 'Yw==' })

    const res = await post({ action: 'complete', uuid })
    expect(res.status).toBe(409)
    expect((await json<{ error: string }>(res)).error).toMatch(/1 of 3|2 of 3/)
  })

  it('never lists an incomplete upload', async () => {
    const listed = await json<{ backups: { uuid: string }[] }>(await post({ action: 'list' }))
    expect(listed.backups.some((b) => b.uuid === 'bk-missing-part')).toBe(false)
  })

  it('lets an interrupted upload be retried from the start', async () => {
    const uuid = 'bk-retry'
    const begin = () =>
      post({
        action: 'begin',
        deviceId: 'phone-c',
        uuid,
        filename: 'x.nugbak',
        sizeBytes: 8,
        chunkCount: 2,
      })
    await begin()
    await post({ action: 'chunk', uuid, seq: 0, data: 'YQ==' })

    // The connection dropped; the device starts again with the same file.
    await begin()
    await post({ action: 'chunk', uuid, seq: 0, data: 'YQ==' })
    await post({ action: 'chunk', uuid, seq: 1, data: 'Yg==' })

    const res = await post({ action: 'complete', uuid })
    expect(res.status).toBe(200)
    expect((await json<{ chunks: number }>(res)).chunks).toBe(2)
  })

  it('refuses an empty backup', async () => {
    const res = await post({
      action: 'begin',
      deviceId: 'phone-d',
      uuid: 'bk-empty',
      filename: 'x.nugbak',
      sizeBytes: 0,
      chunkCount: 0,
    })
    expect(res.status).toBe(400)
  })

  it('refuses a chunk far larger than one the client would send', async () => {
    const res = await post({ action: 'chunk', uuid: 'bk-retry', seq: 9, data: 'x'.repeat(800_000) })
    expect(res.status).toBe(413)
  })
})

describe('not filling the free tier', () => {
  it('keeps only the newest few backups from a device', async () => {
    for (let i = 1; i <= 5; i++) {
      await upload('crowded-phone', ['YQ=='], `2026-12-0${i}T09:00:00.000Z`)
    }

    const listed = await json<{ backups: { uuid: string; deviceId: string; createdAt: string }[] }>(
      await post({ action: 'list' }),
    )
    const mine = listed.backups.filter((b) => b.deviceId === 'crowded-phone')
    expect(mine).toHaveLength(3)
    // The three kept must be the most recent three, not any three.
    expect(mine.map((b) => b.createdAt)).toEqual([
      '2026-12-05T09:00:00.000Z',
      '2026-12-04T09:00:00.000Z',
      '2026-12-03T09:00:00.000Z',
    ])
  })

  it('removes the parts of a pruned backup, not just its row', async () => {
    const orphans = await client.execute(
      `SELECT COUNT(*) AS n FROM cloud_backup_chunks
        WHERE backup_uuid NOT IN (SELECT uuid FROM cloud_backups)`,
    )
    expect(Number(orphans.rows[0].n)).toBe(0)
  })

  it('does not touch another device’s backups', async () => {
    const listed = await json<{ backups: { deviceId: string }[] }>(await post({ action: 'list' }))
    expect(listed.backups.some((b) => b.deviceId === 'phone-a')).toBe(true)
  })
})

describe('deleting', () => {
  it('removes the backup and every part of it', async () => {
    const uuid = await upload('doomed-phone', ['YQ==', 'Yg=='])
    await post({ action: 'delete', uuid })

    const listed = await json<{ backups: { uuid: string }[] }>(await post({ action: 'list' }))
    expect(listed.backups.some((b) => b.uuid === uuid)).toBe(false)

    const chunks = await client.execute({
      sql: 'SELECT COUNT(*) AS n FROM cloud_backup_chunks WHERE backup_uuid = ?',
      args: [uuid],
    })
    expect(Number(chunks.rows[0].n)).toBe(0)
  })

  it('reports a part of a backup that no longer exists rather than inventing one', async () => {
    const res = await post({ action: 'fetch', uuid: 'bk-never-existed', seq: 0 })
    expect(res.status).toBe(404)
  })
})

describe('what the server can see', () => {
  it('stores only what the device sent, and the device sends ciphertext', async () => {
    // The bytes here stand in for an AES-GCM sealed file: the endpoint has no
    // decryption path at all, so there is nothing it could do with them.
    const uuid = await upload('privacy-phone', ['3q2+7w=='])
    const row = await client.execute({
      sql: 'SELECT data FROM cloud_backup_chunks WHERE backup_uuid = ? AND seq = 0',
      args: [uuid],
    })
    expect(String(row.rows[0].data)).toBe('3q2+7w==')

    // It has no way to open one either: no crypto is imported here at all,
    // so "the server cannot read the backups" is a fact about the code and
    // not a promise in a document.
    const source = (await import('node:fs')).readFileSync('api/backup.ts', 'utf8')
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n')
    expect(code).not.toMatch(/require\(['"]crypto|from ['"]node:crypto|webcrypto|subtle\./)
    expect(code).not.toMatch(/decrypt\w*\(/)
  })

  it('records no participant data alongside the file', async () => {
    const info = await client.execute('PRAGMA table_info(cloud_backups)')
    const columns = info.rows.map((r) => String(r.name))
    for (const forbidden of ['first_name', 'last_name', 'phone', 'participant_code']) {
      expect(columns).not.toContain(forbidden)
    }
  })
})
