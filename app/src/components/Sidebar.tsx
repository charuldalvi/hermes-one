// The left column: Hermes, Chief (big, at the top: it leads the agents; click it for its chat), quick actions,
// then the agents (click one to talk to it directly: its chat takes the middle) and their groups where other
// apps list chats. The pages (Made, Board, Scheduled, Apps,
// Marketplace) are a short list pinned at the bottom, above Needs you, so they stay put however many agents
// there are; only the agents and groups scroll. A liquid highlight follows the pointer in each part, and the
// selection slides between rows on the same droplet springs.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { elapsed } from '../lib/markdown'
import { Icon } from '../lib/icons'
import { Liquid, pop } from '../lib/motion'
import { botMood } from '../lib/moods'
import { openChat, setGroupWaiting } from '../lib/hermes'
import { setState, useStore, type Bot, type State } from '../lib/store'
import { BotFace } from './BotFace'
import { HermesMenu } from './HermesMenu'
import { GroupsSection } from './Groups'
import { SystemButton } from './Systems'
import { isWorkKey, openWork, parseWorkKey } from './Work'
import { useGroupNeeds } from '../lib/groups'
import { chatRowProps } from '../lib/panes'

const APP_MARK = new URL('../assets/app-mark.png', import.meta.url).href
const PAGES: { view: State['view']; icon: string; label: string; title: string }[] = [
  { view: 'made', icon: 'box', label: 'Made', title: 'Everything made in the chat' },
  { view: 'projects', icon: 'kanban', label: 'Board', title: 'Board: Hermes’ kanban of work and who is doing it' },
  { view: 'scheduled', icon: 'clock', label: 'Scheduled', title: 'Scheduled jobs' },
  { view: 'apps', icon: 'grid', label: 'Apps', title: 'Apps your agents built' },
  { view: 'marketplace', icon: 'store', label: 'Marketplace', title: 'Marketplace: plugins, skills and apps' },
]

const HOV = new Liquid('hov')
const SEL = new Liquid('sel')
// The pinned pages have their own pair: a highlight lives inside the list it moves through.
const PHOV = new Liquid('hov')
const PSEL = new Liquid('sel')

export function openPanel(profile: string, from?: Element | null) {
  window.dispatchEvent(new CustomEvent('hermes:open-panel', { detail: { profile, from } }))
}

function StatusMark({ bot, waiting }: { bot: Bot; waiting: boolean }) {
  if (waiting || bot.status === 'needs') return <i className="dot need" title="Needs you" />
  if (bot.status === 'working') return <span className="st"><i className="dot run" />{elapsed(bot.since)}</span>
  if (bot.status === 'error') return <i className="dot bad" title="Something went wrong" />
  if (!bot.online || bot.status === 'asleep') return <span className="st">Asleep</span>
  return null
}

