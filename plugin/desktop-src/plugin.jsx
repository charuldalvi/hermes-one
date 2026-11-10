// Hermes One for Hermes Desktop: the desktop half of the hermes-one plugin.
//
// - A theme, "Hermes One": one charcoal (or paper) tone everywhere, near-white text, a white primary button,
//   Inter and JetBrains Mono.
// - The agent's browser: the agent's own Chrome as a small browser in a workspace tab. It shows the agent's
//   tabs (closable, the agent's marked and followed), the address, and the page live; Take over sends your
//   clicks and keys to it. The plugin's backend (dashboard/plugin_api.py, browser/*) finds that Chrome
//   wherever Hermes runs; the pane polls it for each change. The tab opens by itself when the agent in the chat you're looking
//   at starts browsing, and stays shut for a while once you close it.
//
// Source of desktop/plugin.js: `npm run build` in this folder bundles this file (React and the SDK stay external).
import { Button, Codicon, GlyphSpinner, host, PALETTE_AREA, THEMES_AREA, useValue } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'

const ID = 'hermes-one'

// ---------------------------------------------------------------------------------------------------------
// The theme
const THEME = {
  name: 'hermes-one',
  label: 'Hermes One',
  description: 'One quiet charcoal tone, near-white text, a white primary button',
  colors: {
    background: '#f7f7f7', foreground: '#1a1a1a',
    card: '#ffffff', cardForeground: '#1a1a1a',
    muted: '#efefef', mutedForeground: '#6b6b6b',
    popover: '#ffffff', popoverForeground: '#1a1a1a',
    primary: '#1a1a1a', primaryForeground: '#f7f7f7',
    secondary: '#ebebeb', secondaryForeground: '#1a1a1a',
    accent: '#ebebeb', accentForeground: '#1a1a1a',
    border: '#e6e6e6', input: '#ffffff',
    ring: '#2563eb', midground: '#1a1a1a', midgroundForeground: '#f7f7f7', composerRing: '#d4d4d4',
    destructive: '#dc2626', destructiveForeground: '#ffffff',
    sidebarBackground: '#f7f7f7', sidebarBorder: '#e6e6e6',
    userBubble: '#ebebeb', userBubbleBorder: '#ebebeb',
  },
  darkColors: {
    background: '#1a1a1a', foreground: '#dcdcdc',
    card: '#1f1f1f', cardForeground: '#dcdcdc',
    muted: '#1f1f1f', mutedForeground: '#9e9e9e',
    popover: '#1f1f1f', popoverForeground: '#dcdcdc',
    primary: '#ffffff', primaryForeground: '#1a1a1a',
    secondary: '#292929', secondaryForeground: '#dcdcdc',
    accent: '#292929', accentForeground: '#dcdcdc',
    border: '#242424', input: '#1f1f1f',
    ring: '#3b82f6', midground: '#dcdcdc', midgroundForeground: '#1a1a1a', composerRing: '#333333',
    destructive: '#ef4444', destructiveForeground: '#ffffff',
    sidebarBackground: '#1a1a1a', sidebarBorder: '#242424',
    userBubble: '#292929', userBubbleBorder: '#292929',
  },
  typography: {
    fontSans: '"Inter", system-ui, -apple-system, sans-serif',
    fontMono: '"JetBrains Mono", ui-monospace, monospace',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  },
  darkTerminal: {
    foreground: '#d6d6d6', cursor: '#d6d6d6', selectionBackground: '#3a3a3a80',
    black: '#1a1a1a', red: '#ef6b6b', green: '#5fd38d', yellow: '#e8c468', blue: '#7fb2ff', magenta: '#c49cff', cyan: '#6fd3e0', white: '#d6d6d6',
    brightBlack: '#6b6b6b', brightWhite: '#f2f2f2',
  },
}

