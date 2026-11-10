// The commands agents run, for the side panel's Terminal: one tab per command (as Hermes' own desktop app shows
// them). A command starts with the agent's `terminal` tool call; a background one (or a long one Hermes moves to
// the background) then streams its output live as `agent.terminal.output` events keyed by its process id, and
// `terminal.close` says its tab was closed. A short foreground command shows its output when it finishes.
// `process.list` fills in what was already running when the panel opened (with the last 4000 characters of its
// output), and says when a background command ended and how: Hermes sends no event when one simply finishes, so
// while one runs it is asked every 3 seconds.
import { useSyncExternalStore } from 'react'
import { gateway, type GatewayEvent } from './gateway'
import { liveSession, sessionProfile } from './hermes'

export interface Term {
  id: string
  profile: string
  command: string
  cwd?: string
  status: 'running' | 'done' | 'failed'
  exit?: number | null
  startedAt: number
  endedAt?: number
  /** Hermes' process id once it runs in the background (streams live, can be stopped). */
  processId?: string
}

const MAX_OUTPUT = 256_000
const MAX_TERMS = 30 // per agent: the oldest finished ones go first

let terms: Term[] = []
const output = new Map<string, string>()
const writers = new Map<string, (chunk: string) => void>()
const listeners = new Set<() => void>()
const startListeners = new Set<(t: Term, why: 'background' | 'long') => void>()
const emit = () => listeners.forEach((l) => l())

const put = (t: Term) => {
  const i = terms.findIndex((x) => x.id === t.id)
  terms = i >= 0 ? terms.map((x, j) => (j === i ? t : x)) : [...terms, t]
  // Keep each agent's list short: drop its oldest finished commands.
  const mine = terms.filter((x) => x.profile === t.profile)
  if (mine.length > MAX_TERMS) {
    const drop = new Set(mine.filter((x) => x.status !== 'running').slice(0, mine.length - MAX_TERMS).map((x) => x.id))
    terms = terms.filter((x) => !drop.has(x.id))
    drop.forEach((id) => output.delete(id))
  }
  emit()
  watchRunning()
}
// While a background command runs, ask Hermes how it's doing (it sends nothing when one simply finishes).
let poll: ReturnType<typeof setInterval> | null = null
function watchRunning() {
  if (poll || !terms.some((t) => t.status === 'running' && t.processId)) return
  poll = setInterval(() => {
    const profiles = [...new Set(terms.filter((t) => t.status === 'running' && t.processId).map((t) => t.profile))]
    if (!profiles.length) { clearInterval(poll!); poll = null; return }
    profiles.forEach((p) => void backfill(p))
  }, 3000)
}
const patch = (id: string, p: Partial<Term>) => { const t = terms.find((x) => x.id === id); if (t) put({ ...t, ...p }) }
const write = (id: string, chunk: string) => {
  if (!chunk) return
  const all = (output.get(id) ?? '') + chunk
  output.set(id, all.length > MAX_OUTPUT ? all.slice(-MAX_OUTPUT) : all)
  writers.get(id)?.(chunk)
}

/** Everything a command printed so far (what a tab opened mid-stream replays). */
export const outputOf = (id: string) => output.get(id) ?? ''
/** A tab's live writer: gets each new chunk; returns a function to stop. */
export function onOutput(id: string, w: (chunk: string) => void) { writers.set(id, w); return () => { if (writers.get(id) === w) writers.delete(id) } }
/** A command started that is worth showing (a background one, or one still running after a few seconds). */
export function onTermStart(l: (t: Term, why: 'background' | 'long') => void) { startListeners.add(l); return () => { startListeners.delete(l) } }

export function useTerms(profile: string): Term[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => termsOf(profile))
}
const cache = new Map<string, { src: Term[]; out: Term[] }>()
function termsOf(profile: string) {
  const c = cache.get(profile)
  if (c && c.src === terms) return c.out
  const out = terms.filter((t) => t.profile === profile)
  const prev = c?.out
  const same = prev && prev.length === out.length && prev.every((t, i) => t === out[i])
  const res = same ? prev! : out
  cache.set(profile, { src: terms, out: res })
  return res
}
export const runningCount = (profile: string) => terms.filter((t) => t.profile === profile && t.status === 'running').length

const parse = (v: unknown): any => {
  if (v && typeof v === 'object') return v
  if (typeof v !== 'string') return null
  try { return JSON.parse(v) } catch { return null }
}
const longTimers = new Map<string, ReturnType<typeof setTimeout>>()

