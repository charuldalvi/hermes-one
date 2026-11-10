// A QR code for the setup flows that are finished on a phone (Telegram quick setup, WhatsApp
// linking, Team Gateway account links). Byte mode, error correction M, the lowest version that
// fits, the mask with the lowest penalty. Follows the structure of Project Nayuki's QR Code
// generator (MIT licence), written out small so the app needs no extra package.
import { useMemo } from 'react'

const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
const FORMAT_M = 0 // error-correction level M in the format bits

function rawModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2
    r -= (25 * n - 10) * n - 55
    if (ver >= 7) r -= 36
  }
  return r
}
const dataCodewords = (ver: number) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * BLOCKS_M[ver]

function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x }
  return z & 0xff
}
function rsDivisor(degree: number): number[] {
  const r = new Array(degree).fill(0)
  r[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) { r[j] = gfMul(r[j], root); if (j + 1 < degree) r[j] ^= r[j + 1] }
    root = gfMul(root, 0x02)
  }
  return r
}
function rsRemainder(data: number[], div: number[]): number[] {
  const r = new Array(div.length).fill(0)
  for (const b of data) {
    const f = b ^ (r.shift() as number)
    r.push(0)
    div.forEach((c, i) => { r[i] ^= gfMul(c, f) })
  }
  return r
}

/** The modules of a QR code (true = dark), or null when the text is too long. */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = Array.from(new TextEncoder().encode(text))
  let ver = 1
  for (; ver <= 40; ver++) {
    const cc = ver < 10 ? 8 : 16
    if (4 + cc + bytes.length * 8 <= dataCodewords(ver) * 8) break
  }
  if (ver > 40) return null
  const cap = dataCodewords(ver) * 8
  const bits: number[] = []
  const put = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1) }
  put(0b0100, 4)
  put(bytes.length, ver < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  put(0, Math.min(4, cap - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))

  // error correction, split into blocks and interleaved
  const nBlocks = BLOCKS_M[ver], eccLen = ECC_PER_BLOCK_M[ver], raw = Math.floor(rawModules(ver) / 8)
  const nShort = nBlocks - (raw % nBlocks), shortLen = Math.floor(raw / nBlocks)
  const div = rsDivisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, div)
    if (i < nShort) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const words: number[] = []
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) words.push(b[i]) })

  const size = ver * 4 + 17
  const mods = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const setF = (x: number, y: number, dark: boolean) => { mods[y][x] = dark; fn[y][x] = true }
  const bit = (v: number, i: number) => ((v >>> i) & 1) !== 0

  for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0) }
  const finder = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy
      if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, d !== 2 && d !== 4)
    }
  }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2
    const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2
    const pos = [6]
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
  const drawFormat = (mask: number) => {
    const d = (FORMAT_M << 3) | mask
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const b = ((d << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) setF(8, i, bit(b, i))
    setF(8, 7, bit(b, 6)); setF(8, 8, bit(b, 7)); setF(7, 8, bit(b, 8))
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(b, i))
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(b, i))
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(b, i))
    setF(8, size - 8, true)
  }
  drawFormat(0)
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const b = (ver << 12) | rem
    for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), c = Math.floor(i / 3); setF(a, c, bit(b, i)); setF(c, a, bit(b, i)) }
  }
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v
      if (!fn[y][x] && i < words.length * 8) { mods[y][x] = bit(words[i >>> 3], 7 - (i & 7)); i++ }
    }
  }

  const masked = (m: number, x: number, y: number) => [
    (x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0,
    (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0,
    (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ][m]
  const apply = (m: number) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && masked(m, x, y)) mods[y][x] = !mods[y][x] }
  const penalty = () => {
    let p = 0, dark = 0
    const line = (get: (k: number) => boolean) => {
      let run = 1
      for (let k = 1; k <= size; k++) {
        if (k < size && get(k) === get(k - 1)) run++
        else { if (run >= 5) p += 3 + (run - 5); run = 1 }
      }
      for (let k = 0; k + 11 <= size; k++) {
        const s = Array.from({ length: 11 }, (_, t) => (get(k + t) ? 1 : 0)).join('')
        if (s === '10111010000' || s === '00001011101') p += 40
      }
    }
    for (let y = 0; y < size; y++) line((x) => mods[y][x])
    for (let x = 0; x < size; x++) line((y) => mods[y][x])
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = mods[y][x]
      if (c === mods[y][x + 1] && c === mods[y + 1][x] && c === mods[y + 1][x + 1]) p += 3
    }
    for (const row of mods) for (const c of row) if (c) dark++
    p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10
    return p
  }
  let best = 0, bestScore = Infinity
  for (let m = 0; m < 8; m++) {
    apply(m); drawFormat(m)
    const s = penalty()
    if (s < bestScore) { best = m; bestScore = s }
    apply(m)
  }
  apply(best); drawFormat(best)
  return mods
}

export function QrCode({ text, label }: { text: string; label: string }) {
  const m = useMemo(() => qrMatrix(text), [text])
  if (!m) return null
  const n = m.length
  let d = ''
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${x},${y}h1v1h-1z`
  return (
    <svg className="sy-qr" viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <path d={d} fill="#111" />
    </svg>
  )
}
