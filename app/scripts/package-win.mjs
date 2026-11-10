// Builds Hermes One for Windows as a zip: release/Hermes-One-<version>-win32-<arch>.zip. It works on a Mac or on
// Windows. Inside are the app folder, the Hermes plugin (../plugin) and "Install Hermes
// One.cmd", which copies the app to %LOCALAPPDATA%\Programs\Hermes One, puts the plugin into every profile of
// the Hermes on that PC and turns it on (`hermes plugins enable`), then opens the app (Hermes One adds its own
// Start menu shortcut).
//
// Electron for Windows comes from HERMES_ONE_ELECTRON_DIST (an unpacked electron-v<ver>-win32-<arch> folder),
// else it's downloaded once into release/cache from ELECTRON_MIRROR (else GitHub), at the same version as the
// Mac build's Electron. Usage: node scripts/package-win.mjs [--arch x64|arm64]  (run `npm run build` first).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = 'Hermes One'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const argArch = process.argv.indexOf('--arch')
const arch = argArch > 0 ? process.argv[argArch + 1] : 'x64'
if (!['x64', 'arm64'].includes(arch)) throw new Error('--arch must be x64 or arm64')
const release = path.join(root, 'release')
const cache = path.join(release, 'cache')
const out = path.join(release, `${NAME}-win32-${arch}`)
const zip = path.join(release, `Hermes-One-${pkg.version}-win32-${arch}.zip`)
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })

for (const need of ['dist/index.html', 'dist-electron/main.cjs', 'dist-electron/preload.cjs']) {
  if (!fs.existsSync(path.join(root, need))) throw new Error(`${need} is missing: run npm run build first`)
}

// The Electron version: the one this build runs on (Hermes' copy on a Mac, else the npm package).
function electronVersion() {
  for (const p of [path.join(os.homedir(), '.hermes/hermes-agent/node_modules/electron/package.json'), path.join(root, 'node_modules/electron/package.json')]) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')).version } catch { /* next */ }
  }
  throw new Error('Can’t tell which Electron version to use: npm install first')
}

