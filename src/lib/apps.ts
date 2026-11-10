// Apps in the window: the typed bridge to the runtime (electron/apps.ts), the list of apps and which one
// is open, the window's own audio player (apps play sound here, even with the Apps page closed), and
// what apps ask for while nobody looks at them (play a song, a toast, a word to Chief).
import { useSyncExternalStore } from 'react'
import { toast } from './hermes'
import { setState } from './store'

export type Action = { do: string; [key: string]: any }
export interface Block { type?: string; [key: string]: any }
export interface Screen {
  title?: string
  subtitle?: string
  actions?: { icon?: string; label?: string; action?: Action }[]
  body: (Block | null | false | undefined)[]
  refresh?: number
  /** Use the window's whole width (a screen with a web page that fills it is wide anyway). */
  wide?: boolean
}
/** A screen is wide when it says so, or when its page is a web block that fills the screen. */
export const isWide = (screen?: Screen) => !!screen && (screen.wide === true || (screen.body ?? []).some((b) => !!b && b.type === 'web' && (b as any).height === 'fill'))
export interface ToolInfo { name: string; description: string; parameters: Record<string, unknown> }
export interface AppSummary {
  id: string; name: string; icon: string; color: string; description: string; abilities: string[]; background: boolean
  version: number; versions: number[]; rev: number; tools: ToolInfo[]; screens: string[]; bot?: string; publishedAt?: number; running: boolean
}
export interface ScreenReply { app: string; rev: number; same?: boolean; screen?: Screen }
export interface ActReply { app: string; rev: number; result: unknown; screen?: Screen }
export interface AppInfo {
  app: string; version: number; source: string; dataDir: string; versionDir: string; callbackUrl?: string
  versions: { version: number; bot?: string; publishedAt?: number }[]
}
export interface Note { title?: string; text?: string; at?: number; id?: string; cancel?: boolean }
export type AppsEvent =
  | { kind: 'list' }
  | { kind: 'changed'; app: string; rev: number }
  | { kind: 'effect'; app: string; action: Action | Action[] }
  | { kind: 'chat'; app: string; name: string; bot: string; text: string }
  | { kind: 'open'; app: string }
  | { kind: 'published'; app: string; name: string; version: number; bot?: string }

/** window.hermesNative.apps (electron/apps-preload.ts). */
export interface AppsBridge {
  list(): Promise<AppSummary[]>
  screen(app: string, screen?: string, params?: unknown, rev?: number): Promise<ScreenReply>
  act(app: string, action: string, args?: unknown, screen?: string, params?: unknown): Promise<ActReply>
  state(app: string): Promise<{ app: string; rev: number; state: any }>
  undo(app: string): Promise<{ app: string; version: number }>
  remove(app: string): Promise<{ app: string; removed: true }>
  logs(app: string): Promise<string>
  info(app: string): Promise<AppInfo>
  notify(app: string, note: Note): Promise<void>
  feed(feed: unknown): Promise<void>
  reveal(app: string, what?: 'source' | 'data' | 'version'): Promise<void>
  upload(app: string, file: File, opts: { action: string; args?: unknown; screen?: string; params?: unknown }): Promise<ActReply>
  onEvent(fn: (event: AppsEvent) => void): () => void
}

export const appsApi = (): AppsBridge => window.hermesNative.apps as AppsBridge

// ---------- a tiny store (the same shape as lib/store) ----------
function store<T>(initial: T) {
  let value = initial
  const subs = new Set<() => void>()
  return {
    get: () => value,
    set(next: Partial<T> | ((v: T) => Partial<T>)) {
      const patch = typeof next === 'function' ? (next as (v: T) => Partial<T>)(value) : next
      value = { ...value, ...patch }
      subs.forEach((fn) => fn())
    },
    subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn) } },
  }
}

