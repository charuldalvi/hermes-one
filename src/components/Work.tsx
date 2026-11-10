// The work view in the side panel, beside the chat: what an agent is doing on its computer, live.
// - Browser (Hermes on this computer): the agent's own Chrome, as a small browser: its tabs (closable), an address
//   bar, the page; Take over sends your clicks and keys to it (electron/browser.ts).
// - Screen (a system whose Hermes has an agent screen, like a Linux VPS): its desktop (Screen.tsx).
// - Terminal: one tab per command the agent runs, its output live (lib/terminals.ts).
// It opens by itself when the agent in the chat you're looking at starts browsing or runs a long command, and
// stays shut for the rest of that turn once you close it. The panel keys are browser:, screen: and term:<profile>.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { gateway } from '../lib/gateway'
import { prettyName, sessionProfile, toast } from '../lib/hermes'
import { Icon } from '../lib/icons'
import { elapsed } from '../lib/markdown'
import { chatOf, getState, setState, useStore } from '../lib/store'
import { currentSystem } from '../lib/systems'
import { IS_WIN } from '../lib/platform'
import { backfill, closeTerm, onOutput, onTermStart, outputOf, stopTerm, useTerms, type Term } from '../lib/terminals'
import { BotFace } from './BotFace'
import { ScreenView } from './Screen'
import { Select, Spinner, Tabs } from './ui'

export type WorkKind = 'browser' | 'screen' | 'term'
export const workKey = (kind: WorkKind, profile: string) => `${kind}:${profile}`
export const isWorkKey = (key?: string | null): key is string => !!key && /^(browser|screen|term):/.test(key)
export function parseWorkKey(key: string): { kind: WorkKind; profile: string } {
  const i = key.indexOf(':')
  return { kind: key.slice(0, i) as WorkKind, profile: key.slice(i + 1) }
}
/** The first tab: the agent screen where the system has one, else the agent's Chrome on this computer, else none. */
export function lookKind(): 'screen' | 'browser' | null {
  if (getState().screenSupported) return 'screen'
  // The agents' Chrome is found on this Mac (or Linux); not on Windows yet.
  return (currentSystem()?.kind ?? 'local') === 'local' && !IS_WIN ? 'browser' : null
}

const lastKind = new Map<string, WorkKind>()
const openPanel = (key: string) => window.dispatchEvent(new CustomEvent('hermes:open-panel', { detail: { profile: key } }))
export function openWork(kind: WorkKind, profile = getState().chatWith) {
  if (getState().view !== 'chat') setState({ view: 'chat' })
  lastKind.set(profile, kind)
  openPanel(workKey(kind, profile))
}
/** The chat header's button: show the agent's work view (the tab you used last), or hide it. */
export function toggleWork(profile = getState().chatWith) {
  if (isWorkKey(getState().panel)) { window.dispatchEvent(new CustomEvent('hermes:close-panel')); return }
  openWork(lastKind.get(profile) ?? lookKind() ?? 'term', profile)
}

// Closing the work view while the agent works means "not now": it stays shut for the rest of that turn.
const dismissed = new Map<string, number>()
export function noteWorkClosed(key: string | null) {
  if (!isWorkKey(key)) return
  const { profile } = parseWorkKey(key)
  dismissed.set(profile, Date.now())
}
function autoOpen(kind: WorkKind, profile: string) {
  const s = getState()
  if (s.view !== 'chat' || s.chatWith !== profile) return // only for the chat you're looking at
  const turn = chatOf(s, profile).turnStartedAt ?? 0
  const closedAt = dismissed.get(profile)
  if (closedAt && closedAt >= turn) return
  if (s.panel && !isWorkKey(s.panel)) return // the agent's work or a group is open: leave it
  if (isWorkKey(s.panel) && parseWorkKey(s.panel).profile === profile) return // already showing this agent
  openWork(kind, profile)
}
let autoStarted = false
export function startWorkAutoOpen() {
  if (autoStarted) return
  autoStarted = true
  onTermStart((t) => autoOpen('term', t.profile))
  gateway.onEvent((ev) => {
    if (ev.type !== 'tool.start') return
    const name = String(ev.payload?.name ?? '')
    if (!/^browser_|^computer_use/.test(name)) return
    const profile = sessionProfile(ev.session_id)
    const kind = lookKind()
    if (profile && kind) autoOpen(kind, profile)
  })
}

