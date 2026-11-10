// Hermes One: the agents on the left; in the middle, Chief's chat or the chat with the agent you clicked (or
// several chats side by side, group chats too); on the right, an agent's latest work, its browser, terminal or
// screen, or what needs you.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BotFace } from './components/BotFace'
import { Chat } from './components/Chat'
import { Composer } from './components/Composer'
import { isWorkKey, lookKind, noteWorkClosed, parseWorkKey, toggleWork, WorkPane } from './components/Work'
import { Panel } from './components/Panel'
import { GroupPanel } from './components/Groups'
import { Sidebar } from './components/Sidebar'
import { Made, QuickActions } from './components/Views'
import { Apps } from './components/Apps'
import { Marketplace } from './components/Marketplace'
import { Projects } from './components/Projects'
import { PageFrame, Settings } from './components/Settings'
import { ScheduledPage } from './components/settings/Scheduled'
import { ConfirmHost } from './components/ui'
import { ChatSettingsButton } from './components/ChatSettings'
import { ChatSearchButton } from './components/ChatSearch'
import { ConnBar, ConnCenter } from './components/ConnNote'
import { openChat, sendToChief } from './lib/hermes'
import { Icon } from './lib/icons'
import { springTo, SPRING } from './lib/motion'
import { chatOf, focusKeyOf, getState, PaneProfile, setState, useStore } from './lib/store'
import { closePane, focusPane, openBeside, PANE_DRAG } from './lib/panes'

// The right panel's width: dragged by its left edge (remembered on this Mac), else a share of the window.
// It never gets narrower than 400 px or leaves the chat less than 440 px. An agent's screen beside the chat
// keeps its own width, wider by default: a desktop picture needs the room.
const widthKey = (p: string | null) => (isWorkKey(p) ? 'hermes-one:screen-width' : 'hermes-one:panel-width')
const savedPanel = (p: string | null) => { try { const v = Number(localStorage.getItem(widthKey(p))); return Number.isFinite(v) && v > 0 ? v : 0 } catch { return 0 } }
const clampPanel = (v: number) => Math.round(Math.max(400, Math.min(Math.max(400, window.innerWidth - 300 - 440), v)))
const defaultPanel = (p: string | null) => (isWorkKey(p)
  ? clampPanel(Math.max(480, Math.min(1280, (window.innerWidth - 300) * 0.56)))
  : Math.round(Math.max(440, Math.min(905, (window.innerWidth - 300) * 0.56))))
// Beside several chats, the panel takes one chat's share of the room, so it never squeezes them.
const panelWidth = (p: string | null = getState().panel) => {
  const n = getState().view === 'chat' ? getState().panes.length : 1
  if (n > 1) return Math.round(Math.max(400, (window.innerWidth - 300) / (n + 1)))
  return savedPanel(p) ? clampPanel(savedPanel(p)) : defaultPanel(p)
}

