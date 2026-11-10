// Hermes One's own preferences, kept on this Mac (localStorage). Read anywhere with getPrefs(); the
// document's data attributes and variables carry the visual ones so CSS can follow (text size, calm motion,
// the frosted window, the chat background, the accent colour, the tint, the workspace shape).
export interface Prefs {
  notify: boolean; badge: boolean; notifyDone: boolean; motion: 'full' | 'calm'; textSize: 'small' | 'normal' | 'large'; sendKey: 'enter' | 'cmd-enter'
  /** The window lets the desktop glow through the chat and the pages, blurred (the sidebar stays solid). */
  frosted: boolean
  /** How much of the frosted desktop shows through, 0 (barely) to 100 (a lot). Subtle is 17. */
  frost: number
  /** A chat background picture is kept on this Mac (the main process holds the file). */
  hasPicture: boolean
  /** Behind every chat, or only chats that are still empty. */
  showOn: 'every' | 'empty'
  /** How much of the picture shows at the top: in an empty chat, and once there are messages (0–100). */
  strengthEmpty: number; strengthBusy: number
  /** How strongly it fades to the app's colour toward the message box (0 none, 100 solid from halfway), and its blur. */
  fade: number; blur: number
  /** 'mono' (black and white) or a colour for the send button, your messages and what's selected. */
  accent: string
  /** A hue that tints the greys (null keeps them neutral), and how strongly (0–100; 60 is about 18% saturation). */
  tint: number | null; tintStrength: number
  /** The workspace full height, or a rounded card inside the window. */
  shape: 'full' | 'rounded'
  /** Interface scale in percent (the window's zoom; the main process keeps it). */
  scale: number
  /** How the Made page lays out files: picture tiles, or full-width rows. */
  madeView: 'grid' | 'list'
}
const DEFAULTS: Prefs = {
  notify: true, badge: true, notifyDone: false, motion: 'full', textSize: 'normal', sendKey: 'enter',
  frosted: false, frost: 17, hasPicture: false, showOn: 'every', strengthEmpty: 55, strengthBusy: 25, fade: 65, blur: 30,
  accent: 'mono', tint: null, tintStrength: 60, shape: 'full', scale: 100, madeView: 'grid',
}
export const ACCENTS = ['mono', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#14b8a6']
export const TINTS: { hue: number | null; name: string }[] = [
  { hue: null, name: 'Neutral' }, { hue: 210, name: 'Glacier' }, { hue: 190, name: 'Ocean' }, { hue: 150, name: 'Forest' },
  { hue: 270, name: 'Plum' }, { hue: 340, name: 'Rose' }, { hue: 35, name: 'Sand' },
]
export const SCALES = [80, 90, 100, 110, 125, 150]
const KEY = 'hermes-one.prefs'
let cache: Prefs | null = null

export function getPrefs(): Prefs {
  if (cache) return cache
  let raw: any = {}
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}') } catch { /* defaults */ }
  // Earlier versions kept one choice, workspace: none / frosted (or desktop) / picture.
  if (raw.frosted === undefined && (raw.workspace === 'frosted' || raw.workspace === 'desktop')) raw.frosted = true
  delete raw.workspace; delete raw.window; delete raw.sideFrost; delete raw.dim
  cache = { ...DEFAULTS, ...raw }
  return cache!
}
export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  cache = { ...getPrefs(), [k]: v }
  try { localStorage.setItem(KEY, JSON.stringify(cache)) } catch { /* private mode: keep for this run */ }
  applyPrefs()
}

const clamp = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0))
/** How solid the workspace tint is (percent of the app's colour) at a frost level: Subtle 86, Strong 52. */
export const frostTint = (frost: number) => Math.round(94 - clamp(frost) * 0.48)

export function applyPrefs() {
  const p = getPrefs()
  const root = document.documentElement
  root.dataset.text = p.textSize
  root.dataset.motion = p.motion
  applyTint(p.tint, p.tintStrength)
  root.dataset.accent = p.accent === 'mono' ? 'mono' : 'color'
  root.style.setProperty('--accent', p.accent === 'mono' ? 'var(--text-primary)' : p.accent)
  // The quick-entry bar has its own frost; the window's look is the main window's.
  if (new URLSearchParams(location.search).get('quick') === '1') return
  root.dataset.frosted = p.frosted ? 'on' : 'off'
  root.dataset.picture = p.hasPicture ? 'on' : 'off'
  root.dataset.bgShow = p.showOn
  root.dataset.shape = p.shape
  root.style.setProperty('--frost-ws', `${frostTint(p.frost)}%`)
  root.style.setProperty('--bg-fade-empty', pictureFade(p.strengthEmpty, p.fade))
  root.style.setProperty('--bg-fade-busy', pictureFade(p.strengthBusy, p.fade))
  root.style.setProperty('--bg-veil-empty', `color-mix(in srgb, var(--bg-app) ${100 - clamp(p.strengthEmpty)}%, transparent)`)
  root.style.setProperty('--bg-blur', `${Math.round(clamp(p.blur) * 0.4)}px`)
}

/** The veil over the picture, top to bottom: at the top it lets `strength`% of the picture through, then eases
 *  (smoothstep, so there's no visible band) toward the app's own colour at the bottom. Fade sets how far: none
 *  (the same all the way down), solid by the bottom, or solid from about halfway down. Light mode fades to light. */
export function pictureFade(strength: number, fade: number) {
  const top = 100 - clamp(strength)
  const f = clamp(fade) / 100
  const bottom = top + (100 - top) * Math.min(1, f / 0.4)
  const end = 1.05 - 0.6 * f
  const ease = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t) }
  const stops = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((t) => {
    const a = top + (bottom - top) * ease(t / end)
    return `color-mix(in srgb, var(--bg-app) ${a.toFixed(1)}%, transparent) ${Math.round(t * 100)}%`
  })
  return `linear-gradient(to bottom, ${stops.join(', ')})`
}

/** Tints the app's greys with a hue, keeping each grey's lightness (so contrast stays the same). Text greys stay
 *  neutral. Light mode gets a little more saturation, as pale tints read weaker. */
function applyTint(hue: number | null, strength: number) {
  let el = document.getElementById('hermes-tint') as HTMLStyleElement | null
  if (hue === null) { el?.remove(); return }
  if (!el) { el = document.createElement('style'); el.id = 'hermes-tint'; document.head.appendChild(el) }
  const s = (clamp(strength) / 100) * 30
  const dark: [string, number, number][] = [['950', 8.6, 1.1], ['925', 10.2, 1], ['900', 12.2, 0.9], ['875', 14.1, 0.8], ['850', 16.1, 0.72], ['800', 20, 0.66]]
  const light: [string, number, number][] = [['950', 93.7, 1], ['925', 96.9, 1.1], ['900', 99.6, 1.2], ['875', 90.2, 0.9], ['850', 92.2, 0.95], ['800', 83.1, 0.8]]
  const vars = (rows: [string, number, number][], k: number) => rows.map(([n, l, m]) => `--gray-${n}: hsl(${hue} ${(s * m * k).toFixed(1)}% ${l}%);`).join(' ')
  el.textContent = `:root { ${vars(dark, 1)} }\n@media (prefers-color-scheme: light) { :root { ${vars(light, 1.4)} } }`
}
