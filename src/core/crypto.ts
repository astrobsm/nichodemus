/**
 * Local cryptography: PIN verification and encrypted backups.
 *
 * PINs are never stored. A PBKDF2-SHA256 derivation with a per-user random
 * salt is stored instead. Backups are sealed with AES-GCM under a key
 * derived from a passphrase the administrator supplies at backup time.
 * All of this runs on-device through WebCrypto - nothing is transmitted.
 */

const subtle = () => {
  const c = globalThis.crypto?.subtle
  if (!c) throw new Error('This device does not provide the WebCrypto API.')
  return c
}

export const PIN_ITERATIONS = 150_000
export const BACKUP_ITERATIONS = 250_000

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(text: string): Uint8Array {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function randomBytes(length: number): Uint8Array {
  const b = new Uint8Array(length)
  globalThis.crypto.getRandomValues(b)
  return b
}

async function pbkdf2(
  secret: string,
  salt: Uint8Array,
  iterations: number,
  bits: number,
): Promise<Uint8Array> {
  const key = await subtle().importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const derived = await subtle().deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    bits,
  )
  return new Uint8Array(derived)
}

// ------------------------------------------------------------------- PINs

export interface PinRecord {
  hash: string
  salt: string
  iterations: number
}

export async function hashPin(pin: string, iterations = PIN_ITERATIONS): Promise<PinRecord> {
  const salt = randomBytes(16)
  const hash = await pbkdf2(pin, salt, iterations, 256)
  return { hash: toB64(hash), salt: toB64(salt), iterations }
}

export async function verifyPin(pin: string, record: PinRecord): Promise<boolean> {
  const salt = fromB64(record.salt)
  const candidate = await pbkdf2(pin, salt, record.iterations, 256)
  const expected = fromB64(record.hash)
  if (candidate.length !== expected.length) return false
  // Constant-time comparison.
  let diff = 0
  for (let i = 0; i < candidate.length; i++) diff |= candidate[i] ^ expected[i]
  return diff === 0
}

// ---------------------------------------------------------------- backups

const BACKUP_MAGIC = 'NUGBAK1\0' // 8 bytes

/**
 * Backup container layout (all binary, written to a single file):
 *   [0..7]    magic "NUGBAK1\0"
 *   [8..23]   PBKDF2 salt (16 bytes)
 *   [24..35]  AES-GCM iv (12 bytes)
 *   [36..39]  iteration count, uint32 big-endian
 *   [40..]    AES-GCM ciphertext of the SQLite image
 */
export async function encryptBackup(
  plaintext: Uint8Array,
  passphrase: string,
): Promise<Uint8Array> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const keyBytes = await pbkdf2(passphrase, salt, BACKUP_ITERATIONS, 256)
  const key = await subtle().importKey('raw', keyBytes as BufferSource, 'AES-GCM', false, [
    'encrypt',
  ])
  const cipher = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      plaintext.slice() as BufferSource,
    ),
  )

  const header = new Uint8Array(40)
  for (let i = 0; i < 8; i++) header[i] = BACKUP_MAGIC.charCodeAt(i)
  header.set(salt, 8)
  header.set(iv, 24)
  new DataView(header.buffer).setUint32(36, BACKUP_ITERATIONS, false)

  const out = new Uint8Array(header.length + cipher.length)
  out.set(header, 0)
  out.set(cipher, header.length)
  return out
}

export class BackupPassphraseError extends Error {
  constructor() {
    super('The backup could not be opened. Check the backup password and try again.')
    this.name = 'BackupPassphraseError'
  }
}

export class BackupFormatError extends Error {
  constructor() {
    super('This file is not a Nichodemus Ugbor outreach backup.')
    this.name = 'BackupFormatError'
  }
}

export function isEncryptedBackup(bytes: Uint8Array): boolean {
  if (bytes.length < 40) return false
  for (let i = 0; i < 8; i++) if (bytes[i] !== BACKUP_MAGIC.charCodeAt(i)) return false
  return true
}

export async function decryptBackup(
  container: Uint8Array,
  passphrase: string,
): Promise<Uint8Array> {
  if (!isEncryptedBackup(container)) throw new BackupFormatError()
  const salt = container.slice(8, 24)
  const iv = container.slice(24, 36)
  const iterations = new DataView(
    container.buffer,
    container.byteOffset + 36,
    4,
  ).getUint32(0, false)
  const cipher = container.slice(40)

  const keyBytes = await pbkdf2(passphrase, salt, iterations, 256)
  const key = await subtle().importKey('raw', keyBytes as BufferSource, 'AES-GCM', false, [
    'decrypt',
  ])
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    )
    return new Uint8Array(plain)
  } catch {
    throw new BackupPassphraseError()
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await subtle().digest('SHA-256', bytes.slice() as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A SQLite file always begins with "SQLite format 3\0". */
export function looksLikeSqlite(bytes: Uint8Array): boolean {
  const magic = 'SQLite format 3\0'
  if (bytes.length < magic.length) return false
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic.charCodeAt(i)) return false
  return true
}
