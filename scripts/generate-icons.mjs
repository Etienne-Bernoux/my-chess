// Génère les icônes PWA sans dépendance d'image : on compose les pixels puis on
// encode le PNG à la main. Exécuté à la demande (`node scripts/generate-icons.mjs`),
// pas au build — les fichiers produits sont versionnés.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { Buffer } from 'node:buffer'

const BACKGROUND = [0x10, 0x10, 0x14]
const IDLE = [0x4e, 0x4e, 0x59]
const ACTIVE = [0xf1, 0xf1, 0xf4]

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

const crc32 = (buffer) => {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // profondeur
  ihdr[9] = 6 // RGBA
  // Chaque scanline est préfixée de son octet de filtre (0 = aucun).
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Coin arrondi : un point est dedans si la distance au rectangle inscrit tient. */
const insideRounded = (x, y, left, top, right, bottom, radius) => {
  if (x < left || x > right || y < top || y > bottom) return false
  const dx = Math.max(left + radius - x, 0, x - (right - radius))
  const dy = Math.max(top + radius - y, 0, y - (bottom - radius))
  return dx * dx + dy * dy <= radius * radius
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4)

  // Zone sûre `maskable` : tout le contenu tient dans les 60 % centraux.
  const inset = size * 0.2
  const left = inset
  const right = size - inset
  const radius = size * 0.055
  const gap = size * 0.035
  const middle = size / 2

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let color = BACKGROUND
      if (insideRounded(x, y, left, inset, right, middle - gap / 2, radius)) color = IDLE
      else if (insideRounded(x, y, left, middle + gap / 2, right, size - inset, radius)) {
        color = ACTIVE
      }

      const offset = (y * size + x) * 4
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
      pixels[offset + 3] = 0xff
    }
  }

  return encodePng(size, pixels)
}

mkdirSync(new URL('../public/', import.meta.url), { recursive: true })
for (const size of [192, 512]) {
  const target = new URL(`../public/icon-${size}.png`, import.meta.url)
  writeFileSync(target, drawIcon(size))
  console.log(`écrit public/icon-${size}.png`)
}
