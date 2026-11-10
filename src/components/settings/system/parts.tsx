// Small shared pieces for the Scheduled, Messaging and System pages: dates and sizes in plain words,
// a runner that starts a Hermes background action and follows its log, copyable values, folds.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { actionStatus, type ActionStatus } from '../../../lib/api-system'
import { Icon } from '../../../lib/icons'
import { toast } from '../../../lib/hermes'
import { Spinner } from '../../ui'
import '../../../styles/system.css'

// ---------- words for times, sizes, errors ----------

/** Milliseconds from an ISO string or epoch seconds/ms; NaN when there is none. */
export function ms(v?: string | number | null): number {
  if (v === undefined || v === null || v === '') return NaN
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000
  return Date.parse(v)
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
export const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** "Today 9:30 PM", "Tomorrow 8:00 AM", "Mon 3 Nov, 10:00 AM". */
export function when(v?: string | number | null): string {
  const t = ms(v)
  if (Number.isNaN(t)) return ''
  const d = new Date(t)
  const now = new Date()
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, now)) return `Today ${clock(d)}`
  if (sameDay(d, tomorrow)) return `Tomorrow ${clock(d)}`
  if (sameDay(d, yesterday)) return `Yesterday ${clock(d)}`
  const sameYear = d.getFullYear() === now.getFullYear()
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })}, ${clock(d)}`
}

/** "just now", "5 min ago", "3 h ago", "2 days ago"; in the future: "in 5 min". */
export function ago(v?: string | number | null): string {
  const t = ms(v)
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const s = Math.abs(diff) / 1000
  const say = (n: number, unit: string) => (diff >= 0 ? `${n} ${unit} ago` : `in ${n} ${unit}`)
  if (s < 45) return diff >= 0 ? 'just now' : 'in a moment'
  if (s < 3600) return say(Math.round(s / 60), 'min')
  if (s < 86400) return say(Math.round(s / 3600), 'h')
  const days = Math.round(s / 86400)
  return say(days, days === 1 ? 'day' : 'days')
}

export function bytes(n?: number | null): string {
  if (!n || n < 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0, v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`
}

/** 3725 → "1 h 2 min". */
export function duration(seconds?: number | null): string {
  if (!seconds || seconds < 0) return '0 s'
  if (seconds < 60) return `${Math.round(seconds)} s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`
  return `${Math.floor(h / 24)} days`
}

/** 1234567 → "1.2M". */
export function compact(n?: number | null): string {
  if (!n) return '0'
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function money(n?: number | null): string {
  if (!n) return '$0'
  return n < 0.01 ? '<$0.01' : `$${n.toFixed(n < 10 ? 2 : 0)}`
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e ?? 'Something went wrong')).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
/** The request outlived the app's wait (a long job keeps running on Hermes' side). */
export const isTimeout = (e: unknown) => /timeout|timed out|aborted/i.test(errText(e))

export async function copy(text: string, what = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(what) } catch { toast('Couldn’t copy. Select it and copy by hand.') }
}

export const open = (url?: string | null) => { if (url && /^https?:/.test(url)) void window.hermesNative.openExternal(url) }
export const reveal = (path?: string | null) => { if (path) void window.hermesNative.reveal(path) }

/** True while the window is in front; polls skip a background window. */
export const visible = () => document.visibilityState === 'visible'

/** Runs `fn` every `ms` while the window is visible, and once more when it comes back. */
export function usePoll(fn: () => void, every: number, on = true) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!on) return
    const id = window.setInterval(() => { if (visible()) ref.current() }, every)
    const back = () => { if (visible()) ref.current() }
    document.addEventListener('visibilitychange', back)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', back) }
  }, [every, on])
}

// ---------- background actions (doctor, backup, update, restart …) ----------

/** Only this run's lines: action logs are appended run after run under a "=== name started …" header. */
export function thisRun(lines: string[]): string[] {
  let from = 0
  lines.forEach((l, i) => { if (/^=== \S+ started /.test(l)) from = i + 1 })
  return lines.slice(from).map((l) => l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''))
}

export interface Run { name: string; label: string; running: boolean; lines: string[]; exit: number | null; error?: string; extra?: any; done?: boolean }

/**
 * Starts a Hermes background action and follows `/api/actions/<name>/status` until it ends. A
 * restart takes the very server it polls down for a moment, so refused polls are tolerated for a
 * while; a fresh server that never saw the action answers `running:false, exit:null` until done.
 */