export function App() {
  const connection = useStore((s) => s.connection)
  const view = useStore((s) => s.view)
  const panel = useStore((s) => s.panel)
  const toast = useStore((s) => s.toast)
  const busy = useStore((s) => s.chief.busy || s.bots.some((b) => b.status === 'working') || Object.values(s.chats).some((c) => c.busy))
  const hasMsgs = useStore((s) => chatOf(s, s.chatWith).messages.length > 0)
  const panes = useStore((s) => s.panes)
  const focus = useStore(focusKeyOf)
  const [quick, setQuick] = useState(false)
  const [shown, setShown] = useState<string | null>(panel)
  const rp = useRef<HTMLDivElement>(null)
  const width = useRef(0)

  // A clock for "working for 12s" counters, only while something works.
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setState({ tick: Date.now() }), 1000)
    return () => clearInterval(t)
  }, [busy])

  const setW = (v: number) => { width.current = v; if (rp.current) rp.current.style.width = `${Math.max(0, v)}px` }
  // The panel's content keeps its final width while the panel springs open, so text never re-wraps mid-move.
  const setTarget = () => { rp.current?.style.setProperty('--panel-w', `${panelWidth()}px`) }

  // Open: the panel springs open (the "screen" spring) and the bead you clicked flies into its title.
  const open = useCallback((profile: string, from?: Element | null) => {
    const was = getState().panel
    setState({ panel: profile, lastPanel: profile === '__needs' || isWorkKey(profile) ? getState().lastPanel : profile, view: getState().view === 'settings' ? 'chat' : getState().view })
    setShown(profile)
    setTarget()
    // Opening, or swapping between an agent's work and a screen (each has its own width): spring to it.
    if (!was || isWorkKey(was) !== isWorkKey(profile)) springTo('panel', panelWidth(), { from: width.current, k: SPRING.screen[0], z: SPRING.screen[1], eps: 0.3, apply: setW })
    else if (!isWorkKey(profile)) {
      const el = rp.current?.querySelector<HTMLElement>('.rscroll')
      if (el) springTo('panel-enter', 1, { from: 0, k: SPRING.fluid[0], z: SPRING.fluid[1], eps: 0.002, apply: (v) => { el.style.opacity = String(Math.min(1, v)); el.style.transform = `translateY(${(1 - v) * 10}px)` } })
    }
    // No bead flight from the sidebar: the panel springs open and its bead is simply there (the user's call).
  }, [])
  // Resize: drag the panel's left edge; double-click it to go back to the usual width.
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX, startW = width.current
    const grip = e.currentTarget
    try { grip.setPointerCapture(e.pointerId) } catch { /* a synthetic pointer */ }
    document.documentElement.classList.add('resizing')
    const move = (ev: PointerEvent) => { const w = clampPanel(startW + (startX - ev.clientX)); setW(w); rp.current?.style.setProperty('--panel-w', `${w}px`) }
    const up = () => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up)
      document.documentElement.classList.remove('resizing')
      try { localStorage.setItem(widthKey(getState().panel), String(width.current)) } catch { /* the usual width next launch */ }
    }
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up)
  }
  const resetWidth = () => {
    try { localStorage.removeItem(widthKey(getState().panel)) } catch { /* nothing kept */ }
    setTarget()
    springTo('panel', panelWidth(), { from: width.current, k: SPRING.screen[0], z: SPRING.screen[1], eps: 0.3, apply: setW })
  }
  // Close: the panel springs shut.
  const close = useCallback(() => {
    noteWorkClosed(getState().panel)
    setState({ panel: null })
    springTo('panel', 0, { from: width.current, k: SPRING.screen[0], z: SPRING.screen[1], eps: 0.3, apply: setW, done: () => { if (!getState().panel) setShown(null) } })
  }, [])

  useEffect(() => {
    const onOpen = (e: Event) => { const d = (e as CustomEvent).detail; if (getState().panel === d.profile) return; open(d.profile, d.from) }
    const onClose = () => { if (getState().panel) close() }
    const onSend = (e: Event) => { void sendToChief(String((e as CustomEvent).detail)) }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setQuick((q) => !q) }
      else if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); if (getState().panel) close(); setState({ view: 'settings' }) }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); setState({ view: 'chat' }); window.dispatchEvent(new Event('hermes:focus-composer')) }
      else if (e.key === 'Escape' && !quick && getState().panel) close()
    }
    const onResize = () => { setTarget(); if (getState().panel) setW(panelWidth()) }
    window.addEventListener('hermes:open-panel', onOpen)
    window.addEventListener('hermes:close-panel', onClose)
    window.addEventListener('hermes:send', onSend)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('hermes:open-panel', onOpen)
      window.removeEventListener('hermes:close-panel', onClose)
      window.removeEventListener('hermes:send', onSend)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close, quick])

  useLayoutEffect(() => { if (rp.current) rp.current.style.width = `${width.current}px` })
  // A chat opened or closed beside the others: an open panel springs to its new share.
  const paneCount = useStore((s) => (s.view === 'chat' ? s.panes.length : 1))
  const firstCount = useRef(true)
  useEffect(() => {
    if (firstCount.current) { firstCount.current = false; return }
    if (!getState().panel) return
    setTarget()
    springTo('panel', panelWidth(), { from: width.current, k: SPRING.screen[0], z: SPRING.screen[1], eps: 0.3, apply: setW })
  }, [paneCount])

  return (
    <div className="app" data-view={view} data-chat={hasMsgs ? 'busy' : 'empty'}>
      <div className="wsbg" aria-hidden="true" />
      <div className="wsframe" aria-hidden="true" />
      <Sidebar onQuick={() => setQuick(true)} />
      {view === 'chat' ? <Panes panes={panes} focus={focus} onPanel={open} onClosePanel={close} />
        : view === 'made' ? <Made />
        : view === 'scheduled' ? <PageFrame icon="clock" title="Scheduled"><ScheduledPage profile="default" /></PageFrame>
        : view === 'settings' ? <Settings />
        : view === 'marketplace' ? <Marketplace />
        : view === 'projects' ? <Projects />
        : <Apps />}
      <aside className="rp" ref={rp}>{shown ? <div className="rp-grip" onPointerDown={drag} onDoubleClick={resetWidth} title="Drag to resize · double-click for the usual width" role="separator" aria-orientation="vertical" aria-label="Resize the side panel" /> : null}{shown ? (isWorkKey(shown) ? <WorkPane panelKey={shown} onClose={close} />
        : <Panel profile={shown} onClose={close} />) : null}</aside>
      {quick ? <QuickActions onClose={() => setQuick(false)} /> : null}
      {toast ? <div className="toast" key={toast}>{toast}</div> : null}
      <ConfirmHost />
    </div>
  )
}

