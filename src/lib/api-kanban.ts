// Projects: Hermes' kanban boards, through the kanban plugin's REST routes (plugins/kanban/dashboard/
// plugin_api.py), the same ones Hermes Desktop's board and Hermes Remote's Crew tab call. Every route
// lives on the default profile, so nothing here names one: a body field called `profile` would make
// the main process mint the ticket for that bot instead (which is why reassigning goes through PATCH).
// Also here: what a card means for you in plain words (Hermes Remote's CrewWork), shared by the board,
// the crew view and the task dialog so "needs you" means the same everywhere.
import { at, get, rest } from './api'

const K = '/api/plugins/kanban'
const enc = encodeURIComponent

// ---------- shapes (only what the UI reads; the server sends more) ----------

export interface KBoardMeta {
  slug: string; name?: string | null; description?: string | null; icon?: string | null; color?: string | null
  archived?: boolean; is_current?: boolean; counts?: Record<string, number>; total?: number
  default_workdir?: string | null; project_id?: string | null; project_name?: string | null; created_at?: number | null
}

export interface KTask {
  id: string; title: string; body?: string | null; status: string; assignee?: string | null; priority?: number
  tenant?: string | null; created_by?: string | null; created_at?: number | null; started_at?: number | null; completed_at?: number | null
  current_run_started_at?: number | null; latest_summary?: string | null; comment_count?: number
  link_counts?: { parents: number; children: number }; progress?: { done: number; total: number } | null
  warnings?: { count: number; highest_severity?: string | null } | null
  worker_pid?: number | null; last_heartbeat_at?: number | null; block_kind?: string | null; block_recurrences?: number
  result?: string | null; last_failure_error?: string | null; consecutive_failures?: number; session_id?: string | null
  skills?: string[] | null; workspace_kind?: string | null; workspace_path?: string | null; branch_name?: string | null
  model_override?: string | null; reasoning_effort?: string | null; goal_mode?: boolean
  /** Hermes' own warnings about the task (stuck worker, repeated failures…), on the detail read. */
  diagnostics?: { kind: string; severity: string; title: string; detail?: string; count?: number }[] | null
}

export interface KColumn { name: string; tasks: KTask[] }
export interface KBoard { columns: KColumn[]; tenants: string[]; assignees: string[]; latest_event_id: number; now: number }

export interface KWorkflow {
  columns: { key: string; label: string; icon?: string; drag_target: boolean }[]
  manual: Record<string, string[]>
  archived: string
}

export interface KComment { id: number; task_id?: string; author: string; body: string; created_at: number }
export interface KEvent { id: number; kind: string; payload: any; created_at: number; run_id?: number | null }
export interface KRun {
  id: number; profile?: string | null; status: string; outcome?: string | null; summary?: string | null; error?: string | null
  started_at?: number | null; ended_at?: number | null; worker_pid?: number | null; metadata?: any
}
export interface KAttachment { id: number; filename: string; content_type?: string | null; size?: number | null; stored_path?: string | null; created_at?: number }
export interface KLinkTask { id: string; title: string; status: string }
export interface KTaskDetail {
  task: KTask; comments: KComment[]; events: KEvent[]; attachments?: KAttachment[] | null; runs: KRun[]
  links: { parents: string[]; children: string[] }; link_tasks?: KLinkTask[] | null
  child_results?: { id: string; title: string; status: string; latest_summary?: string | null; result?: string | null }[]
}

// ---------- routes ----------

export const boards = (includeArchived = false) =>
  get<{ boards: KBoardMeta[]; current: string }>(at(`${K}/boards`, { include_archived: includeArchived || undefined }))
export const board = (slug: string, includeArchived = false) =>
  get<KBoard>(at(`${K}/board`, { board: slug, include_archived: includeArchived || undefined }))
export const workflow = () => get<KWorkflow>(`${K}/workflow`)
export const task = (slug: string, id: string) => get<KTaskDetail>(at(`${K}/tasks/${enc(id)}`, { board: slug }))
export const taskLog = (slug: string, id: string) =>
  get<{ exists: boolean; content: string; truncated: boolean; size_bytes: number }>(at(`${K}/tasks/${enc(id)}/log`, { board: slug, tail: 16384 }))