// ---------------------------------------------------------------------------------------------------
export function WorkPane({ panelKey, onClose }: { panelKey: string; onClose: () => void }) {
  const { kind, profile } = parseWorkKey(panelKey)
  const bots = useStore((s) => s.bots)
  const terms = useTerms(profile)
  const running = terms.filter((t) => t.status === 'running').length
  const look = lookKind()
  const name = profile === 'default' ? 'Quicksilver' : bots.find((b) => b.profile === profile)?.name ?? prettyName(profile)
  const items = [
    ...(look === 'screen' ? [{ key: 'screen' as const, label: 'Screen' }] : look === 'browser' ? [{ key: 'browser' as const, label: 'Browser' }] : []),
    { key: 'term' as const, label: 'Terminal', ...(terms.length ? { count: running || terms.length } : {}) },
  ]
  const options = [{ value: 'default', label: 'Quicksilver' }, ...bots.filter((b) => !b.isChief).map((b) => ({ value: b.profile, label: b.name }))]
  const shownKind = items.some((i) => i.key === kind) ? kind : 'term'
  return (
    <div className="rpin wkpane">
      <div className="hdr drag">
        <span className="nodrag"><Tabs items={items} value={shownKind} onChange={(k) => openWork(k, profile)} /></span>
        <span className="sp" />
        <span className="nodrag wk-pick"><Select value={profile} width={190} align="end" options={options} onChange={(v) => { if (v !== profile) openWork(shownKind, v) }} /></span>
        <button className="hbtn nodrag" onClick={onClose} aria-label="Close" title="Close"><Icon name="x" /></button>
      </div>
      {shownKind === 'screen' ? <ScreenView key={profile} profile={profile} />
        : shownKind === 'browser' ? <BrowserView key={profile} profile={profile} name={name} />
        : <TerminalView key={profile} profile={profile} name={name} />}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------
// Browser: the agent's Chrome as a small browser.
interface BTab { id: string; title: string; url: string; agent: boolean }
const MOD = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
const hostOf = (url: string) => { try { return new URL(url).host } catch { return '' } }
const tileColor = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 32% 42%)` }

function BrowserView({ profile, name }: { profile: string; name: string }) {
  const pose = useStore((s) => s.bots.find((b) => b.profile === profile)?.poseKey)
  const [state, setStatus] = useState<'looking' | 'none' | 'live' | 'remote' | 'error'>('looking')
  const [error, setError] = useState('')
  const [tabs, setTabs] = useState<BTab[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [nav, setNav] = useState({ url: '', canBack: false, canForward: false })
  const [mine, setMine] = useState(false) // you took over
  const [typing, setTyping] = useState<string | null>(null)
  const [hasFrame, setHasFrame] = useState(false)
  const img = useRef<HTMLImageElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const size = useRef({ w: 0, h: 0 })

  // Find the agent's Chrome and watch it; while it has none, look again every 2 seconds.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const watch = async () => {
      if (!alive) return
      const r = await window.hermesNative.browserWatch?.(profile)
      if (!alive) return
      if (r?.ok) { setStatus('live'); return }
      if (r?.error === 'remote') { setStatus('remote'); return }
      if (r?.error) { setError(r.error); setStatus('error') } else setStatus('none')
      timer = setTimeout(() => void look(), 2000)
    }
    const look = async () => {
      if (!alive) return
      const list = await window.hermesNative.browserList?.()
      if (!alive) return
      if (list?.includes(profile)) void watch()
      else timer = setTimeout(() => void look(), 2000)
    }
    const off = window.hermesNative.onBrowserEvent?.((ev: any) => {
      if (ev.kind === 'tabs') {
        setTabs(ev.tabs); setCurrent(ev.current)
        // No tab left on view (you closed the last one): drop the old picture rather than keep showing it.
        if (!ev.current) { setHasFrame(false); setMine(false); img.current?.removeAttribute('src') }
      }
      else if (ev.kind === 'nav') { setNav({ url: ev.url, canBack: ev.canBack, canForward: ev.canForward }); setTyping(null) }
      else if (ev.kind === 'frame') {
        size.current = { w: ev.width, h: ev.height }
        if (img.current) img.current.src = `data:image/jpeg;base64,${ev.data}`
        setHasFrame(true)
      } else if (ev.kind === 'gone') { setStatus('none'); setTabs([]); setCurrent(null); setHasFrame(false); setMine(false); timer = setTimeout(() => void look(), 2000) }
    })
    void watch()
    return () => { alive = false; if (timer) clearTimeout(timer); off?.(); void window.hermesNative.browserUnwatch?.() }
  }, [profile])

  const act = (a: Record<string, unknown>) => void window.hermesNative.browserAct?.(a)
  // Tell the agent's Chrome the panel's shape, so the page lays out at a desktop width and fills it (see fit()).
  useEffect(() => {
    const el = surface.current
    if (state !== 'live' || !el) return
    let t: ReturnType<typeof setTimeout> | null = null
    const send = () => { if (el.clientWidth > 50 && el.clientHeight > 50) act({ type: 'fit', width: el.clientWidth, height: el.clientHeight }) }
    const ro = new ResizeObserver(() => { if (t) clearTimeout(t); t = setTimeout(send, 500) })
    ro.observe(el)
    send()
    return () => { ro.disconnect(); if (t) clearTimeout(t) }
  }, [state, tabs.length > 0])
  // Where on the page a pointer is (0..1 of the page), from the picture as drawn (contained, top-aligned).
  const at = (e: { clientX: number; clientY: number }) => {
    const el = img.current
    if (!el || !el.naturalWidth) return null
    const r = el.getBoundingClientRect()
    const k = Math.min(r.width / el.naturalWidth, r.height / el.naturalHeight)
    const w = el.naturalWidth * k, h = el.naturalHeight * k
    const x = (e.clientX - r.left - (r.width - w) / 2) / w, y = (e.clientY - r.top) / h
    return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y }
  }
  const moving = useRef(0)
  const mouse = (action: string) => (e: React.MouseEvent) => {
    if (!mine) return
    const p = at(e)
    if (!p) return
    if (action === 'mouseMoved') { if (moving.current) return; moving.current = requestAnimationFrame(() => { moving.current = 0 }) }
    if (action === 'mousePressed') surface.current?.focus()
    act({ type: 'mouse', action, ...p, button: action === 'mouseMoved' ? 'none' : ['left', 'middle', 'right'][e.button] ?? 'left', clickCount: action === 'mouseMoved' ? 0 : Math.max(1, e.detail), modifiers: MOD(e) })
  }
  useEffect(() => {
    const el = surface.current
    if (!el || !mine) return
    const wheel = (e: WheelEvent) => { const p = at(e); if (!p) return; e.preventDefault(); act({ type: 'mouse', action: 'mouseWheel', ...p, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: MOD(e) }) }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [mine, hasFrame])
  const key = (action: 'keyDown' | 'keyUp') => (e: React.KeyboardEvent) => {
    if (!mine) return
    if (e.metaKey && e.key.toLowerCase() === 'v') return // paste arrives as text below
    e.preventDefault(); e.stopPropagation()
    act({ type: 'key', action, key: e.key, code: e.code, modifiers: MOD(e) })
  }

  const cur = tabs.find((t) => t.id === current)
  const agentHere = !!cur?.agent
  if (state !== 'live' || !tabs.length) {
    return (
      <div className="wk-stage wk-empty">
        <Icon name="globe" size={28} />
        {state === 'looking' ? <Spinner size={18} />
          : state === 'remote' ? <p>The browser view shows the agents’ Chrome on this computer. On {currentSystem()?.name ?? 'that system'}, the agents browse over there.</p>
          : state === 'error' ? <p>Couldn’t show {name}’s browser: {error}</p>
          : state === 'live' ? <><p>{name}’s browser has no pages open.</p><p className="wk-quiet">It shows here when {name} opens one.</p></>
          : <><p>{name} has no browser open right now.</p><p className="wk-quiet">It shows here the moment {name} starts browsing. You can take over at any time.</p></>}
      </div>
    )
  }
  return (
    <div className="wk-stage wk-browser">
      <div className="wb-tabs">
        {tabs.map((t) => (
          <div key={t.id} className={`wb-tab${t.id === current ? ' on' : ''}`} title={`${t.title}\n${t.url}`} onClick={() => act({ type: 'select', tab: t.id })}>
            <span className="fav" style={{ background: tileColor(hostOf(t.url) || t.title) }}>{(hostOf(t.url).replace(/^www\./, '')[0] ?? '•').toUpperCase()}</span>
            <span className="t">{t.title || hostOf(t.url) || 'New tab'}</span>
            {t.agent ? <span className="ag" title={`${name} is working in this tab`}><BotFace profile={profile} size={16} poseKey={pose} watch={false} /></span> : null}
            <button className="x" title="Close this tab" aria-label="Close this tab" onClick={(e) => { e.stopPropagation(); act({ type: 'close', tab: t.id }) }}><Icon name="x" size={12} /></button>
          </div>
        ))}
      </div>
      <div className="wb-nav">
        <button className="ic" disabled={!mine || !nav.canBack} title="Back" onClick={() => act({ type: 'back' })}><Icon name="chevR" size={16} style={{ transform: 'scaleX(-1)' }} /></button>
        <button className="ic" disabled={!mine || !nav.canForward} title="Forward" onClick={() => act({ type: 'forward' })}><Icon name="chevR" size={16} /></button>
        <button className="ic" disabled={!mine} title="Reload" onClick={() => act({ type: 'reload' })}><Icon name="refresh" size={15} /></button>
        <form className="wb-field" onSubmit={(e) => { e.preventDefault(); if (typing != null) act({ type: 'navigate', url: typing }); (document.activeElement as HTMLElement | null)?.blur() }}>
          {/^https:/.test(nav.url) ? <Icon name="lock" size={13} /> : <Icon name="globe" size={13} />}
          <input value={typing ?? nav.url} readOnly={!mine} spellCheck={false} onChange={(e) => setTyping(e.target.value)} onBlur={() => setTyping(null)} aria-label="Address" />
        </form>
        {mine ? <button className="b-soft sm" onClick={() => setMine(false)}>Hand back</button>
          : <button className="b-pri sm" disabled={!hasFrame} onClick={() => { setMine(true); setTimeout(() => surface.current?.focus(), 0) }}>Take over</button>}
      </div>
      <div className={`wb-page${mine ? ' mine' : ''}`} ref={surface} tabIndex={0}
        onMouseDown={mouse('mousePressed')} onMouseUp={mouse('mouseReleased')} onMouseMove={mouse('mouseMoved')} onContextMenu={(e) => { if (mine) e.preventDefault() }}
        onKeyDown={key('keyDown')} onKeyUp={key('keyUp')} onPaste={(e) => { if (!mine) return; e.preventDefault(); const text = e.clipboardData.getData('text'); if (text) act({ type: 'text', text }) }}>
        <img ref={img} alt="" draggable={false} style={{ visibility: hasFrame ? 'visible' : 'hidden' }} />
        {!hasFrame ? <div className="wk-empty"><Spinner size={18} /></div> : null}
      </div>
      <div className="wb-foot">
        {mine ? <><i className="dot ok" />Your clicks and keys go to this page. {name} can still use it too.</>
          : agentHere ? <><i className="dot run" />{name} is working in this tab</>
          : <><i className="dot" />{tabs.some((t) => t.agent) ? `${name} is in another tab` : `${name}’s browser`}{tabs.some((t) => t.agent) ? <button className="b-text sm" onClick={() => act({ type: 'follow' })}>Follow {name}</button> : null}</>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------
// Terminal: a tab per command.
const XTHEME = { background: '#111111', foreground: '#d6d6d6', cursor: '#111111', selectionBackground: '#3a3a3a', black: '#1a1a1a', brightBlack: '#6b6b6b', red: '#ef6b6b', green: '#5fd38d', yellow: '#e8c468', blue: '#7fb2ff', magenta: '#c49cff', cyan: '#6fd3e0', white: '#d6d6d6', brightWhite: '#f2f2f2' }
const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, '')
const short = (cmd: string) => { const c = cmd.replace(/\s+/g, ' ').trim(); return c.length > 34 ? `${c.slice(0, 33)}…` : c }
const took = (t: Term) => { const s = Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s` }

