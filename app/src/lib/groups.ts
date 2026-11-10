// Bot Mode group rooms ("groups"): a room of 2–6 bots working together, hosted by the local Hermes gateway
// and spoken to over the same socket as everything else (groups.* methods). Rooms push no events, so, as
// Hermes Desktop does, an open room reads groups.state plus the groups.log delta every 1.5 s, and every other
// room's state is read every few seconds so the sidebar can show who is working and what needs you.
// The server checks every field strictly; only the fields each method accepts are ever sent.
import { useEffect, useSyncExternalStore } from 'react'
import { gateway } from './gateway'
import { prettyName, toast } from './hermes'
import { getState, setState as setMain, type Bot } from './store'

// ---------- wire shapes (tui_gateway/contracts/groups_bot_relay.py) ----------

export interface RoomMember { member_id: string; profile: string; handle: string; display_name?: string; target?: Record<string, unknown> }
export interface Room {
  room_id: string
  name: string
  members: RoomMember[]
  created_at?: number
  updated_at?: number
  latest_seq?: number
  authority_epoch?: number
  disbanded_at?: number | null
}
export type Routing = 'everyone' | 'lead' | 'auto'
export interface RoomContext { purpose: string; notes: string; routing?: Routing; lead_member_id?: string }
export interface MemberActivity { member_id: string; status: string; thread_id?: string; round_index?: number; started_at?: number; tool?: string; progress_at?: number }
export interface PendingAction {
  kind: string
  member_id: string
  task_id: string
  execution_generation: number
  request_id?: string
  approval?: { request_id?: string; prompt_id?: string; command?: string; description?: string; choices?: string[] }
}
export interface DriverStatus {
  running?: boolean
  working?: boolean
  blocked?: boolean
  counts?: Record<string, number>
  pending_actions?: PendingAction[]
  member_activity?: MemberActivity[]
  last_error?: string | null
  max_rounds?: number | null
  max_continues?: number | null
  routing_modes?: string[] | null
}
export interface RoomState { room: Room; context?: RoomContext | null; driver_status?: DriverStatus | null }
export interface RoomAttachment { attachment_id: string; kind: string; name: string; size: number; mime: string }
export interface RoomEvent {
  room_id?: string
  seq: number
  event_id?: string
  kind: string
  actor?: { kind?: string; id?: string; profile?: string; display_name?: string }
  payload: { text?: string; content?: string; attachments?: RoomAttachment[]; member_id?: string; thread_id?: string; discussion_event_id?: string; [key: string]: unknown }
  created_at?: number
}
export interface GroupCaps { driver: boolean; methods: string[]; seatable_profiles?: string[] | null; max_log_limit?: number }

/** What this app knows about one room: its last state, the log read so far, and how the last read went. */
export interface RoomView {
  state?: RoomState
  events: RoomEvent[]
  /** The log is append-only within one authority epoch: each read asks only for what is new. */
  seq: number
  epoch?: number
  logLoaded: boolean
  fetchedAt?: number
  error?: string
  gone?: boolean
}

export interface GroupsState {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  rooms: Room[]
  caps?: GroupCaps | null
  views: Record<string, RoomView>
}

// ---------- the store slice ----------

let gs: GroupsState = { phase: 'idle', rooms: [], views: {} }
const listeners = new Set<() => void>()
export function getGroups() { return gs }
/** Called with a room's new events as they arrive (never the history loaded on a fresh read): the agents feed. */
let roomEventsHook: ((roomId: string, events: RoomEvent[], members: RoomMember[]) => void) | null = null
export function setRoomEventsHook(fn: typeof roomEventsHook) { roomEventsHook = fn }
function set(patch: Partial<GroupsState>) { gs = { ...gs, ...patch }; listeners.forEach((l) => l()) }
/** Screenshot demo only (dev/Demo.tsx): made-up groups for the sidebar. */
export const showDemoGroups = (rooms: Room[]) => set({ phase: 'ready', rooms })
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }
/** Read the groups slice; the selector must return something stable (a field, not a new object). */
export function useGroups<T>(select: (s: GroupsState) => T): T { return useSyncExternalStore(subscribe, () => select(gs)) }
/** Whether the room list has loaded at least once (an empty list then really means no groups). */
export const groupsReady = () => gs.phase === 'ready'
export const useRoomView = (roomId: string) => useGroups((s) => s.views[roomId])
/** How many things in all listed groups wait on you (approvals, turns to retry or discard). */
export const useGroupNeeds = () => useGroups((s) => s.rooms.reduce((n, r) => n + (s.views[r.room_id]?.state?.driver_status?.pending_actions?.length ?? 0), 0))
/** Where a scheduled job delivers to post its result into this room. */
export const roomDeliveryTarget = (roomId: string, profile = 'default') => `room:${roomId}@${profile}`
export const useRoom = (roomId: string) => useGroups((s) => s.rooms.find((r) => r.room_id === roomId))

