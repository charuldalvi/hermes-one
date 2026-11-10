// The crew: who is working on what on this board, one card per bot (Hermes Remote's "Crew on this
// project"). Each says its part in one sentence, then lists its work: what it's on, what waits for
// you, what's stuck, what's coming; finished work folds away. Bots with nothing here sit at the end.
import { useMemo, useState } from 'react'
import * as kb from '../../lib/api-kanban'
import { Icon } from '../../lib/icons'
import type { Bot } from '../../lib/store'
import { Empty } from '../ui'
import { botName, cardTime, Face, StateLine, type CTask } from './parts'

interface Member { profile: string | null; cards: CTask[]; working?: CTask; yours: CTask[]; stuck: CTask[]; coming: CTask[]; done: CTask[] }

function sentence(m: Member): { text: string; tone: kb.Tone } {
  if (m.working) return { text: `Working on ${kb.shortTitle(m.working.t.title)}`, tone: 'run' }
  if (m.stuck[0]) return { text: `Stuck: ${(m.stuck[0].w as any).reason ?? kb.shortTitle(m.stuck[0].t.title)}`, tone: 'bad' }
  if (m.yours[0]) {
    const ask = (m.yours[0].w as any).ask
    const what = ask === 'check' ? 'Waiting for your check' : ask === 'answer' ? 'Waiting for your answer' : 'Waiting for you to start'
    return { text: what + (m.coming.length ? `, then ${m.coming.length} more` : ''), tone: 'need' }
  }
  if (m.coming.length) return { text: m.coming.length === 1 ? '1 thing coming up' : `${m.coming.length} things coming up`, tone: 'quiet' }
  return { text: m.done.length ? 'Done for now' : 'Nothing here yet', tone: 'quiet' }
}

const rank = (m: Member) => m.working ? 0 : m.yours.length || m.stuck.length ? 1 : m.coming.length ? 2 : m.done.length ? 3 : 4

export function CrewView({ cards, bots, onOpen, tick }: { cards: CTask[]; bots: Bot[]; onOpen: (id: string) => void; tick: number }) {
  void tick
  const members = useMemo(() => {
    const by = new Map<string, CTask[]>()
    for (const c of cards) {
      if (c.w.kind === 'away') continue
      const k = c.t.assignee ?? ''
      by.set(k, [...(by.get(k) ?? []), c])
    }
    const out: Member[] = [...by.entries()].map(([k, list]) => ({
      profile: k || null, cards: list,
      working: list.find((c) => c.w.kind === 'working'),
      yours: list.filter((c) => c.w.kind === 'yours'),
      stuck: list.filter((c) => c.w.kind === 'stuck'),
      coming: list.filter((c) => c.w.kind === 'coming').sort((a, b) => Number((b.w as any).next) - Number((a.w as any).next) || (b.t.priority ?? 0) - (a.t.priority ?? 0)),
      done: list.filter((c) => c.w.kind === 'done').sort((a, b) => (b.t.completed_at ?? 0) - (a.t.completed_at ?? 0)),
    }))
    // Work no one has yet goes last among the busy ones.
    return out.sort((a, b) => rank(a) - rank(b) || Number(!a.profile) - Number(!b.profile) || botName(a.profile, bots).localeCompare(botName(b.profile, bots)))
  }, [cards, bots])
  const free = useMemo(() => bots.filter((b) => !members.some((m) => m.profile === b.profile)).sort((a, b) => (a.isChief ? -1 : b.isChief ? 1 : a.name.localeCompare(b.name))), [bots, members])

  if (!members.length) return <Empty title="No one has work here yet" body="When Quicksilver hands out the work on this board, you’ll see who does what." />

  return (
    <div className="pj-crew flow">
      {members.map((m) => <MemberCard key={m.profile ?? '-'} m={m} bots={bots} onOpen={onOpen} />)}
      {free.length ? (
        <div className="pj-free">
          <span className="lab-s">Free on this board</span>
          <span className="faces">
            {free.map((b) => <span key={b.profile} className="pj-freebot" title={b.isChief ? 'Quicksilver' : b.name}><Face profile={b.profile} bots={bots} size={26} /><span>{b.isChief ? 'Quicksilver' : b.name}</span></span>)}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function MemberCard({ m, bots, onOpen }: { m: Member; bots: Bot[]; onOpen: (id: string) => void }) {
  const [showDone, setShowDone] = useState(false)
  const s = sentence(m)
  const open = [...m.cards.filter((c) => c.w.kind === 'working'), ...m.yours, ...m.stuck, ...m.coming]
  const mood = m.working ? 'thinking' as const : m.yours.length || m.stuck.length ? 'callout' as const : undefined
  return (
    <div className="card pj-mem">
      <div className="srow pj-memh">
        <Face profile={m.profile} bots={bots} size={34} mood={mood} />
        <div className="tx">
          <div className="t1"><span>{m.profile ? botName(m.profile, bots) : 'Not assigned yet'}</span></div>
          <div className={`pj-sent ${s.tone}`}>{s.tone === 'run' ? <i className="dot run" /> : null}<span>{s.text}</span></div>
        </div>
        <div className="act pj-counts">
          {open.length ? <span>{open.length} open</span> : null}
          {m.done.length ? <span>{m.done.length} done</span> : null}
        </div>
      </div>
      {open.map((c) => <Row key={c.t.id} c={c} onOpen={onOpen} />)}
      {m.done.length ? (
        <>
          <button className="pj-fold" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            <Icon name="chevR" size={14} /><span>Done · {m.done.length}</span><em>Latest: {kb.shortTitle(m.done[0].t.title)}</em>
          </button>
          {showDone ? m.done.map((c) => <Row key={c.t.id} c={c} onOpen={onOpen} dim />) : null}
        </>
      ) : null}
    </div>
  )
}

function Row({ c, onOpen, dim }: { c: CTask; onOpen: (id: string) => void; dim?: boolean }) {
  const meta = c.w.kind === 'coming' ? kb.columnLabel(c.t.status) : undefined
  return (
    <button className={`pj-trow${dim ? ' dim' : ''}`} onClick={() => onOpen(c.t.id)}>
      <span className="tt">{c.t.title}</span>
      {c.w.kind === 'coming' ? <span className="pj-state quiet"><span className="tx">{c.w.next ? 'Starts soon' : c.w.after ? `After ${c.w.after}` : meta}</span></span> : <StateLine w={c.w} />}
      <span className="pj-mi time">{cardTime(c)}</span>
    </button>
  )
}