function onEvent(ev: GatewayEvent) {
  const p = ev.payload ?? {}
  if (ev.type === 'agent.terminal.output' || ev.type === 'terminal.close') {
    const pid = String(p.process_id ?? '')
    if (!pid) return
    let t = terms.find((x) => x.processId === pid)
    if (!t && ev.type === 'agent.terminal.output') {
      // A process this window didn't see start (it began before Hermes One connected): show it, then ask its name.
      const profile = sessionProfile(ev.session_id)
      if (!profile) return
      t = { id: `proc:${pid}`, profile, command: 'A command', status: 'running', startedAt: Date.now(), processId: pid }
      put(t)
      startListeners.forEach((l) => l(t!, 'background'))
      void backfill(profile)
    }
    if (!t) return
    if (ev.type === 'agent.terminal.output') write(t.id, String(p.chunk ?? ''))
    else { patch(t.id, { status: t.status === 'running' ? 'done' : t.status, endedAt: t.endedAt ?? Date.now() }); void backfill(t.profile) }
    return
  }
  if ((ev.type !== 'tool.start' && ev.type !== 'tool.complete') || p.name !== 'terminal') return
  const profile = sessionProfile(ev.session_id)
  if (!profile) return
  const id = `tool:${p.tool_id}`
  if (ev.type === 'tool.start') {
    const a = p.args ?? {}
    const t: Term = { id, profile, command: String(a.command ?? p.args_text ?? p.preview ?? 'A command'), cwd: typeof a.workdir === 'string' ? a.workdir : undefined, status: 'running', startedAt: Date.now() }
    put(t)
    // A quick command (ls, git status) never opens the panel by itself; one still going after 3 s does.
    longTimers.set(id, setTimeout(() => { longTimers.delete(id); const cur = terms.find((x) => x.id === id); if (cur?.status === 'running') startListeners.forEach((l) => l(cur, 'long')) }, 3000))
    return
  }
  const t = terms.find((x) => x.id === id) ?? { id, profile, command: String(p.args?.command ?? 'A command'), status: 'running' as const, startedAt: Date.now() - Math.round((p.duration_s ?? 0) * 1000) }
  const r = parse(p.result) ?? parse(p.result_text) ?? {}
  const pid = r.session_id ?? r.yielded_session_id
  if (pid && r.output === 'Background process started') {
    // Runs on in the background: its output streams in as agent.terminal.output.
    clearTimeout(longTimers.get(id)); longTimers.delete(id)
    put({ ...t, processId: String(pid) })
    startListeners.forEach((l) => l({ ...t, processId: String(pid) }, 'background'))
    return
  }
  if (pid) { put({ ...t, processId: String(pid) }); if (r.output && !output.get(id)) write(id, String(r.output)) ; return } // moved to the background mid-run
  if (!output.get(id)) write(id, String(r.output ?? (typeof p.result_text === 'string' ? p.result_text : '') ?? ''))
  const exit = typeof r.exit_code === 'number' ? r.exit_code : typeof r.returncode === 'number' ? r.returncode : null
  put({ ...t, status: exit && exit !== 0 ? 'failed' : 'done', exit, endedAt: Date.now() })
}

/** What's running (or just ran) in the background for an agent's chat, with what it printed lately. */
export async function backfill(profile: string) {
  const sid = liveSession(profile)
  if (!sid || !gateway.open) return
  let list: any[] = []
  // The profile matters: without it Hermes looks among Hermes' commands and answers not_found.
  try { list = (await gateway.request<any>('process.list', { session_id: sid, profile }, 10_000))?.processes ?? [] } catch { return }
  for (const e of list) {
    const pid = String(e.session_id ?? '')
    if (!pid) continue
    const known = terms.find((x) => x.processId === pid)
    const exited = e.status === 'exited'
    const exit = exited && typeof e.exit_code === 'number' ? e.exit_code : null
    const endedAt = typeof e.exited_at === 'number' ? Math.round(e.exited_at < 1e12 ? e.exited_at * 1000 : e.exited_at) : Date.parse(String(e.exited_at ?? '')) || Date.now()
    const ended = { status: (exit && exit !== 0 ? 'failed' : 'done') as Term['status'], exit, endedAt }
    const started = typeof e.started_epoch === 'number' ? Math.round(e.started_epoch * 1000) : Date.parse(String(e.started_at ?? '')) || Date.now() - (Number(e.uptime_seconds) || 0) * 1000
    const t: Term = known
      ? { ...known, command: known.command === 'A command' ? String(e.command ?? known.command) : known.command, cwd: known.cwd ?? e.cwd ?? undefined }
      : { id: `proc:${pid}`, profile, command: String(e.command ?? 'A command'), cwd: e.cwd ?? undefined, status: 'running', startedAt: started, processId: pid }
    if (exited && t.status === 'running') Object.assign(t, ended)
    put(t)
    if (!output.get(t.id) && e.output_tail) write(t.id, String(e.output_tail))
  }
}

/** Stop a background command (only the agent that started it is affected). */
export async function stopTerm(t: Term) {
  const sid = liveSession(t.profile)
  if (!sid || !t.processId) return
  await gateway.request('process.kill', { session_id: sid, process_id: t.processId, profile: t.profile }, 15_000)
  patch(t.id, { status: 'failed', endedAt: Date.now() })
}

/** Screenshot demo only (dev/Demo.tsx): a made-up command with its output. */
export function showDemoTerm(t: Term, out: string) { put(t); write(t.id, out) }

/** Close a finished tab (a running one stays until it ends or is stopped). */
export function closeTerm(id: string) { terms = terms.filter((t) => t.id !== id); output.delete(id); emit() }

let started = false
export function startTerminals() { if (started) return; started = true; gateway.onEvent(onEvent) }
