// Copies the SQLite WASM binaries into public/ so the app loads them from its
// own origin, offline, with no CDN and no network call at runtime.
//
// sql.js ships two production builds and resolves between them through the
// "browser" export condition: the browser bundle asks for
// sql-wasm-browser.wasm, the Node build for sql-wasm.wasm. Which one a given
// bundler picks depends on its build conditions, so both are published here.
// A missing binary would only surface at runtime, on a device, in the field -
// exactly where it cannot be fixed.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const from = resolve(root, 'node_modules/sql.js/dist')
const to = resolve(root, 'public')

const WANTED = ['sql-wasm-browser.wasm', 'sql-wasm.wasm']

if (!existsSync(from)) {
  console.error('[copy-wasm] sql.js is not installed yet - run npm install first.')
  process.exit(1)
}

mkdirSync(to, { recursive: true })

const copied = []
for (const file of WANTED) {
  const src = resolve(from, file)
  if (!existsSync(src)) continue
  copyFileSync(src, resolve(to, file))
  copied.push(file)
}

if (copied.length === 0) {
  console.error(`[copy-wasm] none of ${WANTED.join(', ')} were found in ${from}.`)
  process.exit(1)
}

console.log(`[copy-wasm] wrote public/${copied.join(', public/')}`)