function patchView(roomId: string, patch: Partial<RoomView>) {
  const prev = gs.views[roomId] ?? { events: [], seq: 0, logLoaded: false }
  set({ views: { ...gs.views, [roomId]: { ...prev, ...patch } } })
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Rooms deleted from this app: a read that was already on its way must not bring one back. */
const deleted = new Set<string>()

function setRooms(next: Room[]) {
  const old = new Map(gs.rooms.map((r) => [r.room_id, r]))
  // Stable order: the order you made them in (the server lists most recently changed first, which jumps).
  const rooms = next
    .filter((r) => r.disbanded_at == null && !deleted.has(r.room_id))
    .map((r) => { const o = old.get(r.room_id); return o && same(o, r) ? o : r })
    .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0) || a.name.localeCompare(b.name))
  if (rooms.length === gs.rooms.length && rooms.every((r, i) => r === gs.rooms[i])) return
  const keep = new Set(rooms.map((r) => r.room_id))
  const views: Record<string, RoomView> = {}
  for (const [id, v] of Object.entries(gs.views)) if (keep.has(id) || watchers.has(id)) views[id] = v
  set({ rooms, views })
  const mirror = rooms.map((r) => ({ room_id: r.room_id, name: r.name, members: r.members.map((m) => m.profile) }))
  if (!same(getState().rooms, mirror)) setMain({ rooms: mirror })
}

function upsertRoom(room: Room) {
  if (deleted.has(room.room_id)) return
  if (room.disbanded_at != null) { dropRoom(room.room_id); return }
  const i = gs.rooms.findIndex((r) => r.room_id === room.room_id)
  const merged = i >= 0 ? { ...gs.rooms[i], ...room } : room
  if (i >= 0 && same(gs.rooms[i], merged)) return
  setRooms(i >= 0 ? gs.rooms.map((r, j) => (j === i ? merged : r)) : [...gs.rooms, merged])
}

function dropRoom(roomId: string) {
  if (watchers.has(roomId)) patchView(roomId, { gone: true })
  setRooms(gs.rooms.filter((r) => r.room_id !== roomId))
}

// ---------- requests and the reader's words for refusals ----------

const call = <T,>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000) => gateway.request<T>(method, params, timeoutMs)

const REASONS: Record<string, string> = {
  permission_denied: 'This group isn’t available any more.',
  not_found: 'This group isn’t available any more.',
  room_history_expired: 'This group isn’t available any more.',
  invalid_params: 'Hermes couldn’t accept that.',
  runtime_coordination_required: 'Groups aren’t running in Hermes right now. Restart Hermes and try again.',
  runtime_draining: 'Hermes is restarting. Try again in a moment.',
  stale_generation: 'That already changed. The group is up to date now.',
  unknown_execution: 'Hermes can’t find that piece of work any more.',
  session_busy: 'That agent is still busy. Try again when it’s free.',
  storage_unavailable: 'Hermes couldn’t reach its storage. Try again.',
  request_too_large: 'That’s too big to send.',
  profile_mismatch: 'This group belongs to another Hermes profile.',
  authority_conflict: 'This group is run by another Hermes.',
  bounds_exceeded: 'The group already used all its extra rounds.',
  no_pending_user_event: 'There’s nothing to continue.',
  unsupported_operation: 'This Hermes can’t do that yet. Update Hermes and try again.',
  unknown_method: 'This Hermes doesn’t have groups yet. Update Hermes to use them.',
}

/** A refusal's reason code (the socket puts it in error.message and error.data.reason). */
export function reasonOf(e: unknown): string {
  const err = e as { data?: { reason?: unknown }; message?: unknown } | null
  return typeof err?.data?.reason === 'string' ? err.data.reason : typeof err?.message === 'string' ? err.message : ''
}