function TerminalView({ profile, name }: { profile: string; name: string }) {
  const terms = useTerms(profile)
  useStore((s) => s.tick)
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => { void backfill(profile) }, [profile])
  // The newest running command, else the newest one, unless you picked a tab.
  const pick = useMemo(() => (sel && terms.some((t) => t.id === sel) ? sel : [...terms].reverse().find((t) => t.status === 'running')?.id ?? terms[terms.length - 1]?.id ?? null), [sel, terms])
  const t = terms.find((x) => x.id === pick)
  const copy = useCallback(() => { if (!t) return; void navigator.clipboard.writeText(strip(outputOf(t.id))).then(() => toast('Copied')) }, [t])
  if (!terms.length) {
    return (
      <div className="wk-stage wk-empty">
        <Icon name="terminal" size={28} />
        <p>No commands yet.</p>
        <p className="wk-quiet">When {name} runs one, like Claude Code or a test run, it shows here live, one tab per command.</p>
      </div>
    )
  }
  return (
    <div className="wk-stage wk-term">
      <div className="wt-tabs">
        {terms.map((x) => (
          <div key={x.id} className={`wt-tab${x.id === pick ? ' on' : ''}`} title={x.command} onClick={() => setSel(x.id)}>
            <i className={`s ${x.status}`} /><span className="t">{short(x.command)}</span>
            {x.status !== 'running' ? <button className="x" title="Close this tab" aria-label="Close this tab" onClick={(e) => { e.stopPropagation(); closeTerm(x.id) }}><Icon name="x" size={12} /></button> : null}
          </div>
        ))}
      </div>
      {t ? <XTermView key={t.id} term={t} /> : null}
      {t ? (
        <div className="wt-foot">
          {t.status === 'running' ? <><Spinner size={12} />Running · {elapsed(t.startedAt)}</>
            : t.status === 'failed' ? <><i className="dot bad" />{t.exit != null ? `Failed · exit ${t.exit}` : 'Stopped'} · {took(t)}</>
            : <><i className="dot ok" />Finished{t.exit != null ? ` · exit ${t.exit}` : ''} · {took(t)}</>}
          {t.cwd ? <span className="cwd">in {t.cwd.replace(/^\/Users\/[^/]+/, '~')}</span> : null}
          <span className="sp" />
          <button className="b-text sm" onClick={copy}><Icon name="copy" size={14} />Copy</button>
          {t.status === 'running' && t.processId ? <button className="b-soft sm" onClick={() => void stopTerm(t).catch((e) => toast(String(e?.message ?? e)))}>Stop</button> : null}
        </div>
      ) : null}
    </div>
  )
}

function XTermView({ term }: { term: Term }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = host.current
    if (!el) return
    const x = new XTerm({ disableStdin: true, convertEol: true, cursorBlink: false, cursorStyle: 'bar', cursorInactiveStyle: 'none', fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 12.5, lineHeight: 1.35, scrollback: 5000, theme: XTHEME, allowProposedApi: false })
    const fit = new FitAddon()
    x.loadAddon(fit)
    x.open(el)
    try { fit.fit() } catch { /* not laid out yet */ }
    const cwd = term.cwd ? term.cwd.replace(/^\/Users\/[^/]+/, '~') + ' ' : ''
    x.write(`\x1b[2m${cwd}$\x1b[0m \x1b[97m${term.command}\x1b[0m\r\n\r\n`)
    x.write(outputOf(term.id))
    const off = onOutput(term.id, (chunk) => x.write(chunk))
    const ro = new ResizeObserver(() => { try { fit.fit() } catch { /* hidden */ } })
    ro.observe(el)
    return () => { off(); ro.disconnect(); x.dispose() }
  }, [term.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="wt-x" ref={host} />
}