export const orchestration = () =>
  get<{ resolved_default_assignee?: string; resolved_orchestrator_profile?: string; default_assignee?: string }>(`${K}/orchestration`)

// Every board change nudges the dispatcher (debounced, fire-and-forget), as Hermes Desktop does, so a
// task made ready starts now instead of on Hermes' next minute tick.
const nudgeTimers = new Map<string, ReturnType<typeof setTimeout>>()
function nudge(slug: string) {
  clearTimeout(nudgeTimers.get(slug))
  nudgeTimers.set(slug, setTimeout(() => { nudgeTimers.delete(slug); dispatch(slug).catch(() => undefined) }, 400))
}
async function nudged<T>(slug: string, write: Promise<T>): Promise<T> { const v = await write; nudge(slug); return v }

export interface NewTask { title: string; body?: string; assignee?: string | null; priority?: number; triage?: boolean; tenant?: string }
export const createTask = (slug: string, t: NewTask) =>
  nudged(slug, rest<{ task: KTask | null; warning?: string }>('POST', at(`${K}/tasks`, { board: slug }), {
    title: t.title, ...(t.body ? { body: t.body } : {}), ...(t.assignee ? { assignee: t.assignee } : {}),
    priority: t.priority ?? 0, triage: !!t.triage, ...(t.tenant ? { tenant: t.tenant } : {}),
  }))
export interface TaskPatch { status?: string; assignee?: string; priority?: number; title?: string; body?: string; block_reason?: string }
export const patchTask = (slug: string, id: string, patch: TaskPatch) =>
  nudged(slug, rest<{ task: KTask | null }>('PATCH', at(`${K}/tasks/${enc(id)}`, { board: slug }), patch))
export const deleteTask = (slug: string, id: string) => nudged(slug, rest('DELETE', at(`${K}/tasks/${enc(id)}`, { board: slug })))
export const addComment = (slug: string, id: string, body: string) =>
  rest('POST', at(`${K}/tasks/${enc(id)}/comments`, { board: slug }), { body, author: YOU })
/** One change to many tasks; each succeeds or fails on its own. */
export const bulk = (slug: string, ids: string[], patch: { archive?: boolean; status?: string; assignee?: string }) =>
  nudged(slug, rest<{ results: { id: string; ok: boolean; error?: string }[] }>('POST', at(`${K}/tasks/bulk`, { board: slug }), { ids, ...patch }))
/** Takes a task back from the bot working on it; it goes back in the queue. */
export const reclaim = (slug: string, id: string, reason?: string) =>
  nudged(slug, rest('POST', at(`${K}/tasks/${enc(id)}/reclaim`, { board: slug }), reason ? { reason } : {}))
/** Starts what's ready now instead of on the next minute tick. */
export const dispatch = (slug: string) =>
  rest<{ spawned?: unknown[]; promoted?: number; auto_assigned?: unknown[] }>('POST', at(`${K}/dispatch`, { board: slug }))

export const createBoard = (b: { slug: string; name: string; description?: string }) =>
  rest<{ board: KBoardMeta; current: string }>('POST', `${K}/boards`, b)
export const updateBoard = (slug: string, patch: { name?: string; description?: string }) =>
  rest<{ board: KBoardMeta }>('PATCH', `${K}/boards/${enc(slug)}`, patch)
/** Archives the board (Hermes can bring it back); `forGood` deletes it and its tasks. */
export const removeBoard = (slug: string, forGood = false) =>
  rest<{ result: any; current: string }>('DELETE', at(`${K}/boards/${enc(slug)}`, { delete: forGood || undefined }))
/** The board Chief and the CLI use when none is named. */
export const makeCurrent = (slug: string) => rest<{ current: string }>('POST', `${K}/boards/${enc(slug)}/switch`)

/** A board slug from a name: lowercase letters, digits and dashes, at most 64. */
export function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '')
}

// ---------- columns, in plain words ----------