/** Any failure in plain words: the reason's sentence, plus the gateway's detail when it named one. */
export function groupError(e: unknown): string {
  const err = e as { data?: { detail?: unknown }; message?: unknown } | null
  const reason = reasonOf(e)
  const detail = typeof err?.data?.detail === 'string' && err.data.detail ? err.data.detail : ''
  const base = REASONS[reason]
  if (base) return detail ? `${base.replace(/\.$/, ':')} ${detail}` : base
  const msg = typeof err?.message === 'string' ? err.message : String(e)
  if (/timed out/.test(msg)) return 'Hermes took too long to answer. Try again.'
  return msg || 'Something went wrong.'
}

const GONE = new Set(['permission_denied', 'not_found', 'room_history_expired'])
/** groups.send refusals marked `admitted: false` provably posted nothing, so the words can come back. */
export const admittedNothing = (e: unknown) => (e as { data?: { admitted?: unknown } } | null)?.data?.admitted === false

export const offers = (caps: GroupCaps | null | undefined, method: string) => !caps?.methods?.length || caps.methods.includes(method)

// ---------- reading ----------

let capsAt = 0
export async function loadCaps(): Promise<GroupCaps | null> {
  capsAt = Date.now()
  try {
    const caps = await call<GroupCaps>('groups.capabilities')
    if (!same(gs.caps, caps)) set({ caps })
    return caps
  } catch {
    if (gs.caps === undefined) set({ caps: null })
    return null
  }
}

let lastList = 0
let listing: Promise<void> | null = null
/** Every live room, all pages. */
export function refreshRooms(): Promise<void> {
  if (listing) return listing
  listing = (async () => {
    if (gs.phase === 'idle') set({ phase: 'loading' })
    try {
      const all: Room[] = []
      let offset = 0
      for (let page = 0; page < 20; page++) {
        const res = await call<{ rooms: Room[]; next_offset: number | null }>('groups.list', { limit: 100, offset })
        all.push(...(res?.rooms ?? []))
        if (res?.next_offset == null || !Number.isSafeInteger(res.next_offset) || res.next_offset <= offset) break
        offset = res.next_offset
      }
      lastList = Date.now()
      setRooms(all)
      if (gs.phase !== 'ready' || gs.error) set({ phase: 'ready', error: undefined })
    } catch (e) {
      lastList = Date.now() - 12_000 // try again sooner than the usual 20 s
      set({ phase: gs.rooms.length ? 'ready' : 'error', error: groupError(e) })
    } finally { listing = null }
  })()
  return listing
}

const inflight = new Set<string>()
const watchers = new Map<string, number>()
export const isWatched = (roomId: string) => watchers.has(roomId)

/** Rooms asked to refresh while a read was already on its way: read once more when it lands. */
const again = new Set<string>()

/** One room's state, and with `withLog` its log delta (all of it on the first read or a new epoch). */
export async function refreshRoom(roomId: string, withLog = isWatched(roomId)): Promise<void> {
  if (inflight.has(roomId)) { again.add(roomId); return }
  inflight.add(roomId)
  let stage = 'state'
  try {
    const st = await call<RoomState>('groups.state', { room_id: roomId })
    stage = 'log'
    const before = gs.views[roomId] ?? { events: [], seq: 0, logLoaded: false }
    let log: { events: RoomEvent[]; cursor: number; fresh: boolean; epoch?: number } | null = null
    if (withLog) {
      const nowEpoch = st.room?.authority_epoch
      const latest = st.room?.latest_seq
      const fresh = !before.logLoaded || nowEpoch !== before.epoch || (typeof latest === 'number' && latest < before.seq)
      if (fresh || typeof latest !== 'number' || latest > before.seq) {
        const since = fresh ? 0 : before.seq
        const limit = Math.min(200, gs.caps?.max_log_limit ?? 200)
        const got: RoomEvent[] = []
        let cursor = since
        for (let page = 0; page < 500; page++) {
          const res = await call<{ events: RoomEvent[]; cursor?: number; has_more?: boolean }>('groups.log', { room_id: roomId, since_seq: cursor, limit })
          got.push(...(res?.events ?? []))
          const next = typeof res?.cursor === 'number' ? res.cursor : got.at(-1)?.seq ?? cursor
          if (!res?.has_more || next <= cursor) { cursor = next; break }
          cursor = next
        }
        log = { events: got.filter((e) => e.seq > since), cursor, fresh, epoch: nowEpoch }
      }
    }
    if (deleted.has(roomId)) return
    noticeNewNeeds(roomId, st)
    // Merge into what is there now: a send may have added its own message while this read was out.
    const cur = gs.views[roomId] ?? before
    let { events, seq, epoch, logLoaded } = cur
    if (log) {
      if (log.fresh) events = log.events
      else {
        const last = events.at(-1)?.seq ?? 0
        const added = log.events.filter((e) => e.seq > last)
        if (added.length) events = [...events, ...added]
        if (added.length) { try { roomEventsHook?.(roomId, added, st.room?.members ?? []) } catch (e) { console.error(e) } }
      }
      seq = Math.max(log.fresh ? 0 : cur.seq, log.cursor, events.at(-1)?.seq ?? 0)
      epoch = log.epoch
      logLoaded = true
    }
    patchView(roomId, {
      state: cur.state && same(cur.state, st) ? cur.state : st,
      events, seq, epoch, logLoaded, fetchedAt: Date.now(), error: undefined, gone: false,
    })
    if (st.room) upsertRoom(st.room)
  } catch (e) {
    // groups.state takes only the room id, so a refusal of its params there means the room itself is missing.
    const reason = reasonOf(e)
    if (GONE.has(reason) || (stage === 'state' && reason === 'invalid_params')) { patchView(roomId, { gone: true, fetchedAt: Date.now() }); dropRoom(roomId) }
    else patchView(roomId, { error: groupError(e), fetchedAt: Date.now() })
  } finally {
    inflight.delete(roomId)
    if (again.delete(roomId) && !deleted.has(roomId)) void refreshRoom(roomId)
  }
}

