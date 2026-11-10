// JSON-RPC 2.0 over the local gateway's WebSocket (/api/ws), with a fresh one-use ticket per dial.
// Events arrive as {method:"event", params:{type, session_id, payload, seq}}; the server can also ask
// the client things (approval, clarify) as requests with an id, which we answer with a result.

declare global {
  interface Window {
    hermesNative: {
      endpoint: (refresh?: boolean) => Promise<{ api_origin: string; instance_id: string; profile_id: string }>
      ticket: (purpose?: string, profileHome?: string) => Promise<string>
      rest: (method: string, pathname: string, body?: unknown) => Promise<{ ok: boolean; status: number; json: any; text?: string }>
      reveal: (path: string) => Promise<void>
      apps: import('./apps').AppsBridge
      askMic?: () => Promise<boolean>
      openPath?: (path: string) => Promise<string | null>
      loginItem?: (on?: boolean) => Promise<boolean>
      theme?: (choice?: 'system' | 'light' | 'dark') => Promise<string>
      frosted?: (on?: boolean) => Promise<boolean>
      canFrost?: () => Promise<boolean>
      systems?: () => Promise<import('./systems').SystemRow[]>
      switchSystem?: (id: string) => Promise<boolean>
      addSystem?: (input: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
      signInSystem?: (id: string, password: string) => Promise<{ ok: boolean; error?: string }>
      removeSystem?: (id: string) => Promise<boolean>
      browserList?: () => Promise<string[] | null>
      browserWatch?: (profile: string) => Promise<{ ok: boolean; error?: string }>
      browserAct?: (action: Record<string, unknown>) => Promise<void>
      browserUnwatch?: () => Promise<void>
      onBrowserEvent?: (cb: (ev: any) => void) => () => void
      scale?: (v?: number) => Promise<number>
      onScale?: (cb: (v: number) => void) => () => void
      pickPicture?: () => Promise<{ ok: true } | { error: string } | null>
      removePicture?: () => Promise<boolean>
      picture?: () => Promise<{ data: Uint8Array; mime: string } | null>
      fetchPublic?: (url: string) => Promise<string | null>
      quickSend?: (text: string, open: boolean) => Promise<void>
      quickHide?: () => Promise<void>
      onQuickSend?: (cb: (text: string) => void) => () => void
      onQuickShown?: (cb: () => void) => () => void
      openExternal: (url: string) => Promise<void>
      badge: (count: number) => Promise<void>
      pickFiles: () => Promise<Attachment[]>
      stageImages: (files: { path: string; mime: string }[], profileHome?: string) => Promise<{ path: string; mime: string }[]>
      describeFile: (file: File) => Promise<Attachment>
      savePasted: (base64: string, ext: string) => Promise<Attachment>
      notify: (title: string, body: string) => Promise<void>
      platform: string
      testChiefSession?: string | null
      testSessions?: string | null
      snapshot?: boolean
    }
  }
}

export interface Attachment { path: string; name: string; mime: string }
export interface GatewayEvent { type: string; session_id?: string; payload?: any; seq?: number }
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
type ServerRequestHandler = (method: string, params: any, id: string | number) => void

export class Gateway {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<string | number, Pending>()
  private eventListeners = new Set<(e: GatewayEvent) => void>()
  private statusListeners = new Set<(s: 'connecting' | 'open' | 'closed' | 'error', detail?: string) => void>()
  private readyListeners = new Set<(payload: any) => void>()
  onServerRequest: ServerRequestHandler = () => {}
  private retry = 0
  private closedByUs = false
  private dialing = false
  private wake: ReturnType<typeof setTimeout> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private lastFrame = 0
  origin = ''
  home = ''

  onEvent(l: (e: GatewayEvent) => void) { this.eventListeners.add(l); return () => this.eventListeners.delete(l) }
  onStatus(l: (s: 'connecting' | 'open' | 'closed' | 'error', detail?: string) => void) { this.statusListeners.add(l); return () => this.statusListeners.delete(l) }
  onReady(l: (payload: any) => void) { this.readyListeners.add(l); return () => this.readyListeners.delete(l) }
  private status(s: 'connecting' | 'open' | 'closed' | 'error', detail?: string) { this.statusListeners.forEach((l) => l(s, detail)) }

  async connect(): Promise<void> {
    if (this.dialing) return
    this.dialing = true
    if (this.wake) { clearTimeout(this.wake); this.wake = null }
    this.closedByUs = false
    this.status('connecting')
    // Finding Hermes is instant when it runs; a slow answer means `ensure` is starting it again.
    // Much slower usually means macOS is asking whether Hermes One may open files on the drive Hermes is on.
    const slow = setTimeout(() => this.status('connecting', 'starting'), 2500)
    const slower = setTimeout(() => this.status('connecting', 'waiting'), 15_000)
    try {
      const endpoint = await window.hermesNative.endpoint(this.retry > 0).finally(() => { clearTimeout(slow); clearTimeout(slower) })
      this.origin = endpoint.api_origin
      this.home = endpoint.profile_id
      const ticket = await window.hermesNative.ticket('interactive')
      // Native dial (as Hermes Desktop does it): the one-use ticket travels as a subprotocol, never in the
      // URL, beside the public protocol name. Electron's main process drops the Origin header for this host.
      const ws = new WebSocket(`${endpoint.api_origin.replace(/^http/, 'ws')}/api/ws`, ['hermes-gateway-v1', `hermes-gateway-ticket.${ticket}`])
      this.ws = ws
      this.dialing = false
      ws.onopen = () => { this.retry = 0; this.lastFrame = Date.now(); this.startHeartbeat() }
      ws.onmessage = (m) => this.handle(m.data)
      ws.onerror = () => { /* onclose follows */ }
      ws.onclose = (ev) => {
        this.stopHeartbeat()
        this.failPending(new Error('Connection closed'))
        if (this.ws === ws) this.ws = null
        if (this.closedByUs) return
        // Hermes stopped or restarted (quitting Hermes Desktop stops the copy it started): look again
        // at once, which starts Hermes if it isn't running.
        this.status('connecting', 'lost')
        this.scheduleReconnect()
      }
    } catch (error: any) {
      this.dialing = false
      this.status('error', error?.message ?? String(error))
      this.scheduleReconnect()
    }
  }

  /** Tries again soon: 0.5 s, 1 s, 2 s, then every 3 s. Hermes One can't do anything without Hermes. */
  private scheduleReconnect() {
    const delay = Math.min(3000, 500 * 2 ** Math.min(this.retry, 3))
    this.retry++
    if (this.wake) clearTimeout(this.wake)
    this.wake = setTimeout(() => { this.wake = null; if (!this.closedByUs && !this.ws) void this.connect() }, delay)
  }

  /** "Try now", or the window coming back to the front: skip the wait. */
  retryNow() {
    if (this.closedByUs || this.ws || this.dialing) return
    this.retry = Math.max(this.retry, 1)
    void this.connect()
  }

  close() { this.closedByUs = true; this.ws?.close(); this.ws = null }
  get open() { return this.ws?.readyState === WebSocket.OPEN }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => {
      if (!this.open) return
      if (Date.now() - this.lastFrame > 45_000) { this.ws?.close(4000, 'heartbeat lost'); return }
      this.request('gateway.ping', {}, 10_000).catch(() => {})
    }, 15_000)
  }
  private stopHeartbeat() { if (this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = null }

  private failPending(error: Error) {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(error) }
    this.pending.clear()
  }

  private handle(data: unknown) {
    this.lastFrame = Date.now()
    let frame: any
    try { frame = JSON.parse(String(data)) } catch { return }
    if (frame.method === 'event') {
      const ev = frame.params as GatewayEvent
      if (ev?.type === 'gateway.ready') {
        this.status('open')
        this.readyListeners.forEach((l) => l(ev.payload))
      }
      this.eventListeners.forEach((l) => { try { l(ev) } catch (e) { console.error(e) } })
      return
    }
    if (frame.method && frame.id !== undefined) { this.onServerRequest(frame.method, frame.params, frame.id); return }
    if (frame.id !== undefined && this.pending.has(frame.id)) {
      const p = this.pending.get(frame.id)!
      this.pending.delete(frame.id); clearTimeout(p.timer)
      if (frame.error) p.reject(Object.assign(new Error(frame.error.message ?? 'Request failed'), { code: frame.error.code, data: frame.error.data }))
      else p.resolve(frame.result)
    }
  }

  // Hermes speaks two dialects: its gateway's (this Mac, or over SSH) and `hermes serve`'s (a VPS or another
  // computer reached by address, as Hermes Remote does), which lacks a few fields (request_id on session.create
  // is idempotency_key there; prompt.submit has no submission_id). Both refuse unknown fields by name, so a
  // refused field is dropped (or renamed) and the call sent again; what was dropped is remembered per method.
  private dropped = new Map<string, Set<string>>()
  async request<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    const adapt = (p: Record<string, unknown>) => {
      const drop = this.dropped.get(method)
      if (!drop?.size) return p
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(p)) {
        if (!drop.has(k)) out[k] = v
        else if (k === 'request_id' && method === 'session.create' && out.idempotency_key === undefined) out.idempotency_key = v
      }
      return out
    }
    try {
      return await this.send<T>(method, adapt(params), timeoutMs)
    } catch (error: any) {
      const text = String(error?.message ?? '')
      const fields = [...text.matchAll(/([A-Za-z_][\w]*): Extra inputs are not permitted/g)].map((m) => m[1]).filter((f) => f in params)
      if (!fields.length) throw error
      const drop = this.dropped.get(method) ?? new Set<string>()
      if (fields.every((f) => drop.has(f))) throw error
      fields.forEach((f) => drop.add(f))
      this.dropped.set(method, drop)
      return this.send<T>(method, adapt(params), timeoutMs)
    }
  }

  private send<T = any>(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.open) return reject(new Error('Not connected to Hermes'))
      const id = this.nextId++
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.ws!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  respond(id: string | number, result: unknown) { if (this.open) this.ws!.send(JSON.stringify({ jsonrpc: '2.0', id, result })) }
  respondError(id: string | number, code: number, message: string) { if (this.open) this.ws!.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })) }
}

export const gateway = new Gateway()
