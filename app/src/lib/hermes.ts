// Hermes, as this app sees it: Chief's one canonical chat (the default profile's "Bot Chat"), every other
// agent's Bot Chat attached for live status and approvals (and opened in the middle when you click the
// agent, so you can talk to it directly), and the canonical gateway protocol on top.
// Identity is Bot Mode's: profile + the session titled exactly "Bot Chat". Nothing here creates a
// second chat; /new tidies the one chat instead (session.compress).
import { IS_MAC } from './platform'
import { gateway, type GatewayEvent } from './gateway'
import { isInternalNote } from './markdown'
import { assignLooks } from './looks'
import { recordTalk } from './feed'
import { getPrefs } from './prefs'
import { chatOf, getState, placeFocus, setState, updateBot, updateChat, type Bot, type Msg, type Need, type ToolCall } from './store'

const CANONICAL_TITLE = 'Bot Chat'
const uuid = () => crypto.randomUUID()
interface SessionRef { profile: string; generation?: number; revision?: number }
const sessions = new Map<string, SessionRef>()
let chiefSession: string | undefined

export const isChief = (profile: string) => profile === 'default'
/** The agent a live Hermes session belongs to (for the side panel's Browser and Terminal). */
export const sessionProfile = (sid?: string) => (sid ? sessions.get(sid)?.profile : undefined)
/** The live session of an agent's chat (Hermes', or the agent's own), for per-session calls like process.list. */
export function liveSession(profile: string): string | undefined {
  if (isChief(profile)) return chiefSession
  return getState().chats[profile]?.sessionId ?? getState().bots.find((b) => b.profile === profile)?.runtimeId
}
/** Whose chat is in the middle of the window. */
const active = () => getState().chatWith
const nameOf = (profile: string) => prettyName(profile, getState().bots.find((b) => b.profile === profile)?.name)
export function prettyName(profile: string, display?: string) {
  if (isChief(profile)) return 'Hermes'
  if (display) return display
  const s = profile.replace(/[-_]/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// -------------------------------------------------------------------------------------------------
export async function start() {
  gateway.onStatus((s, detail) => { console.log('[hermes] connection', s, detail ?? ''); setState({ connection: s, connectionError: detail }) })
  gateway.onReady(() => { void boot() })
  gateway.onEvent(onEvent)
  gateway.onServerRequest = onServerRequest
  await gateway.connect()
  // Coming back to the window, or the network coming back, skips the wait between tries.
  const nudge = () => { if (!gateway.open) gateway.retryNow() }
  window.addEventListener('focus', nudge)
  window.addEventListener('online', nudge)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') nudge() })
  let ticks = 0
  setInterval(() => {
    if (!gateway.open) return
    void refreshActivity()
    // Every minute: pick up agents Chief added (create_agent) and attach their chats for live status.
    if (++ticks % 3 === 0) void loadProfiles().then(attachNewBots).catch(() => {})
  }, 20_000)
}

async function boot() {
  try { await gateway.request('client.capabilities', { server_requests: true }) } catch { /* older gateways */ }
  try { await gateway.request('client.capabilities', { desktop_local: true }) } catch { /* optional */ }
  sessions.clear()
  try {
    await loadProfiles()
    await openChief()
    await attachBots()
    // A reconnect gives every session a new runtime id: agent chats are read again when shown.
    setState({ chats: {} })
    for (const p of new Set([...getState().panes, active()])) if (!p.startsWith('group:') && !isChief(p)) void loadChat(p)
    await refreshActivity()
    console.log('[hermes] ready:', getState().bots.length, 'agents,', getState().chief.messages.length, 'chat items,', getState().needs.length, 'needs')
  } catch (error: any) {
    console.log('[hermes] boot failed', error?.message ?? error)
    setState({ connection: 'error', connectionError: error?.message ?? String(error) })
  }
}

// -- the team --------------------------------------------------------------------------------------
async function loadProfiles() {
  const res = await gateway.request<any>('profiles.list', {})
  const prev = new Map(getState().bots.map((b) => [b.profile, b]))
  const rows: any[] = res?.profiles ?? []
  const bots: Bot[] = rows.map((r) => {
    const cs = r.canonical_session
    const old = prev.get(r.name)
    return {
      profile: r.name,
      name: prettyName(r.name, r.display_name),
      isChief: !!r.is_default,
      role: r.description || undefined,
      home: r.path,
      canonicalId: cs ? cs.resolved_id || cs.id : undefined,
      runtimeId: old?.runtimeId,
      status: old?.status ?? 'free',
      since: old?.since,
      step: old?.step,
      preview: cs?.preview || old?.preview,
      lastActive: cs?.last_active ? cs.last_active * 1000 : undefined,
      model: r.model || old?.model,
      online: true,
      poseKey: cs ? cs.id : r.name,
      canonicalCount: cs?.message_count ?? 0,
      workerId: r.worker_session?.id,
      workerTitle: r.worker_session?.title || undefined,
    }
  })
  const order = (b: Bot) => (b.isChief ? '' : b.name.toLowerCase())
  bots.sort((a, b) => order(a).localeCompare(order(b)))
  // Every agent its own bead (shape, colour, pose), before any bead is drawn.
  assignLooks(bots.filter((b) => !b.isChief).map((b) => b.profile))
  setState({ bots })
  // An agent whose chat was open was removed: its pane closes, and the focus goes back to Chief.
  const alive = (k: string) => k.startsWith('group:') || isChief(k) || bots.some((b) => b.profile === k)
  setState((s) => {
    const left = s.panes.filter(alive)
    const panes = left.length ? left : ['default']
    if (alive(s.chatWith)) return { panes }
    if (s.groupOpen) return { panes, chatWith: 'default' }
    const first = panes[0]
    return first.startsWith('group:') ? { panes, chatWith: 'default', groupOpen: first.slice(6) } : { panes, chatWith: first }
  })
}

/** After the team changes (a bot added, renamed or removed): read the profiles again and attach new bots. */
export async function refreshTeam() { try { await loadProfiles(); await attachNewBots() } catch { /* the minute poll catches up */ } }

let profilesTimer: ReturnType<typeof setTimeout> | null = null
function refreshProfilesSoon() {
  if (profilesTimer) return
  profilesTimer = setTimeout(() => { profilesTimer = null; void loadProfiles().catch(() => {}) }, 1500)
}

async function findCanonical(profile: string): Promise<string | undefined> {
  const bot = getState().bots.find((b) => b.profile === profile)
  if (bot?.canonicalId) return bot.canonicalId
  const res = await gateway.request<any>('session.list', { profile, title: CANONICAL_TITLE, include_hidden: true, limit: 5 })
  const rows: any[] = Array.isArray(res) ? res : res?.sessions ?? res?.rows ?? (res ? [res] : [])
  const hit = rows.find((r) => r && (r.root_title === CANONICAL_TITLE || r.title === CANONICAL_TITLE))
  return hit ? hit.resolved_id || hit.id || hit.session_id : undefined
}

async function openChief() {
  updateChat('default', { loading: true })
  let id = window.hermesNative.testChiefSession || await findCanonical('default')
  if (!id) {
    // Bot Mode's own rule: look first, create only when nothing exists, with the exact title.
    const created = await gateway.request<any>('session.create', { request_id: uuid(), source: 'gui', profile: 'default', title: CANONICAL_TITLE, hidden: true, follow_profile_config: true })
    id = created?.stored_session_id ?? created?.session_id // resume takes the stored id (`hermes serve` gives a live one in session_id)
  }
  if (!id) throw new Error("Couldn't find or start Hermes' chat")
  const res = await gateway.request<any>('session.resume', { session_id: id, profile: 'default', source: 'desktop', cols: 100 }, 60_000)
  chiefSession = res.session_id
  sessions.set(res.session_id, { profile: 'default', generation: res.execution_generation, revision: res.revision })
  const messages = toMsgs(res.messages ?? [])
  updateChat('default', { sessionId: res.session_id, messages, loading: false, model: res.info?.model, busy: false })
  updateBot('default', { model: res.info?.model, runtimeId: res.session_id })
  absorbPrompts('default', res.session_id, res.prompts, res.execution_generation)
  void loadChatSettings('default')
}

// -- talking to an agent directly ------------------------------------------------------------------------
/** Puts `profile`'s chat in the middle (Chief's, or an agent's own Bot Chat) and reads it if it isn't yet. */
export function openChat(profile: string) {
  // The work view (browser, screen, terminal) stays beside the chat and follows it to this agent; anything else closes.
  const panel = getState().panel
  const work = panel?.match(/^(browser|screen|term):/)?.[1]
  if (work) { if (panel !== `${work}:${profile}`) window.dispatchEvent(new CustomEvent('hermes:open-panel', { detail: { profile: `${work}:${profile}` } })) }
  else window.dispatchEvent(new CustomEvent('hermes:close-panel'))
  setState((s) => ({ ...placeFocus(s, profile), view: 'chat' }))
  if (isChief(profile)) return
  const cur = getState().chats[profile]
  if (!cur || (!cur.loading && !cur.sessionId)) void loadChat(profile)
}

const loadingChats = new Set<string>()
/** Off-screen test copies: an agent's chat pointed at a hidden test session instead of its real one. */
const testSession = (profile: string) => (window.hermesNative.testSessions ?? '').split(',').map((p) => p.split('=')).find(([k]) => k?.trim() === profile)?.[1]?.trim() || undefined

/** Reads an agent's Bot Chat (the chat Chief hands it work in) with its history. */
async function loadChat(profile: string) {
  if (loadingChats.has(profile)) return
  loadingChats.add(profile)
  updateChat(profile, { loading: true })
  try {
    const bot = getState().bots.find((b) => b.profile === profile)
    const id = testSession(profile) ?? bot?.runtimeId ?? bot?.canonicalId ?? await findCanonical(profile)
    // No chat yet (Chief never handed it work): it's made, Bot Mode's way, with your first message.
    if (!id) {
      updateChat(profile, { loading: false, messages: [], sessionId: undefined })
      // Its model, from its own settings, for the message box.
      void gateway.request<any>('model.options', { profile }, 20_000).then((r) => { if (r?.model) updateChat(profile, { model: r.model, provider: r.provider }) }).catch(() => {})
      return
    }
    await resumeAgent(profile, id, true)
  } catch (error: any) {
    updateChat(profile, { loading: false, messages: [{ id: uuid(), role: 'notice', text: `Couldn’t open this chat: ${error?.message ?? error}`, error: true }] })
  } finally { loadingChats.delete(profile) }
}

async function resumeAgent(profile: string, id: string, withMessages: boolean): Promise<string> {
  const res = await gateway.request<any>('session.resume', { session_id: id, profile, source: 'desktop', cols: 100 }, 60_000)
  sessions.set(res.session_id, { profile, generation: res.execution_generation, revision: res.revision })
  const bot = getState().bots.find((b) => b.profile === profile)
  updateBot(profile, { runtimeId: res.session_id, model: res.info?.model || bot?.model, ...(bot?.canonicalId ? {} : { canonicalId: id }) })
  absorbPrompts(profile, res.session_id, res.prompts, res.execution_generation)
  const working = bot?.status === 'working'
  updateChat(profile, {
    sessionId: res.session_id, loading: false, model: res.info?.model || bot?.model,
    ...(withMessages ? { messages: toMsgs(res.messages ?? []) } : {}),
    ...(working ? { busy: true, step: bot?.step, turnStartedAt: bot?.since } : { busy: false }),
  })
  void loadChatSettings(profile)
  // What this chat will really run on (its live agent), for the model chip.
  void gateway.request<any>('model.options', { session_id: res.session_id, profile }, 20_000).then((r) => { if (r?.model) updateChat(profile, { model: r.model, provider: r.provider }) }).catch(() => {})
  return res.session_id
}

/** The agent's Bot Chat for your first message to it: found, or made with the exact title (Bot Mode's rule). */
async function startAgentChat(profile: string): Promise<string | undefined> {
  let id = testSession(profile) ?? await findCanonical(profile)
  if (!id) {
    const created = await gateway.request<any>('session.create', { request_id: uuid(), source: 'gui', profile, title: CANONICAL_TITLE, hidden: true, follow_profile_config: true })
    id = created?.stored_session_id ?? created?.session_id // resume takes the stored id (`hermes serve` gives a live one in session_id)
  }
  return id ? resumeAgent(profile, id, false) : undefined
}

async function attachBots() {
  const bots = getState().bots.filter((b) => !b.isChief && b.canonicalId)
  await Promise.all(bots.map(async (b) => {
    try {
      const res = await gateway.request<any>('session.resume', { session_id: b.canonicalId, profile: b.profile, source: 'desktop', omit_messages: true, defer_history: true, cols: 100 }, 60_000)
      sessions.set(res.session_id, { profile: b.profile, generation: res.execution_generation, revision: res.revision })
      updateBot(b.profile, { runtimeId: res.session_id, model: res.info?.model || b.model })
      absorbPrompts(b.profile, res.session_id, res.prompts, res.execution_generation)
    } catch (error) {
      console.warn('attach failed', b.profile, error)
    }
  }))
}

async function attachNewBots() {
  const fresh = getState().bots.filter((b) => !b.isChief && b.canonicalId && !b.runtimeId)
  for (const b of fresh) {
    try {
      const res = await gateway.request<any>('session.resume', { session_id: b.canonicalId, profile: b.profile, source: 'desktop', omit_messages: true, defer_history: true, cols: 100 }, 60_000)
      sessions.set(res.session_id, { profile: b.profile, generation: res.execution_generation, revision: res.revision })
      updateBot(b.profile, { runtimeId: res.session_id, model: res.info?.model || b.model })
      absorbPrompts(b.profile, res.session_id, res.prompts, res.execution_generation)
    } catch { /* try again next minute */ }
  }
}

async function refreshActivity() {
  const bots = getState().bots
  await Promise.all(bots.map(async (b) => {
    try {
      const res = await gateway.request<any>('session.active_list', { profile: b.profile }, 15_000)
      const rows: any[] = Array.isArray(res) ? res : res?.sessions ?? res?.rows ?? []
      const mine = rows.find((r) => [r.session_id, r.id, r.stored_session_id].includes(b.runtimeId) || [r.session_id, r.id].includes(b.canonicalId))
      const status = mine?.status
      const cur = getState().bots.find((x) => x.profile === b.profile)
      if (!cur || cur.status === 'needs') return
      if (status === 'working' || status === 'starting') { if (cur.status !== 'working') updateBot(b.profile, { status: 'working', since: cur.since ?? Date.now() }) }
      else if (cur.status === 'working') updateBot(b.profile, { status: 'free', step: undefined })
    } catch { /* older gateways */ }
  }))
}

// -- reading a transcript into chat items -------------------------------------------------------------
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((p: any) => (typeof p === 'string' ? p : p?.type === 'text' ? p.text : '')).join('\n')
  return ''
}
function parseArgs(raw: unknown): any { if (raw && typeof raw === 'object') return raw; try { return JSON.parse(String(raw || '{}')) } catch { return {} } }
export function handoffTargets(args: any): string[] {
  const t = args?.target ?? args?.targets ?? args?.to
  const list = Array.isArray(t) ? t : String(t ?? '').split(',')
  return list.map((x: string) => String(x).trim().replace(/^@/, '')).filter(Boolean)
}
const FROM_RE = /^Message from\s+\S*\s*([^(@:\n]+?)\s*\(@([\w-]+)\):\s*/
export function stripFrom(text: string): { from?: string; handle?: string; body: string } {
  const m = FROM_RE.exec(text)
  return m ? { from: m[1].trim(), handle: m[2], body: text.slice(m[0].length) } : { body: text }
}
/** A bot handle (or name) back to its profile. */
export function profileForHandle(handle?: string): string | undefined {
  if (!handle) return undefined
  const h = handle.toLowerCase().replace(/^@/, '')
  if (h === 'hermes' || h === 'default') return 'default'
  const bots = getState().bots
  return bots.find((b) => b.profile.toLowerCase() === h)?.profile
    ?? bots.find((b) => b.name.toLowerCase() === h.replace(/[-_]/g, ' '))?.profile
}
function replyFrom(text: string): string | undefined {
  const s = stripFrom(text)
  if (s.handle) return profileForHandle(s.handle)
  const m = /@([\w-]+)/.exec(text)
  return profileForHandle(m?.[1])
}

/** Your message as you wrote it: Hermes' notes about attached pictures and the "Files on this Mac" list
 *  this app adds are taken out, and the attachments come back as names to show as chips. */
export function cleanUserText(text: string): { text: string; files: string[] } {
  const files: string[] = []
  let t = text
  t = t.replace(/\[The user sent an image~[\s\S]*?~?\]\s*/g, () => { files.push('Picture'); return '' })
  t = t.replace(/\[If you need a closer look, use vision_analyze[\s\S]*?\]\s*/g, (m) => { const p = /image_url:\s*(\S+?)\s*~?\]/.exec(m)?.[1]; if (p && files[files.length - 1] === 'Picture') files[files.length - 1] = p.split(/[\\/]/).pop() ?? 'Picture'; return '' })
  t = t.replace(/\n*Files on this (?:Mac|PC):\n((?:- .+\n?)+)/g, (_m, list: string) => { for (const line of list.split('\n')) { const p = line.replace(/^- /, '').trim(); if (p) files.push(p.split(/[\\/]/).pop() ?? p) } return '' })
  return { text: t.trim(), files }
}

export function toMsgs(raw: any[]): Msg[] {
  const out: Msg[] = []
  let turn: Msg | null = null
  let lastUserAt: number | undefined
  const flush = () => { if (turn && (turn.text || turn.tools?.length)) out.push(turn); turn = null }
  for (const m of raw) {
    const at = m.timestamp ? m.timestamp * 1000 : undefined
    // A gateway sends stored rows (`content`, `tool_calls`); Hermes' web server, which another computer is
    // reached through (the VPS), sends its display transcript (`text`, and a `tool` row per call).
    const content = textOf(m.content ?? m.text)
    const id = String(m.message_uid ?? m.row_id ?? m.id ?? uuid())
    if (m.role === 'user') {
      const kind: string | undefined = m.display_kind
      if (kind === 'hidden' || kind === 'model_only') continue
      if (kind === 'process_complete') {
        flush()
        const from = replyFrom(content)
        out.push({ id, role: 'notice', text: stripFrom(content).body, from, at })
        continue
      }
      if (kind && kind !== 'user' && kind !== 'steer') {
        flush()
        const cron = /^\[Cronjob "([^"]+)"/.exec(content)
        const label = cron ? `Scheduled job ran: ${cron[1]}` : (m.display_metadata?.display_text || m.display_text || '')
        if (label) out.push({ id, role: 'notice', text: label, at })
        lastUserAt = at
        continue
      }
      if (isInternalNote(content) || !content.trim()) continue
      flush()
      const s = stripFrom(content)
      const clean = cleanUserText(s.body)
      out.push({ id, role: 'user', text: clean.text, images: clean.files.length ? clean.files : undefined, at, from: s.handle ? profileForHandle(s.handle) ?? s.from : undefined })
      lastUserAt = at
      continue
    }
    if (m.role === 'assistant') {
      if (!turn) turn = { id, role: 'assistant', text: '', tools: [], handoffs: [], startedAt: lastUserAt ?? at, at }
      for (const tc of m.tool_calls ?? []) {
        const fn = typeof tc.function === 'object' ? tc.function : { name: tc.name, arguments: tc.arguments }
        const args = parseArgs(fn?.arguments)
        turn.tools!.push({ id: tc.id ?? uuid(), name: fn?.name ?? 'tool', args, done: true })
        if (fn?.name === 'message_agent') turn.handoffs!.push(...handoffTargets(args))
      }
      if (content.trim()) turn.text = turn.text ? `${turn.text}\n\n${content}` : content
      if (m.reasoning && typeof m.reasoning === 'string') turn.thinking = (turn.thinking ? turn.thinking + '\n' : '') + m.reasoning
      turn.endedAt = at
      continue
    }
    if (m.role === 'tool') {
      const t = turn?.tools!.find((x) => x.id === m.tool_call_id)
      if (t) { t.done = true; t.summary = summarize(textOf(m.content ?? m.context)) }
      else if (m.name) {
        // The display transcript: the tool row stands for the call itself (name, args, a short context).
        if (!turn) turn = { id, role: 'assistant', text: '', tools: [], handoffs: [], startedAt: lastUserAt ?? at, at }
        const args = m.args && typeof m.args === 'object' ? m.args : parseArgs(m.args)
        turn.tools!.push({ id: String(m.tool_call_id ?? id), name: String(m.name), args, done: true, summary: m.context ? summarize(String(m.context)) : undefined })
        if (m.name === 'message_agent') turn.handoffs!.push(...handoffTargets(args))
        turn.endedAt = at
      }
    }
  }
  flush()
  return out
}
function summarize(s: string) { return s.replace(/\s+/g, ' ').slice(0, 160) }