// ---------------------------------------------------------------------------------------------------------
// The agent's browser
const CSS = `
.h1b { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 10px 12px 12px; gap: 8px; color: var(--ui-text-primary); font-size: 13px; }
.h1b-head { display: flex; align-items: center; gap: 8px; }
.h1b-head .sp { flex: 1; }
.h1b-pick { height: 28px; padding: 0 8px; border-radius: 7px; border: 1px solid var(--ui-stroke-secondary); background: transparent; color: inherit; font: inherit; }
.h1b-card { flex: 1; min-height: 0; display: flex; flex-direction: column; border-radius: 10px; overflow: hidden; border: 1px solid var(--ui-stroke-secondary); }
.h1b-tabs { display: flex; align-items: flex-end; gap: 2px; padding: 6px 8px 0; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--ui-stroke-secondary); }
.h1b-tab { flex: 0 1 210px; min-width: 110px; display: flex; align-items: center; gap: 7px; height: 32px; padding: 0 4px 0 10px; border-radius: 7px 7px 0 0; color: var(--ui-text-secondary); white-space: nowrap; cursor: default; }
.h1b-tab:hover { color: var(--ui-text-primary); }
.h1b-tab.on { background: var(--ui-bg-elevated, rgba(127,127,127,.12)); color: var(--ui-text-primary); }
.h1b-tab .fav { width: 15px; height: 15px; border-radius: 4px; flex: none; display: grid; place-items: center; font-size: 9.5px; font-weight: 600; color: #fff; }
.h1b-tab .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.h1b-tab .ag { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--ui-accent); }
.h1b-tab .x { flex: none; width: 20px; height: 20px; border-radius: 5px; display: grid; place-items: center; color: var(--ui-text-tertiary); opacity: 0; border: 0; background: none; }
.h1b-tab:hover .x, .h1b-tab.on .x { opacity: 1; }
.h1b-tab .x:hover { background: rgba(127,127,127,.18); color: var(--ui-text-primary); }
.h1b-nav { display: flex; align-items: center; gap: 4px; padding: 6px; background: var(--ui-bg-elevated, rgba(127,127,127,.08)); }
.h1b-ic { width: 28px; height: 28px; border-radius: 7px; display: grid; place-items: center; color: var(--ui-text-secondary); border: 0; background: none; }
.h1b-ic:disabled { opacity: .35; }
.h1b-ic:not(:disabled):hover { background: rgba(127,127,127,.15); color: var(--ui-text-primary); }
.h1b-field { flex: 1; min-width: 0; height: 28px; margin: 0 4px; border-radius: 7px; display: flex; align-items: center; gap: 7px; padding: 0 9px; background: var(--ui-bg-editor, rgba(127,127,127,.06)); color: var(--ui-text-tertiary); }
.h1b-field input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font: inherit; color: var(--ui-text-primary); text-overflow: ellipsis; }
.h1b-field input[readonly] { color: var(--ui-text-secondary); }
.h1b-page { flex: 1; min-height: 0; position: relative; outline: 0; display: flex; }
.h1b-page img { width: 100%; height: 100%; object-fit: contain; object-position: top center; display: block; user-select: none; }
.h1b-page.mine { box-shadow: inset 0 0 0 2px var(--ui-accent); }
.h1b-foot { display: flex; align-items: center; gap: 8px; min-height: 22px; color: var(--ui-text-tertiary); white-space: nowrap; overflow: hidden; }
.h1b-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--ui-text-tertiary); }
.h1b-dot.ok { background: var(--ui-green, #22c55e); }
.h1b-dot.run { background: var(--ui-accent); }
.h1b-empty { flex: 1; display: grid; place-content: center; justify-items: center; gap: 10px; text-align: center; color: var(--ui-text-secondary); padding: 24px; }
.h1b-empty p { margin: 0; max-width: 360px; line-height: 1.5; }
.h1b-empty .q { color: var(--ui-text-tertiary); }
`

