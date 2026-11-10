import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, Notification, screen, session, shell, systemPreferences } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hermesRoot, registerApps } from './apps'
import { BrowserWatch, findBrowsers } from './browser'
import { type TicketPurpose } from './gateway'
import { createSystems, type Systems } from './systems'

app.setName('Hermes One')
const IS_MAC = process.platform === 'darwin'
const IS_WIN = process.platform === 'win32'
const APP_ID = 'com.charuldalvi.hermesone'
// Windows shows notifications only for an app with an id that a Start menu shortcut carries too.
if (IS_WIN) app.setAppUserModelId(APP_ID)
// The desktop glowing through the window: macOS' vibrancy, or acrylic on Windows 11 22H2 (build 22621) and later.
const WIN_BUILD = IS_WIN ? Number(os.release().split('.')[2]) || 0 : 0
const CAN_FROST = IS_MAC || WIN_BUILD >= 22621
// Off-screen test copies can run on their own data (apps, settings), so a test app never lands in the real one.
if (process.env.HERMES_ONE_SNAPSHOT && process.env.HERMES_ONE_USERDATA) app.setPath('userData', process.env.HERMES_ONE_USERDATA)
let win: BrowserWindow | null = null
let apps: ReturnType<typeof registerApps> | null = null

// Snapshot mode (development): render off-screen and save PNGs of scripted steps, so the UI can be
// checked while the Mac's display is asleep. HERMES_ONE_SNAPSHOT=<dir>, HERMES_ONE_SNAP_STEPS=<json file>.
const SNAP_DIR = process.env.HERMES_ONE_SNAPSHOT
async function runSnapshots(w: BrowserWindow) {
  const steps: { name: string; wait?: number; js?: string }[] = JSON.parse(fs.readFileSync(process.env.HERMES_ONE_SNAP_STEPS || '', 'utf8'))
  fs.mkdirSync(SNAP_DIR!, { recursive: true })
  for (const step of steps) {
    if (step.js) { try { await w.webContents.executeJavaScript(step.js, true) } catch (e) { console.log('[snap] js failed', step.name, e) } }
    await new Promise((r) => setTimeout(r, step.wait ?? 1200))
    const img = await w.webContents.capturePage()
    fs.writeFileSync(path.join(SNAP_DIR!, `${step.name}.png`), img.toPNG())
    console.log('[snap] saved', step.name)
  }
  app.quit()
}

// Collection routes under /api/profiles/ by method; any other method there names a profile of that
// name (mirror of the gateway's PROFILE_COLLECTION_ROUTES, via apps/desktop/electron/profile-routes.ts).
const PROFILE_COLLECTIONS: Record<string, string[]> = { active: ['GET', 'POST'], import: ['POST'], 'projects/tree': ['GET'], sessions: ['GET'], 'sessions/pull-requests': ['POST'], 'sessions/sidebar': ['GET'] }
function grantFor(url: URL, verb: string, body: unknown): { profile: string | null; purpose: TicketPurpose } {
  const trimmed = url.pathname.replace(/\/+$/, '')
  const suffix = trimmed.startsWith('/api/profiles/') ? trimmed.slice('/api/profiles/'.length) : ''
  const collection = suffix && PROFILE_COLLECTIONS[suffix]?.includes(verb) ? suffix : null
  let purpose: TicketPurpose = 'native-http'
  if (verb === 'POST' && trimmed === '/api/profiles') purpose = 'native-profile-create'
  else if ((verb === 'PATCH' || verb === 'DELETE') && suffix && !suffix.includes('/') && !collection) purpose = 'native-profile-registry'
  let profile: string | null = null
  if (collection === 'sessions/sidebar') profile = url.searchParams.get('recents_profile')
  else if (suffix && !collection) profile = decodeURIComponent(suffix.split('/')[0])
  else profile = url.searchParams.get('profile')
  if (!profile && body && typeof body === 'object' && !Array.isArray(body) && typeof (body as any).profile === 'string') profile = (body as any).profile
  return { profile: profile?.trim() || null, purpose }
}
// Hermes on this computer or another one (systems.ts); the sidebar footer switches between them.
let systems: Systems
const remoteName = () => (systems.active().kind === 'local' ? null : systems.active().name)