/** The comment author this app writes as; notes by any of these read as "You". */
export const YOU = 'user'
const YOU_AUTHORS = new Set(['user', 'you', 'phone', 'desktop', 'dashboard', 'hermes-one'])
export const isYou = (author?: string | null) => YOU_AUTHORS.has(String(author ?? '').toLowerCase())

export const COLUMN_WORDS: Record<string, { label: string; help: string }> = {
  triage: { label: 'Ideas', help: 'Rough ideas. One gets written up properly before anyone starts on it.' },
  todo: { label: 'To do', help: 'Waiting for something else to finish first, or parked.' },
  scheduled: { label: 'Later', help: 'Waiting for a set time.' },
  ready: { label: 'Up next', help: 'Ready to go. The agent it’s for starts within a minute.' },
  running: { label: 'Working', help: 'An agent is on it right now.' },
  blocked: { label: 'On hold', help: 'Stopped: it has a question for you, hit a wall, or waits for your go-ahead.' },
  review: { label: 'To check', help: 'Finished and waiting for a look before it counts as done.' },
  done: { label: 'Done', help: 'Finished.' },
  archived: { label: 'Put away', help: 'Off the board. Nothing here runs.' },
}
export const columnLabel = (key: string) => COLUMN_WORDS[key]?.label ?? key.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** Today's workflow, for when /workflow can't be read: columns a card may be dragged into, and from where. */
export const FALLBACK_WORKFLOW: KWorkflow = {
  columns: [
    { key: 'triage', label: 'Triage', drag_target: true }, { key: 'todo', label: 'Todo', drag_target: true },
    { key: 'scheduled', label: 'Scheduled', drag_target: false }, { key: 'ready', label: 'Ready', drag_target: true },
    { key: 'running', label: 'Running', drag_target: false }, { key: 'blocked', label: 'Blocked', drag_target: true },
    { key: 'review', label: 'Review', drag_target: false }, { key: 'done', label: 'Done', drag_target: true },
  ],
  manual: {
    triage: ['ready', 'todo'], todo: ['ready', 'scheduled', 'triage'], scheduled: ['ready', 'todo', 'triage'],
    ready: ['blocked', 'done', 'review', 'scheduled', 'todo', 'triage'], running: ['blocked', 'done', 'ready', 'review', 'scheduled', 'todo', 'triage'],
    blocked: ['done', 'ready', 'scheduled', 'todo', 'triage'], review: ['done', 'ready', 'todo', 'triage'], done: ['ready', 'todo', 'triage'],
    archived: ['ready', 'todo', 'triage'],
  },
  archived: 'archived',
}

/** Where a card in `from` may go by hand: allowed by the workflow and not a column only Hermes moves cards into. */
export function movesFrom(wf: KWorkflow, from: string): string[] {
  const open = new Set(wf.columns.filter((c) => c.drag_target).map((c) => c.key))
  return (wf.manual[from] ?? []).filter((k) => open.has(k)).sort((a, b) => wf.columns.findIndex((c) => c.key === a) - wf.columns.findIndex((c) => c.key === b))
}
export function lockedReason(key: string): string {
  if (key === 'running') return 'Only an agent can move work into Working, by starting on it.'
  if (key === 'review') return 'Work lands in To check when the agent finishes it.'
  if (key === 'scheduled') return 'Later needs a wake-up time, which the agents set.'
  return `It can’t move to ${columnLabel(key)} from here.`
}

// ---------- what a card means for you (Hermes Remote's CrewWork) ----------

export type Work =
  | { kind: 'yours'; ask: 'check' | 'answer' | 'start'; reason?: string }
  | { kind: 'stuck'; reason?: string; canRetry: boolean }
  | { kind: 'working'; since?: number }
  | { kind: 'coming'; next: boolean; after?: string; later?: boolean; idea?: boolean }
  | { kind: 'done'; at?: number }
  | { kind: 'away' }

/** Why it's on hold, in the bot's own words: the last "blocked" event's reason. */
export function blockReason(events?: KEvent[]): string | undefined {
  const e = [...(events ?? [])].reverse().find((x) => x.kind === 'blocked')
  const r = e?.payload?.reason
  return typeof r === 'string' && r.trim() && r !== 'initial_status' ? r.trim() : undefined
}