/** Keep one room live while something shows it (the right panel). Returns the release. */
export function watchRoom(roomId: string): () => void {
  startGroups()
  watchers.set(roomId, (watchers.get(roomId) ?? 0) + 1)
  void refreshRoom(roomId, true)
  return () => {
    const left = (watchers.get(roomId) ?? 1) - 1
    if (left > 0) watchers.set(roomId, left)
    else watchers.delete(roomId)
  }
}
export function useWatchRoom(roomId: string) { useEffect(() => watchRoom(roomId), [roomId]) }

// A new approval or stuck turn in any room gets one toast (and a system notice when the app is behind
// other windows). The first read of each room only learns what is already there.
const primed = new Set<string>()
const seenNeeds = new Set<string>()
const needKey = (roomId: string, a: PendingAction) => `${roomId}:${a.kind}:${a.task_id}:${a.execution_generation}`
function noticeNewNeeds(roomId: string, st: RoomState) {
  const actions = st.driver_status?.pending_actions ?? []
  const fresh = actions.filter((a) => !seenNeeds.has(needKey(roomId, a)))
  fresh.forEach((a) => seenNeeds.add(needKey(roomId, a)))
  if (!primed.has(roomId)) { primed.add(roomId); return }
  if (!fresh.length) return
  // Already on screen in the panel you're looking at: the card itself is the notice.
  if (watchers.has(roomId) && document.hasFocus()) return
  const a = fresh[0]
  const member = st.room?.members?.find((m) => m.member_id === a.member_id)
  const who = member ? memberName(member) : 'An agent'
  const text = a.kind === 'approval' ? `${who} in “${st.room?.name ?? 'a group'}” needs your OK` : `“${st.room?.name ?? 'A group'}” needs you`
  toast(text)
  try { if (!document.hasFocus()) void window.hermesNative.notify('Hermes', text) } catch { /* optional */ }
}

// ---------- the poll ----------

let started = false
let hooked = false
let timer: ReturnType<typeof setInterval> | null = null
const connected = () => gateway.open && getState().connection === 'open'

async function tick() {
  if (!connected()) return
  const now = Date.now()
  if (gs.caps === undefined || now - capsAt > 60_000) void loadCaps()
  if (now - lastList > 20_000) await refreshRooms()
  // A read still on its way is left alone (the clock never queues reads behind a slow gateway).
  for (const id of watchers.keys()) if (!inflight.has(id)) void refreshRoom(id, true)
  for (const r of gs.rooms) {
    if (watchers.has(r.room_id) || inflight.has(r.room_id)) continue
    const at = gs.views[r.room_id]?.fetchedAt ?? 0
    if (now - at > 5_000) void refreshRoom(r.room_id, false)
  }
}

/** Start reading rooms (idempotent): on every (re)connect, and on a 1.5 s clock while connected. */
export function startGroups() {
  if (started) return
  started = true
  if (!hooked) { hooked = true; gateway.onReady(() => { lastList = 0; capsAt = 0; setTimeout(() => void tick(), 300) }) }
  timer = setInterval(() => void tick(), 1_500)
  void tick()
}
export function stopGroups() { if (timer) clearInterval(timer); timer = null; started = false }

// ---------- writing ----------