const boundsFile = () => path.join(app.getPath('userData'), 'window.json')
function savedBounds(): { x?: number; y?: number; width: number; height: number } {
  try { const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8')); if (b.width > 600 && b.height > 400) return b } catch { /* first run */ }
  return { width: 1480, height: 940 }
}

// Light, dark or the Mac's own setting (Settings › This app). Remembered here so the window opens in the
// right colours before the page has loaded. Snapshot runs can pin one with HERMES_ONE_THEME.
type ThemeChoice = 'system' | 'light' | 'dark'
const themeFile = () => path.join(app.getPath('userData'), 'theme.json')
function savedTheme(): ThemeChoice {
  const env = process.env.HERMES_ONE_THEME
  if (env === 'light' || env === 'dark' || env === 'system') return env
  try { const t = JSON.parse(fs.readFileSync(themeFile(), 'utf8')).theme; if (t === 'light' || t === 'dark' || t === 'system') return t } catch { /* first launch */ }
  return 'system'
}
const windowBg = () => (nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#f7f7f7')

// Window and background (Settings › This app). Frosted: the Mac blurs the desktop behind the window, and the
// page tints it (how much shows through is the page's business). Remembered here so the window opens frosted.
const lookFile = () => path.join(app.getPath('userData'), 'look.json')
const savedLook = (() => { try { return JSON.parse(fs.readFileSync(lookFile(), 'utf8')) } catch { return {} } })()
let frosted = savedLook.frosted === true && CAN_FROST
// Interface scale (Settings › This app, and View › Zoom with ⌘+ ⌘− ⌘0): the whole window's zoom, in steps.
const SCALES = [80, 90, 100, 110, 125, 150]
let scale = SCALES.includes(savedLook.scale) ? savedLook.scale : 100
const saveLook = () => { try { fs.writeFileSync(lookFile(), JSON.stringify({ frosted, scale })) } catch { /* asked again next launch */ } }
const bgColor = () => (frosted ? '#00000000' : windowBg())
function setFrosted(on: boolean) {
  frosted = on && CAN_FROST
  saveLook()
  if (!win) return
  if (IS_MAC) win.setVibrancy(frosted ? 'under-window' : null)
  else if (IS_WIN) win.setBackgroundMaterial(frosted ? 'acrylic' : 'none')
  win.setBackgroundColor(bgColor())
}
// Windows: minimise, maximise and close are drawn by Windows over the top right of the page, in the header's
// band (tokens.css --header-height, zoomed with the page) and on its own background, so tints and pictures show.
const HEADER_HEIGHT = 56
const titleBarOverlay = () => ({ color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#dcdcdc' : '#1f1f1f', height: Math.round(HEADER_HEIGHT * scale / 100) })
// Windows has no count on the taskbar icon: a small dot over it says something waits for you.
let badgeDot: Electron.NativeImage | null = null
function dotImage() {
  if (badgeDot) return badgeDot
  const size = 32, r = 11.5, c = (size - 1) / 2
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = Math.max(0, Math.min(1, r - Math.hypot(x - c, y - c) + 0.5))
    const i = (y * size + x) * 4
    pixels[i] = Math.round(0x44 * a); pixels[i + 1] = Math.round(0x44 * a); pixels[i + 2] = Math.round(0xef * a); pixels[i + 3] = Math.round(255 * a) // BGRA, premultiplied: #ef4444
  }
  badgeDot = nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 2 })
  return badgeDot
}
// The icon Windows shows for the window and the Start menu shortcut (packaged next to the app's resources).
const windowsIcon = () => { const f = path.join(process.resourcesPath, 'hermes-one.ico'); return fs.existsSync(f) ? f : undefined }
// A Start menu shortcut with the app's id, so Windows shows its notifications (and it's easy to find).
function ensureStartMenuShortcut() {
  if (!IS_WIN || !app.isPackaged) return
  try {
    const link = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Hermes One.lnk')
    const icon = windowsIcon()
    shell.writeShortcutLink(link, fs.existsSync(link) ? 'replace' : 'create', { target: process.execPath, appUserModelId: APP_ID, description: 'Hermes One', ...(icon ? { icon, iconIndex: 0 } : {}) })
  } catch { /* the app still runs; notifications may not show */ }
}
// The quick-entry bar shares the page's zoom (same origin), so it grows with it.
const quickSize = () => ({ width: Math.round(680 * scale / 100), height: Math.round(92 * scale / 100) })
function setScale(v: number) {
  scale = SCALES.includes(v) ? v : 100
  saveLook()
  win?.webContents.setZoomFactor(scale / 100)
  if (IS_WIN) win?.setTitleBarOverlay(titleBarOverlay())
  if (quickWin) quickWin.setSize(quickSize().width, quickSize().height)
  win?.webContents.send('hermes:scale', scale)
}
const stepScale = (dir: number) => setScale(dir === 0 ? 100 : SCALES[Math.max(0, Math.min(SCALES.length - 1, SCALES.indexOf(scale) + dir))])
// The usual menus, with View's zoom items moving the app's own Interface scale (so Settings follows). On
// Windows the window has no menu bar (its title bar is the page's header), but the shortcuts still work.
function buildMenu() {
  const zoom = (label: string, accelerator: string, dir: number, visible = true): Electron.MenuItemConstructorOptions =>
    ({ label, accelerator, click: () => stepScale(dir), visible, acceleratorWorksWhenHidden: true })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(IS_MAC ? [{ role: 'appMenu' } as const] : []), { role: 'fileMenu' }, { role: 'editMenu' },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      zoom('Actual Size', 'CmdOrCtrl+0', 0), zoom('Zoom In', 'CmdOrCtrl+Plus', 1), zoom('Zoom In', 'CmdOrCtrl+=', 1, false), zoom('Zoom Out', 'CmdOrCtrl+-', -1),
      { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ]))
}
// The workspace picture: a copy kept on this Mac (so moving the original doesn't lose it), at most 2880 px wide.
const pictureDir = () => path.join(app.getPath('userData'), 'background')
const pictureFile = () => { try { const f = fs.readdirSync(pictureDir()).find((n) => /^picture\.(jpg|png)$/.test(n)); return f ? path.join(pictureDir(), f) : null } catch { return null } }
function removePicture() { try { for (const f of fs.readdirSync(pictureDir())) fs.rmSync(path.join(pictureDir(), f), { force: true }) } catch { /* nothing kept */ } }
async function pickPicture(): Promise<{ ok: true } | { error: string } | null> {
  const r = await dialog.showOpenDialog(win!, { title: 'Choose a picture for the background', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp', 'gif', 'tiff', 'bmp'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  let img = nativeImage.createFromPath(r.filePaths[0])
  if (img.isEmpty()) img = await nativeImage.createThumbnailFromPath(r.filePaths[0], { width: 2880, height: 2880 }).catch(() => nativeImage.createEmpty())
  if (img.isEmpty()) return { error: 'That picture couldn’t be opened. Try a JPEG or PNG.' }
  const { width } = img.getSize()
  if (width > 2880) img = img.resize({ width: 2880, quality: 'best' })
  const png = /\.png$/i.test(r.filePaths[0])
  fs.mkdirSync(pictureDir(), { recursive: true })
  removePicture()
  fs.writeFileSync(path.join(pictureDir(), png ? 'picture.png' : 'picture.jpg'), png ? img.toPNG() : img.toJPEG(90))
  return { ok: true }
}

function createWindow() {
  win = new BrowserWindow({
    ...savedBounds(), minWidth: 1040, minHeight: 640, show: false,
    title: 'Hermes One', backgroundColor: bgColor(),
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 19 }, visualEffectState: 'active' as const, ...(frosted ? { vibrancy: 'under-window' as const } : {}) } : {}),
    ...(IS_WIN ? { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlay(), icon: windowsIcon(), ...(frosted ? { backgroundMaterial: 'acrylic' as const } : {}) } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: true, ...(SNAP_DIR ? { offscreen: true } : {}) },
  })
  win.loadFile(path.join(__dirname, '../dist/index.html'))
  win.webContents.on('did-finish-load', () => { win?.webContents.setZoomFactor(scale / 100) })
  if (SNAP_DIR) { win.webContents.setFrameRate(30); win.webContents.once('did-finish-load', () => { void runSnapshots(win!) }) }
  else win.once('ready-to-show', () => win?.show())
  if (process.env.HERMES_ONE_DEBUG) win.webContents.on('console-message', (_e, level, message, line, source) => console.log(`[renderer:${level}] ${message} (${source}:${line})`))
  // What an app's web page prints goes to that app's log (Show its log), where its agent can read it.
  win.webContents.on('console-message', (_e, level, message, _line, source) => apps?.pageConsole(level, message, source))
  const remember = () => { if (win && !win.isMinimized() && !win.isFullScreen()) { try { fs.writeFileSync(boundsFile(), JSON.stringify(win.getBounds())) } catch { /* not critical */ } } }
  win.on('resized', remember); win.on('moved', remember)
  win.on('closed', () => { win = null })
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('file://')) { event.preventDefault(); if (/^https?:/.test(url)) void shell.openExternal(url) } })
}