export function useActions() {
  const [runs, setRuns] = useState<Record<string, Run>>({})
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const patch = (key: string, p: Partial<Run>) => { if (alive.current) setRuns((r) => ({ ...r, [key]: { ...r[key], ...p } })) }

  const start = useCallback(async (key: string, label: string, kick: () => Promise<{ name?: string; ok?: boolean; message?: string; [k: string]: any }>, opts: { maxMs?: number; onDone?: (r: Run) => void; tolerateDrop?: boolean } = {}) => {
    patch(key, { name: key, label, running: true, lines: [], exit: null, error: undefined, done: false, extra: undefined })
    let res: any
    try { res = await kick() } catch (e) { patch(key, { running: false, error: errText(e), done: true }); return }
    if (res && res.ok === false) { patch(key, { running: false, error: res.message || res.error || 'Hermes refused.', done: true, extra: res }); return }
    const name = res?.name || key
    patch(key, { name, extra: res })
    const deadline = Date.now() + (opts.maxMs ?? 30 * 60_000)
    let idle = 0, refused = 0, last: ActionStatus | null = null
    while (alive.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1300))
      try { last = await actionStatus(name, 400); refused = 0 } catch { if (++refused > (opts.tolerateDrop ? 90 : 12)) break; continue }
      patch(key, { lines: thisRun(last.lines ?? []) })
      if (last.running) { idle = 0; continue }
      if (last.exit_code === null && ++idle < 8) continue
      break
    }
    const exit = last?.exit_code ?? null
    const final: Run = { name, label, running: false, lines: thisRun(last?.lines ?? []), exit, done: true, extra: { ...res, receipt: last?.receipt }, error: exit && exit !== 0 ? `Finished with a problem (code ${exit}).` : !last && refused ? 'Lost touch with Hermes while it worked.' : undefined }
    patch(key, final)
    opts.onDone?.(final)
  }, [])
  const clear = useCallback((key: string) => setRuns((r) => { const n = { ...r }; delete n[key]; return n }), [])
  return { runs, start, clear }
}

/** The log tail of a background action, with how it went. */
export function RunLog({ run, onClose }: { run?: Run; onClose?: () => void }) {
  const box = useRef<HTMLPreElement>(null)
  useEffect(() => { const b = box.current; if (b) b.scrollTop = b.scrollHeight }, [run?.lines.length])
  if (!run) return null
  return (
    <div className="sy-reveal" style={{ padding: '0 16px 14px' }}>
      <div className="sy-inline" style={{ margin: '2px 0 8px' }}>
        {run.running ? <><Spinner size={12} /><span>{run.label}…</span></> : run.error ? <><i className="dot bad" /><span className="sy-err">{run.error}</span></> : <><i className="dot ok" /><span>{run.label}: done</span></>}
        <span className="sp" style={{ flex: 1 }} />
        {run.lines.length ? <button className="b-text" style={{ height: 26, fontSize: 13 }} onClick={() => void copy(run.lines.join('\n'), 'Copied the output')}>Copy</button> : null}
        {!run.running && onClose ? <button className="hbtn" onClick={onClose} aria-label="Hide"><Icon name="x" size={14} /></button> : null}
      </div>
      {run.lines.length ? <pre className="sy-log" ref={box}>{run.lines.join('\n')}</pre> : run.running ? <div className="sy-note">Waiting for the first lines…</div> : null}
    </div>
  )
}

// ---------- little controls ----------

export function CopyValue({ value, label = 'Copy', what }: { value: string; label?: string; what?: string }) {
  return (
    <div className="sy-copy">
      <code title={value}>{value}</code>
      <button className="b-text" style={{ height: 28 }} onClick={() => void copy(value, what)}>{label}</button>
    </div>
  )
}

export function Fold({ label, open: initial = false, children }: { label: string; open?: boolean; children: ReactNode }) {
  const [on, setOn] = useState(initial)
  return (
    <div>
      <button className="sy-fold" aria-expanded={on} onClick={() => setOn(!on)}><Icon name="chevR" size={14} />{label}</button>
      {on ? <div className="sy-reveal" style={{ marginTop: 10 }}>{children}</div> : null}
    </div>
  )
}

export function Field({ label, optional, hint, bad, children }: { label: string; optional?: boolean; hint?: ReactNode; bad?: boolean; children: ReactNode }) {
  return (
    <div className="sy-f">
      <span className="lb">{label}{optional ? <em>optional</em> : null}</span>
      {children}
      {hint ? <span className={`sy-hint${bad ? ' bad' : ''}`}>{hint}</span> : null}
    </div>
  )
}

export function Meter({ percent, tone }: { percent: number; tone?: 'bad' | 'need' }) {
  const p = Math.max(0, Math.min(100, percent || 0))
  return <div className={`sy-meter ${tone ?? ''}`}><i style={{ width: `${p}%` }} /></div>
}

/** A yellow (or red) line that says what's wrong and offers the fix. */
export function Warn({ children, bad, action }: { children: ReactNode; bad?: boolean; action?: ReactNode }) {
  return <div className={`sy-warn${bad ? ' bad' : ''}`}><i className={`dot ${bad ? 'bad' : 'need'}`} /><div className="tx">{children}</div>{action ? <div className="act">{action}</div> : null}</div>
}

/** Lines from a log, coloured by level, with search hits marked. */
export function LogLines({ lines, search }: { lines: string[]; search?: string }) {
  const needle = search?.trim().toLowerCase()
  return (
    <>
      {lines.map((l, i) => {
        const cls = /\b(ERROR|CRITICAL|Traceback|Exception)\b/.test(l) ? 'e' : /\bWARN(ING)?\b/.test(l) ? 'w' : /\bDEBUG\b/.test(l) ? 'd' : ''
        let body: ReactNode = l
        if (needle) {
          const at = l.toLowerCase().indexOf(needle)
          if (at >= 0) body = <>{l.slice(0, at)}<span className="hit">{l.slice(at, at + needle.length)}</span>{l.slice(at + needle.length)}</>
        }
        return <span key={i} className={cls}>{body}{'\n'}</span>
      })}
    </>
  )
}