const uuid = () => crypto.randomUUID()
const RESERVED_HANDLES = new Set(['all', 'everyone'])

/** The roster groups.create receives (Hermes, the lead, first). Each agent answers to @its-profile; the lead to @hermes.
 *  Handles are unique and never the reserved @all / @everyone. */
export function rosterFor(bots: Pick<Bot, 'profile' | 'name' | 'isChief'>[]): RoomMember[] {
  const profiles = new Set(bots.map((b) => b.profile.toLowerCase()))
  const taken = new Set<string>()
  const ordered = [...bots.filter((b) => b.isChief), ...bots.filter((b) => !b.isChief)]
  return ordered.map((b) => {
    let handle = b.isChief && !profiles.has('hermes') ? 'hermes' : b.profile
    if (RESERVED_HANDLES.has(handle.toLowerCase())) handle = `${handle}-agent`
    while (taken.has(handle.toLowerCase())) handle = `${handle}-2`
    taken.add(handle.toLowerCase())
    const display = b.isChief ? 'Hermes' : b.name
    return { member_id: b.profile, profile: b.profile, handle, ...(display ? { display_name: display.slice(0, 200) } : {}), target: { kind: 'local', profile: b.profile } }
  })
}

/** Create a room of 2–6 bots, then (optionally) set who answers a message that names nobody. */
export async function createGroup(name: string, bots: Bot[], routing: Routing = 'everyone', lead?: string): Promise<{ room: Room; routingError?: string }> {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (!clean) throw new Error('Give the group a name.')
  if (bots.length < 2 || bots.length > 6) throw new Error('A group needs two to six agents.')
  const members = rosterFor(bots)
  if (routing === 'lead' && !(lead && members.some((m) => m.member_id === lead))) routing = 'everyone'
  let res: { room: Room }
  try {
    res = await call<{ room: Room }>('groups.create', { room_id: uuid(), name: clean.slice(0, 200), members })
  } catch (e) {
    const reason = reasonOf(e)
    const detail = (e as { data?: { detail?: unknown } })?.data?.detail
    throw new Error(reason === 'invalid_params' && typeof detail === 'string' ? `Hermes couldn’t make this group: ${detail}` : groupError(e))
  }
  upsertRoom(res.room)
  let routingError: string | undefined
  if (routing !== 'everyone') {
    try {
      await call('groups.context', { room_id: res.room.room_id, event_id: uuid(), purpose: '', notes: '', routing, lead_member_id: routing === 'lead' ? lead ?? '' : '' })
    } catch (e) { routingError = groupError(e) }
  }
  void refreshRoom(res.room.room_id)
  return { room: res.room, routingError }
}

/** Post to the room. Retrying with the same event id never posts twice (the gateway recognises it). */
export async function sendToRoom(roomId: string, eventId: string, payload: { text: string; thread_id: string; attachments?: RoomAttachment[] }): Promise<RoomEvent | undefined> {
  const res = await call<{ event?: RoomEvent; accepted?: boolean; client_event_id?: string }>('groups.send', { room_id: roomId, event_id: eventId, payload }, 60_000)
  if (res?.accepted === false || (res?.client_event_id && res.client_event_id !== eventId)) throw new Error('Hermes didn’t confirm that message. Send it again: it won’t be posted twice.')
  // Shown at once when it is the very next entry of the log this app has read; otherwise the next read brings it.
  const v = gs.views[roomId]
  const ev = res?.event
  if (ev && v?.logLoaded && ev.seq === v.seq + 1 && !v.events.some((e) => e.seq === ev.seq)) patchView(roomId, { events: [...v.events, ev], seq: ev.seq })
  void refreshRoom(roomId)
  return ev
}

export async function stopRoom(roomId: string): Promise<number> {
  const res = await call<{ cancelled?: number }>('groups.stop', { room_id: roomId, cancel_id: uuid() })
  void refreshRoom(roomId)
  return typeof res?.cancelled === 'number' ? res.cancelled : 0
}

export async function continueRoom(roomId: string, discussionEventId: string) {
  await call('groups.continue', { room_id: roomId, discussion_event_id: discussionEventId })
  void refreshRoom(roomId)
}

export async function renameRoom(roomId: string, name: string) {
  const res = await call<{ room?: Room }>('groups.rename', { room_id: roomId, event_id: uuid(), name: name.trim().replace(/\s+/g, ' ').slice(0, 200) })
  if (res?.room) upsertRoom(res.room)
  void refreshRoom(roomId)
}

