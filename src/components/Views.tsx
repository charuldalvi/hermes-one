// The other pages in the sidebar: Made (files the team produced), Scheduled (jobs on a timer), Apps (later),
// and Quick actions (⌘K): jump to any bot, page or what needs you.
import { useEffect, useMemo, useRef, useState } from 'react'
import { openChat, toast } from '../lib/hermes'
import { rest } from '../lib/api'
import { Search, Tabs } from './ui'
import { baseName, splitMedia } from '../lib/markdown'
import { Icon } from '../lib/icons'
import { getState, setState, useStore } from '../lib/store'
import { lookKind, openWork } from './Work'
import { BotFace } from './BotFace'
import { openPanel } from './Sidebar'
import { openGroup } from '../lib/groups'
import { SETTINGS_PAGES } from './Settings'
import { getPrefs, setPref, type Prefs } from '../lib/prefs'

function Header({ title, sub }: { title: string; sub: string }) {
  return <><div className="hdr drag"><span className="crumb"><span className="cur">{title}</span></span></div><div className="view" style={{ paddingTop: 30 }}><h1>{title}</h1><p className="sub">{sub}</p></div></>
}

/** A picture's thumbnail, read through Hermes (its files route) only when the row scrolls into view. */
function Thumb({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const el = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const node = el.current
    if (!node) return
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      try { const r = await rest<any>('GET', `/api/fs/read-data-url?path=${encodeURIComponent(path)}`); if (r?.dataUrl) setSrc(r.dataUrl) } catch { /* not readable: keep the icon */ }
    }, { rootMargin: '200px' })
    io.observe(node)
    return () => io.disconnect()
  }, [path])
  return <span className="thumbt" ref={el}>{src ? <img src={src} alt="" /> : <Icon name="image" size={18} />}</span>
}