// -- live events -------------------------------------------------------------------------------------
function chatMessages(profile: string, fn: (msgs: Msg[]) => Msg[]) { updateChat(profile, (c) => ({ messages: fn(c.messages) })) }
function chiefMessages(fn: (msgs: Msg[]) => Msg[]) { chatMessages('default', fn) }
function lastStreaming(msgs: Msg[]): Msg | undefined { const m = msgs[msgs.length - 1]; return m && m.role === 'assistant' && m.streaming ? m : undefined }
function ensureStreaming(msgs: Msg[], turnId?: string, startedAt?: number): Msg[] {
  if (lastStreaming(msgs)) return msgs
  return [...msgs, { id: turnId ?? uuid(), role: 'assistant', text: '', tools: [], handoffs: [], streaming: true, startedAt: startedAt ?? Date.now(), at: Date.now() }]
}
function patchLast(msgs: Msg[], patch: (m: Msg) => Msg): Msg[] { const i = msgs.length - 1; if (i < 0) return msgs; const copy = msgs.slice(); copy[i] = patch(copy[i]); return copy }

export function toolLabel(t: { name: string; args?: any }): string {
  const a = t.args ?? {}
  const pick = (...k: string[]) => k.map((x) => a[x]).find((v) => typeof v === 'string' && v)
  switch (t.name) {
    case 'message_agent': return `Asking ${handoffTargets(a).map((x) => prettyName(profileForHandle(x) ?? x)).join(', ')}`
    case 'terminal': return 'Running a command'
    case 'read_file': return `Reading ${String(pick('path', 'file_path') ?? 'a file').split(/[\\/]/).pop()}`
    case 'write_file': case 'patch': return `Editing ${String(pick('path', 'file_path') ?? 'a file').split(/[\\/]/).pop()}`
    case 'search_files': return 'Searching files'
    case 'web_search': return `Searching the web${pick('query') ? `: ${pick('query')}` : ''}`
    case 'web_extract': return 'Reading a web page'
    case 'browser_exec': return 'Using the browser'
    case 'delegate_task': return 'Handing off a task'
    case 'clarify': return 'Asking you something'
    case 'memory': return 'Checking memory'
    case 'skill_view': case 'skills_list': return 'Looking at skills'
    case 'vision_analyze': return 'Looking at an image'
    case 'execute_code': return 'Running code'
    default: return t.name.replace(/_/g, ' ')
  }
}