async function electronDist() {
  if (process.env.HERMES_ONE_ELECTRON_DIST) return process.env.HERMES_ONE_ELECTRON_DIST
  const version = electronVersion()
  const name = `electron-v${version}-win32-${arch}`
  const folder = path.join(cache, name)
  if (fs.existsSync(path.join(folder, 'electron.exe'))) return folder
  const file = path.join(cache, `${name}.zip`)
  if (!fs.existsSync(file)) {
    const mirror = (process.env.ELECTRON_MIRROR || 'https://github.com/electron/electron/releases/download/').replace(/\/?$/, '/')
    const url = `${mirror}v${version}/${name}.zip`
    console.log(`downloading ${url}`)
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`)
    fs.mkdirSync(cache, { recursive: true })
    fs.writeFileSync(`${file}.part`, Buffer.from(await res.arrayBuffer()))
    fs.renameSync(`${file}.part`, file)
  }
  fs.rmSync(folder, { recursive: true, force: true })
  fs.mkdirSync(folder, { recursive: true })
  sh('tar', ['-xf', file, '-C', folder]) // bsdtar reads zips, on macOS and on Windows 10+
  return folder
}

const INSTALL_CMD = '@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"\r\npause\r\n'
const INSTALL_PS1 = `# Installs Hermes One for this Windows user and opens it. Run "Install Hermes One.cmd".
# It goes to %LOCALAPPDATA%\\Programs\\Hermes One; Hermes One adds its own Start menu shortcut when it opens.
$ErrorActionPreference = 'Stop'
if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is not set, so there is nowhere to install to.' }
$from = Join-Path $PSScriptRoot '${NAME}'
$to = Join-Path $env:LOCALAPPDATA 'Programs\\${NAME}'
if (-not (Test-Path (Join-Path $from '${NAME}.exe'))) { throw "The '${NAME}' folder isn't next to this script ($from). Unzip the whole download first, then run Install ${NAME}.cmd from the unzipped folder." }
# An open Hermes One is asked to close first (it would hold its files). It runs as several processes of the
# same name: ask them all, then wait, then stop any that are left.
$open = @(Get-Process -Name '${NAME}' -ErrorAction SilentlyContinue)
foreach ($p in $open) { try { $null = $p.CloseMainWindow() } catch {} }
foreach ($p in $open) { try { if (-not $p.WaitForExit(8000)) { $p.Kill() } } catch {} }
if (Test-Path $to) { Remove-Item -LiteralPath $to -Recurse -Force }
New-Item -ItemType Directory -Force -Path $to | Out-Null
Copy-Item -Path (Join-Path $from '*') -Destination $to -Recurse -Force
# Files from a downloaded zip are marked as from the internet; this copy is the user's own install.
Get-ChildItem -LiteralPath $to -Recurse -File | Unblock-File
Write-Host 'Hermes One is installed.'

# The Hermes plugin: Hermes One's tools for the agents (apps, groups, adding agents) and its apps for
# Hermes Remote. It goes into every profile of the Hermes on this PC, and Hermes' own command turns it on
# (a running Hermes loads it straight away).
$hermesHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
$hermes = @('hermes.exe', 'hermes.cmd') | ForEach-Object { Join-Path $hermesHome "bin\\$_" } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $hermes) { $found = Get-Command hermes -ErrorAction SilentlyContinue; if ($found) { $hermes = $found.Source } }
$plugin = Join-Path $PSScriptRoot 'hermes-plugin\\hermes-one'
if (-not $hermes -or -not (Test-Path -LiteralPath (Join-Path $hermesHome 'config.yaml'))) {
  Write-Host ''
  Write-Host "Hermes isn't set up on this PC yet, so the Hermes plugin was skipped. Install Hermes, then run Install ${NAME}.cmd again." -ForegroundColor Yellow
} else {
  $profiles = @([pscustomobject]@{ Name = 'default'; Home = $hermesHome })
  $profilesDir = Join-Path $hermesHome 'profiles'
  if (Test-Path -LiteralPath $profilesDir) {
    foreach ($d in Get-ChildItem -LiteralPath $profilesDir -Directory) {
      if (-not $d.Name.StartsWith('.') -and (Test-Path -LiteralPath (Join-Path $d.FullName 'config.yaml'))) { $profiles += [pscustomobject]@{ Name = $d.Name; Home = $d.FullName } }
    }
  }
  $failed = @()
  foreach ($p in $profiles) {
    try {
      $dest = Join-Path $p.Home 'plugins\\hermes-one'
      if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
      New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
      Copy-Item -LiteralPath $plugin -Destination $dest -Recurse -Force
      Get-ChildItem -LiteralPath $dest -Recurse -File | Unblock-File
      & $hermes --profile $p.Name plugins enable hermes-one --no-allow-tool-override | Out-Null
      if ($LASTEXITCODE -ne 0) { $failed += $p.Name }
    } catch { $failed += $p.Name }
  }
  if ($failed.Count) {
    Write-Host "The Hermes plugin couldn't be turned on for: $($failed -join ', '). Turn it on in Hermes One: Settings, Plugins." -ForegroundColor Yellow
  } else {
    $others = $profiles.Count - 1
    Write-Host ("The Hermes plugin is on for Quicksilver" + $(if ($others -eq 1) { ' and 1 other agent.' } elseif ($others -gt 1) { " and $others other agents." } else { '.' }))
  }
}

Start-Process -FilePath (Join-Path $to '${NAME}.exe')
Write-Host ''
Write-Host 'Hermes One is opening. Next time, find it in the Start menu.'
`

const dist = await electronDist()
fs.rmSync(out, { recursive: true, force: true })
const appRoot = path.join(out, NAME)
fs.mkdirSync(appRoot, { recursive: true })
fs.cpSync(dist, appRoot, { recursive: true })
fs.renameSync(path.join(appRoot, 'electron.exe'), path.join(appRoot, `${NAME}.exe`))
const res = path.join(appRoot, 'resources')
fs.rmSync(path.join(res, 'default_app.asar'), { force: true })
const appDir = path.join(res, 'app')
fs.mkdirSync(appDir, { recursive: true })
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: pkg.name, productName: NAME, version: pkg.version, main: 'dist-electron/main.cjs' }, null, 2))
fs.cpSync(path.join(root, 'dist'), path.join(appDir, 'dist'), { recursive: true })
fs.cpSync(path.join(root, 'dist-electron'), path.join(appDir, 'dist-electron'), { recursive: true })
fs.copyFileSync(path.join(root, 'build/icon.ico'), path.join(res, 'hermes-one.ico'))
const pluginSrc = path.resolve(root, '..', 'plugin')
if (!fs.existsSync(path.join(pluginSrc, 'plugin.yaml'))) throw new Error(`The Hermes plugin isn't at ${pluginSrc}`)
fs.cpSync(pluginSrc, path.join(out, 'hermes-plugin', 'hermes-one'), { recursive: true, filter: (src) => !/(^|[\\/])(__pycache__|\.DS_Store|node_modules)$/.test(src) })
fs.writeFileSync(path.join(out, `Install ${NAME}.cmd`), INSTALL_CMD)
fs.writeFileSync(path.join(out, 'install.ps1'), INSTALL_PS1.replace(/\n/g, '\r\n'))

fs.rmSync(zip, { force: true })
if (process.platform === 'darwin') sh('ditto', ['-c', '-k', '--norsrc', '--noextattr', '--noqtn', '--keepParent', out, zip]) // no __MACOSX extras for Windows
else sh('tar', ['-a', '-c', '-f', zip, '-C', release, path.basename(out)])
console.log(`built ${path.relative(root, zip)} (${(fs.statSync(zip).size / 1048576).toFixed(0)} MB)`)