/** `parents` and `reason` come from the task's detail; on the board they're unknown. */
export function classify(t: KTask, detail?: { parents?: KLinkTask[]; reason?: string }): Work {
  switch (t.status) {
    case 'done': return { kind: 'done', at: t.completed_at ?? undefined }
    case 'archived': return { kind: 'away' }
    case 'review': return { kind: 'yours', ask: 'check' }
    case 'running': return { kind: 'working', since: t.current_run_started_at ?? t.started_at ?? undefined }
    case 'ready': return { kind: 'coming', next: true }
    case 'scheduled': return { kind: 'coming', next: false, later: true }
    case 'triage': return { kind: 'coming', next: false, idea: true }
    case 'blocked': {
      const waiting = detail?.parents?.find((p) => p.status !== 'done' && p.status !== 'archived')
      const reason = detail?.reason
      if (waiting) return { kind: 'coming', next: false, after: shortTitle(waiting.title) }
      // Its earlier steps aren't known on the board: a plain or dependency hold with parents waits on them.
      if (!detail && (t.link_counts?.parents ?? 0) > 0 && (!t.block_kind || t.block_kind === 'dependency')) return { kind: 'coming', next: false }
      if (t.block_kind === 'needs_input') return { kind: 'yours', ask: 'answer', reason }
      if (t.block_kind === 'capability') return { kind: 'stuck', reason: reason ?? t.last_failure_error ?? undefined, canRetry: false }
      if (t.block_kind === 'transient' || t.last_failure_error) return { kind: 'stuck', reason: reason ?? t.last_failure_error ?? undefined, canRetry: true }
      return { kind: 'yours', ask: 'start', reason }
    }
    default: {
      const waiting = detail?.parents?.find((p) => p.status !== 'done' && p.status !== 'archived')
      return { kind: 'coming', next: false, after: waiting ? shortTitle(waiting.title) : undefined }
    }
  }
}

export type Tone = 'run' | 'need' | 'bad' | 'ok' | 'quiet'
/** The state line on a card: the colour carries the meaning (blue working, amber you, red stuck, green done). */
export function stateWords(w: Work): { text: string; tone: Tone } {
  switch (w.kind) {
    case 'yours': return { text: w.ask === 'check' ? 'Ready for you to check' : w.ask === 'answer' ? 'Has a question for you' : 'Waiting for your go-ahead', tone: 'need' }
    case 'stuck': return { text: 'Stuck', tone: 'bad' }
    case 'working': return { text: 'Working on it', tone: 'run' }
    case 'coming': return { text: w.idea ? 'An idea' : w.later ? 'Later' : w.next ? 'Starts soon' : w.after ? `After ${w.after}` : 'Coming up', tone: 'quiet' }
    case 'done': return { text: 'Done', tone: 'ok' }
    case 'away': return { text: 'Put away', tone: 'quiet' }
  }
}
export const needsYou = (w: Work) => w.kind === 'yours' || w.kind === 'stuck'

/**
 * A long working title cut to its first part for lists: what comes before a spaced dash, without a
 * one-word "Pilot:"-style prefix. The full title is one click away.
 */
export function shortTitle(title: string): string {
  let s = title.split(/ [—–-] /)[0].trim()
  const colon = s.indexOf(': ')
  if (colon >= 1 && colon <= 14 && !s.slice(0, colon).includes(' ')) s = s.slice(colon + 2)
  return (s.charAt(0).toUpperCase() + s.slice(1)) || title
}

// ---------- time ----------