export async function setRoomContext(roomId: string, ctx: RoomContext) {
  await call('groups.context', {
    room_id: roomId, event_id: uuid(), purpose: ctx.purpose, notes: ctx.notes,
    ...(ctx.routing ? { routing: ctx.routing, lead_member_id: ctx.routing === 'lead' ? ctx.lead_member_id ?? '' : '' } : {}),
  })
  void refreshRoom(roomId)
}

export async function disbandRoom(roomId: string) {
  await call('groups.disband', { room_id: roomId, cancel_id: uuid() }, 60_000)
  deleted.add(roomId)
  watchers.delete(roomId)
  dropRoom(roomId)
  const { [roomId]: _gone, ...rest } = gs.views
  set({ views: rest })
}

/** Approve or deny an approval, retry a turn that couldn't run, or discard one that stopped part-way. */
export async function actOnRoom(roomId: string, action: PendingAction, choice?: 'once' | 'deny') {
  const base = { room_id: roomId, member_id: action.member_id, task_id: action.task_id, execution_generation: action.execution_generation }
  if (action.kind === 'approval') {
    const requestId = action.request_id || action.approval?.request_id || ''
    if (!requestId || (choice !== 'once' && choice !== 'deny')) throw new Error('That approval is missing its details. Check again.')
    await call('groups.approve', { ...base, request_id: requestId, choice })
  } else if (action.kind === 'retry') await call('groups.retry', base)
  else if (action.kind === 'discard') await call('groups.discard', base)
  else throw new Error('This Hermes asked for something this app doesn’t know yet.')
  void refreshRoom(roomId)
}

export const MAX_FILE_BYTES = 15_000_000
export const MAX_FILES = 8

function fileKind(file: File) { return file.type.startsWith('image/') ? 'image' : file.type === 'application/pdf' ? 'pdf' : 'file' }
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',', 2)[1] ?? '')
    r.onerror = () => reject(r.error ?? new Error('Couldn’t read that file.'))
    r.readAsDataURL(file)
  })
}

