// The agent's Chrome on this computer, for the side panel's Browser. Hermes browses with a real Chrome it starts
// itself (headless unless browser.headed is on, so it has no window), one per agent, with a DevTools port
// (`--remote-debugging-port=0`, written to DevToolsActivePort in its profile folder). Hermes One finds that
// Chrome, lists its tabs, streams the tab's picture (Page.startScreencast) and, when you take over, sends
// your clicks and keys to it. It only ever talks to 127.0.0.1, and only to Chromes whose profile folder lies in
// one of this computer's Hermes homes. Nothing here starts, steers or stops the agent itself.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface AgentBrowser { profile: string; port: number; wsPath: string; dir: string }
export interface Tab { id: string; title: string; url: string; agent: boolean }
export type BrowserEvent =
  | { kind: 'tabs'; tabs: Tab[]; current: string | null; follow: boolean }
  | { kind: 'frame'; data: string; width: number; height: number; tab: string }
  | { kind: 'nav'; tab: string; url: string; canBack: boolean; canForward: boolean }
  | { kind: 'gone'; reason: string }

const real = (p: string) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }

/** Every Hermes home on this computer: the main one (Hermes, "default") and each agent's. */
export function hermesHomes(root: string): { profile: string; home: string }[] {
  const out = [{ profile: 'default', home: real(root) }]
  try {
    for (const name of fs.readdirSync(path.join(root, 'profiles'))) {
      const home = path.join(root, 'profiles', name)
      try { if (fs.statSync(home).isDirectory()) out.push({ profile: name, home: real(home) }) } catch { /* not a folder */ }
    }
  } catch { /* no agents yet */ }
  return out
}

/** Profile folders of the Chromes running with a DevTools port (main processes only, not their helpers). */
function debugChromeDirs(): Promise<string[]> {
  if (process.platform === 'win32') return Promise.resolve([]) // not on Windows yet
  return new Promise((resolve) => {
    execFile('ps', ['-ax', '-o', 'command='], { maxBuffer: 16 * 1024 * 1024, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve([])
      const dirs = new Set<string>()
      for (const line of String(stdout).split('\n')) {
        if (!line.includes('--remote-debugging-port') || !line.includes('--user-data-dir=') || / --type=/.test(line)) continue
        // ps doesn't quote arguments; a folder name can hold spaces, so it runs up to the next " --flag".
        const rest = line.split('--user-data-dir=')[1] ?? ''
        const dir = rest.split(/\s+--[a-z]/)[0].trim().replace(/^["']|["']$/g, '')
        if (dir) dirs.add(dir)
      }
      resolve([...dirs])
    })
  })
}

async function answers(port: number, wsPath: string): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return false
    const j: any = await r.json()
    return !wsPath || String(j.webSocketDebuggerUrl ?? '').endsWith(wsPath)
  } catch { return false }
}

/** The agents' Chromes running now, each matched to the agent whose Hermes home holds its profile folder. */
export async function findBrowsers(root: string): Promise<AgentBrowser[]> {
  const homes = hermesHomes(root).sort((a, b) => b.home.length - a.home.length) // an agent's home sits inside the main one
  const found: AgentBrowser[] = []
  for (const raw of await debugChromeDirs()) {
    const dir = real(raw)
    const owner = homes.find((h) => dir === h.home || dir.startsWith(h.home + path.sep))
    if (!owner) continue
    let port = 0, wsPath = ''
    try { const [p, w] = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n'); port = Number(p); wsPath = (w ?? '').trim() } catch { continue }
    if (!port || !(await answers(port, wsPath))) continue
    found.push({ profile: owner.profile, port, wsPath, dir })
  }
  return found
}

/** A small Chrome DevTools Protocol client over the browser's own WebSocket (sessions flattened). */
class Cdp {
  private id = 0
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  onEvent: (method: string, params: any, sessionId?: string) => void = () => {}
  onClose: () => void = () => {}
  private constructor(private ws: WebSocket) {
    ws.onmessage = (m) => {
      let msg: any
      try { msg = JSON.parse(String(m.data)) } catch { return }
      if (typeof msg.id === 'number') {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message ?? 'DevTools error')); else p.resolve(msg.result)
      } else if (msg.method) this.onEvent(msg.method, msg.params ?? {}, msg.sessionId)
    }
    ws.onclose = () => { for (const p of this.pending.values()) p.reject(new Error('closed')); this.pending.clear(); this.onClose() }
  }
  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      const t = setTimeout(() => { try { ws.close() } catch { /* never opened */ } reject(new Error('The browser didn’t answer')) }, 5000)
      ws.onopen = () => { clearTimeout(t); resolve(new Cdp(ws)) }
      ws.onerror = () => { clearTimeout(t); reject(new Error('The browser didn’t answer')) }
    })
  }
  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) return reject(new Error('closed'))
      const id = ++this.id
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
  close() { try { this.ws.close() } catch { /* already closed */ } }
}

const KEYS: Record<string, [number, string?]> = {
  Enter: [13, '\r'], Backspace: [8], Tab: [9], Escape: [27], Delete: [46], Home: [36], End: [35], PageUp: [33], PageDown: [34],
  ArrowLeft: [37], ArrowUp: [38], ArrowRight: [39], ArrowDown: [40], ' ': [32, ' '],
}

