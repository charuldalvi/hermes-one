// Makes build/icon.ico (Windows) from build/icon.png with macOS' sips: PNG entries at 16–256 px.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-one-ico-'))
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map((s) => {
  const out = path.join(tmp, `${s}.png`)
  execFileSync('sips', ['-z', String(s), String(s), path.join(root, 'build/icon.png'), '--out', out], { stdio: 'ignore' })
  return fs.readFileSync(out)
})
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
let offset = 6 + 16 * sizes.length
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16)
  e.writeUInt8(s === 256 ? 0 : s, 0); e.writeUInt8(s === 256 ? 0 : s, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3)
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12)
  offset += pngs[i].length
  return e
})
fs.writeFileSync(path.join(root, 'build/icon.ico'), Buffer.concat([header, ...entries, ...pngs]))
fs.rmSync(tmp, { recursive: true, force: true })
console.log('build/icon.ico', sizes.join(' '))