/** Hand one file to the room's store; the manifest it returns goes into the next groups.send. */
export async function uploadToRoom(roomId: string, file: File): Promise<RoomAttachment> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is too big (15 MB at most).`)
  const data = await readBase64(file)
  const res = await call<RoomAttachment>('groups.attachment.upload', {
    room_id: roomId, upload_id: uuid(), kind: fileKind(file), name: file.name || 'file', mime: file.type || 'application/octet-stream', data_base64: data,
  }, 180_000)
  return { attachment_id: res.attachment_id, kind: res.kind, name: res.name, size: res.size, mime: res.mime }
}

export async function fetchAttachment(roomId: string, eventId: string, attachmentId: string): Promise<Blob> {
  const res = await call<{ name: string; mime: string; data_base64: string }>('groups.attachment.download', { room_id: roomId, event_id: eventId, attachment_id: attachmentId }, 180_000)
  const bin = atob(res.data_base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: res.mime || 'application/octet-stream' })
}

/** Save a room file through the system's save dialog. */
export async function downloadAttachment(roomId: string, eventId: string, a: RoomAttachment) {
  const blob = await fetchAttachment(roomId, eventId, a.attachment_id)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = a.name || 'file'
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Open a group in the right panel (the bead you clicked flies into its title). */
/** A group chat takes the middle, like an agent's chat; the side panel stays for the agents' browser, terminal or
 *  screen (anything else in it closes). */
export function openGroup(roomId: string, _from?: Element | null) {
  const panel = getState().panel
  if (panel && !/^(browser|screen|term):/.test(panel)) window.dispatchEvent(new CustomEvent('hermes:close-panel'))
  setMain({ view: 'chat', groupOpen: roomId })
}

// ---------- reading a room: who's doing what (pure; the sidebar, header, members and log agree) ----------

export const memberName = (m: Pick<RoomMember, 'display_name' | 'profile' | 'handle' | 'member_id'>) =>
  m.display_name || (m.profile ? prettyName(m.profile) : '') || m.handle || m.member_id

export type MemberStatus =
  | { kind: 'idle' }
  | { kind: 'queued' }
  | { kind: 'working' | 'stalled'; since?: number; quietS?: number; tool?: string }
  | { kind: 'replied' | 'passed' | 'cancelled' | 'unavailable' }
  | { kind: 'failed'; reason?: string; detail?: string }

const STALL_AFTER_S = 120
const TERMINAL = new Set(['turn.settled', 'turn.failed', 'turn.cancelled', 'turn.deferred'])
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const firstLine = (t: string) => t.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
const isUserMessage = (e: RoomEvent) => e.kind === 'message.user' || e.kind === 'message'

/** Each thread's current discussion: the event id of its newest user message. */
function threadDiscussions(events: readonly RoomEvent[]) {
  const map = new Map<string, string>()
  for (const e of events) if (isUserMessage(e) && e.event_id) map.set(str(e.payload.thread_id), e.event_id)
  return map
}

/** Each member's last outcome in its thread's current discussion (a newer message in that thread supersedes it). */
function memberOutcomes(events: readonly RoomEvent[]) {
  const discussions = threadDiscussions(events)
  const out = new Map<string, MemberStatus>()
  for (const e of events) {
    const member = str(e.payload.member_id)
    if (!member || !TERMINAL.has(e.kind) || str(e.payload.discussion_event_id) !== discussions.get(str(e.payload.thread_id))) continue
    if (e.kind === 'turn.settled') out.set(member, { kind: e.payload.passed === true ? 'passed' : 'replied' })
    else if (e.kind === 'turn.failed') { const err = str(e.payload.error); out.set(member, { kind: 'failed', reason: str(e.payload.reason_code) || firstLine(err) || undefined, detail: err || undefined }) }
    else if (e.kind === 'turn.cancelled') out.set(member, { kind: 'cancelled' })
    else if (e.payload.reason === 'member_unavailable') out.set(member, { kind: 'unavailable' })
  }
  return out
}

/** One status per member: live work (running beats queued) first, then its last outcome. */
export function memberStatuses(view: RoomView | undefined, nowS = Date.now() / 1000): Map<string, MemberStatus> {
  const members = view?.state?.room?.members ?? []
  const activity = view?.state?.driver_status?.member_activity ?? []
  const outcomes = memberOutcomes(view?.events ?? [])
  const map = new Map<string, MemberStatus>()
  for (const m of members) {
    const rows = activity.filter((r) => r.member_id === m.member_id)
    const running = rows.find((r) => r.status !== 'queued')
    if (running) {
      const last = running.progress_at ?? running.started_at
      const quietS = typeof last === 'number' ? Math.max(0, nowS - last) : undefined
      map.set(m.member_id, { kind: quietS !== undefined && quietS >= STALL_AFTER_S ? 'stalled' : 'working', since: running.started_at, quietS, tool: running.tool || undefined })
    } else if (rows.length) map.set(m.member_id, { kind: 'queued' })
    else map.set(m.member_id, outcomes.get(m.member_id) ?? { kind: 'idle' })
  }
  return map
}

export const isBusy = (s?: MemberStatus) => s?.kind === 'working' || s?.kind === 'stalled'

/** What the sidebar row shows: needs you, working (since when), went wrong, or asleep (no driver). */
export function roomSummary(view: RoomView | undefined) {
  const d = view?.state?.driver_status
  const activity = d?.member_activity ?? []
  const starts = activity.map((a) => a.started_at).filter((t): t is number => typeof t === 'number')
  return {
    needs: d?.pending_actions?.length ?? 0,
    working: !!d?.working || activity.length > 0,
    since: starts.length ? Math.min(...starts) * 1000 : undefined,
    problem: d?.last_error ? String(d.last_error) : view?.error,
    asleep: !!view?.state && !d,
    activeMembers: new Set(activity.filter((a) => a.status !== 'queued').map((a) => a.member_id)),
  }
}

/** "Round 2 of 6" while members work, from the live tasks' own round. */
export function roundText(view: RoomView | undefined): string | undefined {
  const d = view?.state?.driver_status
  const rounds = (d?.member_activity ?? []).map((a) => a.round_index).filter((n): n is number => typeof n === 'number' && n >= 0)
  if (!rounds.length) return undefined
  const n = Math.max(...rounds) + 1
  return d?.max_rounds ? `Round ${n} of ${d.max_rounds}` : `Round ${n}`
}

/** Who answers a message that names nobody, in words. */
export function routingText(ctx: RoomContext | null | undefined, members: RoomMember[]): string {
  if (ctx?.routing === 'lead' && ctx.lead_member_id) {
    const lead = members.find((m) => m.member_id === ctx.lead_member_id)
    return `${lead ? memberName(lead) : 'The lead'} leads and hands out the work`
  }
  if (ctx?.routing === 'auto') return 'Hermes picks who answers'
  return 'Everyone answers'
}

export interface Pause { count: number; actionable: boolean }
const discussionOf = (e: RoomEvent) => str(e.payload.discussion_event_id)
export const isBounded = (e: RoomEvent) => e.kind === 'room.activity' && e.payload.status === 'bounded'

/** Every pause at the work limit (keyed by seq): how much its discussion said first, and whether Continue
 *  and Stop still mean something (nothing has moved that discussion on since, and continues are left). */
export function pausedDiscussions(events: readonly RoomEvent[], maxContinues: number): Map<number, Pause> {
  const said = new Map<string, number>(), grants = new Map<string, number>(), counts = new Map<number, number>()
  for (const e of events) {
    const d = discussionOf(e)
    if (!d) continue
    if (e.kind === 'message.member') said.set(d, (said.get(d) ?? 0) + 1)
    if (e.kind === 'room.continued') grants.set(d, (grants.get(d) ?? 0) + 1)
    if (isBounded(e)) counts.set(e.seq, said.get(d) ?? 0)
  }
  const moved = new Set<number>(), laterD = new Set<string>(), laterT = new Set<string>()
  let laterStop = false
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i], d = discussionOf(e), t = str(e.payload.thread_id)
    if (isBounded(e) && (laterStop || laterD.has(d) || (t && laterT.has(t)))) moved.add(e.seq)
    if (e.kind === 'room.stop_requested') laterStop = true
    if (d && (e.kind === 'room.continued' || isBounded(e))) laterD.add(d)
    if (e.kind === 'message.user' && t) laterT.add(t)
  }
  const lastStop = events.reduce((s, e) => (e.kind === 'room.stop_requested' ? e.seq : s), 0)
  const sourceSeq = new Map(events.filter((e) => e.kind === 'message.user' && e.event_id).map((e) => [e.event_id!, e.seq]))
  const out = new Map<number, Pause>()
  for (const e of events) {
    if (!isBounded(e)) continue
    const d = discussionOf(e)
    const fenced = lastStop > (sourceSeq.get(d) ?? e.seq)
    out.set(e.seq, { count: counts.get(e.seq) ?? 0, actionable: !!d && !fenced && !moved.has(e.seq) && (grants.get(d) ?? 0) < maxContinues })
  }
  return out
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const mentions = (text: string, handle: string) => !!handle && new RegExp(`(^|[^\\w@])@${escapeRe(handle)}(?![\\w-])`, 'i').test(text)

/** "Researcher asked Writer": a member's reply that @mentions a teammate who then took a turn in that discussion. */
export function roomHandoffs(events: readonly RoomEvent[], members: readonly RoomMember[]) {
  const lastTurn = new Map<string, number>()
  events.forEach((e, i) => {
    const m = str(e.payload.member_id)
    if (m && TERMINAL.has(e.kind)) { lastTurn.set(`${m}|${discussionOf(e)}`, i); lastTurn.set(`${m}|*`, i) }
  })
  const out = new Map<number, { from: string; to: string }[]>()
  events.forEach((e, i) => {
    const from = e.kind === 'message.member' && e.actor?.kind === 'member' ? str(e.actor.id) : ''
    const text = str(e.payload.text) || str(e.payload.content)
    if (!from || !text) return
    const d = discussionOf(e)
    for (const m of members) {
      const at = lastTurn.get(`${m.member_id}|${d || '*'}`)
      if (m.member_id !== from && at !== undefined && at > i && mentions(text, m.handle)) {
        const list = out.get(e.seq) ?? []
        list.push({ from, to: m.member_id })
        out.set(e.seq, list)
      }
    }
  })
  return out
}

/** What an approval would allow. Approve is offered only for this exact request, and only when it shows a
 *  real command, or the description a tool label ("<tool> (…)") stands for. */
export function approvalPreview(a: PendingAction) {
  const ap = a.approval
  const command = str(ap?.command).trim()
  const description = str(ap?.description).trim()
  const labelled = /^<[^>]+> \(/.test(command)
  const actual = labelled ? '' : command
  const requestId = str(a.request_id).trim()
  const matching = !!requestId && (!ap?.request_id || ap.request_id === requestId) && (!ap?.prompt_id || ap.prompt_id === requestId)
  const choices = Array.isArray(ap?.choices) && ap!.choices!.length ? ap!.choices! : ['once', 'deny']
  return { command: actual, description, choices, reviewable: matching && !!(actual || (labelled && description)) }
}

/** Seconds as "45s", "1m 20s", "1h 05m". */
export function since(ms?: number, nowMs = Date.now()): string {
  if (!ms) return ''
  const s = Math.max(0, Math.floor((nowMs - ms) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}