// Quick entry (⌥Space from anywhere): a small floating bar to write to Chief without switching apps.
// It sends through the main window, which holds the one connection to Hermes.
let quickWin: BrowserWindow | null = null
function toggleQuick() {
  if (quickWin?.isVisible()) { quickWin.hide(); return }
  if (!quickWin) {
    quickWin = new BrowserWindow({
      ...quickSize(), frame: false, transparent: true, resizable: false, movable: true, show: false, alwaysOnTop: true,
      skipTaskbar: true, fullscreenable: false, hasShadow: false, backgroundColor: '#00000000',
      ...(IS_MAC ? { vibrancy: 'popover' as const, visualEffectState: 'active' as const } : {}),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    })
    quickWin.loadFile(path.join(__dirname, '../dist/index.html'), { query: { quick: '1' } })
    quickWin.on('blur', () => quickWin?.hide())
    quickWin.on('closed', () => { quickWin = null })
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  quickWin.setPosition(Math.round(x + (width - quickSize().width) / 2), Math.round(y + height * 0.24))
  quickWin.show(); quickWin.focus()
  quickWin.webContents.send('hermes:quick-shown')
}

app.whenReady().then(() => {
  nativeTheme.themeSource = savedTheme()
  buildMenu()
  ensureStartMenuShortcut()
  nativeTheme.on('updated', () => { win?.setBackgroundColor(bgColor()); if (IS_WIN) win?.setTitleBarOverlay(titleBarOverlay()) })
  // The gateway refuses browser origins on its socket; this app is a native client like Hermes Desktop,
  // so it drops the Origin header on requests to the local gateway only.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (/^(ws|http)s?:\/\/(127\.0\.0\.1|\[::1\])(:\d+)?\//.test(details.url)) {
      delete details.requestHeaders.Origin
      delete details.requestHeaders.origin
    }
    callback({ requestHeaders: details.requestHeaders })
  })
  systems = createSystems()
  ipcMain.handle('hermes:endpoint', (_event, refresh: boolean) => systems.conn().endpoint(refresh))
  ipcMain.handle('hermes:ticket', (_event, purpose, profileHome) => systems.conn().ticket(purpose, profileHome))
  // Systems: the list, adding one (signed in or reachable), switching (the window starts over on it), removing.
  const restart = () => { win?.webContents.reload() }
  ipcMain.handle('hermes:systems', () => systems.rows())
  ipcMain.handle('hermes:system-switch', (_event, id: string) => { if (systems.switchTo(String(id))) restart(); return true })
  ipcMain.handle('hermes:system-add', async (_event, input) => {
    try { const def = await systems.add(input ?? {}); systems.switchTo(def.id); restart(); return { ok: true } } catch (error: any) { return { ok: false, error: String(error?.message ?? error) } }
  })
  ipcMain.handle('hermes:system-signin', async (_event, id: string, password: string) => {
    try { await systems.signIn(String(id), String(password ?? '')); if (systems.active().id === id) restart(); return { ok: true } } catch (error: any) { return { ok: false, error: String(error?.message ?? error) } }
  })
  ipcMain.handle('hermes:system-remove', (_event, id: string) => { if (systems.remove(String(id))) restart(); return true })
  ipcMain.handle('hermes:open', (_event, url: string) => { if (/^https?:/.test(url)) return shell.openExternal(url) })
  // The agents' Chromes on this computer (the side panel's Browser): which agents have one open, and watching
  // one at a time. Only for Hermes on this computer; another system's agents browse over there.
  let watching: BrowserWatch | null = null
  // Off-screen test copies can look at a test Chrome in a scratch Hermes home instead.
  const browserRoot = () => (SNAP_DIR && process.env.HERMES_ONE_TEST_BROWSER_ROOT) || hermesRoot()
  ipcMain.handle('browser:list', async () => (systems.active().kind === 'local' ? (await findBrowsers(browserRoot())).map((b) => b.profile) : null))
  ipcMain.handle('browser:watch', async (event, profile: string) => {
    watching?.stop(); watching = null
    if (systems.active().kind !== 'local') return { ok: false, error: 'remote' }
    const b = (await findBrowsers(browserRoot())).find((x) => x.profile === String(profile))
    if (!b) return { ok: false }
    const w: BrowserWatch = new BrowserWatch(b, (ev) => { if (watching === w && !event.sender.isDestroyed()) event.sender.send('browser:event', ev) })
    watching = w
    try { await w.start(); return { ok: true } } catch (error: any) { if (watching === w) watching = null; return { ok: false, error: String(error?.message ?? error) } }
  })
  ipcMain.handle('browser:act', (_event, action) => watching?.act(action))
  ipcMain.handle('browser:unwatch', () => { watching?.stop(); watching = null })
  // macOS asks once for the microphone (speaking instead of typing).
  // The Marketplace's public listing (stars, featured order). Only that site's /docs/api/ files, GET, no credentials.
  ipcMain.handle('hermes:fetch-public', async (_event, url: string) => {
    let u: URL
    try { u = new URL(url) } catch { return null }
    if (u.protocol !== 'https:' || u.hostname !== 'hermes-agent.nousresearch.com' || !u.pathname.startsWith('/docs/api/')) return null
    try { const r = await fetch(u, { signal: AbortSignal.timeout(10_000) }); return r.ok ? (await r.text()).slice(0, 8_000_000) : null } catch { return null }
  })
  ipcMain.handle('hermes:theme', (_event, choice?: ThemeChoice) => {
    if (choice === 'system' || choice === 'light' || choice === 'dark') {
      if (!process.env.HERMES_ONE_THEME) nativeTheme.themeSource = choice
      try { fs.writeFileSync(themeFile(), JSON.stringify({ theme: choice })) } catch { /* not critical */ }
    }
    return nativeTheme.themeSource
  })
  ipcMain.handle('hermes:scale', (_event, v?: number) => { if (typeof v === 'number' && v !== scale) setScale(v); return scale })
  ipcMain.handle('hermes:frosted', (_event, on?: boolean) => { if (typeof on === 'boolean' && on !== frosted) setFrosted(on); return frosted })
  ipcMain.handle('hermes:can-frost', () => CAN_FROST)
  ipcMain.handle('hermes:picture-pick', () => pickPicture())
  ipcMain.handle('hermes:picture-remove', () => { removePicture(); return true })
  ipcMain.handle('hermes:picture', () => { const f = pictureFile(); if (!f) return null; try { return { data: fs.readFileSync(f), mime: f.endsWith('.png') ? 'image/png' : 'image/jpeg' } } catch { return null } })
  ipcMain.handle('hermes:login-item', (_event, on?: boolean) => { if (typeof on === 'boolean') app.setLoginItemSettings({ openAtLogin: on }); return app.getLoginItemSettings().openAtLogin })
  ipcMain.handle('hermes:mic', () => (process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : true))
  // What needs you, on the Dock icon; and a notification when something new needs you while you're elsewhere.
  // Attachments are local paths: Hermes runs on this same Mac and reads the files itself.
  const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4' }
  const describe = (p: string) => ({ path: p, name: path.basename(p), mime: MIME[path.extname(p).slice(1).toLowerCase()] ?? 'application/octet-stream' })
  ipcMain.handle('hermes:pick-files', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'] })
    return r.canceled ? [] : r.filePaths.map(describe)
  })
  ipcMain.handle('hermes:describe-file', (_event, p: string) => describe(p))
  ipcMain.handle('hermes:save-pasted', (_event, base64: string, ext: string) => {
    const dir = path.join(app.getPath('userData'), 'pasted')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `paste-${Date.now()}.${ext.replace(/[^a-z0-9]/gi, '') || 'png'}`)
    fs.writeFileSync(file, Buffer.from(base64, 'base64'))
    return describe(file)
  })
  // Hermes admits pictures (png, jpeg, gif, webp) only from its own image folder: copy them there first.
  // For an agent's chat that's the agent's own profile folder (one of `<hermes>/profiles/<name>`).
  ipcMain.handle('hermes:stage-images', async (_event, files: { path: string; mime: string }[], agentHome?: string) => {
    if (remoteName()) throw new Error(`Pictures and files can’t go to ${remoteName()} yet: they’d have to be uploaded there. This works on ${IS_MAC ? 'This Mac' : 'This PC'}.`)
    const endpoint = await systems.conn().endpoint(false)
    let home = endpoint.profile_id
    if (agentHome) {
      const real = (p: string) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
      const root = real(endpoint.profile_id), want = real(agentHome)
      if (path.dirname(want) === path.join(root, 'profiles') && fs.existsSync(want)) home = want
    }
    const legacy = path.join(home, 'image_cache')
    let dir = path.join(home, 'cache', 'images')
    try { if (fs.readdirSync(legacy).length) dir = legacy } catch { /* no legacy folder */ }
    fs.mkdirSync(dir, { recursive: true })
    return files.map((f) => {
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }[f.mime] ?? path.extname(f.path)
      const dest = path.join(dir, `hermes-one-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`)
      fs.copyFileSync(f.path, dest)
      return { path: dest, mime: f.mime }
    })
  })
  ipcMain.handle('hermes:badge', (_event, count: number) => {
    if (IS_MAC) app.dock?.setBadge(count > 0 ? String(count) : '')
    else if (IS_WIN) win?.setOverlayIcon(count > 0 ? dotImage() : null, count > 0 ? `${count} waiting for you` : '')
    else app.setBadgeCount(Math.max(0, count))
  })
  ipcMain.handle('hermes:notify', (_event, title: string, body: string) => {
    if (win?.isFocused() || !Notification.isSupported()) return
    const n = new Notification({ title, body, silent: false })
    n.on('click', () => { win?.show(); win?.focus() })
    n.show()
  })
  // REST on the local gateway, the way Hermes Desktop calls it (electron/local-gateway.ts): each request
  // carries a one-use ticket minted for the profile the route names (`/api/profiles/<name>/…`, else
  // `?profile=`, else a JSON body's `profile`) and the grant that route needs.
  ipcMain.handle('hermes:rest', async (_event, method: string, pathname: string, body: unknown) => {
    const conn = systems.conn()
    const endpoint = await conn.endpoint(false)
    const url = new URL(pathname, endpoint.api_origin)
    const verb = method.toUpperCase()
    const { profile, purpose } = grantFor(url, verb, body)
    const home = await conn.profileHome(endpoint.profile_id, profile)
    const send = async () => fetch(url, {
      method: verb,
      headers: { ...(await conn.restAuth(purpose, home)), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Running a job now waits for the whole job, and starting web access can build for minutes.
      signal: AbortSignal.timeout(verb === 'GET' ? 60_000 : /\/api\/(cron\/jobs\/[^/]+\/trigger|webapp-access\/(start|restart)|hermes\/update|ops\/)/.test(url.pathname) ? 900_000 : 180_000),
    })
    const response = await send()
    const text = await response.text()
    let json: unknown = null
    try { json = JSON.parse(text) } catch { /* not JSON */ }
    return { ok: response.ok, status: response.status, json, text: json ? undefined : text.slice(0, 2000) }
  })
  // Files Hermes made or uses, opened in their own app (Finder for folders).
  ipcMain.handle('hermes:reveal', (_event, p: string) => { if (!remoteName() && typeof p === 'string' && path.isAbsolute(p)) shell.showItemInFolder(p) })
  ipcMain.handle('hermes:open-path', async (_event, p: string) => { if (remoteName()) return `That file is on ${remoteName()}, not here.`; if (typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p)) { const err = await shell.openPath(p); return err || null } return `That file isn’t on this ${IS_MAC ? 'Mac' : 'computer'} any more.` })
  ipcMain.handle('hermes:quick-send', (_event, text: string, open: boolean) => {
    quickWin?.hide()
    if (!win) createWindow()
    win?.webContents.send('hermes:quick-send', String(text ?? ''))
    if (open) { win?.show(); win?.focus() }
  })
  ipcMain.handle('hermes:quick-hide', () => quickWin?.hide())
  if (!SNAP_DIR) { try { globalShortcut.register('Alt+Space', toggleQuick) } catch { /* taken by another app */ } }
  app.on('will-quit', () => { globalShortcut.unregisterAll(); systems.close() })
  apps = registerApps(ipcMain, (channel, payload) => win?.webContents.send(channel, payload))
  createWindow()
  app.on('activate', () => { if (!win) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
