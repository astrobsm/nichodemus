/**
 * Test harness: opens a real in-memory SQLite database (the same sql.js
 * engine the application uses), runs the real migrations, and provides a
 * helper to build a fresh project + administrator for each suite.
 */
import { beforeAll } from 'vitest'
import { webcrypto } from 'node:crypto'

// sql.js and our crypto helpers expect the browser globals.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}
if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (s: string) => Buffer.from(s, 'binary').toString('base64')
  globalThis.atob = (s: string) => Buffer.from(s, 'base64').toString('binary')
}

beforeAll(() => {
  // Nothing global to prepare; each suite opens its own database.
})