export function Sidebar({ onQuick }: { onQuick: () => void }) {
  const bots = useStore((s) => s.bots)
  const needs = useStore((s) => s.needs)
  const panel = useStore((s) => s.panel)
  const view = useStore((s) => s.view)
  const connection = useStore((s) => s.connection)
  const screenSupported = useStore((s) => !!s.screenSupported)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef<HTMLElement>(null)
  const pending = useMemo(() => needs.filter((n) => !n.outcome), [needs])
  const groupNeeds = useGroupNeeds()
  useEffect(() => { setGroupWaiting(groupNeeds) }, [groupNeeds])
  const waitingCount = pending.length + groupNeeds
  const team = useMemo(() => bots.filter((b) => !b.isChief), [bots])
  // Chief leads the team, so it sits at the top of it; its row opens the one chat.
  const chiefBot = bots.find((b) => b.isChief)
  const chiefBusy = useStore((s) => s.chief.busy)
  const chiefSince = useStore((s) => s.chief.turnStartedAt)
  const chiefNeeds = pending.some((n) => n.profile === 'default')
  // The screen sits beside the chat, so the chat stays selected while it shows.
  const screenOpen = isWorkKey(panel) && parseWorkKey(panel).kind === 'screen'
  const panelOpen = !!panel && panel !== '__needs' && !isWorkKey(panel)
  const chatWith = useStore((s) => s.chatWith)
  const groupOpen = useStore((s) => s.groupOpen)
  // Chats open beside the one in focus read a little brighter.
  const besides = useStore((s) => (s.view === 'chat' && s.panes.length > 1 ? s.panes.join('|') : ''))
  const beside = (key: string) => besides.split('|').includes(key)
  const chiefOn = view === 'chat' && !panelOpen && !groupOpen && chatWith === 'default'
  const chief: Bot = { ...(chiefBot ?? { profile: 'default', isChief: true, online: true, status: 'free' as const }), name: 'Hermes', role: 'Leads your agents. Talk to Hermes here.',
    ...(chiefBusy ? { status: 'working' as const, since: chiefSince } : {}) }
  const needN = useRef<HTMLSpanElement>(null)
  const lastCount = useRef(pending.length)

  useEffect(() => {
    const sc = scroller.current
    if (!sc) return
    sc.prepend(HOV.el); sc.prepend(SEL.el)
    pinned.current?.prepend(PHOV.el); pinned.current?.prepend(PSEL.el)
  }, [])

  const roomCount = useStore((s) => s.rooms.length)
  const selKey = panelOpen ? `bot:${panel}` : view === 'settings' ? 'none' : view === 'chat' && groupOpen ? `bot:group:${groupOpen}` : view === 'chat' && chatWith !== 'default' ? `bot:${chatWith}` : `view:${view}`
  const pageKey = view === 'chat' && screenOpen ? 'view:screen' : selKey
  const first = useRef({ list: true, pages: true })
  useLayoutEffect(() => {
    for (const [box, liq, key, sel] of [[scroller.current, SEL, 'list', selKey], [pinned.current, PSEL, 'pages', pageKey]] as const) {
      const row = box?.querySelector<HTMLElement>(`[data-sel="${sel}"]`)
      if (!row) { liq.hide(); continue }
      if (first.current[key]) { liq.snap(row); first.current[key] = false } else liq.moveTo(row)
    }
  }, [selKey, pageKey, team.length, roomCount, screenSupported])

  useEffect(() => { if (waitingCount !== lastCount.current) { pop(needN.current, 'need-count'); lastCount.current = waitingCount } }, [waitingCount])

  const go = (v: State['view']) => setState({ view: v })
  useStore((s) => s.tick) // working timers count up

  return (
    <aside className="side">
      <div className="side-top drag" />
      <div className="ws drag">
        <img className="appmark" src={APP_MARK} alt="" draggable={false} />
        <HermesMenu />
        <span className="sp" />
        {/* Quick actions, as a small hint beside Hermes (the full-width bar is gone): ⌘K jumps anywhere. */}
        <button className="qk nodrag" title="Quick actions: jump to an agent, a page or a setting (⌘K)" aria-label="Quick actions" onClick={onQuick}>
          <Icon name="search" size={13} /><kbd>⌘K</kbd>
        </button>
      </div>
      <button className={`chiefhero nodrag${chiefOn ? ' on' : ''}${!chiefOn && beside('default') ? ' in' : ''}`} title={'Hermes leads your agents. Talk to Hermes here.\n⌘-click or drag to open beside the other chats'}
        {...chatRowProps('default', () => openChat('default'))}>
        <BotFace profile="default" size={64} mood={botMood(chief, 64, pending)} poseKey={chief.poseKey} />
        <span className="ch-tx">
          <span className="ch-n">Hermes</span>
          <span className="ch-s">{chiefNeeds ? <><i className="dot need" />Needs you</> : chiefBusy ? <><i className="dot run" />Working · {elapsed(chiefSince)}</> : 'Leads your agents · Free'}</span>
        </span>
      </button>
      <div className="sscroll" ref={scroller}
        onPointerOver={(e) => { const row = (e.target as HTMLElement).closest<HTMLElement>('.row'); if (row) HOV.moveTo(row) }}
        onPointerLeave={() => HOV.hide()}>
        <div className="lab"><span>Agents</span>{team.length ? <span>{team.length}</span> : null}</div>
        {team.map((b) => {
          const waiting = pending.some((n) => n.profile === b.profile)
          return (
            <button key={b.profile} className={`row bot${selKey === `bot:${b.profile}` ? ' on' : beside(b.profile) ? ' in' : ''}`} data-sel={`bot:${b.profile}`} title={`${b.role ? `${b.role}\nClick to talk to ${b.name}` : `Talk to ${b.name}`}\n⌘-click or drag to open beside the other chats`}
              {...chatRowProps(b.profile, () => openChat(b.profile))}>
              <BotFace profile={b.profile} size={36} mood={botMood(b, 36, pending)} poseKey={b.poseKey} watch={false} />
              <span className="nm">{b.name}</span>
              <StatusMark bot={b} waiting={waiting} />
            </button>
          )
        })}
        {!team.length && connection === 'open' ? <div className="lab" style={{ height: 'auto', paddingTop: 4 }}>No agents yet. Ask Hermes to add one.</div> : null}
        <GroupsSection />
      </div>
      <nav className="pinpages nodrag" aria-label="Pages" ref={pinned}
        onPointerOver={(e) => { const row = (e.target as HTMLElement).closest<HTMLElement>('.row'); if (row) PHOV.moveTo(row) }}
        onPointerLeave={() => PHOV.hide()}>
        {PAGES.map((pg) => (
          <button key={pg.view} className={`row${view === pg.view && !panelOpen ? ' on' : ''}`} data-sel={`view:${pg.view}`} title={pg.title} onClick={() => go(pg.view)}>
            <Icon name={pg.icon} /><span className="nm">{pg.label}</span>
          </button>
        ))}
        {screenSupported ? (
          <button className={`row${pageKey === 'view:screen' ? ' on' : ''}`} data-sel="view:screen" title="The agent screen, beside the chat" onClick={() => (screenOpen ? window.dispatchEvent(new CustomEvent('hermes:close-panel')) : openWork('screen'))}>
            <Icon name="screen" /><span className="nm">Screen</span>
          </button>
        ) : null}
      </nav>
      <div className="foot">
        {waitingCount
          ? <button className={`needcard${panel === '__needs' ? ' on' : ''}`} onClick={(e) => openPanel('__needs', e.currentTarget.querySelector('.ring'))}>
              <span className="ring" style={{ ['--p' as any]: `${Math.min(100, 34 * waitingCount)}%` }} />Needs you<span className="n" ref={needN}>{waitingCount}</span>
            </button>
          : <div className="needcard calm"><span className="ring" style={{ ['--p' as any]: '0%' }} />Nothing needs you</div>}
        <SystemButton settingsOn={view === 'settings'} onSettings={() => { window.dispatchEvent(new CustomEvent('hermes:close-panel')); go('settings') }} />
      </div>
    </aside>
  )
}