export function Made() {
  const msgs = useStore((s) => s.chief.messages)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'pictures' | 'videos' | 'files'>('all')
  // Grid (picture tiles) or List (full-width rows), remembered.
  const [layout, setLayout] = useState<Prefs['madeView']>(getPrefs().madeView)
  const files = useMemo(() => {
    const out: { path: string; at?: number; from?: string }[] = []
    const seen = new Set<string>()
    for (const m of [...msgs].reverse()) for (const f of splitMedia(m.text || '').files) { if (seen.has(f)) continue; seen.add(f); out.push({ path: f, at: m.endedAt ?? m.at, from: m.from }) }
    return out
  }, [msgs])
  const isPic = (p: string) => /\.(png|jpe?g|gif|webp|heic)$/i.test(p)
  const isVid = (p: string) => /\.(mp4|mov|webm|m4v)$/i.test(p)
  const t = q.trim().toLowerCase()
  const shown = files.filter((f) => (kind === 'all' || (kind === 'pictures' ? isPic(f.path) : kind === 'videos' ? isVid(f.path) : !isPic(f.path) && !isVid(f.path))) && (!t || f.path.toLowerCase().includes(t)))
  const open = async (p: string) => { const err = await window.hermesNative.openPath?.(p); if (err) toast(err) }
  return (
    <div className="chat">
      <div className="hdr drag"><span className="crumb"><Icon name="box" /><span className="cur">Made</span></span></div>
      <div className="view">
        <h1>Made</h1>
        <p className="sub">Everything the agents produced in your chat with Quicksilver, newest first. Click to open; ⌥-click shows it in Finder.</p>
        {files.length ? <div className="stools">
          <Search value={q} onChange={setQ} placeholder="Find a file" />
          <Tabs items={[{ key: 'all', label: 'All', count: files.length }, { key: 'pictures', label: 'Pictures', count: files.filter((f) => isPic(f.path)).length }, { key: 'videos', label: 'Videos', count: files.filter((f) => isVid(f.path)).length }, { key: 'files', label: 'Files' }]} value={kind} onChange={setKind} />
          <Tabs items={[{ key: 'grid', label: 'Grid', icon: 'tiles' }, { key: 'list', label: 'List', icon: 'list' }]} value={layout} onChange={(v) => { setLayout(v); setPref('madeView', v) }} />
        </div> : null}
        <div className={`list flow made ${layout === 'grid' ? 'made-grid' : 'made-rows'}`} key={layout}>
          {shown.length ? shown.map((f, i) => (
            <div className="item click" key={f.path + i} title={layout === 'grid' ? f.path.replace(/^\/Users\/[^/]+/, '~') : undefined} onClick={(e) => void (e.altKey ? window.hermesNative.reveal(f.path) : open(f.path))}>
              {isPic(f.path) ? <Thumb path={f.path} /> : <span className="thumbt"><Icon name={isVid(f.path) ? 'play' : 'file'} size={18} /></span>}
              <div className="tx"><div className="t1">{baseName(f.path)}</div><div className="t2">{f.path.replace(/^\/Users\/[^/]+/, '~')}</div></div>
              <span className="st">{f.at ? new Date(f.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}</span>
              <button className="hbtn" title="Show in Finder" onClick={(e) => { e.stopPropagation(); void window.hermesNative.reveal(f.path) }}><Icon name="folder" /></button>
            </div>
          )) : <p className="free">{files.length ? 'Nothing matches.' : 'Nothing yet. Files your agents make show up here as they arrive in the chat.'}</p>}
        </div>
      </div>
    </div>
  )
}

export function Apps() {
  return (
    <div className="chat">
      <div className="hdr drag"><span className="crumb"><Icon name="grid" /><span className="cur">Apps</span></span></div>
      <div className="center"><div className="box">
        <BotFace profile="default" size={144} mood="idle" disc={false} />
        <h2>Apps are coming</h2>
        <p>Small apps your agents build for you, like a timer or a dashboard, will live here. This part isn’t built yet.</p>
      </div></div>
    </div>
  )
}

interface QItem { key: string; section: string; label: string; hint: string; icon?: string; profile?: string; run: () => void }

/** Quick actions (⌘K): a command palette to jump to Quicksilver, an agent, a group, a page or a setting. */
export function QuickActions({ onClose }: { onClose: () => void }) {
  const bots = useStore((s) => s.bots)
  const needs = useStore((s) => s.needs)
  const rooms = useStore((s) => s.rooms)
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  const items = useMemo(() => {
    const focus = () => setTimeout(() => window.dispatchEvent(new Event('hermes:focus-composer')), 60)
    const waiting = needs.filter((n) => !n.outcome).length
    const all: QItem[] = [
      { key: 'qs', section: 'Quicksilver', label: 'Message Quicksilver', hint: 'Leads your agents', profile: 'default', run: () => { openChat('default'); focus() } },
      ...(waiting ? [{ key: 'needs', section: 'Quicksilver', label: 'What needs you', hint: `${waiting} waiting`, icon: 'alert', run: () => openPanel('__needs') }] : []),
      ...bots.filter((b) => !b.isChief).map((b) => ({ key: `a:${b.profile}`, section: 'Agents', label: b.name, hint: b.role ?? 'Agent', profile: b.profile, run: () => { openChat(b.profile); focus() } })),
      ...rooms.map((r) => ({ key: `g:${r.room_id}`, section: 'Groups', label: r.name, hint: `${r.members.length} agents`, icon: 'group', run: () => openGroup(r.room_id) })),
      { key: 'p:made', section: 'Pages', label: 'Made', hint: 'Files from the chat', icon: 'box', run: () => setState({ view: 'made' }) },
      { key: 'p:board', section: 'Pages', label: 'Board', hint: 'Kanban', icon: 'kanban', run: () => setState({ view: 'projects' }) },
      { key: 'p:sched', section: 'Pages', label: 'Scheduled', hint: 'Jobs', icon: 'clock', run: () => setState({ view: 'scheduled' }) },
      { key: 'p:apps', section: 'Pages', label: 'Apps', hint: 'Made by your agents', icon: 'grid', run: () => setState({ view: 'apps' }) },
      { key: 'p:market', section: 'Pages', label: 'Marketplace', hint: 'Plugins, skills, apps', icon: 'store', run: () => setState({ view: 'marketplace' }) },
      ...(lookKind() === 'screen' ? [{ key: 'p:screen', section: 'Pages', label: 'Screen', hint: 'Beside the chat', icon: 'screen', run: () => openWork('screen') }] : []),
      ...(lookKind() === 'browser' ? [{ key: 'p:browser', section: 'Pages', label: 'Browser', hint: 'The agent’s Chrome, beside the chat', icon: 'globe', run: () => openWork('browser') }] : []),
      { key: 'p:term', section: 'Pages', label: 'Terminal', hint: 'The agent’s commands, beside the chat', icon: 'terminal', run: () => openWork('term') },
      ...SETTINGS_PAGES.map((p) => ({ key: `s:${p.key}`, section: 'Settings', label: p.label, hint: 'Settings', icon: p.icon, run: () => setState({ view: 'settings', settingsPage: p.key }) })),
      { key: 'tidy', section: 'Chat', label: 'Tidy up the chat', hint: '/new', icon: 'refresh', run: () => window.dispatchEvent(new CustomEvent('hermes:send', { detail: '/new' })) },
    ]
    const t = q.trim().toLowerCase()
    return t ? all.filter((x) => `${x.label} ${x.hint} ${x.section}`.toLowerCase().includes(t)) : all
  }, [q, bots, needs, rooms])
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-k="${i}"]`)?.scrollIntoView({ block: 'nearest' }) }, [i])
  const run = (k: number) => { const it = items[k]; if (it) { onClose(); it.run() } }
  return (
    <div className="qpal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="qpal" role="dialog" aria-label="Quick actions">
        <div className="qpal-search">
          <Icon name="search" size={18} />
          <input ref={input} placeholder="Jump to an agent, a group, a page or a setting" value={q} aria-label="Search"
            onChange={(e) => { setQ(e.target.value); setI(0) }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onClose() }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(items.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(0, i - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); run(i) }
            }} />
          <kbd>esc</kbd>
        </div>
        <div className="qpal-list" ref={list} role="listbox">
          {items.length ? items.map((it, k) => (
            <div key={it.key} style={{ display: 'contents' }}>
              {k === 0 || items[k - 1].section !== it.section ? <div className="qpal-sec">{it.section}</div> : null}
              <button data-k={k} className={`qpal-row${k === i ? ' on' : ''}`} role="option" aria-selected={k === i} onMouseMove={() => { if (k !== i) setI(k) }} onClick={() => run(k)}>
                <span className="qpal-ic">{it.profile ? <BotFace profile={it.profile} size={28} mood="idle" poseKey={bots.find((b) => b.profile === it.profile)?.poseKey} watch={false} /> : <Icon name={it.icon ?? 'chevR'} size={17} />}</span>
                <span className="qpal-l">{it.label}</span>
                <span className="qpal-h">{it.hint}</span>
                {k === i ? <span className="qpal-go">↵ Open</span> : null}
              </button>
            </div>
          )) : <div className="qpal-none">Nothing matches “{q}”.</div>}
        </div>
        <div className="qpal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to open</span><span><kbd>esc</kbd> to close</span></div>
      </div>
    </div>
  )
}