/** Watching one agent's Chrome: its tabs, the picture of the tab on view, and your input when you take over. */
export class BrowserWatch {
  private cdp: Cdp | null = null
  private infos = new Map<string, { id: string; title: string; url: string; attached: boolean; type: string }>()
  private agentTabs = new Set<string>()
  private session: string | null = null
  private current: string | null = null
  private follow = true
  private frame = { w: 0, h: 0 }
  private fitTo: { w: number; h: number } | null = null
  private closed = false

  constructor(readonly browser: AgentBrowser, private send: (e: BrowserEvent) => void) {}

  async start() {
    const cdp = await Cdp.connect(`ws://127.0.0.1:${this.browser.port}${this.browser.wsPath}`)
    this.cdp = cdp
    cdp.onClose = () => { if (!this.closed) this.send({ kind: 'gone', reason: 'The agent’s browser closed.' }) }
    cdp.onEvent = (m, p, s) => this.event(m, p, s)
    await cdp.send('Target.setDiscoverTargets', { discover: true })
    const { targetInfos } = await cdp.send<any>('Target.getTargets')
    for (const t of targetInfos ?? []) this.info(t, true)
    const first = this.pickAgentTab() ?? this.pages()[0]?.id ?? null
    this.pushTabs()
    if (first) await this.view(first)
  }

  stop() { this.closed = true; this.cdp?.close(); this.cdp = null }

  private pages() { return [...this.infos.values()].filter((t) => t.type === 'page' && !t.url.startsWith('devtools://')) }
  private pickAgentTab() { const ids = this.pages().filter((t) => this.agentTabs.has(t.id)).map((t) => t.id); return ids[ids.length - 1] }

  private info(t: any, initial = false) {
    const id = String(t.targetId)
    const prev = this.infos.get(id)
    this.infos.set(id, { id, title: String(t.title ?? ''), url: String(t.url ?? ''), attached: !!t.attached, type: String(t.type ?? '') })
    // Someone else attached to a tab we aren't on: that's the agent working in it.
    if (t.attached && (initial || !prev?.attached) && id !== this.current) this.agentTabs.add(id)
    else if (!t.attached) this.agentTabs.delete(id)
  }

  private pushTabs() {
    this.send({ kind: 'tabs', current: this.current, follow: this.follow, tabs: this.pages().map((t) => ({ id: t.id, title: t.title || t.url, url: t.url, agent: this.agentTabs.has(t.id) })) })
  }

  private event(method: string, p: any, sessionId?: string) {
    if (method === 'Target.targetCreated' || method === 'Target.targetInfoChanged') {
      const wasAgent = this.agentTabs.has(String(p.targetInfo?.targetId))
      this.info(p.targetInfo)
      const id = String(p.targetInfo?.targetId)
      if (id === this.current) void this.navState()
      // Nothing on view (the last tab was closed): show the next page that opens.
      else if (!this.current && this.pages().some((t) => t.id === id)) void this.view(id)
      // Follow the agent to a tab it just started working in.
      if (this.follow && !wasAgent && this.agentTabs.has(id) && id !== this.current) void this.view(id)
      this.pushTabs()
    } else if (method === 'Target.targetDestroyed') {
      const id = String(p.targetId)
      this.infos.delete(id); this.agentTabs.delete(id)
      if (id === this.current) { this.current = null; this.session = null; const next = this.pickAgentTab() ?? this.pages()[0]?.id; if (next) void this.view(next) }
      this.pushTabs()
    } else if (method === 'Page.screencastFrame' && sessionId === this.session) {
      void this.cdp?.send('Page.screencastFrameAck', { sessionId: p.sessionId }, sessionId).catch(() => {})
      this.frame = { w: Number(p.metadata?.deviceWidth) || this.frame.w, h: Number(p.metadata?.deviceHeight) || this.frame.h }
      if (this.current) this.send({ kind: 'frame', data: String(p.data), width: this.frame.w, height: this.frame.h, tab: this.current })
    } else if (method === 'Page.frameNavigated' && sessionId === this.session && !p.frame?.parentId) void this.navState()
  }