function setBotWorking(profile: string, step?: string) {
  const b = getState().bots.find((x) => x.profile === profile)
  if (!b) return
  if (b.status === 'needs') { if (step) updateBot(profile, { step }); return }
  updateBot(profile, { status: 'working', since: b.status === 'working' ? b.since : Date.now(), step: step ?? b.step })
}

function onEvent(ev: GatewayEvent) {
  const sid = ev.session_id
  if (ev.type === 'sessions.changed') { refreshProfilesSoon(); return }
  if (!sid) return
  const ref = sessions.get(sid)
  if (!ref) return
  const p = ev.payload ?? {}
  if (typeof p.execution_generation === 'number') ref.generation = p.execution_generation
  if (typeof p.revision === 'number') ref.revision = p.revision
  const prof = ref.profile
  const chief = sid === chiefSession
  // Messages are kept for Chief's chat and for each agent chat you've opened; every agent's status updates either way.
  const shown = chief || (!isChief(prof) && getState().chats[prof]?.sessionId === sid)
  const msgsOf = (fn: (msgs: Msg[]) => Msg[]) => chatMessages(prof, fn)
  switch (ev.type) {
    case 'btw.complete': case 'background.complete': {
      const side = sideTasks.get(String(p.task_id))
      if (side) { sideTasks.delete(String(p.task_id)); finishCard(side.card, { text: String(p.text ?? '') || 'Done.' }, side.profile) }
      break
    }
    case 'session.info': {
      if (shown) { if (p.model) updateChat(prof, { model: p.model }); if (typeof p.reasoning === 'string') updateChat(prof, { effort: p.reasoning }); if (typeof p.fast === 'string') updateChat(prof, { fast: p.fast }); if (typeof p.personality === 'string') updateChat(prof, { personality: p.personality }) }
      break
    }
    case 'message.start': {
      if (shown) {
        if (p.display_kind === 'process_complete') {
          const text = String(p.text ?? p.display_text ?? '')
          const body = stripFrom(text).body.replace(/^Background Process Finished:?\s*/i, '')
          const who = replyFrom(text)
          msgsOf((msgs) => [...msgs, { id: uuid(), role: 'notice', text: body, from: who, at: Date.now() }])
          if (who) recordTalk({ from: who, to: [prof], kind: 'reply' })
        }
        updateChat(prof, (c) => ({ busy: true, turnStartedAt: c.turnStartedAt ?? Date.now(), step: 'Thinking' }))
        msgsOf((msgs) => ensureStreaming(msgs, p.turn_id, chatOf(getState(), prof).turnStartedAt))
      }
      if (!chief) setBotWorking(prof, 'Thinking')
      break
    }
    case 'message.delta': case 'message.interim': {
      const text = typeof p.text === 'string' ? p.text : ''
      if (shown && text) {
        msgsOf((msgs) => patchLast(ensureStreaming(msgs, p.turn_id, chatOf(getState(), prof).turnStartedAt), (m) => ({ ...m, text: ev.type === 'message.interim' && p.already_streamed ? m.text : m.text + text })))
        updateChat(prof, { step: 'Writing' })
      }
      if (!chief) setBotWorking(prof, 'Writing its answer')
      break
    }
    case 'reasoning.delta': {
      if (shown && typeof p.text === 'string') msgsOf((msgs) => patchLast(ensureStreaming(msgs, undefined, chatOf(getState(), prof).turnStartedAt), (m) => ({ ...m, thinking: (m.thinking ?? '') + p.text })))
      break
    }
    case 'tool.start': case 'tool.generating': {
      const tool: ToolCall = { id: String(p.tool_id ?? uuid()), name: String(p.name ?? 'tool'), args: p.args ?? undefined, preview: p.preview }
      if (shown) {
        if (ev.type === 'tool.start') {
          msgsOf((msgs) => patchLast(ensureStreaming(msgs, undefined, chatOf(getState(), prof).turnStartedAt), (m) => ({
            ...m,
            tools: [...(m.tools ?? []).filter((t) => t.id !== tool.id), tool],
            handoffs: tool.name === 'message_agent' ? [...new Set([...(m.handoffs ?? []), ...handoffTargets(tool.args)])] : m.handoffs,
          })))
        }
        updateChat(prof, { step: toolLabel(tool) })
      }
      if (ev.type === 'tool.start' && tool.name === 'message_agent') {
        const targets = handoffTargets(tool.args).map((h) => profileForHandle(h)).filter((x): x is string => !!x)
        targets.forEach((other) => { if (!isChief(other)) setBotWorking(other, 'Starting on it') })
        recordTalk({ from: prof, to: targets, kind: 'handoff' })
      }
      if (!chief) setBotWorking(prof, toolLabel(tool))
      break
    }
    case 'tool.complete': {
      if (shown) msgsOf((msgs) => patchLast(msgs, (m) => (m.role !== 'assistant' ? m : { ...m, tools: (m.tools ?? []).map((t) => (t.id === String(p.tool_id) ? { ...t, done: true, duration: p.duration_s, summary: summarize(String(p.summary ?? '')) } : t)) })))
      break
    }
    case 'status.update': {
      // Plugin chatter (memory recall, HUD notes) isn't a step you need to see.
      const t = String(p.text ?? '').replace(/^[^\p{L}\p{N}]+/u, '').trim()
      if (!t || /\bOMH\b|memor|recall|hud|context|token/i.test(t)) break
      if (shown) updateChat(prof, { step: t.length > 60 ? t.slice(0, 60) + '…' : t })
      if (!chief) setBotWorking(prof, t)
      break
    }
    case 'message.complete': {
      const text = typeof p.text === 'string' ? p.text : ''
      if (shown) {
        msgsOf((msgs) => {
          const last = lastStreaming(msgs)
          if (!last) return text ? [...msgs, { id: uuid(), role: 'assistant', text, at: Date.now(), endedAt: Date.now() }] : msgs
          if (!text && !last.text && !last.tools?.length) return msgs.slice(0, -1) // a command turn with nothing to show
          return patchLast(msgs, (m) => ({ ...m, text: text || m.text, streaming: false, endedAt: Date.now(), error: p.status === 'error' }))
        })
        if (p.status === 'error' && p.error) msgsOf((msgs) => [...msgs, { id: uuid(), role: 'notice', text: String(p.error?.message ?? p.error), error: true }])
        const asked = chatOf(getState(), prof).askedAt
        updateChat(prof, { busy: false, turnStartedAt: undefined, step: undefined, askedAt: undefined })
        const done = chatOf(getState(), prof).messages
        const last = [...done].reverse().find((m) => m.role === 'assistant')
        if (chief) {
          window.dispatchEvent(new CustomEvent('hermes:chief-reply', { detail: { text: last?.text ?? text, error: p.status === 'error' } }))
          if (getPrefs().notifyDone && last?.text) void window.hermesNative.notify?.('Hermes replied', last.text.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').slice(0, 140))
        } else if (asked && getPrefs().notifyDone && last?.text) {
          // Only your own questions to an agent notify; work Chief handed it reports back through Chief.
          void window.hermesNative.notify?.(`${nameOf(prof)} replied`, last.text.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').slice(0, 140))
        }
      }
      if (!chief) {
        const b = getState().bots.find((x) => x.profile === prof)
        if (b && b.status !== 'needs') updateBot(prof, { status: 'free', step: undefined, since: Date.now(), preview: text ? text.replace(/\s+/g, ' ').slice(0, 140) : b.preview, lastActive: Date.now() })
        if (getState().panel === prof) void loadPanel(prof, true)
      }
      break
    }
    case 'approval.request': case 'clarify.request': {
      const need: Need = {
        key: String(p.prompt_id ?? uuid()), kind: ev.type === 'approval.request' ? 'approval' : 'clarify', profile: prof, sessionId: sid,
        rpcId: String(p.prompt_id ?? ''), requestId: String(p.prompt_id ?? ''), generation: p.execution_generation ?? ref.generation,
        title: ev.type === 'approval.request' ? (p.description || 'Run a command') : (p.question || 'A question for you'),
        command: p.command, description: p.description, choices: p.choices,
        questions: ev.type === 'clarify.request' ? [{ qid: 'q', question: p.question, choices: p.choices, multi_select: p.multi_select }] : undefined,
        at: Date.now(),
      } as Need
      addNeed(need)
      break
    }
    case 'approval.settled': case 'clarify.settled': {
      settleNeed(String(p.prompt_id ?? ''), p.choice ?? p.answer)
      break
    }
    case 'error': {
      if (shown) msgsOf((msgs) => [...msgs, { id: uuid(), role: 'notice', text: String(p.message ?? 'Something went wrong'), error: true }])
      break
    }
  }
}

function absorbPrompts(profile: string, sessionId: string, prompts: any[] | undefined, generation?: number) {
  for (const p of prompts ?? []) {
    const kind = p.kind === 'clarify' || p.question ? 'clarify' : 'approval'
    addNeed({
      key: String(p.prompt_id ?? p.id ?? uuid()), kind, profile, sessionId, rpcId: String(p.prompt_id ?? p.id ?? ''), requestId: String(p.prompt_id ?? p.id ?? ''),
      generation: p.execution_generation ?? generation,
      title: kind === 'approval' ? (p.description || 'Run a command') : (p.question || 'A question for you'),
      command: p.command, description: p.description, choices: p.choices,
      questions: kind === 'clarify' ? [{ qid: 'q', question: p.question, choices: p.choices, multi_select: p.multi_select }] : undefined,
      at: Date.now(),
    } as Need)
  }
}

let groupWaiting = 0
/** Group rooms keep their own approvals; the sidebar reports how many so the Dock badge counts them too. */
export function setGroupWaiting(n: number) { if (n !== groupWaiting) { groupWaiting = n; syncBadge() } }
function syncBadge() { void window.hermesNative.badge?.(getPrefs().badge ? getState().needs.filter((n) => !n.outcome).length + groupWaiting : 0) }

function addNeed(need: Need) {
  const isNew = !getState().needs.some((n) => n.key === need.key)
  setState((s) => ({ needs: [...s.needs.filter((n) => n.key !== need.key), need] }))
  syncBadge()
  if (isNew) {
    const who = prettyName(need.profile, getState().bots.find((b) => b.profile === need.profile)?.name)
    if (getPrefs().notify) void window.hermesNative.notify?.(need.kind === 'approval' ? `${who} needs your OK` : need.kind === 'input' ? `${who} needs something typed` : `${who} has a question`, need.kind === 'approval' ? (need.description || need.command || 'Open Hermes One to answer') : (need.title || 'Open Hermes One to answer'))
  }
  if (!isChief(need.profile)) updateBot(need.profile, { status: 'needs', step: need.kind === 'approval' ? 'Needs your OK' : 'Asked you something' })
  else updateChat('default', { step: need.kind === 'approval' ? 'Waiting for your OK' : 'Waiting for your answer' })
}

function settleNeed(key: string, choice?: string) {
  const need = getState().needs.find((n) => n.key === key)
  if (!need || need.outcome) return
  const ok = choice !== 'deny'
  const label = need.kind === 'approval' ? (ok ? (choice === 'always' ? 'Always allowed' : choice === 'session' ? 'Allowed for this chat' : 'Allowed') : 'Denied') : `Answered${choice ? `: ${choice}` : ''}`
  setState((s) => ({ needs: s.needs.map((n) => (n.key === key ? { ...n, outcome: { label, ok } } : n)) }))
  syncBadge()
  const stillWaiting = getState().needs.some((n) => !n.outcome && n.profile === need.profile)
  if (!stillWaiting && !isChief(need.profile)) updateBot(need.profile, { status: 'working', step: ok ? 'Back at work' : 'Stopped', since: Date.now() })
  // Answered cards fold away after a moment; the outcome stays visible meanwhile.
  setTimeout(() => setState((s) => ({ needs: s.needs.filter((n) => n.key !== key) })), 6000)
}

// -- what you can do ---------------------------------------------------------------------------------
export async function answerApproval(need: Need, choice: 'once' | 'session' | 'always' | 'deny') {
  const ref = sessions.get(need.sessionId)
  settleNeed(need.key, choice)
  try {
    await gateway.request('approval.respond', { session_id: need.sessionId, execution_generation: need.generation ?? ref?.generation, prompt_id: need.rpcId, choice, profile: need.profile })
  } catch (error: any) { toast(`Couldn't send that: ${error?.message ?? error}`) }
}

/** Answers a typed request. The value goes straight to Hermes over the local socket and is never kept here. */
export function answerInput(need: Need, value: string) {
  gateway.respond(need.rpcId, { value })
  setState((s) => ({ needs: s.needs.map((n) => (n.key === need.key ? { ...n, outcome: { label: value ? 'Sent' : 'Skipped', ok: !!value } } : n)) }))
  syncBadge()
  setTimeout(() => setState((s) => ({ needs: s.needs.filter((n) => n.key !== need.key) })), 4000)
}

export async function answerQuestion(need: Need, answer: string) {
  const ref = sessions.get(need.sessionId)
  settleNeed(need.key, answer)
  if (need.key.startsWith('srq-')) {
    // A batch question asked as a server request: answer every question with the one reply.
    const answers = Object.fromEntries((need.questions ?? []).map((q) => [q.qid, answer]))
    gateway.respond(isNaN(Number(need.rpcId)) ? need.rpcId : need.rpcId, { answers, outcome: 'submitted' })
    return
  }
  try {
    await gateway.request('clarify.respond', { session_id: need.sessionId, execution_generation: need.generation ?? ref?.generation, prompt_id: need.rpcId, answer, profile: need.profile })
  } catch (error: any) { toast(`Couldn't send that: ${error?.message ?? error}`) }
}

/** Opens the chat with a starter message in the box (not sent), e.g. "Use Blender to " after an install. */
export function askChief(draft: string) {
  window.dispatchEvent(new CustomEvent('hermes:close-panel'))
  setState((s) => ({ ...placeFocus(s, 'default'), view: 'chat' })) // the lead's chat takes focus (where it's open, or in the chat in focus)
  setTimeout(() => window.dispatchEvent(new CustomEvent('hermes:prefill', { detail: draft })), 80)
}

export function toast(text: string) {
  setState({ toast: text })
  setTimeout(() => { if (getState().toast === text) setState({ toast: undefined }) }, 4200)
}

/** Sends to `profile`'s chat: Chief's, or an agent's own Bot Chat (the chat Chief hands it work in). */
export async function sendTo(profile: string, raw: string, attachments: import('./gateway').Attachment[] = [], opts: { spoken?: boolean } = {}): Promise<boolean> {
  const text = raw.trim()
  if (!text && !attachments.length) return false
  let sid = chatOf(getState(), profile).sessionId
  if (!sid && !isChief(profile)) {
    try { sid = await startAgentChat(profile) } catch (error: any) { toast(`Couldn’t reach ${nameOf(profile)}: ${error?.message ?? error}`); return false }
  }
  if (!sid) return false
  const msgsOf = (fn: (msgs: Msg[]) => Msg[]) => chatMessages(profile, fn)
  // One chat: /new and friends tidy this chat (compact) instead of starting another.
  if (/^\/(new|reset|clear|compact)\b/i.test(text)) {
    // Hermes runs /compact itself when it arrives as a message: the chat is summarised, never replaced.
    msgsOf((msgs) => [...msgs, { id: uuid(), role: 'notice', text: 'Tidying up the chat so it stays quick. Nothing is lost.', at: Date.now() }])
    try { await gateway.request('prompt.submit', { session_id: sid, text: '/compact', submission_id: uuid(), profile }, 60_000) }
    catch (error: any) { toast(`Couldn't tidy the chat: ${error?.message ?? error}`) }
    return true
  }
  if (/^\/(branch|fork)\b/i.test(text)) { toast(`There is just one chat with ${nameOf(profile)}, so there are no branches.`); return false }
  if (text.startsWith('/') && !attachments.length) { void runCommand(text, profile); return true }
  msgsOf((msgs) => [...msgs, { id: uuid(), role: 'user', text, at: Date.now(), images: attachments.map((a) => a.name) }])
  recordTalk({ from: 'you', to: [profile], kind: 'ask' })
  updateChat(profile, { busy: true, turnStartedAt: Date.now(), step: 'Thinking', ...(isChief(profile) ? {} : { askedAt: Date.now() }) })
  if (!isChief(profile)) setBotWorking(profile, 'Thinking')
  try {
    // Pictures go as real attachments (copied into that agent's own image folder); other files are named by their path.
    const PICS = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
    const pics = attachments.filter((a) => PICS.includes(a.mime)).slice(0, 10)
    const others = attachments.filter((a) => !pics.includes(a))
    const home = isChief(profile) ? undefined : getState().bots.find((b) => b.profile === profile)?.home
    const staged = pics.length ? await window.hermesNative.stageImages(pics.map((a) => ({ path: a.path, mime: a.mime })), home) : []
    const body = [text || (others.length ? 'Have a look at these files.' : 'Have a look at this.'), ...(others.length ? ['', `Files on this ${IS_MAC ? 'Mac' : 'PC'}:`, ...others.map((a) => `- ${a.path}`)] : [])].join('\n')
    const submit = (extra: Record<string, unknown>) => gateway.request('prompt.submit', { session_id: sid, text: body, submission_id: uuid(), profile, ...(staged.length ? { attachments: staged } : {}), ...extra }, 60_000)
    // Spoken turns ask Hermes for a short, plain answer (its voice note); an older Hermes refuses the field, so resend as typed.
    if (opts.spoken) { try { await submit({ surface: 'voice-live' }) } catch { await submit({}) } } else await submit({})
    return true
  } catch (error: any) {
    updateChat(profile, { busy: false, turnStartedAt: undefined, step: undefined, askedAt: undefined })
    if (!isChief(profile)) updateBot(profile, { status: 'free', step: undefined })
    msgsOf((msgs) => [...msgs, { id: uuid(), role: 'notice', text: `Couldn't send: ${error?.message ?? error}`, error: true }])
    return false
  }
}
export const sendToChief = (raw: string, attachments: import('./gateway').Attachment[] = [], opts: { spoken?: boolean } = {}) => sendTo('default', raw, attachments, opts)

// ---------- slash commands (Hermes Remote's runCommand) ----------

export interface SlashCommand { name: string; description: string; category?: string; desktop?: string; skill: boolean; usage: number; aliases: string[] }
const sideTasks = new Map<string, { card: string; profile: string }>()
/** Commands that start another chat or only make sense in a terminal are left out: there is one chat. */
const NOT_HERE = new Set(['redraw', 'prompt', 'history', 'rewind', 'branch', 'fork', 'quit', 'exit', 'paste', 'mouse', 'vim', 'theme', 'title', 'sessions', 'resume', 'switch'])
const commandCaches = new Map<string, { at: number; list: SlashCommand[] }>()
/** The commands and skills `profile` offers (each agent has its own skills). */
export async function loadCommands(force = false, profile = active()): Promise<SlashCommand[]> {
  const commandCache = commandCaches.get(profile)
  if (commandCache && !force && Date.now() - commandCache.at < 5 * 60_000) return commandCache.list
  const res = await gateway.request<any>('commands.catalog', { profile }, 30_000)
  const meta = res?.commands ?? {}
  const skills = res?.skills ?? {}
  const aliases: Record<string, string[]> = {}
  for (const [alias, target] of Object.entries(res?.canon ?? {})) { if (typeof target === 'string' && target !== alias) (aliases[target.replace(/^\//, '')] ??= []).push(alias.replace(/^\//, '')) }
  const byName = new Map<string, SlashCommand>()
  const add = (pair: any, category?: string) => {
    if (!Array.isArray(pair) || !pair[0]) return
    const key = String(pair[0]); const name = key.replace(/^\//, '')
    const skill = skills[key] ?? skills[name]
    if (byName.has(name)) return
    byName.set(name, { name, description: String(pair[1] ?? ''), category: skill ? 'Skills' : category, desktop: meta[key]?.desktop ?? meta[name]?.desktop, skill: !!skill, usage: skill?.usage ?? 0, aliases: aliases[name] ?? [] })
  }
  for (const c of res?.categories ?? []) for (const pr of c.pairs ?? []) add(pr, c.name)
  for (const pr of res?.pairs ?? []) add(pr)
  const list = [...byName.values()].filter((c) => !NOT_HERE.has(c.name) && c.desktop !== 'terminal' && c.desktop !== 'settings')
  for (const c of list) if (['new', 'reset', 'clear'].includes(c.name)) c.description = 'Tidy up the chat so it stays quick (nothing is lost)'
  commandCaches.set(profile, { at: Date.now(), list })
  return list
}
export async function completeSlash(text: string, profile = active()): Promise<{ text: string; display?: string; meta?: string }[]> {
  const sid = chatOf(getState(), profile).sessionId
  const res = await gateway.request<any>('complete.slash', { text, session_id: sid, profile }, 15_000)
  return res?.items ?? []
}

function commandCard(command: string, profile = 'default'): string {
  const id = uuid()
  chatMessages(profile, (msgs) => [...msgs, { id, role: 'command', command, text: '', pending: true, at: Date.now() }])
  return id
}
function finishCard(id: string, patch: Partial<Msg>, profile = 'default') { chatMessages(profile, (msgs) => msgs.map((m) => (m.id === id ? { ...m, pending: false, ...patch } : m))) }

/** Asks Chief something in the background (prompt.background), without a message in the chat: a card
 *  shows it working, then Chief's answer. Used when Chief arranges the team into groups. */
export async function askChiefAside(title: string, text: string, working: string): Promise<boolean> {
  const sid = getState().chief.sessionId
  if (!sid || !gateway.open) return false
  const card = commandCard(title, 'default')
  try {
    const r = await gateway.request<any>('prompt.background', { session_id: sid, text, profile: 'default' }, 60_000)
    if (r?.task_id) sideTasks.set(String(r.task_id), { card, profile: 'default' })
    chiefMessages((msgs) => msgs.map((m) => (m.id === card ? { ...m, text: working, pending: !!r?.task_id } : m)))
    return true
  } catch (error: any) {
    finishCard(card, { text: error?.message ?? 'Hermes couldn’t start on that.', error: true })
    return false
  }
}

/** A slash command in `profile`'s chat (the one in the middle unless named). */
export async function runCommand(text: string, profile = active()): Promise<void> {
  const body = text.replace(/^\//, '').trim()
  const name = body.split(/\s+/)[0].toLowerCase()
  const arg = body.slice(name.length).trim()
  const sid = chatOf(getState(), profile).sessionId
  if (!sid) return
  const msgsOf = (fn: (msgs: Msg[]) => Msg[]) => chatMessages(profile, fn)
  const done = (id: string, patch: Partial<Msg>) => finishCard(id, patch, profile)
  // A few open the right place in the app instead of printing text.
  if (name === 'model' && !arg) { window.dispatchEvent(new Event('hermes:open-model-card')); return }
  if ((name === 'skills' && (!arg || arg === 'list'))) { setState({ view: 'settings', settingsPage: 'skills', scope: profile }); return }
  if (name === 'cron' && !arg) { setState({ view: 'scheduled' }); return }
  if (name === 'stop') { await stopChat(profile); return }
  const card = commandCard(`/${body}`, profile)
  try {
    let r: any
    if ((name === 'btw' || name === 'bg' || name === 'background') && arg) {
      r = await gateway.request<any>(name === 'btw' ? 'prompt.btw' : 'prompt.background', { session_id: sid, text: arg, profile }, 60_000)
      if (r?.task_id) { sideTasks.set(String(r.task_id), { card, profile }); msgsOf((msgs) => msgs.map((m) => (m.id === card ? { ...m, text: name === 'btw' ? 'Asked on the side. The answer lands here.' : 'Running in the background. The result lands here.' } : m))); return }
      done(card, { text: name === 'btw' ? 'Asked on the side. The answer shows up here when it’s ready.' : 'Running in the background. You’ll see it here when it’s done.' })
      return
    }
    if (name === 'status') r = await gateway.request<any>('session.status', { session_id: sid, profile }, 60_000)
    else {
      try { r = await gateway.request<any>('slash.exec', { session_id: sid, command: body, profile }, 180_000) }
      catch { r = await gateway.request<any>('command.dispatch', { session_id: sid, name, arg: arg || undefined, profile }, 180_000) }
    }
    const output = [r?.output, r?.warning ? `⚠ ${r.warning}` : ''].filter(Boolean).join('\n\n')
    switch (r?.type) {
      case 'alias': msgsOf((m) => m.filter((x) => x.id !== card)); if (r.target) await runCommand(`/${String(r.target).replace(/^\//, '')}${arg ? ' ' + arg : ''}`, profile); return
      case 'send': case 'skill': {
        done(card, { text: r.notice ?? `Running /${name}…` })
        if (r.message) {
          msgsOf((msgs) => [...msgs, { id: uuid(), role: 'user', text: r.display ?? `/${body}`, at: Date.now() }])
          updateChat(profile, { busy: true, turnStartedAt: Date.now(), step: 'Thinking' })
          await gateway.request('prompt.submit', { session_id: sid, text: r.message, submission_id: uuid(), profile }, 60_000)
        }
        return
      }
      case 'prefill': done(card, { text: r.notice ?? 'Added to the message box.' }); if (r.message) window.dispatchEvent(new CustomEvent('hermes:prefill', { detail: r.message })); return
      default: {
        const t = output || (r && typeof r === 'object' && !r.type ? Object.entries(r).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `**${k.replace(/_/g, ' ')}:** ${v}`).join('\n') : '') || 'Done.'
        done(card, { text: t })
        if (['personality', 'yolo', 'busy', 'reasoning', 'fast', 'model'].includes(name)) void loadChatSettings(profile)
        if (['undo', 'rewind', 'retry', 'compact', 'compress'].includes(name)) { msgsOf((msgs) => msgs.filter((x) => x.id !== card)); void reloadChat(profile).then(() => msgsOf((msgs) => [...msgs, { id: card, role: 'command', command: `/${body}`, text: t, at: Date.now() }])) }
      }
    }
  } catch (error: any) { done(card, { text: error?.message ?? 'That command didn’t work.', error: true }) }
}

/** Reads a chat again from Hermes (after /undo or /retry rewrote it). */
export async function reloadChat(profile = active()) {
  const sid = chatOf(getState(), profile).sessionId
  if (!sid) return
  try {
    const res = await gateway.request<any>('session.resume', { session_id: sid, profile, source: 'desktop', cols: 100 }, 60_000)
    const ref = sessions.get(sid); if (ref) { ref.generation = res.execution_generation; ref.revision = res.revision }
    updateChat(profile, { messages: toMsgs(res.messages ?? []) })
  } catch { /* keep what's shown */ }
}
export const reloadChief = () => reloadChat('default')

export async function stopChat(profile = active()) {
  const sid = chatOf(getState(), profile).sessionId
  if (!sid) return
  try { await gateway.request('session.interrupt', { session_id: sid, execution_generation: sessions.get(sid)?.generation, profile }) }
  catch (error: any) { toast(`Couldn't stop: ${error?.message ?? error}`) }
}
export const stopChief = () => stopChat('default')

export async function loadPanel(profile: string, refresh = false) {
  if (isChief(profile)) return
  const existing = getState().panelChat[profile]
  if (existing && !refresh) return
  const bot = getState().bots.find((b) => b.profile === profile)
  const set = (patch: Partial<import('./store').PanelChat>) => setState((s) => ({ panelChat: { ...s.panelChat, [profile]: Object.assign({ profile, messages: [] as Msg[], loading: false }, s.panelChat[profile], patch) } }))
  if (!existing) set({ loading: true })
  try {
    let msgs: Msg[] = []
    let source: 'chat' | 'run' = 'chat'
    if (bot?.canonicalId) {
      const res = await gateway.request<any>('session.resume', { session_id: bot.runtimeId ?? bot.canonicalId, profile, source: 'desktop', cols: 100 }, 60_000)
      sessions.set(res.session_id, { profile, generation: res.execution_generation, revision: res.revision })
      if (!bot.runtimeId) updateBot(profile, { runtimeId: res.session_id })
      msgs = toMsgs(res.messages ?? [])
    }
    // Bots mostly work through the board, in one-off runs; when their own chat is empty, show the latest run.
    if (!msgs.some((m) => m.role === 'assistant') && bot?.workerId) {
      try {
        const res = await gateway.request<any>('session.resume', { session_id: bot.workerId, profile, source: 'desktop', cols: 100 }, 60_000)
        const runMsgs = toMsgs(res.messages ?? [])
        if (runMsgs.length) { msgs = runMsgs; source = 'run' }
      } catch { /* the run may be archived */ }
    }
    set({ messages: msgs, loading: false, source, title: source === 'run' ? bot?.workerTitle : undefined })
  } catch (error) {
    set({ loading: false })
  }
}

export async function loadCron(): Promise<any[]> {
  const out: any[] = []
  for (const b of getState().bots) {
    try {
      const res = await gateway.request<any>('cron.manage', { action: 'list', profile: b.profile }, 20_000)
      for (const j of res?.jobs ?? []) out.push({ ...j, profile: b.profile })
    } catch { /* this profile has no scheduler access */ }
  }
  return out
}

export interface ModelItem { label: string; model: string; provider: string; providerName: string; current: boolean; reasoning: boolean; fast: boolean; signedIn: boolean }
export async function loadModels(profile = active()): Promise<ModelItem[]> {
  const sid = chatOf(getState(), profile).sessionId
  const res = await gateway.request<any>('model.options', { session_id: sid, profile }, 20_000)
  const list: ModelItem[] = []
  for (const p of res?.providers ?? []) {
    const caps = p.capabilities ?? {}
    for (const m of p.models ?? []) {
      const id = typeof m === 'string' ? m : m.id ?? m.model ?? m.name
      if (!id) continue
      const c = caps[id] ?? {}
      list.push({ label: typeof m === 'object' && m.label ? m.label : id, model: id, provider: p.slug ?? p.name, providerName: p.name ?? p.slug, current: id === res.model && (p.slug ?? p.name) === res.provider, reasoning: c.reasoning !== false, fast: c.fast === true, signedIn: p.authenticated !== false })
    }
  }
  // The chat's live agent owns its model: show what it really runs (it can differ from the agent's setting).
  if (res?.provider || res?.model) updateChat(profile, { ...(res.provider ? { provider: res.provider } : {}), ...(res.model ? { model: res.model } : {}) })
  return list
}

/** This chat's thinking effort and fast mode, as Hermes Remote's chat settings read them. */
export async function loadChatSettings(profile = 'default') {
  const sid = chatOf(getState(), profile).sessionId
  if (!sid) return
  const read = (key: string) => gateway.request<any>('config.get', { key, session_id: sid, profile }, 30_000).then((r) => r?.value as string | undefined).catch(() => undefined)
  const [effort, fast] = await Promise.all([read('reasoning'), read('fast')])
  updateChat(profile, { ...(effort ? { effort } : {}), ...(fast ? { fast } : {}) })
}
export async function setChatSetting(key: 'reasoning' | 'fast', value: string, profile = active()) {
  const sid = chatOf(getState(), profile).sessionId
  if (!sid) return
  const cur = chatOf(getState(), profile)
  const before = { effort: cur.effort, fast: cur.fast }
  updateChat(profile, key === 'reasoning' ? { effort: value } : { fast: value })
  try {
    const res = await gateway.request<any>('config.set', { session_id: sid, profile, key, value }, 30_000)
    const v = res?.value
    if (typeof v === 'string') updateChat(profile, key === 'reasoning' ? { effort: v } : { fast: v })
  } catch (error: any) { updateChat(profile, before); toast(`Couldn't change that: ${error?.message ?? error}`) }
}

export async function switchModel(model: string, provider: string, profile = active()) {
  const sid = chatOf(getState(), profile).sessionId
  if (!sid) { toast(`Write to ${nameOf(profile)} first; then its model can change here (or in Settings › Agents).`); return }
  const ref = sessions.get(sid)
  const send = (confirm?: string) => gateway.request<any>('session.mutate', { session_id: sid, profile, request_id: uuid(), expected_revision: ref?.revision, expected_generation: ref?.generation, operation: 'model', payload: { model, provider, ...(confirm ? { confirm } : {}) } })
  // `hermes serve` (another computer reached by its address, as Hermes Remote does) has no session.mutate:
  // there the model changes with config.set, the way Hermes Remote changes it.
  const sendConfig = (confirmed = false) => gateway.request<any>('config.set', { session_id: sid, profile, key: 'model', value: provider ? `${model} --provider ${provider}` : model, ...(confirmed ? { confirm_expensive_model: true } : {}) }, 90_000)
  try {
    let deferred = false
    if (!noSessionMutate) {
      try {
        let res = await send()
        if (res?.status === 'confirmation_required' && res.confirm) res = await send(res.confirm)
        if (typeof res?.revision === 'number' && ref) ref.revision = res.revision
        deferred = res?.status === 'deferred'
      } catch (error: any) {
        if (!/unknown method|method not found|not available on this Hermes/i.test(String(error?.message ?? '')) && error?.code !== -32601) throw error
        noSessionMutate = true
      }
    }
    if (noSessionMutate) {
      let res = await sendConfig()
      if (res?.confirm_required) res = await sendConfig(true)
      deferred = res?.deferred === true
    }
    updateChat(profile, { model }); updateBot(profile, { model })
    toast(deferred ? `${nameOf(profile)} will use ${model} from the next message` : `${nameOf(profile)} now uses ${model}`)
  } catch (error: any) { toast(`Couldn't switch model: ${error?.message ?? error}`) }
}
/** This Hermes has no session.mutate (`hermes serve`): model switches go through config.set. */
let noSessionMutate = false

function onServerRequest(method: string, params: any, id: string | number) {
  // Canonical approvals and questions arrive as events; anything else asked of a client is declined.
  // Something to type: a sudo password, a key a skill needs, a site's login or one-time code. A secure card
  // collects it; Hermes waits until you answer (or skip, which sends an empty value).
  if (['sudo', 'secret', 'display.install.sudo', 'vault.code', 'vault.save_login', 'vault.unlock_prompt'].includes(method)) {
    const ref = sessions.get(params?.session_id)
    const profile = ref?.profile ?? 'default'
    const title = method === 'sudo' ? 'Your Mac password, to run a command as administrator'
      : method === 'display.install.sudo' ? 'Your Mac password, to install the agent screen'
      : method === 'secret' ? (params?.prompt || `A key: ${params?.env_var ?? ''}`)
      : method === 'vault.code' ? `A sign-in code for ${params?.site ?? 'a site'}`
      : method === 'vault.save_login' ? `Save a login for ${params?.site || params?.origin || 'a site'}?`
      : `Unlock ${params?.display_name || params?.backend || 'your password vault'}`
    addNeed({ key: `in-${id}`, kind: 'input', profile, sessionId: params?.session_id ?? '', rpcId: String(id), title, at: Date.now(),
      input: { method, command: params?.command, envVar: params?.env_var, prompt: params?.prompt, site: params?.site, hint: params?.hint, origin: params?.origin, displayName: params?.display_name || params?.backend } } as Need)
    return
  }
  if (method === 'clarify' && Array.isArray(params?.questions)) {
    const ref = sessions.get(params.session_id)
    const q = params.questions[0]
    addNeed({ key: `srq-${id}`, kind: 'clarify', profile: ref?.profile ?? 'default', sessionId: params.session_id, rpcId: String(id), title: q?.question ?? 'A question for you', questions: params.questions, at: Date.now() } as Need)
    return
  }
  gateway.respondError(id, -32601, 'Not supported by Hermes One')
}
