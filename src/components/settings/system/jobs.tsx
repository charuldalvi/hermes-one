// Scheduled jobs in plain words: what state a job is in, when it runs ("Every weekday at 9:00 AM"),
// where its result goes, and the editor's schedule presets (turned into the schedule text Hermes
// parses: a cron line, "every 30m", or a timestamp).
import type { Bot } from '../../../lib/store'
import type { CronJob, DeliveryTarget } from '../../../lib/api-system'
import { prettyName } from '../../../lib/hermes'
import { ms, when } from './parts'

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export function jobTitle(j: CronJob): string {
  const cut = (s: string) => (s.length > 60 ? `${s.slice(0, 59)}…` : s)
  return text(j.name) || cut(text(j.prompt)) || cut(text(j.script)) || 'Untitled job'
}
export const jobKey = (j: CronJob) => `${j.profile}:${j.id}`
export const isScriptOnly = (j: CronJob) => !!j.no_agent && !!text(j.script)
export const isRunning = (j: CronJob) => !!j.live_execution || ['claimed', 'running'].includes(j.latest_execution?.status ?? '')

export type JobState = 'running' | 'scheduled' | 'paused' | 'completed' | 'off'
export function jobState(j: CronJob): JobState {
  if (isRunning(j)) return 'running'
  const s = text(j.state)
  if (s === 'paused') return 'paused'
  if (s === 'completed') return 'completed'
  if (j.enabled === false) return 'off'
  return 'scheduled'
}
export const failedLast = (j: CronJob) => j.last_status === 'error' || j.last_status === 'failed' || (!!j.last_error && j.last_status !== 'ok')

/** A slot left in the past beyond the scheduler's 15 minutes of grace: the only trace of a stopped scheduler. */
export function overdue(j: CronJob): boolean {
  const st = jobState(j)
  if (st === 'paused' || st === 'completed' || st === 'off' || !j.next_run_at) return false
  const t = ms(j.next_run_at)
  return !Number.isNaN(t) && Date.now() - t > 15 * 60_000
}

/** The first plain sentence of a scheduler error, without the Python wrapper. */
export function errorSummary(raw?: string | null): string {
  let t = (raw ?? '').trim()
  for (let prev = ''; prev !== t;) {
    prev = t
    t = t.replace(/^\[[a-z_]+(?::[a-z_]+)?\]\s*/, '').replace(/^(?:⚠️?|❌|🛑)\s*/u, '').replace(/^(?:[A-Za-z_][\w.]*(?:Error|Exception)|Exception):\s*/, '').trimStart()
  }
  const end = t.search(/\. |\n/)
  const s = (end === -1 ? t : t.slice(0, end + 1)).trim()
  return s.length > 200 ? `${s.slice(0, 199)}…` : s
}

// ---------- schedules in words ----------

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_ABBR: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
const int = (s: string) => /^\d+$/.test(s)
const dayNum = (s: string): number | null => (int(s) ? Number(s) % 7 : DAY_ABBR[s.toLowerCase().slice(0, 3)] ?? null)