export interface AppsState {
  list: AppSummary[] | null
  error?: string
  open: string | null
  /** A screen an app asked to show (from a notification or its own perform), taken once by the open view. */
  goto?: { app: string; screen: string; params: unknown; n: number }
  /** Apps published since Hermes One started (by any bot), newest last: for chat cards of teammates' work. */
  published: Published[]
}
export interface Published { app: string; name: string; version: number; bot?: string; at: number }
const apps = store<AppsState>({ list: null, open: null, published: [] })
export function useApps<T>(select: (s: AppsState) => T): T {
  return useSyncExternalStore(apps.subscribe, () => select(apps.get()), () => select(apps.get()))
}
export const getApps = apps.get
/** Apps published since launch, newest last (each with the bot profile that published it and when). */
export function useRecentPublishes(): Published[] { return useSyncExternalStore(apps.subscribe, () => apps.get().published, () => apps.get().published) }

let loading: Promise<void> | null = null
export function refreshApps(): Promise<void> {
  loading ??= appsApi().list()
    .then((list) => apps.set({ list, error: undefined }), (error: Error) => apps.set((s) => ({ list: s.list ?? [], error: error.message })))
    .finally(() => { loading = null })
  return loading
}

/** Open an app on the Apps page (from its tile, a chat card, a notification). */
export function openApp(id: string, screen?: string, params?: unknown) {
  apps.set((s) => ({ open: id, goto: screen ? { app: id, screen, params: params ?? {}, n: (s.goto?.n ?? 0) + 1 } : undefined }))
  setState({ view: 'apps' })
}
export function closeApp() { apps.set({ open: null, goto: undefined }) }
/** The open view took the requested screen. */
export function takeGoto() { apps.set({ goto: undefined }) }

