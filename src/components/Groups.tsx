// Group rooms (Bot Mode's Group Chats): a room of 2–6 bots working together. The sidebar lists each room
// with its members' faces stacked and a live mark (working timer, amber when it needs you); the right panel
// shows one room like a bot's panel: who's in it and what each is doing, the conversation, anything waiting
// on you, and a composer that posts to the room. New groups are made in a dialog (Settings › Team).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  actOnRoom, approvalPreview, continueRoom, createGroup, disbandRoom, downloadAttachment, fetchAttachment, groupError,
  isBounded, isBusy, loadCaps, MAX_FILE_BYTES, MAX_FILES, memberName, memberStatuses, offers, openGroup,
  pausedDiscussions, admittedNothing, refreshRoom, renameRoom, roomDeliveryTarget, roomHandoffs, roomSummary, roundText, routingText,
  sendToRoom, setRoomContext, since, startGroups, stopRoom, uploadToRoom, useGroups, useRoom, useRoomView, useWatchRoom,
  type MemberStatus, type PendingAction, type Room, type RoomAttachment, type RoomContext, type RoomEvent, type RoomMember,
  type RoomView, type Routing,
} from '../lib/groups'
import { arrangeTeam } from '../lib/arrange'
import { toast, toolLabel } from '../lib/hermes'
import { Icon } from '../lib/icons'
import { lookOf } from '../lib/looks'
import { renderMarkdown } from '../lib/markdown'
import { useStore, type Bot } from '../lib/store'
import { BotFace, type Mood } from './BotFace'
import { confirm, Dialog, Empty, ErrorLine, Spinner, Tabs } from './ui'
import '../styles/groups.css'

// ---------- small shared parts ----------

/** Re-render once a second while `on` (working timers). */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}

