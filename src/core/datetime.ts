/**
 * Date/time helpers. Everything uses the device's local clock (spec S59);
 * no network time source is consulted.
 */

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** ISO-8601 local timestamp with offset, e.g. 2026-12-29T09:41:07+01:00 */
export function nowIso(): string {
  return toIso(new Date())
}

export function toIso(d: Date): string {
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  // Milliseconds are included so that two edits within the same second still
  // order correctly - which is what decides the winner when two devices have
  // changed the same record.
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${String(d.getMilliseconds()).padStart(3, '0')}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

/** YYYY-MM-DD for today on this device. */
export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function dateOf(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

export function timeOf(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.slice(11, 16)
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** 29 December 2026 */
export function formatLongDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** 29 Dec 2026 */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return `${formatShortDate(iso)}, ${timeOf(iso)}`
}

/** Age in completed years from a YYYY-MM-DD date of birth. */
export function ageFromDob(dob: string, at: Date = new Date()): number | null {
  const [y, m, d] = dob.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  let age = at.getFullYear() - y
  const beforeBirthday =
    at.getMonth() + 1 < m || (at.getMonth() + 1 === m && at.getDate() < d)
  if (beforeBirthday) age -= 1
  return age >= 0 && age <= 130 ? age : null
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T00:00:00`).getTime()
  const b = new Date(`${toIso.slice(0, 10)}T00:00:00`).getTime()
  return Math.round((b - a) / 86_400_000)
}

/** "Today, 16:42" / "Yesterday, 08:10" / "27 Dec 2026, 14:05" */
export function relativeDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  const d = dateOf(iso)
  const diff = daysBetween(d, today())
  if (diff === 0) return `Today, ${timeOf(iso)}`
  if (diff === 1) return `Yesterday, ${timeOf(iso)}`
  return formatDateTime(iso)
}

export function filenameStamp(d: Date = new Date()): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}