const MOD = (e) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
const hostOf = (url) => { try { return new URL(url).host } catch { return '' } }
const tileColor = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 32% 42%)` }
const nameOf = (profile) => (profile === 'default' ? 'Main agent' : profile.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()))

function BrowserTab({ ctx, initial }) {
  const focused = useValue(host.state.focusedSessionProfile)
  const [profile, setProfile] = useState(initial || focused || 'default')
  const [agents, setAgents] = useState([])
  const picked = useRef(false) // you chose an agent in the picker: stay on it
  const [state, setState] = useState('looking') // looking | none | live
  const [tabs, setTabs] = useState([])
  const [current, setCurrent] = useState(null)
  const [nav, setNav] = useState({ url: '', canBack: false, canForward: false })
  const [mine, setMine] = useState(false)
  const [typing, setTyping] = useState(null)
  const [hasFrame, setHasFrame] = useState(false)
  const watch = useRef(null)
  const img = useRef(null)
  const surface = useRef(null)
  const name = nameOf(profile)

  // Which agents have a browser open (for the picker).
  useEffect(() => {
    let alive = true
    const load = () => ctx.rest('/browser/agents').then((r) => {
      if (!alive) return
      const list = r?.profiles ?? []
      setAgents(list)
      // The agent you're talking to isn't browsing but another one is (it handed the work on): show that one.
      setProfile((cur) => (!picked.current && !list.includes(cur) && list.length ? list[0] : cur))
    }).catch(() => {})
    load()
    const stop = ctx.setInterval(load, 5000)
    return () => { alive = false; stop() }
  }, [])

  // The latest picture is kept, so the first one shows even when it arrives before the page view is drawn.
  const lastFrame = useRef(null)
  const setImg = (el) => { img.current = el; if (el && lastFrame.current) el.src = lastFrame.current }
  const showFrame = (data) => { lastFrame.current = `data:image/jpeg;base64,${data}`; if (img.current) img.current.src = lastFrame.current; setHasFrame(true) }
  const reset = () => { setTabs([]); setCurrent(null); setHasFrame(false); setMine(false); lastFrame.current = null; img.current?.removeAttribute('src') }

  // Watch the agent's Chrome by asking the plugin's backend for what changed (each ask waits up to 1.5 s for a
  // change, so the page moves live). Plain requests work everywhere Hermes runs, local or remote.
  useEffect(() => {
    let alive = true
    let wid = null
    watch.current = null
    setState('looking'); reset()
    const wait = (ms) => new Promise((done) => { ctx.setTimeout(done, ms) })
    const run = async () => {
      let seq = 0
      while (alive) {
        if (!wid) {
          const r = await ctx.rest(`/browser/open/${encodeURIComponent(profile)}`, { method: 'POST', timeoutMs: 20000 }).catch(() => null)
          if (!alive) break
          if (!r?.running || !r.watch) { setState('none'); reset(); await wait(2000); continue }
          wid = r.watch; watch.current = wid; seq = 0
        }
        const p = await ctx.rest(`/browser/poll/${wid}/${seq}`, { timeoutMs: 10000 }).catch(() => null)
        if (!alive) break
        if (!p || p.gone) { wid = null; watch.current = null; setState('none'); reset(); await wait(1500); continue }
        seq = p.seq
        setState('live'); setTabs(p.tabs ?? []); setCurrent(p.current ?? null)
        if (!p.current) { setHasFrame(false); setMine(false); lastFrame.current = null; img.current?.removeAttribute('src') }
        if (p.nav && p.nav.tab === p.current) setNav({ url: p.nav.url ?? '', canBack: !!p.nav.canBack, canForward: !!p.nav.canForward })
        if (p.frame && p.frame.tab === p.current) showFrame(p.frame.data)
      }
    }
    void run()
    return () => { alive = false; if (wid) void ctx.rest(`/browser/close/${wid}`, { method: 'POST' }).catch(() => {}) }
  }, [profile])

  const act = (a) => { if (watch.current) void ctx.rest('/browser/act', { method: 'POST', body: { watch: watch.current, ...a } }).catch(() => {}) }

  // Tell the agent's Chrome the pane's shape, so the page lays out at a desktop width and fills it.
  useEffect(() => {
    const el = surface.current
    if (state !== 'live' || !el) return
    let t = null
    const send = () => { if (el.clientWidth > 50 && el.clientHeight > 50) act({ type: 'fit', width: el.clientWidth, height: el.clientHeight }) }
    const ro = new ResizeObserver(() => { if (t) clearTimeout(t); t = setTimeout(send, 500) })
    ro.observe(el)
    send()
    return () => { ro.disconnect(); if (t) clearTimeout(t) }
  }, [state, tabs.length > 0])

  // Where on the page a pointer is (0..1), from the picture as drawn (contained, top-aligned).
  const at = (e) => {
    const el = img.current
    if (!el || !el.naturalWidth) return null
    const r = el.getBoundingClientRect()
    const k = Math.min(r.width / el.naturalWidth, r.height / el.naturalHeight)
    const w = el.naturalWidth * k, h = el.naturalHeight * k
    const x = (e.clientX - r.left - (r.width - w) / 2) / w, y = (e.clientY - r.top) / h
    return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y }
  }
  const moving = useRef(0)
  const mouse = (action) => (e) => {
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
    const wheel = (e) => { const p = at(e); if (!p) return; e.preventDefault(); act({ type: 'mouse', action: 'mouseWheel', ...p, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: MOD(e) }) }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [mine, hasFrame])
  const key = (action) => (e) => {
    if (!mine) return
    if (e.metaKey && e.key.toLowerCase() === 'v') return // paste arrives as text
    e.preventDefault(); e.stopPropagation()
    act({ type: 'key', action, key: e.key, code: e.code, modifiers: MOD(e) })
  }

  const live = state === 'live'
  const cur = tabs.find((t) => t.id === current)
  const pickable = [...new Set([profile, ...agents])]
  const head = (
    <div className="h1b-head">
      <Codicon name="globe" />
      <span>Browser</span>
      <span className="sp" />
      <select className="h1b-pick" value={profile} onChange={(e) => { picked.current = true; setProfile(e.target.value) }} title="Whose browser">
        {pickable.map((p) => <option key={p} value={p}>{nameOf(p)}{agents.includes(p) ? '' : ' (no browser open)'}</option>)}
      </select>
    </div>
  )
  if (state === 'looking' || state === 'none' || !tabs.length) {
    return (
      <div className="h1b">
        {head}
        <div className="h1b-card"><div className="h1b-empty">
          {state === 'looking' ? <GlyphSpinner /> : <>
            <Codicon name="globe" size={24} />
            <p>{state === 'none' ? `${name} has no browser open right now.` : `${name}’s browser has no pages open.`}</p>
            <p className="q">It shows here the moment {name} starts browsing. You can take over at any time.</p>
          </>}
        </div></div>
      </div>
    )
  }
  return (
    <div className="h1b">
      {head}
      <div className="h1b-card">
        <div className="h1b-tabs">
          {tabs.map((t) => (
            <div key={t.id} className={`h1b-tab${t.id === current ? ' on' : ''}`} title={`${t.title}\n${t.url}`} onClick={() => act({ type: 'select', tab: t.id })}>
              <span className="fav" style={{ background: tileColor(hostOf(t.url) || t.title) }}>{(hostOf(t.url).replace(/^www\./, '')[0] ?? '•').toUpperCase()}</span>
              <span className="t">{t.title || hostOf(t.url) || 'New tab'}</span>
              {t.agent ? <span className="ag" title={`${name} is working in this tab`} /> : null}
              {live ? <button className="x" title="Close this tab" aria-label="Close this tab" onClick={(e) => { e.stopPropagation(); act({ type: 'close', tab: t.id }) }}><Codicon name="close" size={12} /></button> : null}
            </div>
          ))}
        </div>
        <div className="h1b-nav">
          <button className="h1b-ic" disabled={!mine || !nav.canBack} title="Back" onClick={() => act({ type: 'back' })}><Codicon name="arrow-left" /></button>
          <button className="h1b-ic" disabled={!mine || !nav.canForward} title="Forward" onClick={() => act({ type: 'forward' })}><Codicon name="arrow-right" /></button>
          <button className="h1b-ic" disabled={!mine} title="Reload" onClick={() => act({ type: 'reload' })}><Codicon name="refresh" /></button>
          <form className="h1b-field" onSubmit={(e) => { e.preventDefault(); if (typing != null) act({ type: 'navigate', url: typing }); document.activeElement?.blur?.() }}>
            <Codicon name={/^https:/.test(nav.url) ? 'lock' : 'globe'} size={13} />
            <input value={typing ?? nav.url} readOnly={!mine} spellCheck={false} onChange={(e) => setTyping(e.target.value)} onBlur={() => setTyping(null)} aria-label="Address" />
          </form>
          {mine ? <Button size="sm" variant="secondary" onClick={() => setMine(false)}>Hand back</Button>
            : <Button size="sm" disabled={!hasFrame || !live} onClick={() => { setMine(true); setTimeout(() => surface.current?.focus(), 0) }}>Take over</Button>}
        </div>
        <div className={`h1b-page${mine ? ' mine' : ''}`} ref={surface} tabIndex={0}
          onMouseDown={mouse('mousePressed')} onMouseUp={mouse('mouseReleased')} onMouseMove={mouse('mouseMoved')} onContextMenu={(e) => { if (mine) e.preventDefault() }}
          onKeyDown={key('keyDown')} onKeyUp={key('keyUp')} onPaste={(e) => { if (!mine) return; e.preventDefault(); const text = e.clipboardData.getData('text'); if (text) act({ type: 'text', text }) }}>
          <img ref={setImg} alt="" draggable={false} style={{ visibility: hasFrame ? 'visible' : 'hidden' }} />
          {!hasFrame ? <div className="h1b-empty" style={{ position: 'absolute', inset: 0 }}><GlyphSpinner /></div> : null}
        </div>
      </div>
      <div className="h1b-foot">
        {mine ? <><span className="h1b-dot ok" />Your clicks and keys go to this page. {name} can still use it too.</>
          : cur?.agent ? <><span className="h1b-dot run" />{name} is working in this tab</>
          : <><span className="h1b-dot" />{tabs.some((t) => t.agent) ? `${name} is in another tab` : `${name}’s browser`}{tabs.some((t) => t.agent) ? <Button size="xs" variant="ghost" onClick={() => act({ type: 'follow' })}>Follow {name}</Button> : null}</>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------
export default {
  id: ID,
  name: 'Hermes One',
  register(ctx) {
    const style = document.createElement('style')
    style.dataset.plugin = ID
    style.textContent = CSS
    document.head.appendChild(style)
    ctx.onDispose(() => style.remove())

    ctx.register({ id: 'theme', area: THEMES_AREA, data: THEME })

    // The agent's browser opens as a tab in the main workspace (once; opening again brings it to the front).
    let closedAt = 0
    let closeTab = null
    const openBrowser = (profile) => {
      if (typeof host.openWorkspace !== 'function') { host.notify({ kind: 'info', message: 'The agent’s browser needs a newer Hermes Desktop.' }); return }
      closeTab = host.openWorkspace('hermes-one-browser', {
        title: 'Browser',
        minWidth: '28rem',
        render: () => <BrowserTab ctx={ctx} initial={profile} />,
        onClose: () => { closedAt = Date.now(); closeTab = null },
      })
    }
    ctx.onDispose(() => closeTab?.())
    ctx.register({
      id: 'open-browser',
      area: PALETTE_AREA,
      data: { id: 'hermes-one.browser', label: 'Show the agent’s browser', keywords: ['browser', 'chrome', 'agent', 'hermes one', 'watch'], run: () => openBrowser(host.state.focusedSessionProfile.get()) },
    })
    // Opens by itself when the agent in the chat you're looking at starts browsing; once you close it, it
    // stays shut for 10 minutes ("not now").
    ctx.onEvent('tool.start', (ev) => {
      const name = String(ev?.payload?.name ?? '')
      if (!/^browser_|^browser$/.test(name)) return
      if (ev.session_id && ev.session_id !== host.state.focusedSessionId.get()) return
      if (closeTab || Date.now() - closedAt < 10 * 60_000) return
      openBrowser(host.state.focusedSessionProfile.get())
    })
  },
}