const clock = (s?: number) => (s ? new Date(s * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '')
function dayLabel(s: number) {
  const d = new Date(s * 1000), now = new Date(), y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

function usePoses() {
  const bots = useStore((s) => s.bots)
  return useMemo(() => new Map(bots.map((b) => [b.profile, b])), [bots])
}

/** Members' faces, overlapping, the first on top. The first face is the one that flies into the panel. */
export function FaceStack({ members, size, max = 3, moods, className }: { members: RoomMember[]; size: number; max?: number; moods?: Map<string, Mood>; className?: string }) {
  const bots = usePoses()
  // Side by side with a small gap, never overlapping (each bead is drawn a little larger than its disc, so
  // overlapped discs ran into each other); after `max` beads a plain "+N" names how many more.
  const shown = members.slice(0, max)
  const extra = members.length - shown.length
  return (
    <span className={`gstack ${className ?? ''}`} style={{ ['--gs' as any]: `${size}px` }}>
      {shown.map((m, i) => (
        <span className="gface" key={m.member_id} title={memberName(m)}>
          <BotFace profile={m.profile} size={size} mood={moods?.get(m.member_id) ?? 'idle'} poseKey={bots.get(m.profile)?.poseKey} watch={false} />
        </span>
      ))}
      {extra > 0 ? <span className="gface gmore" title={members.slice(shown.length).map(memberName).join(', ')}>+{extra}</span> : null}
    </span>
  )
}

function moodsFor(view: RoomView | undefined, size: number, statuses?: Map<string, MemberStatus>): Map<string, Mood> {
  const out = new Map<string, Mood>()
  const needs = new Set((view?.state?.driver_status?.pending_actions ?? []).map((a) => a.member_id))
  const active = roomSummary(view).activeMembers
  for (const m of view?.state?.room?.members ?? []) {
    if (needs.has(m.member_id)) out.set(m.member_id, size >= 40 ? 'hand' : 'callout')
    else if (active.has(m.member_id) || isBusy(statuses?.get(m.member_id))) out.set(m.member_id, 'thinking')
  }
  return out
}

const Md = memo(function Md({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} onClick={(e) => { const a = (e.target as HTMLElement).closest('a'); if (a?.href) { e.preventDefault(); void window.hermesNative.openExternal(a.href) } }} />
})

// ---------- sidebar ----------

function GroupMark({ view, count }: { view: RoomView | undefined; count: number }) {
  const s = roomSummary(view)
  const now = useNow(s.working && !s.needs)
  if (s.needs) return <i className="dot need" title="Needs you" />
  if (s.working) return <span className="st"><i className="dot run" />{s.since ? since(s.since, now) : ''}</span>
  if (s.problem) return <i className="dot bad" title={s.problem} />
  if (s.asleep) return <span className="st" title="Groups aren’t running in Hermes right now">Asleep</span>
  return <span className="gcount" title={`${count} agents`}>{count}</span>
}

function GroupRow({ room, on }: { room: Room; on: boolean }) {
  const view = useRoomView(room.room_id)
  const moods = useMemo(() => moodsFor(view, 26), [view])
  const s = roomSummary(view)
  const who = room.members.map(memberName).join(', ')
  return (
    <button className={`row bot grow${on ? ' on' : ''}`} data-sel={`bot:group:${room.room_id}`}
      title={s.needs ? `${room.name} needs you` : `${room.name} · ${who}`}
      onClick={(e) => openGroup(room.room_id, e.currentTarget.querySelector('.face'))}>
      <FaceStack members={room.members} size={26} max={3} moods={moods} />
      <span className="nm">{room.name}</span>
      <GroupMark view={view} count={room.members.length} />
    </button>
  )
}

/** The sidebar's Groups: one row per live room, then "New group". Mount it inside the sidebar's scroller. */
export function GroupsSection() {
  useEffect(() => { startGroups() }, [])
  const rooms = useGroups((s) => s.rooms)
  const phase = useGroups((s) => s.phase)
  const error = useGroups((s) => s.error)
  const panel = useStore((s) => s.panel)
  const connection = useStore((s) => s.connection)
  const [creating, setCreating] = useState(false)
  const bots = useStore((s) => s.bots.filter((b) => !b.isChief).length)
  return (
    <>
      <div className="lab"><span>Groups</span>
        <span className="gacts">
          <button className="garr" disabled={connection !== 'open' || bots < 2} title="Quicksilver sorts the agents into groups by craft, like a film crew or a research desk" onClick={() => void arrangeTeam({ asked: true })}>
            <Icon name="spark" size={12} />Let Quicksilver arrange</button>
          <button className="garr gadd" disabled={connection !== 'open'} title="New group" aria-label="New group" onClick={() => setCreating(true)}><Icon name="plus" size={13} /></button>
        </span></div>
      {rooms.map((r) => <GroupRow key={r.room_id} room={r} on={panel === `group:${r.room_id}`} />)}
      {phase === 'error' && !rooms.length ? <div className="lab gnote-side" title={error}>Groups couldn’t load. Retrying…</div> : null}
      {!rooms.length && phase !== 'error' ? <button className="row gnew" disabled={connection !== 'open'} onClick={() => setCreating(true)}><span className="gplus"><Icon name="plus" size={13} /></span><span className="nm">New group</span></button> : null}
      <NewGroupDialog open={creating} onClose={() => setCreating(false)} />
    </>
  )
}

// ---------- the room panel ----------

const STATUS_TEXT: Record<MemberStatus['kind'], string> = {
  idle: 'Free', queued: 'Waiting for a turn', working: 'Working', stalled: 'No progress lately', replied: 'Replied',
  passed: 'Had nothing to add', failed: 'Went wrong', cancelled: 'Stopped', unavailable: 'Couldn’t be reached',
}

/** What a member is doing now; when it's free, what it's for (its role on the team). */
function StatusLine({ status, now, needs, role }: { status: MemberStatus; now: number; needs: boolean; role: string }) {
  if (needs) return <span className="gst"><i className="dot need" />Needs you</span>
  if (status.kind === 'working' || status.kind === 'stalled') {
    const doing = status.tool ? toolLabel({ name: status.tool }) : status.kind === 'stalled' ? `No progress for ${since(now - (status.quietS ?? 0) * 1000, now)}` : 'Working'
    return <span className="gst" title={doing}><i className="dot run" /><span className="gdo">{doing}</span>{status.since ? <em>{since(status.since * 1000, now)}</em> : null}</span>
  }
  if (status.kind === 'failed') return <span className="gst" title={status.detail ?? status.reason}><i className="dot bad" />Went wrong{status.reason ? <em className="gdo">· {status.reason}</em> : null}</span>
  if (status.kind === 'idle') return <span className="gst quiet" title={role}><span className="gdo">{role}</span></span>
  return <span className="gst" title={role}>{STATUS_TEXT[status.kind]}</span>
}

function Members({ members, statuses, view, lead, now }: { members: RoomMember[]; statuses: Map<string, MemberStatus>; view: RoomView | undefined; lead?: string; now: number }) {
  const bots = usePoses()
  const needs = new Set((view?.state?.driver_status?.pending_actions ?? []).map((a) => a.member_id))
  return (
    <div className="gmembers flow">
      {members.map((m) => {
        const st = statuses.get(m.member_id) ?? { kind: 'idle' as const }
        const bot = bots.get(m.profile)
        const role = bot?.isChief ? 'Leads your agents' : bot?.role || 'One of your agents'
        const mood: Mood = needs.has(m.member_id) ? 'callout' : isBusy(st) ? (st.kind === 'working' && st.tool?.startsWith('write') ? 'writing' : 'thinking') : 'idle'
        return (
          <div className="gmem" key={m.member_id} title={`${memberName(m)} · ${role}`}>
            <BotFace profile={m.profile} size={30} mood={mood} poseKey={bot?.poseKey} watch={false} />
            <div className="tx">
              <div className="t1"><span className="n">{memberName(m)}</span>{lead === m.member_id ? <span className="badge quiet">Lead</span> : null}<span className="h">@{m.handle}</span></div>
              <StatusLine status={st} now={now} needs={needs.has(m.member_id)} role={role} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Room files: chips with Download; images under 5 MB also show inline once they scroll near.
const previews = new Map<string, Promise<string>>()
function ImagePreview({ roomId, eventId, a }: { roomId: string; eventId: string; a: RoomAttachment }) {
  const [src, setSrc] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    let alive = true
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      const key = `${roomId}|${eventId}|${a.attachment_id}`
      let p = previews.get(key)
      if (!p) { p = fetchAttachment(roomId, eventId, a.attachment_id).then((b) => URL.createObjectURL(b)); previews.set(key, p); p.catch(() => previews.delete(key)) }
      p.then((u) => { if (alive) setSrc(u) }, () => {})
    }, { rootMargin: '240px' })
    io.observe(el)
    return () => { alive = false; io.disconnect() }
  }, [roomId, eventId, a.attachment_id])
  return <div className="gimg" ref={box}>{src ? <img src={src} alt={a.name} /> : null}</div>
}

function Files({ roomId, event, canDownload }: { roomId: string; event: RoomEvent; canDownload: boolean }) {
  const list = event.payload.attachments ?? []
  const [busy, setBusy] = useState<string | null>(null)
  if (!list.length) return null
  const eventId = event.event_id
  const save = async (a: RoomAttachment) => {
    if (!eventId) return
    setBusy(a.attachment_id)
    try { await downloadAttachment(roomId, eventId, a) } catch (e) { toast(`Couldn’t download ${a.name}: ${groupError(e)}`) } finally { setBusy(null) }
  }
  return (
    <>
      {canDownload && eventId ? list.filter((a) => a.kind === 'image' && a.size <= 5 * 1024 * 1024).map((a) => <ImagePreview key={a.attachment_id} roomId={roomId} eventId={eventId} a={a} />) : null}
      <div className="resrow">
        {list.map((a) => (
          <button className="res gfile" key={a.attachment_id} title={canDownload ? `Download ${a.name}` : a.name} disabled={!canDownload || !eventId || busy === a.attachment_id} onClick={() => void save(a)}>
            <Icon name={a.kind === 'image' ? 'image' : 'file'} size={14} />{a.name}
            {canDownload ? (busy === a.attachment_id ? <Spinner size={11} /> : <Icon name="download" size={13} />) : null}
          </button>
        ))}
      </div>
    </>
  )
}

/** The colour an @name is shown in: the agent's own bead colour; Quicksilver and @everyone in the accent blue.
 *  Undefined when the name isn't in the group (it stays plain text). */
function mentionColor(handle: string, members: RoomMember[]): string | undefined {
  const h = handle.toLowerCase().replace(/[.]+$/, '')
  if (h === 'all' || h === 'everyone') return 'var(--blue-500)'
  const m = members.find((x) => x.handle.toLowerCase() === h)
  if (!m) return undefined
  return m.profile === 'default' ? 'var(--blue-500)' : lookOf(m.profile)?.color ?? 'var(--blue-500)'
}

/** Text with each @name of a group member picked out in that agent's colour. */
function Mentions({ text, members }: { text: string; members: RoomMember[] }) {
  const parts = text.split(/(@[\w.-]+)/g)
  return <>{parts.map((p, i) => {
    const c = p.startsWith('@') ? mentionColor(p.slice(1), members) : undefined
    return c ? <span className="men" key={i} style={{ ['--men' as any]: c }}>{p}</span> : p
  })}</>
}

/** Your words, with the @names you addressed picked out. */
function WithMentions({ text, members }: { text: string; members: RoomMember[] }) {
  return <Mentions text={text} members={members} />
}

interface LogCtx {
  roomId: string
  members: Map<string, RoomMember>
  roster: RoomMember[]
  canDownload: boolean
  pauses: Map<number, { count: number; actionable: boolean }>
  busy: boolean
  onContinue: (discussion: string) => void
  onStop: () => void
  onReply: (m: RoomMember, text: string, thread?: string) => void
}

function Note({ children, tone, detail }: { children: ReactNode; tone?: 'bad' | 'ok'; detail?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`gnote${tone ? ` ${tone}` : ''}`}>
      {tone === 'bad' ? <i className="dot bad" /> : <span className="gline" />}
      <span className="gnt">{children}</span>
      {detail ? <button className="gmore-b" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Details'}</button> : null}
      {open && detail ? <pre className="gdetail">{detail}</pre> : null}
    </div>
  )
}

function MemberMessage({ e, ctx }: { e: RoomEvent; ctx: LogCtx }) {
  const [more, setMore] = useState(false)
  const bots = usePoses()
  const id = e.actor?.kind === 'member' ? e.actor.id ?? '' : String(e.payload.member_id ?? '')
  const m = ctx.members.get(id)
  const profile = m?.profile ?? e.actor?.profile ?? id
  const name = e.actor?.display_name || (m ? memberName(m) : id || 'An agent')
  const text = String(e.payload.text ?? e.payload.content ?? '')
  const long = text.length > 900
  return (
    <div className="turn gturn">
      <div className="who">
        <BotFace profile={profile} size={28} poseKey={bots.get(profile)?.poseKey} watch={false} />{name}
        <span className="when">{clock(e.created_at)}</span>
        {m && text ? <button className="greply" title={`Reply to ${name}`} onClick={() => ctx.onReply(m, text, typeof e.payload.thread_id === 'string' ? e.payload.thread_id : undefined)}><Icon name="chat" size={14} />Reply</button> : null}
      </div>
      {text ? <div className={long && !more ? 'gclip' : undefined}><Md text={text} /></div> : null}
      {long ? <button className="fold" onClick={() => setMore(!more)}>{more ? 'Show less' : 'Show all'}</button> : null}
      <Files roomId={ctx.roomId} event={e} canDownload={ctx.canDownload} />
    </div>
  )
}

function LogItem({ e, ctx }: { e: RoomEvent; ctx: LogCtx }) {
  const p = e.payload
  const nameOf = (id?: unknown) => { const m = ctx.members.get(String(id ?? '')); return m ? memberName(m) : String(id || 'An agent') }
  const names = (ids: unknown) => (Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && ctx.members.has(x)).map(nameOf) : [])
  const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)
  switch (e.kind) {
    case 'message.user': case 'message': {
      if (e.actor?.kind === 'member') return <MemberMessage e={e} ctx={ctx} />
      const text = String(p.text ?? p.content ?? '')
      if (/^cron(-notice)?:/.test(e.actor?.id ?? '')) {
        return (
          <div className="turn gturn">
            <div className="who"><span className="gtile"><Icon name="clock" size={15} /></span>Scheduled job<span className="when">{clock(e.created_at)}</span></div>
            {text ? <Md text={text} /> : null}
            <Files roomId={ctx.roomId} event={e} canDownload={ctx.canDownload} />
          </div>
        )
      }
      return (
        <div className="you gyou">
          {text ? <WithMentions text={text} members={ctx.roster} /> : null}
          {p.attachments?.length ? <div className="gyoufiles"><Files roomId={ctx.roomId} event={e} canDownload={ctx.canDownload} /></div> : null}
        </div>
      )
    }
    case 'message.member': return <MemberMessage e={e} ctx={ctx} />
    case 'turn.failed': {
      const err = String(p.error ?? '')
      return <Note tone="bad" detail={err || String(p.reason_code ?? '') || undefined}>{nameOf(p.member_id)} couldn’t finish</Note>
    }
    case 'turn.cancelled': return <Note>{nameOf(p.member_id)} stopped</Note>
    case 'turn.deferred': return <Note tone="bad">{p.reason === 'member_unavailable' ? `${nameOf(p.member_id)} couldn’t be reached, so its turn is on hold` : `${nameOf(p.member_id)}’s turn is on hold`}</Note>
    case 'member.unavailable': return <Note tone="bad">An agent in this group couldn’t be reached</Note>
    case 'room.stop_requested': return <Note>Stopped</Note>
    case 'room.activity': {
      if (p.status === 'settled') return <Note tone="ok">Done. Nobody had more to add.</Note>
      if (!isBounded(e)) return null
      const pause = ctx.pauses.get(e.seq)
      const what = p.reason_code === 'max_messages' ? 'message limit' : 'round limit'
      return (
        <div className="gnote gpause">
          <span className="gline" />
          <span className="gnt">{pause ? `Paused after ${pause.count} ${pause.count === 1 ? 'message' : 'messages'} (the ${what})` : `Reached the ${what}`}</span>
          {pause?.actionable ? <>
            <button className="b-soft sm" disabled={ctx.busy} onClick={() => ctx.onContinue(String(p.discussion_event_id ?? ''))}>Continue</button>
            <button className="b-text sm" onClick={ctx.onStop}>Stop</button>
          </> : null}
        </div>
      )
    }
    case 'room.routed': {
      const n = names(p.member_ids)
      const t = p.fallback ? 'Couldn’t choose who answers, so everyone will' : p.everyone ? 'Assigned to everyone' : n.length ? `Assigned to ${list(n)}` : ''
      return t ? <Note>{t}</Note> : null
    }
    case 'room.assignment': {
      const lead = nameOf(p.lead_member_id)
      return <Note>{p.fallback ? `${lead} is taking this` : `${lead} gave this to ${list(names(p.member_ids)) || 'the group'}`}</Note>
    }
    case 'room.continued': return <Note>Continued</Note>
    case 'room.renamed': return typeof p.name === 'string' ? <Note>Renamed to “{p.name}”</Note> : null
    case 'room.context_set': return <Note>Group settings changed{typeof p.purpose === 'string' && p.purpose ? `: ${p.purpose}` : ''}</Note>
    case 'room.created': return <Note>Group started</Note>
    case 'room.members_changed': return <Note>Members changed</Note>
    case 'authority.lost': return <Note tone="bad">This group is now run by another Hermes</Note>
    case 'room.disbanded': return <Note>Group deleted</Note>
    default: return null
  }
}

const PAGE = 80

function RoomLog({ view, ctx }: { view: RoomView; ctx: LogCtx }) {
  const [shown, setShown] = useState(PAGE)
  const events = view.events
  const handoffs = useMemo(() => roomHandoffs(events, ctx.roster), [events, ctx.roster])
  const start = Math.max(0, events.length - shown)
  let prevDay = ''
  return (
    <div className="glog">
      {start > 0 ? <button className="older" onClick={() => setShown(shown + PAGE)}>Show earlier messages</button> : null}
      {events.slice(start).map((e) => {
        const day = e.created_at ? dayLabel(e.created_at) : ''
        const showDay = !!day && day !== prevDay && (e.kind.startsWith('message') || prevDay === '')
        if (showDay) prevDay = day
        return (
          <div key={e.seq} style={{ display: 'contents' }}>
            {showDay ? <div className="day">{day}</div> : null}
            <LogItem e={e} ctx={ctx} />
            {handoffs.get(e.seq)?.map((h) => <Note key={`${e.seq}:${h.to}`}>{memberName(ctx.members.get(h.from) ?? { member_id: h.from, profile: h.from, handle: h.from })} asked {memberName(ctx.members.get(h.to) ?? { member_id: h.to, profile: h.to, handle: h.to })}</Note>)}
          </div>
        )
      })}
    </div>
  )
}

function Typing({ members, statuses, now }: { members: RoomMember[]; statuses: Map<string, MemberStatus>; now: number }) {
  const bots = usePoses()
  const busy = members.filter((m) => isBusy(statuses.get(m.member_id)))
  if (!busy.length) return null
  return (
    <div className="gtyping-list">
      {busy.map((m) => {
        const st = statuses.get(m.member_id) as Extract<MemberStatus, { kind: 'working' | 'stalled' }>
        const doing = st.tool ? toolLabel({ name: st.tool }) : st.kind === 'stalled' ? 'hasn’t made progress for a while' : 'is working'
        return (
          <div className="gtyping" key={m.member_id}>
            <BotFace profile={m.profile} size={26} mood={st.tool?.startsWith('write') ? 'writing' : 'thinking'} poseKey={bots.get(m.profile)?.poseKey} watch={false} />
            <span><b>{memberName(m)}</b> {st.tool ? `· ${doing}` : doing}…</span>
            {st.since ? <span className="tm">{since(st.since * 1000, now)}</span> : null}
          </div>
        )
      })}
    </div>
  )
}

/** Something the room is waiting on, named by the bot that needs it: an approval, a turn to retry or discard. */
function NeedCard({ roomId, action, member, lastError, canAct }: { roomId: string; action: PendingAction; member?: RoomMember; lastError?: string | null; canAct: (method: string) => boolean }) {
  const [busy, setBusy] = useState<string | null>(null)
  const who = member ? memberName(member) : action.member_id || 'An agent'
  const run = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label)
    try { await fn(); if (done) toast(done) } catch (e) { toast(groupError(e)); void refreshRoom(roomId) } finally { setBusy(null) }
  }
  if (action.kind === 'approval') {
    const pv = approvalPreview(action)
    return (
      <div className="plan">
        <div className="ph"><span className="tile"><Icon name="terminal" size={18} /></span><span className="tt">{pv.description || 'Run a command'}</span><span className="cnt">{who} asks</span></div>
        <div className="pb">
          {pv.command ? <div className="cmd">{pv.command}</div> : null}
          <div className="why">{pv.reviewable ? `${who} needs your OK before it does this. The group waits until you answer.` : 'The details of this request aren’t here yet. Check again before you allow it.'}</div>
        </div>
        <div className="ft">
          {pv.choices.includes('deny') && canAct('groups.approve') ? <button className="b-text" disabled={!!busy} onClick={() => void run('deny', () => actOnRoom(roomId, action, 'deny'), 'Denied')}>{busy === 'deny' ? 'Denying…' : 'Deny'}</button> : null}
          <span className="sp" />
          {!pv.reviewable ? <button className="b-soft" disabled={!!busy} onClick={() => void refreshRoom(roomId)}>Check again</button> : null}
          {pv.reviewable && pv.choices.includes('once') && canAct('groups.approve') ? <button className="b-pri" disabled={!!busy} onClick={() => void run('once', () => actOnRoom(roomId, action, 'once'), 'Approved')}>{busy === 'once' ? 'Approving…' : 'Approve & Run'}</button> : null}
        </div>
      </div>
    )
  }
  const stall = action.task_id.startsWith('prepare:')
  if (action.kind === 'retry') {
    return (
      <div className="plan">
        <div className="ph"><span className="tile"><Icon name="refresh" size={18} /></span><span className="tt">{stall ? 'The group couldn’t get started' : `${who} couldn’t be reached`}</span><span className="cnt">Needs you</span></div>
        <div className="pb"><div className="why">{stall ? (lastError || `Hermes couldn’t wake ${action.member_id || 'the agents'}.`) + ' Try again when Hermes is ready.' : `${who}’s turn is on hold. Try again when it’s back.`}</div></div>
        <div className="ft"><span className="sp" />{canAct('groups.retry') ? <button className="b-soft" disabled={!!busy} onClick={() => void run('retry', () => actOnRoom(roomId, action), 'Trying again')}>{busy ? 'Trying…' : 'Try again'}</button> : null}</div>
      </div>
    )
  }
  if (action.kind === 'discard') {
    const discard = async () => {
      const ok = await confirm({ title: `Discard ${who}’s unfinished turn?`, body: 'It stopped part-way and may already have changed things that weren’t recorded. Discarding lets the group move on; it doesn’t undo anything.', action: 'Discard', danger: true })
      if (ok) await run('discard', () => actOnRoom(roomId, action), 'Discarded')
    }
    return (
      <div className="plan">
        <div className="ph"><span className="tile"><Icon name="alert" size={18} /></span><span className="tt">{who}’s turn stopped part-way</span><span className="cnt">Needs you</span></div>
        <div className="pb"><div className="why">Hermes can’t tell whether it finished. The group waits until you decide.</div></div>
        <div className="ft"><span className="sp" />{canAct('groups.discard') ? <button className="b-ghost-danger" disabled={!!busy} onClick={() => void discard()}>{busy ? 'Discarding…' : 'Discard…'}</button> : null}</div>
      </div>
    )
  }
  return null
}

