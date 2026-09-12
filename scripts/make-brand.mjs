#!/usr/bin/env node
/**
 * Generates every piece of branding from one source image.
 *
 *   npm run brand
 *
 * Source: assets/logo-source.jpg — the official outreach seal.
 * Everything else in the application is derived from it, so the logo is
 * changed in exactly one place.
 *
 * Outputs
 *   public/icons/           PWA icons, favicon, in-app logo, PDF watermark
 *   android/.../mipmap-*    launcher icons at five densities (if android/ exists)
 *   build/electron/         desktop icons (if the desktop build is present)
 */
import sharp from 'sharp'
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(root, 'assets/logo-source.jpg')
const ICONS = resolve(root, 'public/icons')

if (!existsSync(SOURCE)) {
  console.error(`[brand] Source image not found: ${SOURCE}`)
  process.exit(1)
}

const written = []
function note(path) {
  written.push(path.replace(root, '').replace(/\\/g, '/').replace(/^\//, ''))
}

/** The seal sits on a white field; keep it white so nothing looks clipped. */
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

/** Square icon: the seal scaled to fill, on white. */
async function square(size) {
  return sharp(SOURCE)
    .resize(size, size, { fit: 'contain', background: WHITE })
    .flatten({ background: WHITE })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/**
 * Circle-cropped seal on a transparent field, inset to `coverage` of the
 * canvas. Used where the platform applies its own mask, so the seal has to
 * survive a circular or squircle crop without losing its outer ring.
 */
async function circle(size, coverage = 1) {
  const inner = Math.round(size * coverage)
  const r = inner / 2
  const mask = Buffer.from(
    `<svg width="${inner}" height="${inner}"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`,
  )
  const seal = await sharp(SOURCE)
    .resize(inner, inner, { fit: 'cover' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()

  if (inner === size) return seal

  const pad = Math.round((size - inner) / 2)
  return sharp({
    create: { width: size, height: size, channels: 4, background: TRANSPARENT },
  })
    .composite([{ input: seal, top: pad, left: pad }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** Seal inset on a white canvas, for maskable icons that get cropped. */
async function maskable(size, coverage = 0.72) {
  const inner = Math.round(size * coverage)
  const pad = Math.round((size - inner) / 2)
  const seal = await sharp(SOURCE).resize(inner, inner, { fit: 'contain', background: WHITE }).toBuffer()
  return sharp({
    create: { width: size, height: size, channels: 4, background: WHITE },
  })
    .composite([{ input: seal, top: pad, left: pad }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function write(path, buffer) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buffer)
  note(path)
}

// ------------------------------------------------------------- web icons

mkdirSync(ICONS, { recursive: true })

await write(join(ICONS, 'icon-192.png'), await square(192))
await write(join(ICONS, 'icon-512.png'), await square(512))
await write(join(ICONS, 'icon-maskable-512.png'), await maskable(512))
await write(join(ICONS, 'apple-touch-icon.png'), await square(180))
await write(join(ICONS, 'favicon-32.png'), await square(32))

// The seal as displayed inside the application: sign-in, header, reports.
await write(join(ICONS, 'logo.png'), await square(640))
// 320px covers every use: 132px on the boot screen at 2x device pixels,
// and a 40mm stamp on the PDF cover. 512px only inflated every report.
await write(join(ICONS, 'logo-circle.png'), await circle(320))

/**
 * A pale version of the seal, stamped behind every page of a PDF report.
 * Flattening onto white at low opacity keeps the text above it readable —
 * a full-strength watermark would fight with the tables.
 */
const watermark = await sharp(SOURCE)
  .resize(520, 520, { fit: 'contain', background: WHITE })
  .flatten({ background: WHITE })
  .composite([
    {
      input: Buffer.from(
        `<svg width="520" height="520"><rect width="520" height="520" fill="#fff" opacity="0.88"/></svg>`,
      ),
      blend: 'over',
    },
  ])
  // JPEG, not PNG: the watermark is a flattened photograph with no
  // transparency, and it is embedded in every report. JPEG takes it from
  // roughly 200 KB to 25 KB, which is the difference between a report that
  // sends over a rural connection and one that does not.
  .jpeg({ quality: 72, progressive: true })
  .toBuffer()
await write(join(ICONS, 'watermark.jpg'), watermark)

// A real .ico, for the browser tab and the Windows desktop build.
// ICO container: 6-byte header, one 16-byte directory entry per image, then
// the PNG payloads. Written by hand to avoid another dependency.
async function ico(sizes) {
  const images = await Promise.all(sizes.map((s) => square(s)))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type 1 = icon
  header.writeUInt16LE(sizes.length, 4)

  let offset = 6 + sizes.length * 16
  const entries = []
  for (let i = 0; i < sizes.length; i++) {
    const e = Buffer.alloc(16)
    e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 0) // 0 means 256
    e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 1)
    e.writeUInt8(0, 2) // palette
    e.writeUInt8(0, 3) // reserved
    e.writeUInt16LE(1, 4) // colour planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(images[i].length, 8)
    e.writeUInt32LE(offset, 12)
    offset += images[i].length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...images])
}

await write(resolve(root, 'public/favicon.ico'), await ico([16, 32, 48, 256]))

// --------------------------------------------------------- android icons

const RES = resolve(root, 'android/app/src/main/res')
const DENSITIES = [
  { dir: 'mipmap-mdpi', launcher: 48, foreground: 108 },
  { dir: 'mipmap-hdpi', launcher: 72, foreground: 162 },
  { dir: 'mipmap-xhdpi', launcher: 96, foreground: 216 },
  { dir: 'mipmap-xxhdpi', launcher: 144, foreground: 324 },
  { dir: 'mipmap-xxxhdpi', launcher: 192, foreground: 432 },
]

export async function writeAndroidIcons() {
  if (!existsSync(RES)) return 0
  let n = 0
  for (const d of DENSITIES) {
    const dir = join(RES, d.dir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'ic_launcher.png'), await square(d.launcher))
    writeFileSync(join(dir, 'ic_launcher_round.png'), await circle(d.launcher))
    // The adaptive foreground is masked to roughly the middle 72%, so the
    // seal is inset to survive the crop with its outer ring intact.
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), await circle(d.foreground, 0.62))
    n += 3
  }

  const values = join(RES, 'values')
  mkdirSync(values, { recursive: true })

  // Capacitor ships its own ic_launcher_background.xml; two definitions of the
  // same colour name make the resource merger fail.
  const stray = join(values, 'ic_launcher_background.xml')
  if (existsSync(stray)) {
    const { rmSync } = await import('node:fs')
    rmSync(stray)
  }

  // White behind the seal: its outer ring is dark green and gold, which
  // disappears against a dark background.
  writeFileSync(
    join(values, 'colors.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#0F3A5A</color>
    <color name="colorPrimaryDark">#0A2840</color>
    <color name="colorAccent">#1B7A3E</color>
    <color name="ic_launcher_background">#FFFFFF</color>
</resources>
`,
  )
  return n + 1
}

const androidCount = await writeAndroidIcons()
if (androidCount) note(join(RES, `(${androidCount} launcher resources)`))

// -------------------------------------------------------- desktop icons

const ELECTRON = resolve(root, 'build/electron')
mkdirSync(ELECTRON, { recursive: true })
await write(join(ELECTRON, 'icon.png'), await square(512))
await write(join(ELECTRON, 'icon.ico'), await ico([16, 32, 48, 256]))

// ------------------------------------------------------------------ done

console.log('[brand] generated from assets/logo-source.jpg:')
for (const f of written) console.log(`    ${f}`)
if (!androidCount) {
  console.log('    (android/ not present - launcher icons will be written by "npm run apk")')
}
