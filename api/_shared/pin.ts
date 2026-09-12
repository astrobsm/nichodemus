/**
 * Server-side PIN verification.
 *
 * Deliberately mirrors src/core/crypto.ts exactly — PBKDF2-SHA256, 256 bits,
 * a per-user random salt, the iteration count stored on the user row. The
 * cloud copy of the users table holds the same derivation the device made, so
 * a PIN chosen on a phone verifies here without either side ever storing or
 * transmitting the PIN itself.
 */
import { pbkdf2 as pbkdf2Callback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const pbkdf2 = promisify(pbkdf2Callback)

export interface StoredPin {
  hash: string
  salt: string
  iterations: number
}

export async function verifyPin(pin: string, stored: StoredPin): Promise<boolean> {
  if (!pin || !stored?.hash || !stored?.salt) return false

  const iterations = Number(stored.iterations)
  // A tampered or corrupt row must not be able to make this cheap to attack,
  // nor to exhaust the function's time budget.
  if (!Number.isFinite(iterations) || iterations < 10_000 || iterations > 1_000_000) return false

  let expected: Buffer
  try {
    expected = Buffer.from(stored.hash, 'base64')
  } catch {
    return false
  }
  if (expected.length !== 32) return false

  const derived = (await pbkdf2(
    pin,
    Buffer.from(stored.salt, 'base64'),
    iterations,
    32,
    'sha256',
  )) as Buffer

  return timingSafeEqual(derived, expected)
}
