// Finds the Electron that runs Hermes One in development (npm start) and that the Mac build copies.
//   macOS: the Electron.app Hermes already ships (no download; GitHub is slow here), else this folder's own.
//   Windows and Linux: HERMES_ONE_ELECTRON_BIN, else the electron npm package (npm install downloads it).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const exists = (p) => !!p && fs.existsSync(p)

export const electronApp = process.platform === 'darwin'
  ? [
      process.env.HERMES_ONE_ELECTRON_APP,
      path.join(os.homedir(), '.hermes/hermes-agent/node_modules/electron/dist/Electron.app'),
      path.join(root, 'node_modules/electron/dist/Electron.app'),
    ].find(exists)
  : undefined

function npmElectron() {
  try {
    const dir = path.join(root, 'node_modules', 'electron')
    return path.join(dir, 'dist', fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim())
  } catch { return undefined }
}

export const electronBin = process.platform === 'darwin'
  ? (electronApp ? path.join(electronApp, 'Contents/MacOS/Electron') : undefined)
  : process.env.HERMES_ONE_ELECTRON_BIN || npmElectron()

if (!exists(electronBin)) {
  throw new Error(process.platform === 'darwin'
    ? 'No Electron.app found; set HERMES_ONE_ELECTRON_APP'
    : 'No Electron found; run npm install (it downloads Electron) or set HERMES_ONE_ELECTRON_BIN')
}
