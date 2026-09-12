// Generates the PWA icons as PNGs with no external dependency.
// A minimal, hand-rolled PNG encoder: the icon is a flat navy square with a
// white cross, which is all the launcher needs.
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function png(size, padding) {
  const navy = [15, 58, 90]
  const white = [255, 255, 255]
  const raw = Buffer.alloc(size * (size * 3 + 1))
  const armThickness = Math.round(size * 0.14)
  const armLength = Math.round(size * (padding ? 0.26 : 0.34))
  const centre = size / 2

  let p = 0
  for (let y = 0; y < size; y++) {
    raw[p++] = 0 // filter type: none
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - centre)
      const dy = Math.abs(y - centre)
      const inCross =
        (dx <= armThickness / 2 && dy <= armLength) || (dy <= armThickness / 2 && dx <= armLength)
      const c = inCross ? white : navy
      raw[p++] = c[0]
      raw[p++] = c[1]
      raw[p++] = c[2]
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(resolve(root, 'public/icons'), { recursive: true })
writeFileSync(resolve(root, 'public/icons/icon-192.png'), png(192, false))
writeFileSync(resolve(root, 'public/icons/icon-512.png'), png(512, false))
writeFileSync(resolve(root, 'public/icons/icon-maskable-512.png'), png(512, true))
console.log('[make-icons] icons written to public/icons')
