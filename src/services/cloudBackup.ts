/**
 * Keeping a copy of the encrypted backup somewhere other than the device.
 *
 * The backup file is sealed on this device, with a passphrase that is never
 * transmitted. What travels is ciphertext, so the cloud copy is exactly as
 * safe as the passphrase — and no safer, which is why the passphrase prompt
 * says what it says. A backup nobody can decrypt is not a backup, so the
 * passphrase has to be written down somewhere other than the phone.
 *
 * Uploads go up in chunks. A field connection drops constantly; an upload
 * that has to complete in one request would never finish, and a partial
 * upload must never be offered for restore.
 */
import { syncConfig } from './sync'
import { deviceId } from '../core/ids'
import { uuid } from '../core/ids'

/** Raw bytes per chunk, before base64 expands them by a third. */
export const CHUNK_BYTES = 256 * 1024

export class CloudBackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudBackupError'
  }
}

export interface CloudBackupEntry {
  uuid: string
  deviceId: string
  filename: string
  createdAt: string
  sizeBytes: number
  checksum: string | null
  chunkCount: number
  createdBy: string | null
  recordCounts: string | null
}

async function call<T>(body: object, timeoutMs = 60_000): Promise<T> {
  const { endpoint, token } = syncConfig()
  if (!endpoint || !token) {
    throw new CloudBackupError(
      'This device is not connected to the cloud. Set the web address and sign in under Cloud sync first.',
    )
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(`${endpoint}/api/backup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-token': token },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new CloudBackupError('The cloud did not answer in time. Try again on a better signal.')
    }
    throw new CloudBackupError(
      'The cloud could not be reached. The backup on this device is unaffected.',
    )
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 401) throw new CloudBackupError('The cloud rejected this device’s key.')
  const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null
  if (!json) throw new CloudBackupError('The cloud gave an answer we could not read.')
  if (!json.ok) throw new CloudBackupError(json.error ?? 'The cloud refused the request.')
  return json as T
}

/** base64 of a byte range, built in slices so a large file cannot blow the stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 8192
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(binary)
}

function fromBase64(data: string): Uint8Array {
  const binary = atob(data)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export interface UploadProgress {
  sent: number
  total: number
}

export interface UploadResult {
  uuid: string
  chunks: number
  pruned: number
}

/**
 * Sends an already-encrypted backup to the cloud.
 *
 * The file is only marked complete once every part has arrived, so an upload
 * interrupted halfway leaves nothing that could be mistaken for a usable
 * backup.
 */
export async function uploadBackup(
  sealed: Uint8Array,
  meta: {
    filename: string
    checksum?: string
    createdAt?: string
    createdBy?: string
    recordCounts?: unknown
  },
  onProgress?: (p: UploadProgress) => void,
): Promise<UploadResult> {
  const id = uuid()
  const total = Math.ceil(sealed.byteLength / CHUNK_BYTES)

  await call({
    action: 'begin',
    deviceId: deviceId(),
    uuid: id,
    filename: meta.filename,
    createdAt: meta.createdAt ?? new Date().toISOString(),
    sizeBytes: sealed.byteLength,
    checksum: meta.checksum ?? null,
    chunkCount: total,
    createdBy: meta.createdBy ?? null,
    recordCounts: meta.recordCounts ? JSON.stringify(meta.recordCounts) : null,
  })

  for (let seq = 0; seq < total; seq++) {
    const slice = sealed.subarray(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES)
    await call({ action: 'chunk', uuid: id, seq, data: toBase64(slice) })
    onProgress?.({ sent: seq + 1, total })
  }

  const done = await call<{ chunks: number; pruned: number }>({ action: 'complete', uuid: id })
  return { uuid: id, chunks: done.chunks, pruned: done.pruned }
}

export async function listCloudBackups(): Promise<CloudBackupEntry[]> {
  const result = await call<{ backups: CloudBackupEntry[] }>({ action: 'list' }, 30_000)
  return result.backups
}

export async function downloadCloudBackup(
  entry: CloudBackupEntry,
  onProgress?: (p: UploadProgress) => void,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  for (let seq = 0; seq < entry.chunkCount; seq++) {
    const part = await call<{ data: string }>({ action: 'fetch', uuid: entry.uuid, seq })
    parts.push(fromBase64(part.data))
    onProgress?.({ sent: seq + 1, total: entry.chunkCount })
  }

  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }

  if (out.byteLength !== entry.sizeBytes) {
    throw new CloudBackupError(
      `The downloaded backup is ${out.byteLength} bytes but should be ${entry.sizeBytes}. It has not been used.`,
    )
  }
  return out
}

export async function deleteCloudBackup(uuid: string): Promise<void> {
  await call({ action: 'delete', uuid }, 30_000)
}
