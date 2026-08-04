/**
 * Genera los iconos PNG de la PWA sin dependencias externas.
 * Dibuja una línea de pulso (estilo gráfico de precios) sobre el fondo --bg-primary,
 * con gradiente violeta (--accent) → verde (--gain).
 *
 *   npm run icons
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
const SIZES = [72, 96, 128, 144, 152, 192, 384, 512]

const BG = [0x06, 0x06, 0x0a]
const ACCENT = [0x8b, 0x5c, 0xf6]
const GAIN = [0x00, 0xe6, 0x8a]

// Polilínea del "pulso", en coordenadas normalizadas (0..1). y=0 arriba.
const PULSE = [
  [0.12, 0.66],
  [0.28, 0.66],
  [0.36, 0.34],
  [0.46, 0.78],
  [0.56, 0.2],
  [0.66, 0.56],
  [0.74, 0.44],
  [0.88, 0.44],
]

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
const lerp = (a, b, t) => a + (b - a) * t

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** @param {number} size @param {Uint8Array} rgba filas size*size*4 */
function encodePNG(size, rgba) {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: None
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function renderIcon(size, { padding = 0.08 } = {}) {
  const px = new Uint8Array(size * size * 4)
  const thickness = Math.max(1.6, size * 0.062)
  const radius = size * 0.22 // esquinas redondeadas del fondo
  const inner = size * (1 - padding * 2)
  const offset = size * padding
  const pts = PULSE.map(([x, y]) => [offset + x * inner, offset + y * inner])

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5
      const cy = y + 0.5

      // Máscara del fondo con esquinas redondeadas (superelipse simple)
      const dx = Math.max(radius - cx, cx - (size - radius), 0)
      const dy = Math.max(radius - cy, cy - (size - radius), 0)
      const cornerDist = Math.hypot(dx, dy)
      const bgAlpha = Math.max(0, Math.min(1, radius - cornerDist + 0.5))

      // Distancia a la polilínea
      let dist = Infinity
      for (let i = 0; i < pts.length - 1; i++) {
        dist = Math.min(dist, distToSegment(cx, cy, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]))
      }
      const lineAlpha = Math.max(0, Math.min(1, thickness / 2 - dist + 0.5)) * bgAlpha
      const glowAlpha = Math.max(0, Math.min(1, (thickness * 2 - dist) / (thickness * 2))) * 0.18 * bgAlpha

      const t = Math.max(0, Math.min(1, (cx - offset) / inner))
      const lineColor = mix(ACCENT, GAIN, t)

      const a = lineAlpha + glowAlpha * (1 - lineAlpha)
      const color = mix(BG, lineColor, a === 0 ? 0 : lerp(0, 1, lineAlpha + glowAlpha * 0.5))

      const i = (y * size + x) * 4
      px[i] = color[0]
      px[i + 1] = color[1]
      px[i + 2] = color[2]
      px[i + 3] = Math.round(bgAlpha * 255)
    }
  }
  return px
}

mkdirSync(OUT_DIR, { recursive: true })

for (const size of SIZES) {
  writeFileSync(resolve(OUT_DIR, `icon-${size}x${size}.png`), encodePNG(size, renderIcon(size)))
}
// Badge monocromo para la notificación (Android lo recolorea)
writeFileSync(resolve(OUT_DIR, 'badge-72x72.png'), encodePNG(72, renderIcon(72, { padding: 0.14 })))

console.log(`✓ ${SIZES.length + 1} iconos generados en public/icons`)