/** "now", "4m", "3h", "2d" since an epoch in seconds. */
export function ago(sec?: number | null): string {
  if (!sec) return ''
  const s = Math.max(0, Date.now() / 1000 - sec)
  if (s < 45) return 'now'
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  if (s < 86400 * 60) return `${Math.round(s / 86400)}d`
  return new Date(sec * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
export const agoLong = (sec?: number | null) => { const a = ago(sec); return !a ? '' : a === 'now' ? 'just now' : /\d[mhd]$/.test(a) ? `${a} ago` : a }
/** "45s", "12m", "2h 05m" between two epochs in seconds (to now when open). */
export function span(from?: number | null, to?: number | null): string {
  if (!from) return ''
  const s = Math.max(0, Math.round((to ?? Date.now() / 1000) - from))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.floor(s / 3600)}h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}m`
}
export const when = (sec?: number | null) => sec ? new Date(sec * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''

// ---------- history, in plain words ----------

export function eventWords(e: KEvent): { text: string; detail?: string } {
  const p = (e.payload && typeof e.payload === 'object') ? e.payload : {}
  const s = (k: string) => (typeof p[k] === 'string' && p[k] ? String(p[k]) : '')
  switch (e.kind) {
    case 'created': return { text: `Added${s('status') ? ` to ${columnLabel(s('status'))}` : ''}${s('assignee') ? ` for ${s('assignee')}` : ''}` }
    case 'status': return { text: `Moved to ${columnLabel(s('status') || '?')}`, detail: s('reason') && s('reason') !== 'parent_reopened' ? s('reason') : undefined }
    case 'assigned': return { text: s('assignee') ? `Handed to ${s('assignee')}` : 'No one assigned' }
    case 'commented': return { text: `Note from ${isYou(s('author')) ? 'you' : s('author') || 'someone'}` }
    case 'claimed': return { text: s('source_status') === 'review' ? 'An agent started checking it' : 'An agent started on it' }
    case 'spawned': return { text: 'Work started' }
    case 'completed': return { text: 'Finished' }
    case 'blocked': return { text: 'Stopped to wait', detail: s('reason') && s('reason') !== 'initial_status' ? s('reason') : undefined }
    case 'unblocked': return { text: `Started again${s('status') ? ` (${columnLabel(s('status'))})` : ''}` }
    case 'reclaimed': return { text: 'Taken back and queued again', detail: s('reason') || undefined }
    case 'specified': return { text: 'Written up from the idea' }
    case 'promoted': case 'promoted_manual': return { text: 'Earlier steps done, so it’s up next' }
    case 'scheduled': return { text: 'Set for later', detail: s('reason') || undefined }
    case 'archived': return { text: 'Put away' }
    case 'reprioritized': return { text: `Priority set to ${p.priority ?? '?'}` }
    case 'edited': return { text: 'Edited' }
    case 'review_requested': return { text: 'Sent for checking' }
    case 'timed_out': return { text: 'Ran out of time' }
    case 'gave_up': return { text: 'Gave up after too many tries' }
    case 'linked': return { text: 'Linked to another step' }
    case 'unlinked': return { text: 'Unlinked from a step' }
    case 'attached': return { text: `Attached ${s('filename') || 'a file'}` }
    default: return { text: e.kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) }
  }
}

/** One attempt at a task: how it ended, with its colour. */
export function runWords(r: KRun): { text: string; tone: Tone } {
  if (!r.ended_at) return { text: 'Working', tone: 'run' }
  const o = r.outcome ?? r.status
  switch (o) {
    case 'completed': case 'done': return { text: 'Finished', tone: 'ok' }
    case 'review': case 'review_requested': return { text: 'Sent for checking', tone: 'ok' }
    case 'blocked': return { text: 'Stopped to ask', tone: 'need' }
    case 'reclaimed': return { text: 'Taken back', tone: 'quiet' }
    case 'timed_out': return { text: 'Ran out of time', tone: 'bad' }
    case 'crashed': case 'spawn_failed': case 'failed': return { text: 'Went wrong', tone: 'bad' }
    case 'gave_up': return { text: 'Gave up', tone: 'bad' }
    default: return { text: String(o ?? 'Ended').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), tone: 'quiet' }
  }
}

export const PRIORITIES = [
  { value: 0, label: 'Normal' },
  { value: 1, label: 'High' },
  { value: 2, label: 'Urgent' },
]
export const priorityLabel = (p?: number) => !p ? 'Normal' : PRIORITIES.find((x) => x.value === p)?.label ?? (p > 0 ? `High (${p})` : `Low (${p})`)