export function timeOf(h: number | string, m: number | string): string {
  const hh = Number(h), mm = Number(m)
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return `${h}:${m}`
  return new Date(2000, 0, 1, hh, mm).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`

function dowWords(dow: string): string | null {
  if (dow === '*') return null
  if (dow === '1-5' || /^mon-fri$/i.test(dow)) return 'weekdays'
  if (['0,6', '6,0', '6,7', 'sat,sun', 'sun,sat'].includes(dow.toLowerCase())) return 'weekends'
  const days: number[] = []
  for (const part of dow.split(',')) {
    const r = part.split('-')
    if (r.length === 2) { const a = dayNum(r[0]), b = dayNum(r[1]); if (a === null || b === null) return null; for (let d = a; d !== (b + 1) % 7; d = (d + 1) % 7) days.push(d) }
    else { const d = dayNum(part); if (d === null) return null; days.push(d) }
  }
  if (days.length === 1) return `every ${DAYS[days[0]]}`
  return list(days.map((d) => `${DAYS[d]}s`))
}

/** "30 21 * * *" → "Every day at 9:30 PM"; anything unusual stays as written. */
export function cronWords(expr: string): string {
  const p = expr.trim().split(/\s+/)
  if (p.length !== 5) return `On its own timetable (${expr})`
  const [m, h, dom, mon, dow] = p
  const step = (s: string) => (/^\*\/(\d+)$/.exec(s)?.[1])
  if (step(m) && h === '*' && dom === '*' && mon === '*' && dow === '*') return Number(step(m)) === 1 ? 'Every minute' : `Every ${step(m)} minutes`
  if (int(m) && h === '*' && dom === '*' && mon === '*' && dow === '*') return m === '0' ? 'Every hour, on the hour' : `Every hour at :${m.padStart(2, '0')}`
  if (int(m) && step(h) && dom === '*' && mon === '*' && dow === '*') return `Every ${step(h)} hours`
  if (int(m) && /^\d+-\d+$/.test(h) && dom === '*' && mon === '*') {
    const [a, b] = h.split('-')
    const days = dowWords(dow)
    return `Every hour from ${timeOf(a, m)} to ${timeOf(b, m)}${days ? ` on ${days}` : ''}`
  }
  if (int(m) && /^\d+(,\d+)+$/.test(h) && dom === '*' && mon === '*') {
    const days = dowWords(dow)
    const times = list(h.split(',').map((x) => timeOf(x, m)))
    return `${days ? `${days[0].toUpperCase()}${days.slice(1)}` : 'Every day'} at ${times}`
  }
  if (!int(m) || !int(h)) return `On its own timetable (${expr})`
  const t = timeOf(h, m)
  if (dom === '*' && mon === '*') {
    const days = dowWords(dow)
    if (!days) return `Every day at ${t}`
    return `${days[0].toUpperCase()}${days.slice(1)} at ${t}`
  }
  if (int(dom) && mon === '*' && dow === '*') return `On the ${ordinal(Number(dom))} of every month at ${t}`
  if (int(dom) && int(mon) && dow === '*') return `Every year on ${new Date(2000, Number(mon) - 1, Number(dom)).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })} at ${t}`
  return `On its own timetable (${expr})`
}

export function minutesWords(min: number): string {
  if (min % 1440 === 0) return min === 1440 ? 'Every day' : `Every ${min / 1440} days`
  if (min % 60 === 0) return min === 60 ? 'Every hour' : `Every ${min / 60} hours`
  return min === 1 ? 'Every minute' : `Every ${min} minutes`
}

export function scheduleWords(j: Pick<CronJob, 'schedule' | 'schedule_display'>): string {
  const s = j.schedule
  if (s && typeof s === 'object') {
    if (s.kind === 'cron' && s.expr) return cronWords(s.expr)
    if (s.kind === 'interval' && s.minutes) return minutesWords(Number(s.minutes))
    if (s.kind === 'once' && s.run_at) return `Once, ${when(s.run_at)}`
  }
  const d = text(j.schedule_display) || (typeof s === 'string' ? s : text((s as any)?.display))
  if (!d) return 'On a schedule'
  if (/^[\d*/,\-a-z]+(\s+[\d*/,\-a-z]+){4}$/i.test(d)) return cronWords(d)
  const every = /^every (\d+)\s*m(in)?$/i.exec(d)
  if (every) return minutesWords(Number(every[1]))
  return d.charAt(0).toUpperCase() + d.slice(1)
}

export function repeatWords(j: CronJob): string {
  const times = j.repeat?.times, done = j.repeat?.completed ?? 0
  if (!times) return done ? `Keeps going (${done} ${done === 1 ? 'run' : 'runs'} so far)` : 'Keeps going'
  if (times === 1) return done ? 'Just once (done)' : 'Just once'
  return `${times} times (${done} done)`
}

// ---------- where results go ----------

export function targetLabel(id: string, bots: Bot[], targets?: DeliveryTarget[]): string {
  if (id === 'local') return 'Nowhere, just keep it'
  if (id === 'origin') return 'Where it was set up'
  const chat = /^bot-chat:(.+)$/.exec(id)
  if (chat) {
    const p = chat[1]
    if (p === 'default') return 'Your chat with Quicksilver'
    const b = bots.find((x) => x.profile === p)
    return `${b?.name ?? prettyName(p)}’s chat`
  }
  const t = targets?.find((x) => x.id === id)
  const name = t?.name ?? id.replace(/(^|[_-])(\w)/g, (_m, s, c) => `${s ? ' ' : ''}${c.toUpperCase()}`)
  return name
}
export const splitDeliver = (d?: string | null) => [...new Set((d || 'local').split(',').map((x) => x.trim()).filter(Boolean))]
export const deliverWords = (d: string | null | undefined, bots: Bot[], targets?: DeliveryTarget[]) => list(splitDeliver(d).map((x) => targetLabel(x, bots, targets)))
/** The bot's own default: its result lands in your chat with Chief when that's possible. */
export function defaultDeliver(targets: DeliveryTarget[], profile: string): string {
  if (targets.some((t) => t.id === 'bot-chat:default')) return 'bot-chat:default'
  if (targets.some((t) => t.id === `bot-chat:${profile}`)) return `bot-chat:${profile}`
  return 'local'
}

// ---------- the editor's schedule ----------

export type Preset = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'hourly' | 'interval' | 'once' | 'custom'
export interface Sched { preset: Preset; time: string; day: string; dom: string; minute: string; every: string; unit: 'm' | 'h' | 'd'; at: string; text: string }
export const PRESETS: { value: Preset; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'hourly', label: 'Every hour' },
  { value: 'interval', label: 'Every few minutes or hours' },
  { value: 'once', label: 'Just once' },
  { value: 'custom', label: 'Something else' },
]
export const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: String(d), label: DAYS[d] }))

const pad = (n: number) => String(n).padStart(2, '0')
function localInput(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export function blankSched(): Sched {
  const soon = Date.now() + 60 * 60_000
  return { preset: 'daily', time: '09:00', day: '1', dom: '1', minute: '0', every: '30', unit: 'm', at: localInput(soon - (soon % (15 * 60_000))), text: '' }
}

export function schedFromJob(j: CronJob): Sched {
  const s = blankSched()
  const sc = j.schedule
  if (sc && typeof sc === 'object') {
    if (sc.kind === 'interval' && sc.minutes) {
      const min = Number(sc.minutes)
      return { ...s, preset: 'interval', ...(min % 1440 === 0 ? { every: String(min / 1440), unit: 'd' } : min % 60 === 0 ? { every: String(min / 60), unit: 'h' } : { every: String(min), unit: 'm' }) }
    }
    if (sc.kind === 'once' && sc.run_at) { const t = ms(sc.run_at); return { ...s, preset: 'once', at: Number.isNaN(t) ? s.at : localInput(t) } }
    if (sc.kind === 'cron' && sc.expr) {
      const p = sc.expr.trim().split(/\s+/)
      if (p.length === 5) {
        const [m, h, dom, mon, dow] = p
        const time = int(m) && int(h) ? `${pad(Number(h))}:${pad(Number(m))}` : s.time
        if (int(m) && int(h) && dom === '*' && mon === '*' && dow === '*') return { ...s, preset: 'daily', time }
        if (int(m) && int(h) && dom === '*' && mon === '*' && dow === '1-5') return { ...s, preset: 'weekdays', time }
        if (int(m) && int(h) && dom === '*' && mon === '*' && dayNum(dow) !== null && !dow.includes(',')) return { ...s, preset: 'weekly', time, day: String(dayNum(dow)) }
        if (int(m) && int(h) && int(dom) && mon === '*' && dow === '*') return { ...s, preset: 'monthly', time, dom }
        if (int(m) && h === '*' && dom === '*' && mon === '*' && dow === '*') return { ...s, preset: 'hourly', minute: m }
        const st = /^\*\/(\d+)$/.exec(m)
        if (st && h === '*' && dom === '*' && mon === '*' && dow === '*') return { ...s, preset: 'interval', every: st[1], unit: 'm' }
      }
      return { ...s, preset: 'custom', text: sc.expr }
    }
  }
  return { ...s, preset: 'custom', text: text(j.schedule_display) || (typeof sc === 'string' ? sc : '') }
}

/** The schedule text Hermes parses, or '' when the form isn't complete. */
export function schedToString(s: Sched): string {
  const [h, m] = (s.time || '09:00').split(':').map((x) => String(Number(x)))
  switch (s.preset) {
    case 'daily': return `${m} ${h} * * *`
    case 'weekdays': return `${m} ${h} * * 1-5`
    case 'weekly': return `${m} ${h} * * ${s.day}`
    case 'monthly': return `${m} ${h} ${Math.min(28, Math.max(1, Number(s.dom) || 1))} * *`
    case 'hourly': return `${Math.min(59, Math.max(0, Number(s.minute) || 0))} * * * *`
    case 'interval': return Number(s.every) > 0 ? `every ${Math.round(Number(s.every))}${s.unit}` : ''
    case 'once': return s.at ? `${s.at}:00` : ''
    default: return s.text.trim()
  }
}

export function schedSummary(s: Sched): string {
  const str = schedToString(s)
  if (!str) return 'Pick when it should run.'
  if (s.preset === 'interval') return minutesWords(Number(s.every) * (s.unit === 'h' ? 60 : s.unit === 'd' ? 1440 : 1))
  if (s.preset === 'once') return `Once, ${when(Date.parse(s.at))}`
  if (s.preset === 'custom') {
    if (/^[\d*/,\-a-z]+(\s+[\d*/,\-a-z]+){4}$/i.test(str)) return cronWords(str)
    return `Hermes reads this as written: “${str}”`
  }
  return cronWords(str)
}