/** Keep the conversation pinned to its newest line unless you scrolled up to read. */
function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const el = ref.current
    const content = el?.firstElementChild
    if (!el || !content) return
    const onScroll = () => { pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }
    const follow = () => { if (pinned.current) el.scrollTop = el.scrollHeight }
    const ro = new ResizeObserver(follow)
    el.addEventListener('scroll', onScroll)
    ro.observe(content)
    ro.observe(el)
    follow()
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect() }
  }, [dep])
  return { ref, pin: () => { pinned.current = true; const el = ref.current; if (el) el.scrollTop = el.scrollHeight } }
}

/** The right-panel view of one group. `roomId` is the panel id without its `group:` prefix. Keyed by room, so
 *  another room never inherits this one's draft, reply or scroll. */
export function GroupPanel({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  return <RoomPanel key={roomId} roomId={roomId} onClose={onClose} />
}

function RoomPanel({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  useWatchRoom(roomId)
  const view = useRoomView(roomId)
  const listed = useRoom(roomId)
  const caps = useGroups((s) => s.caps)
  const [settings, setSettings] = useState(false)
  const [reply, setReply] = useState<{ member: RoomMember; quote: string; thread?: string } | null>(null)
  const [continuing, setContinuing] = useState(false)
  const room = view?.state?.room ?? listed
  const members = room?.members ?? []
  const driver = view?.state?.driver_status
  const ctxState = view?.state?.context
  const working = roomSummary(view).working
  const now = useNow(working)
  const statuses = useMemo(() => memberStatuses(view, now / 1000), [view, now])
  const moods = useMemo(() => moodsFor(view, 44, statuses), [view, statuses])
  const byId = useMemo(() => new Map(members.map((m) => [m.member_id, m])), [members])
  const pauses = useMemo(() => (typeof driver?.max_continues === 'number' ? pausedDiscussions(view?.events ?? [], driver.max_continues) : new Map()), [view?.events, driver?.max_continues])
  const lead = ctxState?.routing === 'lead' ? ctxState.lead_member_id : undefined
  const { ref: scroller, pin } = useStickToBottom(view?.logLoaded)
  const canAct = (method: string) => offers(caps, method)
  const actions = driver?.pending_actions ?? []

  const stop = useCallback(async () => {
    try { const n = await stopRoom(roomId); toast(n ? 'Stopped' : 'Nothing was running') } catch (e) { toast(groupError(e)) }
  }, [roomId])
  const logCtx: LogCtx = {
    roomId, members: byId, roster: members, canDownload: canAct('groups.attachment.download'), pauses, busy: continuing,
    onContinue: (d) => { setContinuing(true); continueRoom(roomId, d).then(() => toast('Continuing'), (e) => toast(groupError(e))).finally(() => setContinuing(false)) },
    onStop: () => void stop(),
    onReply: (m, text, thread) => setReply({ member: m, quote: text.split('\n').map((l) => l.trim()).find(Boolean)?.replace(/[#*_`>]/g, '') ?? '', thread }),
  }

  const head = (
    <div className="hdr drag">
      <span className="crumb"><Icon name="group" /><span>Groups</span><span className="sl">/</span>
        <span className="cur">{members.length ? <FaceStack members={members} size={22} max={3} /> : null}<span className="gcrumb">{room?.name ?? 'Group'}</span></span>
      </span>
      <span className="sp" />
      {room && !view?.gone ? <button className="hbtn nodrag" title="Group settings" onClick={() => setSettings(true)}><Icon name="sliders" /></button> : null}
      <button className="hbtn nodrag" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
    </div>
  )

  if (view?.gone) {
    return (
      <div className="rpin gpanel">{head}
        <div className="rscroll"><div className="rcol"><Empty title="This group isn’t here any more" body="It was deleted, or it belongs to another Hermes profile." /></div></div>
      </div>
    )
  }

  const loading = !view?.logLoaded
  return (
    <div className="rpin gpanel">
      {head}
      <div className="rscroll" ref={scroller}><div className="rcol">
        <div className="btitle">{members.length ? <FaceStack members={members} size={44} max={4} moods={moods} /> : <BotFace profile="default" size={44} mood="search" watch={false} />}<span className="gtitle">{room?.name ?? 'Group'}</span></div>
        <p className="brole">{ctxState?.purpose || (members.length ? `${members.length} agents working together. ${routingText(ctxState, members)}${ctxState?.routing === 'lead' ? '.' : ' when a message names nobody.'}` : 'Opening the group…')}</p>
        {view?.error && !view.state ? <ErrorLine text={view.error} onRetry={() => void refreshRoom(roomId, true)} /> : null}
        {view?.state && !driver ? <div className="errline"><i className="dot need" /><span>Groups aren’t running in Hermes right now, so the agents can’t answer. Restart Hermes and they pick up where they left off.</span></div> : null}
        {driver?.last_error && !actions.some((a) => a.task_id.startsWith('prepare:')) ? <ErrorLine text={`The group couldn’t get started: ${driver.last_error}`} onRetry={() => void refreshRoom(roomId, true)} /> : null}
        {members.length ? <Members members={members} statuses={statuses} view={view} lead={lead} now={now} /> : null}
        <div className="gsec"><span>Conversation</span></div>
        {loading ? <div className="gload"><Spinner size={14} />Reading the conversation…</div> : view && view.events.some((e) => e.kind.startsWith('message')) ? <RoomLog view={view} ctx={logCtx} /> : (
          <p className="free">Nobody has said anything yet. Write to the group below. {routingText(ctxState, members)}{ctxState?.routing === 'lead' ? '.' : ' when a message names nobody;'} @name one agent to ask just them.</p>
        )}
        {view?.logLoaded ? <Typing members={members} statuses={statuses} now={now} /> : null}
        {actions.length ? (
          <div className="gneeds">
            {actions.map((a) => <NeedCard key={`${a.kind}:${a.task_id}:${a.execution_generation}`} roomId={roomId} action={a} member={byId.get(a.member_id)} lastError={driver?.last_error} canAct={canAct} />)}
          </div>
        ) : null}
        {view?.error && view.state ? <p className="gstale">Couldn’t refresh: {view.error}</p> : null}
      </div></div>
      {room ? <GroupComposer room={room} view={view} members={members} statuses={statuses} reply={reply} setReply={setReply} onStop={() => void stop()} onSent={pin} canUpload={canAct('groups.attachment.upload')} /> : null}
      {room && settings ? <GroupSettingsDialog room={room} context={ctxState} modes={driver?.routing_modes ?? undefined} onClose={() => setSettings(false)} onDeleted={onClose} /> : null}
    </div>
  )
}

// ---------- the room composer ----------

interface Chip { key: string; name: string; kind: string; att?: RoomAttachment; error?: string }

function GroupComposer({ room, view, members, statuses, reply, setReply, onStop, onSent, canUpload }: {
  room: Room; view: RoomView | undefined; members: RoomMember[]; statuses: Map<string, MemberStatus>
  reply: { member: RoomMember; quote: string; thread?: string } | null; setReply: (r: null) => void
  onStop: () => void; onSent: () => void; canUpload: boolean
}) {
  const connection = useStore((s) => s.connection)
  const [text, setText] = useState('')
  const [chips, setChips] = useState<Chip[]>([])
  const [sending, setSending] = useState(false)
  const [pending, setPending] = useState<{ eventId: string; payload: { text: string; thread_id: string; attachments?: RoomAttachment[] } } | null>(null)
  const [hint, setHint] = useState('')
  const [caret, setCaret] = useState(0)
  const [hi, setHi] = useState(0)
  const [muted, setMuted] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const back = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const driver = view?.state?.driver_status
  const working = roomSummary(view).working
  const uploading = chips.some((c) => !c.att && !c.error)
  const ready = connection === 'open' && !!driver && !sending && !uploading && (!!pending || text.trim().length > 0 || chips.some((c) => c.att))

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(220, el.scrollHeight) + 'px'
  }, [text])

  // Replying puts the bot's @name first, so the room routes the message to it.
  useEffect(() => {
    if (!reply) return
    const tag = `@${reply.member.handle}`
    setText((t) => (t.trimStart().startsWith(tag) ? t : `${tag} ${t.trimStart()}`))
    requestAnimationFrame(() => { const el = area.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length } })
  }, [reply])

  // @-suggestions: the room's members (and @everyone) matching what you've typed after the @.
  const m = /(^|\s)@([\w.-]*)$/.exec(text.slice(0, caret))
  const query = m && !pending ? m[2].toLowerCase() : null
  const suggestions = query === null || muted === `${caret}:${query}` ? [] : [
    ...members.filter((mm) => mm.handle.toLowerCase().startsWith(query) || memberName(mm).toLowerCase().startsWith(query)).map((mm) => ({ handle: mm.handle, label: memberName(mm), member: mm })),
    ...('everyone'.startsWith(query) ? [{ handle: 'everyone', label: 'Everyone', member: undefined }] : []),
  ].slice(0, 7)
  useEffect(() => { setHi(0) }, [query])
  const pick = (handle: string) => {
    if (!m) return
    const start = caret - m[2].length - 1
    const next = `${text.slice(0, start)}@${handle} ${text.slice(caret)}`
    const pos = start + handle.length + 2
    setText(next)
    requestAnimationFrame(() => { const el = area.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = pos; setCaret(pos) } })
  }

  const addFiles = async (files: File[]) => {
    if (!files.length) return
    if (!canUpload) { toast('This Hermes can’t take files in groups yet.'); return }
    const room_id = room.room_id
    const space = MAX_FILES - chips.length
    if (space <= 0) { toast(`${MAX_FILES} files at most in one message.`); return }
    for (const f of files.slice(0, space)) {
      const key = crypto.randomUUID()
      const kind = f.type.startsWith('image/') ? 'image' : 'file'
      if (f.size > MAX_FILE_BYTES) { setChips((c) => [...c, { key, name: f.name, kind, error: 'Too big (15 MB at most)' }]); continue }
      setChips((c) => [...c, { key, name: f.name, kind }])
      try { const att = await uploadToRoom(room_id, f); setChips((c) => c.map((x) => (x.key === key ? { ...x, att } : x))) } catch (e) { setChips((c) => c.map((x) => (x.key === key ? { ...x, error: groupError(e) } : x))) }
    }
  }

  const send = async () => {
    if (!ready) return
    const eventId = pending?.eventId ?? crypto.randomUUID()
    const atts = chips.filter((c) => c.att).map((c) => c.att!)
    const payload = pending?.payload ?? { text: text.trim(), thread_id: reply?.thread ?? eventId, ...(atts.length ? { attachments: atts } : {}) }
    setSending(true); setHint('')
    try {
      await sendToRoom(room.room_id, eventId, payload)
      setText(''); setChips([]); setPending(null); setReply(null)
      onSent()
    } catch (e) {
      if (admittedNothing(e)) { setPending(null); setHint(`${groupError(e)} Your message is still here.`) }
      else { setPending({ eventId, payload }); setHint('This may already have been sent. Sending again won’t post it twice.') }
    } finally { setSending(false) }
  }

  const busyNames = members.filter((mm) => isBusy(statuses.get(mm.member_id))).map(memberName)
  const round = roundText(view)
  const desc = !driver ? 'Not running right now' : working ? [round, busyNames.length ? `${busyNames.join(', ')} working` : 'Working'].filter(Boolean).join(' · ') : routingText(view?.state?.context, members)

  return (
    <div className="composer gcomposer">
      <div className="cmp">
        <div className="strip">
          <FaceStack members={members} size={22} max={3} />
          <span className="nm gname">{room.name}</span>
          <span className="ds">{desc}</span>
          <span className="sp" />
          {working ? <button className="b-text sm" onClick={onStop} title="Stop what the group is doing"><Icon name="stop" size={12} />Stop</button> : null}
        </div>
        {reply ? (
          <div className="greplying"><Icon name="chat" size={13} /><span>Replying to <b>{memberName(reply.member)}</b>{reply.quote ? <em> · {reply.quote}</em> : null}</span>
            <button onClick={() => setReply(null)} aria-label="Cancel reply"><Icon name="x" size={12} /></button></div>
        ) : null}
        <div className={`field${drag ? ' drag-on' : ''}`}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true) } }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDrag(false); void addFiles([...e.dataTransfer.files]) }}>
          {suggestions.length ? (
            <div className="menu gmention" role="listbox">
              <div className="mh">Ask one agent</div>
              {suggestions.map((s, i) => (
                <button key={s.handle} className={`mi${i === hi ? ' on' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(s.handle) }} onMouseEnter={() => setHi(i)}>
                  {s.member ? <BotFace profile={s.member.profile} size={20} watch={false} /> : <span className="gtile sm"><Icon name="group" size={13} /></span>}
                  <span className="ml">{s.label}</span><span className="mhint">@{s.handle}</span>
                </button>
              ))}
            </div>
          ) : null}
          {chips.length ? <div className="thumbs">{chips.map((c) => (
            <span className={`res${c.error ? ' gerr' : ''}`} key={c.key} title={c.error ?? c.name}>
              {c.att || c.error ? <Icon name={c.kind === 'image' ? 'image' : 'file'} size={14} /> : <Spinner size={12} />}{c.name}{c.error ? <em>· {c.error}</em> : null}
              <button className="gx" onClick={() => setChips((x) => x.filter((y) => y.key !== c.key))} aria-label={`Remove ${c.name}`}><Icon name="x" size={12} /></button>
            </span>
          ))}</div> : null}
          {/* The @names in what you're typing show in the agent's colour: the same text is drawn underneath with
              them picked out, and the box itself shows only the caret and selection on top. */}
          <div className="mwrap">
          <div className="mback" ref={back} aria-hidden="true"><Mentions text={text} members={members} />{'\u200b'}</div>
          <textarea ref={area} rows={1} value={text} readOnly={!!pending} placeholder={driver ? `Message ${room.name}. @name to ask one agent` : 'The group can’t answer right now'}
            onScroll={(e) => { if (back.current) back.current.scrollTop = e.currentTarget.scrollTop }}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length) }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (suggestions.length) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setHi((hi + 1) % suggestions.length); return }
                if (e.key === 'ArrowUp') { e.preventDefault(); setHi((hi - 1 + suggestions.length) % suggestions.length); return }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[hi].handle); return }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMuted(`${caret}:${query}`); return }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
            }}
            onPaste={(e) => {
              const files = [...e.clipboardData.files]
              if (!files.length) return
              e.preventDefault()
              void addFiles(files)
            }} />
          </div>
          <div className="tools">
            {canUpload ? <>
              <input ref={picker} type="file" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.currentTarget.value = ''; void addFiles(f) }} />
              <button className="plus" title="Attach files" disabled={!!pending} onClick={() => picker.current?.click()}><Icon name="plus" size={18} /></button>
            </> : null}
            <span className="sp" />
            {pending ? <button className="b-text sm" onClick={() => { setPending(null); setHint('Edit your message, then send it. If the first one did arrive, the group will see both.') }}>Edit instead</button> : null}
            <button className={`send${ready ? ' ready' : ''}`} title={pending ? 'Send again' : 'Send'} disabled={!ready} onClick={() => void send()}>
              {sending ? <Spinner size={13} /> : <Icon name={pending ? 'refresh' : 'send'} size={15} />}
            </button>
          </div>
        </div>
      </div>
      <div className={`hint${hint ? ' ghint' : ''}`}>{hint || (connection === 'open' ? 'Enter to send · Shift Enter for a new line · @ to ask one agent' : 'Waiting for Hermes…')}</div>
    </div>
  )
}

// ---------- group settings ----------

const NOTES_MAX = 4096
const bytes = (s: string) => new TextEncoder().encode(s.trim()).length

/** Who answers a message that names nobody: everyone, Hermes' pick, or a lead you choose. Tabs with the
 *  app's sliding pill, then the members to pick the lead from. (No popover: it would open under the dialog.) */
function RoutingPicker({ members, value, onChange, modes, disabled }: { members: RoomMember[]; value: string; onChange: (v: string) => void; modes?: string[] | null; disabled?: boolean }) {
  const mode = value.startsWith('lead:') ? 'lead' : value === 'auto' ? 'auto' : 'everyone'
  const items: { key: 'everyone' | 'auto' | 'lead'; label: string }[] = [
    { key: 'everyone', label: 'Everyone answers' },
    ...(!modes || modes.includes('auto') || mode === 'auto' ? [{ key: 'auto' as const, label: 'Hermes picks' }] : []),
    ...(!modes || modes.includes('lead') || mode === 'lead' ? [{ key: 'lead' as const, label: 'A lead hands it out' }] : []),
  ]
  const lead = value.startsWith('lead:') ? value.slice(5) : ''
  return (
    <div className={`groute${disabled ? ' off' : ''}`}>
      <Tabs items={items} value={mode} onChange={(k) => onChange(k === 'lead' ? `lead:${lead || members[0]?.member_id || ''}` : k)} />
      {mode === 'lead' ? (
        <div className="gleads">
          {members.map((m) => (
            <button key={m.member_id} className={`gchip${lead === m.member_id ? ' on' : ''}`} onClick={() => onChange(`lead:${m.member_id}`)} aria-pressed={lead === m.member_id}>
              <BotFace profile={m.profile} size={18} watch={false} />{memberName(m)}
            </button>
          ))}
        </div>
      ) : null}
      <em>{mode === 'everyone' ? 'Every agent gets a turn. You can always @name one agent to ask just them.' : mode === 'auto' ? 'Hermes reads each message and picks who it’s for. @names still go straight to the agents you name.' : 'The lead reads each message and hands it to the right agents. @names still go straight to the agents you name.'}</em>
    </div>
  )
}
const routingValue = (ctx?: RoomContext | null) => (ctx?.routing === 'lead' && ctx.lead_member_id ? `lead:${ctx.lead_member_id}` : ctx?.routing === 'auto' ? 'auto' : 'everyone')
const parseRouting = (v: string): { routing: Routing; lead_member_id: string } => (v.startsWith('lead:') ? { routing: 'lead', lead_member_id: v.slice(5) } : { routing: v === 'auto' ? 'auto' : 'everyone', lead_member_id: '' })

function GroupSettingsDialog({ room, context, modes, onClose, onDeleted }: { room: Room; context?: RoomContext | null; modes?: string[]; onClose: () => void; onDeleted: () => void }) {
  const caps = useGroups((s) => s.caps)
  const [name, setName] = useState(room.name)
  const [purpose, setPurpose] = useState(context?.purpose ?? '')
  const [notes, setNotes] = useState(context?.notes ?? '')
  const [route, setRoute] = useState(routingValue(context))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(true)
  const close = () => { setOpen(false); setTimeout(onClose, 170) }
  const over = bytes(notes) > NOTES_MAX
  const ctxChanged = purpose.trim() !== (context?.purpose ?? '') || notes.trim() !== (context?.notes ?? '') || route !== routingValue(context)
  const nameChanged = name.trim().replace(/\s+/g, ' ') !== room.name
  const ok = !!name.trim() && !over && (ctxChanged || nameChanged) && !busy

  const save = async () => {
    setBusy(true); setErr('')
    try {
      if (nameChanged) await renameRoom(room.room_id, name)
      if (ctxChanged) await setRoomContext(room.room_id, { purpose: purpose.trim(), notes: notes.trim(), ...parseRouting(route) })
      toast('Group settings saved')
      close()
    } catch (e) { setErr(groupError(e)) } finally { setBusy(false) }
  }
  const remove = async () => {
    const yes = await confirm({ title: `Delete “${room.name}”?`, body: 'Anything the agents are doing stops, and the group and its conversation leave your list. This can’t be undone.', action: 'Delete group', danger: true })
    if (!yes) return
    setBusy(true); setErr('')
    try { await disbandRoom(room.room_id); toast(`Deleted “${room.name}”`); close(); onDeleted() } catch (e) { setErr(groupError(e)); setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={close} title={<><FaceStack members={room.members} size={22} max={4} />Group settings</>} width={560}
      footer={<>{offers(caps, 'groups.disband') ? <button className="b-ghost-danger" disabled={busy} onClick={() => void remove()}>Delete group…</button> : null}<span className="sp" /><button className="b-text" onClick={close}>Cancel</button><button className="b-pri" disabled={!ok} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form">
        <label><span>Name</span><input className="answer" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></label>
        <label><span>What it’s for <em>optional</em></span><input className="answer" value={purpose} maxLength={500} placeholder="Plan the spring launch, one step at a time" onChange={(e) => setPurpose(e.target.value)} />
          <em>Every agent reads this before it answers. Changes apply from your next message.</em></label>
        <label><span>Shared notes <em>optional</em></span><textarea className="answer" rows={4} value={notes} placeholder="Facts every agent in the group should keep in mind" onChange={(e) => setNotes(e.target.value)} />
          <em className={over ? 'gover' : undefined}>{bytes(notes)} / {NOTES_MAX}{over ? ' · too long' : ''}</em></label>
        <div className="glabel"><span>Who answers a message that names nobody</span>
          <RoutingPicker members={room.members} value={route} onChange={setRoute} modes={modes} /></div>
        <DeliveryLine roomId={room.room_id} />
        <div className="gmemfixed"><span>Members</span>{room.members.map((m) => <span className="gchip" key={m.member_id}><BotFace profile={m.profile} size={18} watch={false} />{memberName(m)}</span>)}<em>Members are set when a group is made. To change them, make a new group.</em></div>
        {err ? <p className="free" style={{ color: 'var(--tint-red)', margin: 0 }}>{err}</p> : null}
      </div>
    </Dialog>
  )
}

/** Scheduled jobs can post their results into a group: this is the destination to give them. */
function DeliveryLine({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false)
  const target = roomDeliveryTarget(roomId)
  const copy = async () => { try { await navigator.clipboard.writeText(target); setCopied(true); setTimeout(() => setCopied(false), 1400) } catch { toast('Couldn’t copy') } }
  return (
    <div className="gdeliver"><span>Scheduled jobs</span>
      <div className="gdl"><em>To have a scheduled job post its results here, use this destination:</em></div>
      <div className="gdl"><code>{target}</code><button className="b-text sm" onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} size={13} />{copied ? 'Copied' : 'Copy'}</button></div>
    </div>
  )
}

// ---------- new group ----------

/** Make a group: name it, pick 2–6 bots (Chief can be one), and choose who answers a message that names nobody. */
export function NewGroupDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (roomId: string) => void }) {
  const bots = useStore((s) => s.bots)
  const connection = useStore((s) => s.connection)
  const caps = useGroups((s) => s.caps)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [route, setRoute] = useState('everyone')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    startGroups()
    void loadCaps()
    setName(''); setPicked([]); setRoute('everyone'); setErr(''); setBusy(false)
  }, [open])

  const sorted = useMemo(() => [...bots].sort((a, b) => (a.isChief ? -1 : b.isChief ? 1 : a.name.localeCompare(b.name))), [bots])
  const seatable = caps?.seatable_profiles ? new Set(caps.seatable_profiles) : null
  const chosen = picked.map((p) => sorted.find((b) => b.profile === p)).filter((b): b is Bot => !!b)
  const autoName = chosen.map((b) => (b.isChief ? 'Quicksilver' : b.name)).join(' & ').slice(0, 200)
  const roster: RoomMember[] = chosen.map((b) => ({ member_id: b.profile, profile: b.profile, handle: b.profile, display_name: b.isChief ? 'Quicksilver' : b.name }))
  const leadPicked = route.startsWith('lead:') ? route.slice(5) : ''
  useEffect(() => { if (leadPicked && !picked.includes(leadPicked)) setRoute('everyone') }, [picked, leadPicked])
  const driverOff = caps?.driver === false
  const ok = chosen.length >= 2 && chosen.length <= 6 && !busy && connection === 'open' && !driverOff

  const toggle = (p: string) => setPicked((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : cur.length >= 6 ? cur : [...cur, p]))
  const create = async () => {
    setBusy(true); setErr('')
    try {
      const r = parseRouting(route)
      const { room, routingError } = await createGroup(name.trim() || autoName, chosen, r.routing, r.lead_member_id)
      toast(routingError ? `“${room.name}” is ready, but who answers couldn’t be set: ${routingError}` : `“${room.name}” is ready`)
      onClose()
      onCreated?.(room.room_id)
      setTimeout(() => openGroup(room.room_id), 180)
    } catch (e: any) { setErr(e?.message ?? groupError(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New group" width={580}
      footer={<><span className="gcount">{chosen.length ? `${chosen.length} of 6 picked` : 'Pick 2 to 6 agents'}</span><span className="sp" /><button className="b-text" onClick={onClose}>Cancel</button><button className="b-pri" disabled={!ok} onClick={() => void create()}>{busy ? 'Making it…' : 'Make the group'}</button></>}>
      <div className="form">
        <p className="free" style={{ margin: 0 }}>A group is a room where a few agents work on something together. You write to the room; they answer in turn and build on each other.</p>
        {driverOff ? <div className="errline" style={{ margin: 0 }}><i className="dot need" /><span>Groups aren’t running in Hermes right now. Restart Hermes, then try again.</span></div> : null}
        <label><span>Name</span><input className="answer" value={name} maxLength={200} autoFocus placeholder={autoName || 'Spring launch'} onChange={(e) => setName(e.target.value)} /></label>
        <div className="gpicklab"><span>Who’s in it</span><em>Quicksilver can join too</em></div>
        <div className="gpick">
          {sorted.map((b) => {
            const on = picked.includes(b.profile)
            const blocked = !!seatable && !seatable.has(b.profile)
            const full = !on && picked.length >= 6
            return (
              <button key={b.profile} className={`gpr${on ? ' on' : ''}`} disabled={blocked || full} onClick={() => toggle(b.profile)} aria-pressed={on}
                title={blocked ? 'This agent can’t join groups right now' : full ? 'Six agents at most' : undefined}>
                <BotFace profile={b.profile} size={30} poseKey={b.poseKey} watch={false} mood={on ? 'hop' : 'idle'} />
                <span className="tx"><span className="t1">{b.isChief ? 'Quicksilver' : b.name}</span><span className="t2">{blocked ? 'Can’t join groups right now' : b.isChief ? 'Leads your agents' : b.role || 'One of your agents'}</span></span>
                <span className="gcheck">{on ? <Icon name="check" size={12} /> : null}</span>
              </button>
            )
          })}
          {!sorted.length ? <p className="free">No agents yet. Ask Quicksilver to add some.</p> : null}
        </div>
        <div className="glabel"><span>Who answers a message that names nobody</span>
          <RoutingPicker members={roster} value={route} onChange={setRoute} disabled={chosen.length < 2} /></div>
        {err ? <p className="free" style={{ color: 'var(--tint-red)', margin: 0 }}>{err}</p> : null}
      </div>
    </Dialog>
  )
}