// ---------- events from the runtime ----------
const listeners = new Set<(event: AppsEvent) => void>()
export function onAppsEvent(fn: (event: AppsEvent) => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

const nameOf = (id: string) => apps.get().list?.find((a) => a.id === id)?.name ?? id

/** Ask Chief something on an app's behalf (there is one chat; other bots are reached through Chief). */
export function chatFromApp(appName: string, bot: string | undefined, text: string, show: boolean) {
  const target = String(bot ?? '').trim().replace(/^@/, '')
  const forBot = target && !/^(chief|default|hermes)$/i.test(target) ? `For ${target}: ` : ''
  window.dispatchEvent(new CustomEvent('hermes:send', { detail: `[From the ${appName} app]\n${forBot}${text}` }))
  if (show) setState({ view: 'chat' })
}

/** What an app asked for outside an open screen (or a screen action that needs no screen). */
export function runAnywhere(appId: string, action: Action | Action[] | null | undefined) {
  for (const a of Array.isArray(action) ? action : action ? [action] : []) {
    if (!a || typeof a !== 'object') continue
    switch (a.do) {
      case 'play': player.play(a.queue, a.index ?? 0, appId); break
      case 'audio': player.control(a.op ?? 'toggle'); break
      case 'toast': if (a.text) toast(String(a.text)); break
      case 'link': if (/^https?:\/\//i.test(String(a.url ?? ''))) void window.hermesNative.openExternal(String(a.url)); break
      case 'copy': case 'share': void navigator.clipboard?.writeText(String(a.text ?? '')).then(() => toast('Copied'), () => toast('Couldn’t copy that')); break
      case 'notify': void appsApi().notify(appId, { title: a.title, text: a.text, at: a.at, id: a.id, cancel: a.cancel }).catch(() => {}); break
      case 'chat': if (a.text) chatFromApp(nameOf(appId), a.bot, String(a.text), true); break
      case 'open': openApp(appId, a.screen ?? 'home', a.params); break
      default: break
    }
  }
}

let wired = false
function wire() {
  if (wired || !window.hermesNative?.apps) return
  wired = true
  appsApi().onEvent((event) => {
    if (event.kind === 'list') void refreshApps()
    else if (event.kind === 'effect') runAnywhere(event.app, event.action)
    else if (event.kind === 'chat') chatFromApp(event.name, event.bot, event.text, false)
    else if (event.kind === 'open') openApp(event.app)
    else if (event.kind === 'published') apps.set((s) => ({ published: [...s.published, { app: event.app, name: event.name, version: event.version, bot: event.bot, at: Date.now() }].slice(-50) }))
    listeners.forEach((fn) => { try { fn(event) } catch (error) { console.error(error) } })
  })
}
try { wire() } catch (error) { console.warn('[apps] events unavailable', error) }

// ---------- the window's audio player ----------
export interface Track { url: string; title?: string; artist?: string; art?: string; live?: boolean }
export interface PlayerState { queue: Track[]; index: number; playing: boolean; loading: boolean; app: string | null }

function createPlayer() {
  const audio = typeof Audio === 'undefined' ? null : new Audio()
  if (audio) audio.preload = 'auto'
  const state = store<PlayerState>({ queue: [], index: 0, playing: false, loading: false, app: null })
  const describe = () => {
    const track = state.get().queue[state.get().index]
    if (!('mediaSession' in navigator) || !track) return
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: track.title ?? '', artist: track.artist ?? '', artwork: track.art ? [{ src: track.art, sizes: '512x512' }] : [] }) } catch { /* not here */ }
  }
  const load = (index: number) => {
    const track = state.get().queue[index]
    if (!track || !audio) return
    state.set({ index, loading: true })
    audio.src = track.url
    describe()
    void audio.play().catch(() => state.set({ playing: false, loading: false }))
  }
  if (audio) {
    audio.addEventListener('playing', () => state.set({ playing: true, loading: false }))
    audio.addEventListener('pause', () => state.set({ playing: false }))
    audio.addEventListener('waiting', () => state.set({ loading: true }))
    audio.addEventListener('error', () => { state.set({ playing: false, loading: false }); if (state.get().queue.length) toast('That couldn’t play') })
    audio.addEventListener('ended', () => {
      const { index, queue } = state.get()
      if (index + 1 < queue.length) load(index + 1)
      else state.set({ playing: false })
    })
  }
  const control = (op: string) => {
    if (!audio) return
    const { index, queue } = state.get()
    if (op === 'pause') audio.pause()
    else if (op === 'resume' || op === 'play') void audio.play().catch(() => {})
    else if (op === 'toggle') { if (audio.paused) void audio.play().catch(() => {}); else audio.pause() }
    else if (op === 'next') { if (index + 1 < queue.length) load(index + 1) }
    else if (op === 'previous') { if (audio.currentTime > 3 || index === 0) audio.currentTime = 0; else load(index - 1) }
    else if (op === 'stop') { audio.pause(); audio.removeAttribute('src'); state.set({ queue: [], index: 0, playing: false, loading: false, app: null }) }
  }
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    const on = (name: MediaSessionAction, op: string) => { try { navigator.mediaSession.setActionHandler(name, () => control(op)) } catch { /* not here */ } }
    on('play', 'resume'); on('pause', 'pause'); on('nexttrack', 'next'); on('previoustrack', 'previous')
  }
  return {
    audio,
    get: state.get,
    subscribe: state.subscribe,
    play(queue: Track[] | undefined, index = 0, app: string | null = null) {
      const tracks = (queue ?? []).filter((t) => t && typeof t.url === 'string' && t.url)
      if (!tracks.length) return
      state.set({ queue: tracks, app })
      load(Math.max(0, Math.min(Number(index) || 0, tracks.length - 1)))
    },
    control,
  }
}
export const player = createPlayer()
export function usePlayer(): PlayerState { return useSyncExternalStore(player.subscribe, player.get, player.get) }

// ---------- small words ----------
export function ago(ms?: number): string {
  if (!ms) return ''
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 172800) return 'yesterday'
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** What an app can do, in plain words, for its tile. */
export function abilityWords(app: AppSummary): string[] {
  const words: Record<string, string> = { audio: 'Plays audio', web: 'Has a web page', notify: 'Sends reminders', signin: 'Signs in to a service', photos: 'Uses photos', camera: 'Uses photos', files: 'Uses files', location: 'Uses your location', agents: 'Sees what your agents are doing' }
  const out = [...new Set(app.abilities.map((a) => words[a]).filter(Boolean))]
  if (app.background) out.unshift('Works on its own')
  return out
}
