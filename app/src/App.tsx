// Hermes One: the agents on the left; in the middle, Chief's chat or the chat with the agent you clicked;
// on the right, an agent's latest work, a group, an agent's screen, or what needs you.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BotFace } from './components/BotFace'
import { Chat } from './components/Chat'
import { Composer } from './components/Composer'
import { isWorkKey, lookKind, noteWorkClosed, toggleWork, WorkPane } from './components/Work'
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
import { sendToChief } from './lib/hermes'
import { Icon } from './lib/icons'
import { springTo, SPRING } from './lib/motion'
import { chatOf, getState, setState, useStore } from './lib/store'

// The right panel's width: dragged by its left edge (remembered on this Mac), else a share of the window.
// It never gets narrower than 400 px or leaves the chat less than 440 px. An agent's screen beside the chat
// keeps its own width, wider by default: a desktop picture needs the room.
const widthKey = (p: string | null) => (isWorkKey(p) ? 'hermes-one:screen-width' : 'hermes-one:panel-width')
const savedPanel = (p: string | null) => { try { const v = Number(localStorage.getItem(widthKey(p))); return Number.isFinite(v) && v > 0 ? v : 0 } catch { return 0 } }
const clampPanel = (v: number) => Math.round(Math.max(400, Math.min(Math.max(400, window.innerWidth - 300 - 440), v)))
const defaultPanel = (p: string | null) => (isWorkKey(p)
  ? clampPanel(Math.max(480, Math.min(1280, (window.innerWidth - 300) * 0.56)))
  : Math.round(Math.max(440, Math.min(905, (window.innerWidth - 300) * 0.56))))
const panelWidth = (p: string | null = getState().panel) => (savedPanel(p) ? clampPanel(savedPanel(p)) : defaultPanel(p))

export function App() {
  const connection = useStore((s) => s.connection)
  const view = useStore((s) => s.view)
  const panel = useStore((s) => s.panel)
  const toast = useStore((s) => s.toast)
  const busy = useStore((s) => s.chief.busy || s.bots.some((b) => b.status === 'working') || Object.values(s.chats).some((c) => c.busy))
  const chatWith = useStore((s) => s.chatWith)
  const withBot = useStore((s) => s.bots.find((b) => b.profile === s.chatWith))
  const hasMsgs = useStore((s) => chatOf(s, s.chatWith).messages.length > 0)
  const isChiefChat = chatWith === 'default'
  const screenSupported = useStore((s) => !!s.screenSupported)
  const workOpen = isWorkKey(panel)
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

  return (
    <div className="app" data-view={view} data-chat={hasMsgs ? 'busy' : 'empty'}>
      <div className="wsbg" aria-hidden="true" />
      <div className="wsframe" aria-hidden="true" />
      <Sidebar onQuick={() => setQuick(true)} />
      {view === 'chat' ? (
        <main className="chat">
          <div className="hdr drag">
            {isChiefChat
              ? <span className="crumb"><BotFace profile="default" size={20} watch={false} poseKey={getState().bots.find((b) => b.isChief)?.poseKey} /><span className="cur">Hermes</span><span className="sl">·</span><span>Leads your agents</span></span>
              : <span className="crumb"><BotFace profile={chatWith} size={20} watch={false} poseKey={withBot?.poseKey} /><span className="cur">{withBot?.name ?? chatWith}</span>{withBot?.role ? <><span className="sl">·</span><span className="crole">{withBot.role}</span></> : null}</span>}
            <span className="sp" />
            <ChatSearchButton />
            <ChatSettingsButton />
            <button className={`hbtn nodrag${workOpen ? ' on' : ''}`} title={workOpen ? 'Hide the browser and terminal' : `Show ${isChiefChat ? 'Hermes' : withBot?.name ?? 'this agent'}’s ${lookKind() === 'screen' ? 'screen' : lookKind() === 'browser' ? 'browser' : 'commands'} and terminal beside the chat`} onClick={() => toggleWork()}><Icon name="screen" /></button>
            <button className={`hbtn nodrag${panel && !workOpen ? ' on' : ''}`} title={isChiefChat ? 'Show the side panel' : `${withBot?.name ?? 'This agent'}’s latest work`} onClick={() => (panel && !workOpen ? close() : open(isChiefChat ? getState().lastPanel ?? '__needs' : chatWith))}><Icon name="panelR" /></button>
          </div>
          {connection === 'open' || hasMsgs ? (
            <>
              <Chat key={`chat:${chatWith}`} />
              <ConnBar />
              <Composer key={`box:${chatWith}`} />
            </>
          ) : <ConnCenter />}
        </main>
      ) : view === 'made' ? <Made />
        : view === 'scheduled' ? <PageFrame icon="clock" title="Scheduled"><ScheduledPage profile="default" /></PageFrame>
        : view === 'settings' ? <Settings />
        : view === 'marketplace' ? <Marketplace />
        : view === 'projects' ? <Projects />
        : <Apps />}
      <aside className="rp" ref={rp}>{shown ? <div className="rp-grip" onPointerDown={drag} onDoubleClick={resetWidth} title="Drag to resize · double-click for the usual width" role="separator" aria-orientation="vertical" aria-label="Resize the side panel" /> : null}{shown ? (shown.startsWith('group:') ? <GroupPanel roomId={shown.slice(6)} onClose={close} />
        : isWorkKey(shown) ? <WorkPane panelKey={shown} onClose={close} />
        : <Panel profile={shown} onClose={close} />) : null}</aside>
      {quick ? <QuickActions onClose={() => setQuick(false)} /> : null}
      {toast ? <div className="toast" key={toast}>{toast}</div> : null}
      <ConfirmHost />
    </div>
  )
}
