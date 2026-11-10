// Builds "Hermes One.app" from the Electron that ships with Hermes (no download), adds the app files,
// renames and re-signs it, and installs it in ~/Applications. It signs with this Mac's Apple Development
// certificate when there is one (HERMES_ONE_SIGN_ID picks another), so macOS remembers privacy answers,
// like access to the external drive Hermes lives on, across updates. Ad hoc otherwise.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronApp } from './electron-path.mjs'

if (process.platform !== 'darwin') { console.error('This builds the Mac app. For Windows run: npm run package:win'); process.exit(1) }

const NAME = 'Hermes One'
const ID = 'com.charuldalvi.hermesone'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const outDir = path.join(root, 'release')
const appPath = path.join(outDir, `${NAME}.app`)
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })

fs.rmSync(appPath, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
sh('ditto', [electronApp, appPath])

const res = path.join(appPath, 'Contents/Resources')
fs.rmSync(path.join(res, 'default_app.asar'), { force: true })
const appDir = path.join(res, 'app')
fs.mkdirSync(appDir, { recursive: true })
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: pkg.name, productName: NAME, version: pkg.version, main: 'dist-electron/main.cjs' }, null, 2))
sh('ditto', [path.join(root, 'dist'), path.join(appDir, 'dist')])
sh('ditto', [path.join(root, 'dist-electron'), path.join(appDir, 'dist-electron')])
fs.rmSync(path.join(res, 'electron.icns'), { force: true })
// The icon. macOS 26 and later shrink an old-style .icns into a grey frame unless its shape matches the
// system's, so Xcode's actool compiles build/AppIcon.icon (Icon Composer's format: the full-bleed pearl
// render, which macOS masks itself) into Assets.car, plus a correctly shaped AppIcon.icns for older macOS.
// Without Xcode it falls back to build/icon.icns.
let iconFile = 'electron.icns'
try {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-one-icon-'))
  execFileSync('xcrun', ['actool', '--compile', tmp, '--platform', 'macosx', '--minimum-deployment-target', '12.0', '--target-device', 'mac',
    '--app-icon', 'AppIcon', '--output-partial-info-plist', path.join(tmp, 'partial.plist'), path.join(root, 'build/AppIcon.icon')], { stdio: 'ignore' })
  fs.copyFileSync(path.join(tmp, 'Assets.car'), path.join(res, 'Assets.car'))
  fs.copyFileSync(path.join(tmp, 'AppIcon.icns'), path.join(res, 'AppIcon.icns'))
  fs.rmSync(tmp, { recursive: true, force: true })
  iconFile = 'AppIcon'
} catch {
  console.log('actool unavailable: using build/icon.icns')
  fs.copyFileSync(path.join(root, 'build/icon.icns'), path.join(res, 'electron.icns'))
}

const plist = path.join(appPath, 'Contents/Info.plist')
const set = (key, value) => sh('plutil', ['-replace', key, '-string', value, plist])
set('CFBundleName', NAME)
set('CFBundleDisplayName', NAME)
set('CFBundleIdentifier', ID)
set('CFBundleShortVersionString', pkg.version)
set('CFBundleVersion', pkg.version)
set('CFBundleIconFile', iconFile)
if (iconFile === 'AppIcon') set('CFBundleIconName', 'AppIcon')
set('NSHumanReadableCopyright', 'Hermes One: your local Hermes, as one chat with Chief')
set('NSMicrophoneUsageDescription', 'Hermes One uses the microphone when you speak a message instead of typing it.')
for (const helper of fs.readdirSync(path.join(appPath, 'Contents/Frameworks')).filter((f) => f.startsWith('Electron Helper'))) {
  const hp = path.join(appPath, 'Contents/Frameworks', helper, 'Contents/Info.plist')
  const suffix = helper.replace('Electron Helper', '').replace('.app', '').trim().replace(/[()]/g, '').toLowerCase()
  sh('plutil', ['-replace', 'CFBundleIdentifier', '-string', `${ID}.helper${suffix ? '.' + suffix : ''}`, hp])
}
function signingIdentity() {
  if (process.env.HERMES_ONE_SIGN_ID) return process.env.HERMES_ONE_SIGN_ID
  try {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
    return out.match(/\b([0-9A-F]{40}) "Apple Development: [^"]+"/)?.[1] ?? '-'
  } catch { return '-' }
}
const identity = signingIdentity()
console.log(identity === '-' ? 'signing ad hoc' : `signing with ${identity.slice(0, 8)}…`)
sh('codesign', ['--force', '--deep', '--sign', identity, appPath])

if (!process.argv.includes('--no-install')) {
  const dest = path.join(os.homedir(), 'Applications', `${NAME}.app`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.rmSync(dest, { recursive: true, force: true })
  sh('ditto', [appPath, dest])
  // Electron's bundle carries a 1980 date, and macOS keeps showing the icon it cached for a bundle whose
  // date hasn't changed (the old Electron icon in the Dock). A fresh date plus re-registering makes it
  // read the new one.
  const now = new Date()
  for (const p of [dest, path.join(dest, 'Contents'), path.join(dest, 'Contents/Info.plist'), path.join(dest, 'Contents/Resources')]) fs.utimesSync(p, now, now)
  try { sh('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', dest]) } catch { /* the icon then refreshes on the next Dock restart */ }
  console.log(`installed ${dest}`)
}
