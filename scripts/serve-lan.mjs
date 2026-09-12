#!/usr/bin/env node
/**
 * Serves the built application so a phone can install it from the browser.
 *
 *   npm run serve            over Wi-Fi, prints the address to type
 *   npm run serve -- --usb   over a USB cable, which also enables the proper
 *                            "Install app" prompt
 *
 * The --usb route is worth understanding: Chrome only offers a real install on
 * a secure origin. "adb reverse" makes the phone treat localhost:4173 as its
 * own, which counts as secure, so you get the full install rather than a
 * plain home-screen shortcut. Over Wi-Fi you get the shortcut, which still
 * works offline but looks slightly less like a native app.
 *
 * This is a delivery mechanism only. No patient data passes through it - the
 * database is created on the phone, after installation.
 */
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { networkInterfaces, homedir, platform } from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const PORT = Number(process.env.PORT ?? 4173)
const useUsb = process.argv.includes('--usb')
const isWindows = platform() === 'win32'

if (!existsSync(join(dist, 'index.html'))) {
  console.error('\n  ✗ No build found. Run "npm run build" first.\n')
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  // Chrome refuses to stream-compile WebAssembly served as anything else,
  // and the whole database engine is a .wasm file.
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  // Contain the path: a request must not be able to escape dist/.
  const relative = normalize(decodeURIComponent(url)).replace(/^(\.\.[/\\])+/, '')
  let file = join(dist, relative)

  if (!file.startsWith(dist)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  // Single-page app: unknown paths fall back to the shell.
  if (!existsSync(file)) file = join(dist, 'index.html')

  const body = readFileSync(file)
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Length': body.length,
    // The service worker must always be revalidated or an update never lands.
    'Cache-Control': file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=0',
  })
  res.end(body)
})

function lanAddresses() {
  const out = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address })
    }
  }
  return out
}

function findAdb() {
  const sdk =
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null) ??
    join(homedir(), 'AppData', 'Local', 'Android', 'Sdk')
  const adb = join(sdk, 'platform-tools', isWindows ? 'adb.exe' : 'adb')
  return existsSync(adb) ? adb : null
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Nichodemus Ugbor Memorial Community Health Outreach`)
  console.log(`  Serving the built application on port ${PORT}\n`)

  if (useUsb) {
    const adb = findAdb()
    if (!adb) {
      console.error('  ✗ adb not found. Install the Android platform-tools, or')
      console.error('    run without --usb to serve over Wi-Fi instead.\n')
    } else {
      try {
        const devices = execFileSync(adb, ['devices'], { encoding: 'utf8' })
          .split('\n')
          .slice(1)
          .filter((l) => l.trim().endsWith('device'))
        if (devices.length === 0) {
          console.error('  ✗ No phone detected over USB.')
          console.error('    Enable Developer options and USB debugging, plug the phone in,')
          console.error('    accept the prompt on its screen, then run this again.\n')
        } else {
          execFileSync(adb, ['reverse', `tcp:${PORT}`, `tcp:${PORT}`])
          console.log('  Phone connected over USB.\n')
          console.log(`    On the phone, open Chrome and go to:\n`)
          console.log(`        http://localhost:${PORT}\n`)
          console.log('    Then: menu (⋮) → Install app\n')
          console.log('    Because this address counts as secure, you get a real')
          console.log('    installation rather than a home-screen shortcut.\n')
        }
      } catch (err) {
        console.error(`  ✗ adb reverse failed: ${err.message}\n`)
      }
    }
  } else {
    const addresses = lanAddresses()
    if (addresses.length === 0) {
      console.log('  No Wi-Fi address found. Connect this computer to the same')
      console.log('  network as the phone, or use: npm run serve -- --usb\n')
    } else {
      console.log('  On the phone, connect to the same Wi-Fi and open Chrome at:\n')
      for (const a of addresses) {
        console.log(`        http://${a.address}:${PORT}        (${a.name})`)
      }
      console.log('\n    Then: menu (⋮) → Add to Home screen\n')
      console.log('    The app works fully offline once added. For the proper')
      console.log('    "Install app" prompt instead, use:  npm run serve -- --usb\n')
    }
  }

  console.log('  Once the app is on the phone this computer is no longer needed.')
  console.log('  Press Ctrl+C to stop.\n')
})
