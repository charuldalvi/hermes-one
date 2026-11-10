// The right panel: the bot you clicked. What it does, what it's doing, its last piece of work (what it
// read and the steps it took, folded like the reference's trace), its answer, and anything it needs from you.
import { useEffect, useMemo, useState } from 'react'
import { loadPanel, openChat, prettyName, toolLabel } from '../lib/hermes'
import { baseName, elapsed, renderMarkdown, splitMedia } from '../lib/markdown'
import { Icon } from '../lib/icons'
import { botMood } from '../lib/moods'
import { useStore, type Msg, type ToolCall } from '../lib/store'
import { BotFace } from './BotFace'
import { NeedCard } from './NeedCard'
import { Tabs } from './ui'
import { prettyModel } from '../lib/api'
import { openGroup, useGroups } from '../lib/groups'
import { setState } from '../lib/store'

function sourcesOf(tools: ToolCall[]) {
  const out: { icon: string; text: string }[] = []
  for (const t of tools) {
    const a = t.args ?? {}
    if (t.name === 'read_file' || t.name === 'write_file' || t.name === 'patch') { const p = a.path ?? a.file_path; if (p) out.push({ icon: 'file', text: baseName(String(p)) }) }
    else if (t.name === 'search_files') out.push({ icon: 'search', text: String(a.pattern ?? a.query ?? 'files') })
    else if (t.name === 'web_search') out.push({ icon: 'search', text: String(a.query ?? 'the web') })
    else if (t.name === 'web_extract') { const u = a.url ?? (Array.isArray(a.urls) ? a.urls[0] : ''); if (u) { try { out.push({ icon: 'globe', text: new URL(String(u)).hostname }) } catch { out.push({ icon: 'globe', text: String(u).slice(0, 40) }) } } }
  }
  const seen = new Set<string>()
  return out.filter((s) => (seen.has(s.text) ? false : (seen.add(s.text), true)))
}

function Md({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} onClick={(e) => { const a = (e.target as HTMLElement).closest('a'); if (a?.href) { e.preventDefault(); void window.hermesNative.openExternal(a.href) } }} />
}

