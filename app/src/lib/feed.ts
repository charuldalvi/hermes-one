// The agents feed, for Hermes One apps with the "agents" ability (an office view, a status board…):
//   agents  every agent: id (its profile), name, role, whether it leads (Hermes), its own bead look
//           (shape, colour, pose), and live status: free, working, needs (waiting on you), asleep or error,
//           with what it's doing and since when. Work inside a group counts as working.
//   groups  each group: id, name, members (agent ids), lead.
//   talks   the last 50 times someone addressed someone: you asking an agent or a group ("ask"), an agent
//           handing work to another ("handoff"), an agent reporting back ("reply"), a message in a group
//           ("group"). Who to whom and when, never the words, so an app can show who talks to whom
//           without reading anyone's conversation.
// The window builds it from what it already follows, hands it to the main process (which passes it to the
// running "agents" apps) and to the app pages on screen.
import { appsApi } from './apps'
import { getGroups, isBusy, memberStatuses, mentions, setRoomEventsHook, watchRoom, type RoomEvent, type RoomMember } from './groups'
import { lookOf } from './looks'
import { getState, subscribe } from './store'

export type AgentStatus = 'free' | 'working' | 'needs' | 'asleep' | 'error'
export interface FeedAgent {
  id: string; name: string; lead: boolean; role?: string
  look: { shape: string; color: string; pose: string }
  status: AgentStatus; doing?: string; since?: number
}
export interface Talk { id: string; at: number; from: string; to: string[]; kind: 'ask' | 'handoff' | 'reply' | 'group'; group?: string }
export interface Feed { at: number; agents: FeedAgent[]; groups: { id: string; name: string; members: string[]; lead?: string }[]; talks: Talk[] }

const LEAD_LOOK = { shape: 'round', color: '#3b82f6', pose: 'Round' }
const talks: Talk[] = []
let seq = 0
let feed: Feed = { at: 0, agents: [], groups: [], talks: [] }
let lastSig = ''
const listeners = new Set<(f: Feed) => void>()

/** Someone addressed someone: `from` and `to` are agent ids ('default' is Hermes) or 'you'. */
export function recordTalk(t: Omit<Talk, 'id' | 'at'>) {
  const to = [...new Set(t.to.filter((x) => x && x !== t.from))]
  if (!t.from || !to.length) return
  talks.push({ ...t, to, id: `t${Date.now().toString(36)}${(++seq).toString(36)}`, at: Date.now() })
  if (talks.length > 50) talks.splice(0, talks.length - 50)
  schedule()
}

function build(): Feed {
  const s = getState()
  const g = getGroups()
  // Busy in a group counts as working, even when its own chat is quiet.
  const inGroup = new Map<string, string>()
  for (const r of g.rooms) {
    const view = g.views[r.room_id]
    const st = memberStatuses(view)
    for (const m of view?.state?.room?.members ?? r.members) if (isBusy(st.get(m.member_id))) inGroup.set(m.profile, r.name)
  }
  const waiting = new Set(s.needs.filter((n) => !n.outcome).map((n) => n.profile))
  const agents: FeedAgent[] = s.bots.map((b) => {
    const lead = b.isChief
    const busy = (lead && s.chief.busy) || b.status === 'working'
    let status: AgentStatus = waiting.has(b.profile) || b.status === 'needs' ? 'needs'
      : busy ? 'working' : b.status === 'error' ? 'error' : !b.online || b.status === 'asleep' ? 'asleep' : 'free'
    let doing = status === 'working' ? (lead ? s.chief.step ?? b.step : b.step) : status === 'needs' ? 'Waiting on you' : undefined
    if (status === 'free' && inGroup.has(b.profile)) { status = 'working'; doing = `In ${inGroup.get(b.profile)}` }
    const since = status === 'working' ? (lead ? s.chief.turnStartedAt ?? b.since : b.since) : undefined
    return {
      id: b.profile, name: lead ? 'Hermes' : b.name, lead, role: lead ? 'Leads your agents' : b.role,
      look: lead ? LEAD_LOOK : lookOf(b.profile) ?? LEAD_LOOK, status, ...(doing ? { doing } : {}), ...(since ? { since } : {}),
    }
  })
  const groups = g.rooms.map((r) => {
    const ctx = g.views[r.room_id]?.state?.context
    const lead = r.members.find((m) => m.member_id === ctx?.lead_member_id)?.profile
    return { id: r.room_id, name: r.name, members: r.members.map((m) => m.profile), ...(lead ? { lead } : {}) }
  })
  return { at: Date.now(), agents, groups, talks: talks.slice() }
}

let timer: ReturnType<typeof setTimeout> | null = null
function schedule() {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    const next = build()
    const sig = JSON.stringify({ ...next, at: 0 })
    if (sig === lastSig) return
    lastSig = sig
    feed = next
    listeners.forEach((l) => { try { l(feed) } catch (e) { console.error(e) } })
    void appsApi().feed?.(feed).catch(() => { /* the apps runtime is restarting */ })
  }, 250)
}

export const getFeed = () => feed
export function onFeed(fn: (f: Feed) => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

/** Group messages as talks: a member's message goes to the members it @names (or the whole group); yours
 *  to the members you @name (or everyone in it). */
function groupTalks(roomId: string, events: RoomEvent[], members: RoomMember[]) {
  for (const e of events) {
    const text = String(e.payload.text ?? e.payload.content ?? '')
    const named = members.filter((m) => mentions(text, m.handle)).map((m) => m.profile)
    const all = members.map((m) => m.profile)
    if (e.kind === 'message.member' && e.actor?.kind === 'member') {
      const from = members.find((m) => m.member_id === e.actor?.id)?.profile
      if (from) recordTalk({ from, to: named.length ? named : all, kind: 'group', group: roomId })
    } else if (e.kind === 'message.user' || e.kind === 'message') {
      recordTalk({ from: 'you', to: named.length ? named : all, kind: 'ask', group: roomId })
    }
  }
}

/** Starts the feed: follows the store, the groups and, while any app wants the feed, every group's messages. */
export function startFeed() {
  subscribe(schedule)
  setInterval(schedule, 2_000) // group statuses change without a store change
  setRoomEventsHook(groupTalks)
  // Group messages are read only for rooms someone watches: while an "agents" app exists, watch them all.
  const watching = new Map<string, () => void>()
  const check = async () => {
    let wanted = false
    try { wanted = (await appsApi().list()).some((a) => a.abilities?.includes('agents')) } catch { /* not ready yet */ }
    const ids = wanted ? getGroups().rooms.map((r) => r.room_id) : []
    for (const id of ids) if (!watching.has(id)) watching.set(id, watchRoom(id))
    for (const [id, release] of watching) if (!ids.includes(id)) { release(); watching.delete(id) }
  }
  void check()
  setInterval(() => void check(), 15_000)
  schedule()
}