/** The chats in the middle, side by side (most of the time just one). A sidebar row dragged here drops between
 *  them, at the line that shows where it will go. */
function Panes({ panes, focus, onPanel, onClosePanel }: { panes: string[]; focus: string; onPanel: (key: string) => void; onClosePanel: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [drop, setDrop] = useState<{ at: number; x: number } | null>(null)
  const many = panes.length > 1
  // Where a dragged chat lands: before the pane whose left half the pointer is over, or after the last one.
  const spot = (clientX: number) => {
    const el = box.current
    if (!el) return null
    const kids = [...el.querySelectorAll<HTMLElement>(':scope > .chat')]
    const left = el.getBoundingClientRect().left
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect()
      if (clientX < r.left + r.width / 2) return { at: i, x: r.left - left }
    }
    const last = kids[kids.length - 1]?.getBoundingClientRect()
    return { at: kids.length, x: last ? last.right - left : 0 }
  }
  return (
    <div className={`panes${many ? ' many' : ''}`} ref={box}
      onDragOver={(e) => { if (!e.dataTransfer.types.includes(PANE_DRAG)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDrop(spot(e.clientX)) }}
      onDragLeave={(e) => { if (!box.current?.contains(e.relatedTarget as Node | null)) setDrop(null) }}
      onDrop={(e) => {
        const key = e.dataTransfer.getData(PANE_DRAG)
        const at = spot(e.clientX)?.at
        setDrop(null)
        if (key) { e.preventDefault(); openBeside(key, at) }
      }}>
      {panes.map((k) => (k.startsWith('group:')
        ? <GroupPane key={k} k={k} focused={k === focus} />
        : <ChatPane key={k} profile={k} focused={k === focus} many={many} onPanel={onPanel} onClosePanel={onClosePanel} />))}
      {drop ? <div className="pdrop" style={{ left: drop.x }} aria-hidden="true" /> : null}
    </div>
  )
}

// A click anywhere in a chat gives it focus, except on controls that handle it themselves (data-own-focus).
const focusOnPress = (key: string, focused: boolean) => (e: React.PointerEvent) => {
  if (focused || (e.target as HTMLElement).closest('[data-own-focus]')) return
  focusPane(key)
}

function GroupPane({ k, focused }: { k: string; focused: boolean }) {
  return (
    <main className={`chat gmain${focused ? ' on' : ''}`} onPointerDownCapture={focusOnPress(k, focused)}>
      {/* Closing it beside other chats closes just this one; on its own, the agent's chat comes back. */}
      <GroupPanel roomId={k.slice(6)} onClose={() => (getState().panes.length > 1 ? closePane(k) : openChat(getState().chatWith))} />
    </main>
  )
}

function ChatPane({ profile, focused, many, onPanel, onClosePanel }: { profile: string; focused: boolean; many: boolean; onPanel: (key: string) => void; onClosePanel: () => void }) {
  const connection = useStore((s) => s.connection)
  const panel = useStore((s) => s.panel)
  const bot = useStore((s) => s.bots.find((b) => b.profile === profile))
  const hasMsgs = useStore((s) => chatOf(s, profile).messages.length > 0)
  const isChief = profile === 'default'
  const name = isChief ? 'Hermes' : bot?.name ?? profile
  const workHere = isWorkKey(panel) && parseWorkKey(panel!).profile === profile
  const latestHere = !!panel && !isWorkKey(panel) && (isChief ? panel === getState().lastPanel || panel === '__needs' : panel === profile)
  // The side panel belongs to the chat in focus: these buttons focus this chat first, then show or hide it.
  const onWork = () => {
    if (workHere) { onClosePanel(); return }
    focusPane(profile) // an open browser, terminal or screen follows the focus to this agent
    const p = getState().panel
    if (!(isWorkKey(p) && parseWorkKey(p!).profile === profile)) toggleWork(profile)
  }
  const onLatest = () => {
    if (latestHere) { onClosePanel(); return }
    focusPane(profile)
    onPanel(isChief ? getState().lastPanel ?? '__needs' : profile)
  }
  return (
    <PaneProfile.Provider value={profile}>
      <main className={`chat${focused ? ' on' : ''}`} onPointerDownCapture={focusOnPress(profile, focused)}>
        <div className="hdr drag">
          {isChief
            ? <span className="crumb"><BotFace profile="default" size={20} watch={false} poseKey={getState().bots.find((b) => b.isChief)?.poseKey} /><span className="cur">Hermes</span><span className="sl">·</span><span className="crole">Leads your agents</span></span>
            : <span className="crumb"><BotFace profile={profile} size={20} watch={false} poseKey={bot?.poseKey} /><span className="cur">{name}</span>{bot?.role ? <><span className="sl">·</span><span className="crole">{bot.role}</span></> : null}</span>}
          <span className="sp" />
          <ChatSearchButton />
          <ChatSettingsButton />
          <button className={`hbtn nodrag${workHere ? ' on' : ''}`} data-own-focus title={workHere ? 'Hide the browser and terminal' : `Show ${name}’s ${lookKind() === 'screen' ? 'screen' : lookKind() === 'browser' ? 'browser' : 'commands'} and terminal beside the chat`} onClick={onWork}><Icon name="screen" /></button>
          <button className={`hbtn nodrag${latestHere ? ' on' : ''}`} data-own-focus title={isChief ? 'Show the side panel' : `${name}’s latest work`} onClick={onLatest}><Icon name="panelR" /></button>
          {many ? <button className="hbtn nodrag" data-own-focus title={`Close ${name}’s chat here (it stays in the sidebar)`} aria-label={`Close ${name}’s chat here`} onClick={() => closePane(profile)}><Icon name="x" /></button> : null}
        </div>
        {connection === 'open' || hasMsgs ? (
          <>
            <Chat key={`chat:${profile}`} />
            {focused ? <ConnBar /> : null}
            <Composer key={`box:${profile}`} />
          </>
        ) : <ConnCenter />}
      </main>
    </PaneProfile.Provider>
  )
}