function Work({ ask, turn, live, step, since, run }: { ask?: Msg; turn?: Msg; live: boolean; step?: string; since?: number; run?: boolean }) {
  const [open, setOpen] = useState(true)
  const tools = turn?.tools ?? []
  const srcs = sourcesOf(tools)
  const steps = tools.filter((t) => !['read_file', 'search_files', 'web_search', 'web_extract'].includes(t.name)).map(toolLabel)
  const dur = turn?.startedAt && turn?.endedAt ? Math.max(1, Math.round((turn.endedAt - turn.startedAt) / 1000)) : 0
  const durText = dur < 60 ? `${dur}s` : `${Math.floor(dur / 60)}m ${String(dur % 60).padStart(2, '0')}s`
  return (
    <>
      {ask ? <div className="free" style={{ marginBottom: 18 }}><span style={{ color: 'var(--text-primary)' }}>{run ? 'The job' : ask.from === 'default' || !ask.from ? 'Hermes asked' : `${prettyName(ask.from)} asked`}:</span> {ask.text.length > 300 ? ask.text.slice(0, 300) + '…' : ask.text}</div> : null}
      {(tools.length || live) ? (
        <div className="trace">
          <button className="tr" onClick={() => setOpen(!open)}><span className="g"><Icon name={open ? 'chevD' : 'chevR'} size={15} /></span>{live ? `Working for ${elapsed(since)}` : `Worked for ${dur ? durText : 'a moment'}`}</button>
          {open ? (
            <>
              <div className="trline" />
              {srcs.length ? <><div className="tr"><span className="g"><Icon name="book" size={15} /></span>Read</div>
                <div className="srcs">{srcs.slice(0, 6).map((s) => <span className="src" key={s.text}><Icon name={s.icon} size={13} />{s.text}</span>)}{srcs.length > 6 ? <span className="src" style={{ background: 'none' }}>+{srcs.length - 6} more</span> : null}</div></> : null}
              {steps.slice(-8).map((s, i) => <div className="tr" key={i}><span className="g"><span className="sd" /></span><span className="tx">{s}</span></div>)}
              <div className="tr"><span className="g">{live ? <span className="sd run" /> : <span className="ok"><Icon name="check" size={10} /></span>}</span><span className="tx">{live ? (step ?? 'Working') : 'Done'}</span></div>
              <button className="less" onClick={() => setOpen(false)}>show less</button>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

/** The bot's own chat, read-only: who asked what, its answers, and the steps folded under each. */
function Transcript({ msgs, name }: { msgs: Msg[]; name: string }) {
  const shown = msgs.filter((m) => m.text || m.tools?.length).slice(-80)
  if (!shown.length) return <p className="free">{name} hasn’t chatted yet.</p>
  return (
    <div className="tscript">
      {shown.map((m) => m.role === 'user' ? (
        <div key={m.id} className="ts-ask"><span className="ts-who">{m.from && m.from !== 'default' ? prettyName(m.from) : 'Hermes'}</span><div className="ts-bub">{m.text.length > 1200 ? m.text.slice(0, 1200) + '…' : m.text}</div></div>
      ) : m.role === 'notice' ? (
        <div key={m.id} className="notice" style={{ margin: '0 0 18px' }}>{m.text}</div>
      ) : (
        <div key={m.id} className="ts-turn">
          {m.tools?.length ? <div className="ts-steps">{m.tools.slice(-6).map((t) => <span key={t.id} className="src"><Icon name="tool" size={12} />{toolLabel(t)}</span>)}{m.tools.length > 6 ? <span className="src" style={{ background: 'none' }}>+{m.tools.length - 6}</span> : null}</div> : null}
          {m.text ? <Md text={m.text} /> : null}
          {m.endedAt ? <div className="ts-when">{new Date(m.endedAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div> : null}
        </div>
      ))}
    </div>
  )
}

export function Panel({ profile, onClose }: { profile: string; onClose: () => void }) {
  const [tab, setTab] = useState<'work' | 'chat'>('work')
  useEffect(() => { setTab('work') }, [profile])
  const bots = useStore((s) => s.bots)
  const needs = useStore((s) => s.needs)
  const chats = useStore((s) => s.panelChat)
  const groupRooms = useGroups((s) => s.rooms)
  const groupViews = useGroups((s) => s.views)
  useStore((s) => s.tick)
  const bot = bots.find((b) => b.profile === profile)
  useEffect(() => { if (profile !== '__needs') void loadPanel(profile) }, [profile])

  const head = (crumb: React.ReactNode, name: string) => (
    <div className="hdr drag">
      <span className="crumb"><Icon name="users" /><span>Agents</span><span className="sl">/</span><span className="cur">{crumb}{name}</span></span>
      <span className="sp" />
      <button className="hbtn nodrag" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
    </div>
  )

  if (profile === '__needs') {
    const roomsWaiting = groupRooms.map((r) => ({ ...r, n: groupViews[r.room_id]?.state?.driver_status?.pending_actions?.length ?? 0 })).filter((r) => r.n > 0)
    const pending = needs.filter((n) => !n.outcome || Date.now() - n.at < 60_000)
    return (
      <div className="rpin">
        {head(null, 'Needs you')}
        <div className="rscroll"><div className="rcol needlist">
          {pending.length ? pending.map((n) => {
            const b = bots.find((x) => x.profile === n.profile)
            return (
              <div key={n.key} style={{ display: 'grid', gap: 14 }}>
                <div className="who"><BotFace profile={n.profile} size={32} mood={botMood(b, 40, needs)} poseKey={b?.poseKey} watch={false} />{b?.name ?? prettyName(n.profile)}</div>
                <NeedCard need={n} bot={b} />
              </div>
            )
          }) : !roomsWaiting.length ? <p className="free">Nothing needs you. Approvals and questions from any agent land here.</p> : null}
          {roomsWaiting.map((r) => (
            <button key={r.room_id} className="item click" onClick={() => openGroup(r.room_id)}>
              <Icon name="group" size={18} /><div className="tx"><div className="t1">{r.name || 'A group'}</div><div className="t2">{r.n} waiting in this group: open it to answer</div></div><Icon name="chevR" size={16} />
            </button>
          ))}
        </div></div>
      </div>
    )
  }

  const chat = chats[profile]
  const msgs = chat?.messages ?? []
  const lastTurnIdx = [...msgs].reverse().findIndex((m) => m.role === 'assistant')
  const turn = lastTurnIdx >= 0 ? msgs[msgs.length - 1 - lastTurnIdx] : undefined
  const turnPos = turn ? msgs.indexOf(turn) : -1
  const ask = turnPos > 0 ? [...msgs.slice(0, turnPos)].reverse().find((m) => m.role === 'user') : msgs.filter((m) => m.role === 'user').pop()
  const live = bot?.status === 'working'
  const { body, files } = splitMedia(turn?.text ?? '')
  const mine = needs.filter((n) => n.profile === profile && (!n.outcome || Date.now() - n.at < 60_000))
  const earlier = msgs.filter((m) => m.role === 'assistant' && m !== turn && m.text).slice(-4).reverse()

  return (
    <div className="rpin">
      {head(<BotFace profile={profile} size={22} mood={botMood(bot, 22, needs)} poseKey={bot?.poseKey} watch={false} />, bot?.name ?? prettyName(profile))}
      <div className="rscroll"><div className="rcol">
        <div className="btitle"><BotFace profile={profile} size={44} mood={botMood(bot, 44, needs)} poseKey={bot?.poseKey} watch />{bot?.name ?? prettyName(profile)}</div>
        <p className="brole">{bot?.role || 'One of your agents. Hermes hands it work when it fits.'}</p>
        <div className="ptabs">
          <Tabs items={[{ key: 'work', label: 'Latest work' }, { key: 'chat', label: chat?.source === 'run' ? 'The job' : 'Its chat', count: msgs.filter((m) => m.role !== 'notice').length || undefined }]} value={tab} onChange={setTab} />
          <span className="sp" />
          <button className="b-text sm" title="Model, role and personality" onClick={() => { onClose(); setState({ view: 'settings', settingsPage: 'team' }) }}><Icon name="sliders" size={14} />{bot?.model ? prettyModel(bot.model) : 'Settings'}</button>
          <button className="b-text sm" title="Refresh" onClick={() => void loadPanel(profile, true)}><Icon name="refresh" size={14} /></button>
        </div>
        {tab === 'chat' ? <Transcript msgs={msgs} name={bot?.name ?? prettyName(profile)} /> : <>
        {mine.map((n) => <div key={n.key} style={{ marginBottom: 22 }}><NeedCard need={n} bot={bot} /></div>)}
        {chat?.loading ? <p className="free">Loading its work…</p> : null}
        {!chat?.loading && !turn && !live ? <p className="free">No work yet. When Hermes hands {bot?.name ?? 'it'} something, you’ll see what it read, the steps it took and its answer here.</p> : null}
        {chat?.source === 'run' && turn ? <div className="free" style={{ marginBottom: 14 }}>Latest job from the board{chat.title ? `: ${chat.title}` : ''}</div> : null}
        {turn || live ? <Work ask={ask} turn={turn} live={!!live} step={bot?.step} since={bot?.since} run={chat?.source === 'run'} /> : null}
        {body && !live ? <div className="body"><Md text={body} /></div> : null}
        {files.length ? <div className="resrow" style={{ marginBottom: 20 }}>{files.map((f) => <span className="res" key={f} title={f}><Icon name="file" size={14} />{baseName(f)}</span>)}</div> : null}
        {earlier.length ? <>
          <div className="free" style={{ marginTop: 18, color: 'var(--text-secondary)' }}>Earlier</div>
          {earlier.map((m) => <div key={m.id} className="item" style={{ marginBottom: 8 }}><div className="tx"><div className="t1">{m.text.replace(/[#*_`>]/g, '').split('\n').find((l) => l.trim()) ?? ''}</div><div className="t2">{m.endedAt ? new Date(m.endedAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</div></div></div>)}
        </> : null}
        </>}
        <p className="ask"><button className="b-soft" onClick={() => openChat(profile)}><Icon name="chat" size={14} />Talk to {bot?.name ?? 'this agent'}</button></p>
      </div></div>
    </div>
  )
}
