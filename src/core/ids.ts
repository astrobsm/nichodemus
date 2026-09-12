/** Identifier helpers. All generation is local; nothing is fetched. */

export function uuid(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  const bytes = new Uint8Array(16)
  c.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const DEVICE_KEY = 'nug.device.id'

/**
 * A stable per-device identifier stamped onto every record so a future
 * multi-device merge can tell where a row was written (spec S91).
 */
export function deviceId(): string {
  if (typeof localStorage === 'undefined') return 'node-test-device'
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = `dev-${uuid().slice(0, 8)}`
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

/** NUG-0001 style participant code. */
export function participantCode(prefix: string, serial: number): string {
  return `${prefix}-${String(serial).padStart(4, '0')}`
}

export function referralCode(prefix: string, serial: number): string {
  return `${prefix}-REF-${String(serial).padStart(4, '0')}`
}

export function woundCode(prefix: string, serial: number): string {
  return `${prefix}-WND-${String(serial).padStart(4, '0')}`
}

export function staffCode(prefix: string, serial: number): string {
  return `${prefix}-STF-${String(serial).padStart(3, '0')}`
}

export function procurementCode(prefix: string, serial: number): string {
  return `${prefix}-PRC-${String(serial).padStart(3, '0')}`
}

export function taskCode(prefix: string, serial: number): string {
  return `${prefix}-TSK-${String(serial).padStart(3, '0')}`
}

/**
 * Normalised search key: lowercase alphanumerics of the full name plus the
 * digits of the phone number. Used for fast offline duplicate detection.
 */
export function buildSearchKey(parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Last 10 digits of a phone number, for comparison across formats. */
export function normalisePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}
