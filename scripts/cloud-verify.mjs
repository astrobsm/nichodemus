#!/usr/bin/env node
/**
 * Runs the live cloud check.
 *
 *   npm run cloud:verify
 *
 * Loads .env.local, sets CLOUD_VERIFY=1 (without which the test file skips
 * itself, so an ordinary `npm test` can never touch a live database), and
 * hands over to vitest, which resolves the TypeScript the endpoint is
 * written in.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env, CLOUD_VERIFY: '1' }

const envFile = resolve(root, '.env.local')
if (!existsSync(envFile)) {
  console.error(`
  ✗ No .env.local found at ${envFile}

    It needs:
      TURSO_DATABASE_URL=libsql://...
      TURSO_AUTH_TOKEN=...
      SYNC_TOKEN=...

    Run "npm run cloud:setup" first.
`)
  process.exit(1)
}
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}

for (const key of ['TURSO_DATABASE_URL', 'SYNC_TOKEN']) {
  if (!env[key]) {
    console.error(`\n  ✗ ${key} is missing from .env.local\n`)
    process.exit(1)
  }
}

// shell: true is required on Windows, where spawning the npx batch file
// directly fails with EINVAL.
const child = spawn('npx vitest run tests/cloudLive.test.ts', {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: true,
})
child.on('close', (code) => process.exit(code ?? 0))