  /** Show a tab: attach to it and stream its picture. */
  async view(id: string) {
    const cdp = this.cdp
    if (!cdp) return
    const old = this.session
    this.current = id
    this.session = null
    if (old) { void cdp.send('Page.stopScreencast', {}, old).catch(() => {}); void cdp.send('Target.detachFromTarget', { sessionId: old }).catch(() => {}) }
    this.pushTabs()
    try {
      const { sessionId } = await cdp.send<any>('Target.attachToTarget', { targetId: id, flatten: true })
      if (this.current !== id) { void cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {}); return }
      this.session = sessionId
      await cdp.send('Page.enable', {}, sessionId)
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1920, maxHeight: 1600, everyNthFrame: 1 }, sessionId)
      await this.navState()
      await this.fit()
    } catch { /* the tab went away meanwhile */ }
  }

  /** Hermes starts the agent's Chrome headless at its default 800 × 600, so sites show their tablet or phone
   *  layout and the picture fills only the top of a tall panel. Give its window a desktop width (at least
   *  1100 px) in the panel's shape: the page then lays out as on a computer and fills the panel. The agent
   *  keeps that size; it's only changed when the panel's shape really changes. */
  private async fit() {
    const cdp = this.cdp, tab = this.current, s = this.session, want = this.fitTo
    if (!cdp || !tab || !s || !want || want.w < 50 || want.h < 50) return
    const width = Math.round(Math.min(1920, Math.max(1100, want.w * 1.3)))
    const height = Math.round(Math.min(2400, Math.max(600, (width * want.h) / want.w)))
    try {
      const m = await cdp.send<any>('Page.getLayoutMetrics', {}, s)
      const vw = Number(m.cssLayoutViewport?.clientWidth) || 0, vh = Number(m.cssLayoutViewport?.clientHeight) || 0
      if (Math.abs(vw - width) < 24 && Math.abs(vh - height) < 24) return
      const { windowId, bounds } = await cdp.send<any>('Browser.getWindowForTarget', { targetId: tab })
      if (bounds?.windowState && bounds.windowState !== 'normal') return // minimised or full screen: leave it
      // The window is a little bigger than the page (the toolbar Chrome keeps even when headless).
      const extraW = Math.max(0, (Number(bounds?.width) || vw) - vw), extraH = Math.max(0, (Number(bounds?.height) || vh) - vh)
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: width + extraW, height: height + extraH } })
    } catch { /* an older Chrome, or the tab went away */ }
  }

  private async navState() {
    const cdp = this.cdp, s = this.session, tab = this.current
    if (!cdp || !s || !tab) return
    try {
      const h = await cdp.send<any>('Page.getNavigationHistory', {}, s)
      const entry = h.entries?.[h.currentIndex]
      this.send({ kind: 'nav', tab, url: String(entry?.url ?? this.infos.get(tab)?.url ?? ''), canBack: h.currentIndex > 0, canForward: h.currentIndex < (h.entries?.length ?? 0) - 1 })
    } catch { /* gone */ }
  }

  async act(a: any) {
    const cdp = this.cdp
    if (!cdp) return
    const s = this.session
    switch (a?.type) {
      case 'select': this.follow = !!this.agentTabs.has(String(a.tab)) || !!a.follow; await this.view(String(a.tab)); return
      case 'close': await cdp.send('Target.closeTarget', { targetId: String(a.tab) }).catch(() => {}); return
      case 'fit': this.fitTo = { w: Number(a.width) || 0, h: Number(a.height) || 0 }; await this.fit(); return
      case 'follow': { this.follow = true; const t = this.pickAgentTab(); if (t && t !== this.current) await this.view(t); else this.pushTabs(); return }
    }
    if (!s) return
    switch (a.type) {
      case 'navigate': {
        let url = String(a.url ?? '').trim()
        if (!url) return
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = /\s/.test(url) || !/\./.test(url) ? `https://www.google.com/search?q=${encodeURIComponent(url)}` : `https://${url}`
        if (!/^https?:/i.test(url)) return // only web pages from the address bar
        await cdp.send('Page.navigate', { url }, s).catch(() => {})
        return
      }
      case 'back': case 'forward': {
        const h = await cdp.send<any>('Page.getNavigationHistory', {}, s).catch(() => null)
        const e = h?.entries?.[h.currentIndex + (a.type === 'back' ? -1 : 1)]
        if (e) await cdp.send('Page.navigateToHistoryEntry', { entryId: e.id }, s).catch(() => {})
        return
      }
      case 'reload': await cdp.send('Page.reload', {}, s).catch(() => {}); return
      case 'mouse': {
        const x = Math.round(Number(a.x) * this.frame.w), y = Math.round(Number(a.y) * this.frame.h)
        await cdp.send('Input.dispatchMouseEvent', {
          type: a.action, x, y, modifiers: a.modifiers ?? 0,
          ...(a.action === 'mouseWheel' ? { deltaX: Number(a.deltaX) || 0, deltaY: Number(a.deltaY) || 0 } : { button: a.button ?? 'none', clickCount: a.clickCount ?? 0 }),
        }, s).catch(() => {})
        return
      }
      case 'key': {
        const key = String(a.key ?? '')
        const [code, text] = KEYS[key] ?? (key.length === 1 ? [key.toUpperCase().charCodeAt(0), key] : [0])
        const typed = a.action === 'keyDown' && text && !(a.modifiers & (2 | 4)) // not with ctrl or cmd
        await cdp.send('Input.dispatchKeyEvent', {
          type: a.action === 'keyUp' ? 'keyUp' : typed ? 'keyDown' : 'rawKeyDown', key, code: a.code ?? '', modifiers: a.modifiers ?? 0,
          windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, ...(typed ? { text, unmodifiedText: text } : {}),
        }, s).catch(() => {})
        return
      }
      case 'text': await cdp.send('Input.insertText', { text: String(a.text ?? '') }, s).catch(() => {}); return
    }
  }
}
