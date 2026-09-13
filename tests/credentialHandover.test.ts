/**
 * Handing somebody their sign-in details.
 *
 * A PIN sent through WhatsApp cannot be unsent. It sits in two phones'
 * message history, and on a shared or borrowed phone that history is not
 * private. The design does not pretend otherwise: it makes the PIN stop
 * mattering instead. It must be changed at first sign-in, and it expires on
 * its own whether it was used or not.
 *
 * These tests are about that expiry actually being enforced, and about the
 * message going to the right person.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDatabase, teardown, type Fixture } from './helpers'
import {
  changePin,
  createUser,
  issueTemporaryPin,
  login,
  TEMPORARY_PIN_HOURS,
} from '../src/db/repo/users'
import { query, run, transaction } from '../src/db/sqlite'
import { auditForEntity } from '../src/core/audit'
import {
  composeMessage,
  normaliseNumber,
  whatsappLink,
  WhatsAppError,
} from '../src/services/whatsapp'

let fx: Fixture

beforeEach(async () => {
  fx = await freshDatabase()
  expect(fx.project.id).toBeGreaterThan(0)
})

afterAll(teardown)

async function makeUser(username = 'ngozi') {
  return createUser({
    username,
    fullName: 'Nurse Ngozi',
    role: 'NURSE',
    pin: '4821',
    phone: '08030000123',
  })
}

describe('a temporary PIN', () => {
  it('is six digits from a real random source, not a guessable pattern', async () => {
    const id = await makeUser()
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const { pin } = await issueTemporaryPin(id, 'Ada Admin')
      expect(pin).toMatch(/^\d{6}$/)
      seen.add(pin)
    }
    // Twenty draws from a million should not repeat; a constant or a counter
    // would collapse this to one or two values.
    expect(seen.size).toBeGreaterThan(15)
  })

  it('lets the person in, once', async () => {
    const id = await makeUser()
    const { pin } = await issueTemporaryPin(id, 'Ada Admin')
    const result = await login('ngozi', pin)
    expect(result.ok).toBe(true)
    expect(result.ok && result.mustChangePin).toBe(true)
  })

  it('replaces whatever PIN was there before', async () => {
    const id = await makeUser()
    await issueTemporaryPin(id, 'Ada Admin')
    const old = await login('ngozi', '4821')
    expect(old.ok).toBe(false)
  })

  it('is never written into the audit trail', async () => {
    const id = await makeUser()
    const { pin } = await issueTemporaryPin(id, 'Ada Admin')
    const entries = auditForEntity('user', id)
    expect(JSON.stringify(entries)).not.toContain(pin)
    expect(entries.some((e) => /Temporary PIN issued/.test(e.summary ?? ''))).toBe(true)
  })

  it('is not recoverable from the database afterwards', async () => {
    const id = await makeUser()
    const { pin } = await issueTemporaryPin(id, 'Ada Admin')
    const rows = query<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', [id])
    expect(JSON.stringify(rows)).not.toContain(pin)
  })
})

describe('expiry', () => {
  it('stops working once its moment has passed, even though it is correct', async () => {
    const id = await makeUser()
    const { pin } = await issueTemporaryPin(id, 'Ada Admin')

    // Move the expiry into the past, as the clock would.
    await transaction(() =>
      run('UPDATE users SET pin_expires_at = ? WHERE id = ?', [
        new Date(Date.now() - 60_000).toISOString(),
        id,
      ]),
    )

    const result = await login('ngozi', pin)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/expired/i)
  })

  it('is about two days, not indefinite', async () => {
    const id = await makeUser()
    const { expiresAt } = await issueTemporaryPin(id, 'Ada Admin')
    const hours = (new Date(expiresAt).getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(TEMPORARY_PIN_HOURS - 1)
    expect(hours).toBeLessThan(TEMPORARY_PIN_HOURS + 1)
  })

  it('does not tell a guesser that an account exists', async () => {
    // The expiry is only reported once the PIN is known to be right. A wrong
    // PIN on an expired account must look like any other wrong PIN.
    const id = await makeUser()
    await issueTemporaryPin(id, 'Ada Admin')
    await transaction(() =>
      run('UPDATE users SET pin_expires_at = ? WHERE id = ?', [
        new Date(Date.now() - 60_000).toISOString(),
        id,
      ]),
    )

    const wrong = await login('ngozi', '000000')
    expect(wrong.ok).toBe(false)
    expect(wrong.ok === false && wrong.reason).not.toMatch(/expired/i)
  })

  it('ends as soon as the person chooses their own PIN', async () => {
    const id = await makeUser()
    const { pin } = await issueTemporaryPin(id, 'Ada Admin')
    await login('ngozi', pin)
    await changePin(id, '9182')

    const rows = query<{ pin_expires_at: string | null; must_change_pin: number }>(
      'SELECT pin_expires_at, must_change_pin FROM users WHERE id = ?',
      [id],
    )
    expect(rows[0].pin_expires_at).toBeNull()
    expect(Number(rows[0].must_change_pin)).toBe(0)

    // And it keeps working past the moment the temporary one would have died.
    const later = await login('ngozi', '9182')
    expect(later.ok).toBe(true)
  })
})

describe('the telephone number', () => {
  it('accepts the way people actually write it locally', () => {
    expect(normaliseNumber('08030000123')).toBe('2348030000123')
    expect(normaliseNumber('0803 000 0123')).toBe('2348030000123')
    expect(normaliseNumber('+234 803 000 0123')).toBe('2348030000123')
    expect(normaliseNumber('2348030000123')).toBe('2348030000123')
    expect(normaliseNumber('00234 803 000 0123')).toBe('2348030000123')
  })

  it('refuses something too short to be a number', () => {
    // Sending to a wrong number means sending a working PIN to a stranger.
    expect(normaliseNumber('12345')).toBeNull()
    expect(normaliseNumber('')).toBeNull()
    expect(() => whatsappLink('12345', 'hello')).toThrow(WhatsAppError)
  })

  it('builds a link WhatsApp understands', () => {
    const link = whatsappLink('08030000123', 'Hello there')
    expect(link).toBe('https://wa.me/2348030000123?text=Hello%20there')
  })

  it('escapes the message rather than breaking the link', () => {
    const link = whatsappLink('08030000123', 'PIN: 123456 & more?')
    expect(link).not.toMatch(/[ &?](?!text=)/)
    expect(decodeURIComponent(link.split('text=')[1])).toBe('PIN: 123456 & more?')
  })
})

describe('the message', () => {
  const base = { fullName: 'Nurse Ngozi Okeke', username: 'ngozi', outreach: 'NUG Outreach' }

  it('carries the username and the PIN when one was issued', () => {
    const text = composeMessage({ ...base, pin: '482913' })
    expect(text).toContain('ngozi')
    expect(text).toContain('482913')
  })

  it('tells them to change it and delete the message', () => {
    const text = composeMessage({ ...base, pin: '482913' })
    expect(text).toMatch(/choose your own PIN/i)
    expect(text).toMatch(/delete this message/i)
  })

  it('says when it stops working', () => {
    const text = composeMessage({
      ...base,
      pin: '482913',
      expiresAt: new Date(Date.now() + 48 * 3_600_000).toISOString(),
    })
    expect(text).toMatch(/stops working/i)
  })

  it('carries no PIN at all when the person chose their own', () => {
    // This is the ordinary case after a self-service request, and the safest
    // message is the one with no credential in it.
    const text = composeMessage(base)
    expect(text).not.toMatch(/\b\d{6}\b/)
    expect(text).toMatch(/PIN you chose/i)
  })

  it('greets the person by name', () => {
    expect(composeMessage(base)).toMatch(/^Hello Nurse,/)
  })
})
