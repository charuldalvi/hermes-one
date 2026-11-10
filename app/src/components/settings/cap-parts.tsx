// Small parts the Skills, Plugins, Tools and Memory pages share: the bot's name for copy, a "more"
// menu, loading rows, a Markdown block, a log box, settings fields, and a queue that keeps writes to
// one config value in order. Colour only means something (rule 4); everything else stays mono.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from '../../lib/icons'
import { renderMarkdown } from '../../lib/markdown'
import { useStore } from '../../lib/store'
import { Popover, Select, Switch } from '../ui'
import '../../styles/capabilities.css'

/** "Chief" for the default profile, else the bot's name. */
export function useBotName(profile: string): string {
  const bots = useStore((s) => s.bots)
  if (profile === 'default') return 'Hermes'
  return bots.find((b) => b.profile === profile)?.name ?? profile
}

export const errText = (e: unknown) => (e as any)?.message ?? String(e)
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`
/** "software-development" → "Software development". */
export const pretty = (s?: string | null) => {
  const t = String(s ?? '').replace(/[-_]+/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}
export const norm = (s: unknown) => String(s ?? '').toLowerCase()

/** Props that make a row open on click, Enter or Space, and reachable with Tab. */
export function clickable(open: () => void) {
  return {
    role: 'button' as const, tabIndex: 0, onClick: open,
    onKeyDown: (e: KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); open() } },
  }
}

/** Writes that touch one saved value (the disabled-skills list, say) run one after another. */
export function useQueue() {
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  return useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const next = chain.current.then(job, job)
    chain.current = next.catch(() => undefined)
    return next
  }, [])
}

// ---------- menus ----------

export interface MenuItem { label: string; onClick: () => void; hint?: string; danger?: boolean; disabled?: boolean; icon?: string }

export function MoreMenu({ items, label = 'More', width = 260 }: { items: (MenuItem | null | false)[]; label?: string; width?: number }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const list = items.filter(Boolean) as MenuItem[]
  return (
    <>
      <button ref={btn} className={`hbtn${open ? ' on' : ''}`} aria-label={label} aria-haspopup="menu" onClick={() => setOpen(!open)}><Icon name="dots" /></button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} width={width} align="end">
        <div className="pop-list" role="menu">
          {list.map((it) => (
            <button key={it.label} role="menuitem" className={`mi${it.danger ? ' cap-danger' : ''}`} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick() }}>
              {it.icon ? <Icon name={it.icon} size={15} /> : null}<span className="ml">{it.label}</span>{it.hint ? <span className="mhint">{it.hint}</span> : null}
            </button>
          ))}
        </div>
      </Popover>
    </>
  )
}

// ---------- states ----------

/** Rows shaped like the list that's coming, instead of a spinner in the middle of nowhere. */
export function SkeletonCard({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card cap-skel" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="srow" key={i}><div className="tx"><i style={{ width: `${30 + ((i * 37) % 40)}%` }} /><i className="s" style={{ width: `${55 + ((i * 23) % 35)}%` }} /></div><i className="sw-s" /></div>
      ))}
    </div>
  )
}

export function Section({ title, sub, right, children }: { title: string; sub?: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <div className="ssec"><h2>{title}</h2>{sub !== undefined ? <span>{sub}</span> : null}<span className="sp" />{right}</div>
      {children}
    </>
  )
}

export function Note({ children, tone }: { children: ReactNode; tone?: 'need' | 'bad' | 'ok' }) {
  return <div className={`cap-note${tone ? ` ${tone}` : ''}`}>{tone ? <i className={`dot ${tone}`} /> : null}<span>{children}</span></div>
}

/** A running job (an update, an install): one line with a spinner, its log a click away. */
export function JobLine({ text, lines, done, ok, onClose }: { text: string; lines: string[]; done?: boolean; ok?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="cap-job">
      <div className="jl">
        {done ? <i className={`dot ${ok ? 'ok' : 'bad'}`} /> : <i className="dot run" />}
        <span className="jt">{text}</span>
        {lines.length ? <button className="b-text" onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Details'}</button> : null}
        {done && onClose ? <button className="hbtn" aria-label="Dismiss" onClick={onClose}><Icon name="x" size={14} /></button> : null}
      </div>
      {open && lines.length ? <LogBox lines={lines} /> : null}
    </div>
  )
}

export function LogBox({ lines, empty = 'Starting…' }: { lines: string[]; empty?: string }) {
  const box = useRef<HTMLPreElement>(null)
  const text = lines.length ? lines.join('\n') : empty
  // keep the newest line in view while it grows
  useEffect(() => { const b = box.current; if (b) b.scrollTop = b.scrollHeight }, [text])
  return <pre ref={box} className="cap-log">{text}</pre>
}

// ---------- text ----------

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return (
    <div className={`md cap-md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => { const a = (e.target as HTMLElement).closest('a'); if (a?.href) { e.preventDefault(); void window.hermesNative.openExternal(a.href) } }} />
  )
}

/** The YAML block between the leading `---` fences as `key: value` rows, and the text after it. */
export function parseFrontmatter(content: string): { body: string; meta: [string, string][] } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content)
  if (!m) return { body: content, meta: [] }
  const meta: [string, string][] = []
  let key: string | null = null
  let block: string[] = []
  const flush = () => { if (key !== null) meta.push([key, block.join('\n').trim().replace(/^\|\s*$/, '')]); key = null; block = [] }
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w[\w-]*):\s?(.*)$/.exec(line)
    if (kv) { flush(); key = kv[1]; block = kv[2] && kv[2] !== '|' && kv[2] !== '>' ? [kv[2]] : [] } else if (key !== null) block.push(line.replace(/^ {2}/, ''))
  }
  flush()
  return { body: content.slice(m[0].length), meta }
}

export function Chips({ items, counts, empty }: { items: string[]; counts?: Record<string, number>; empty?: string }) {
  if (!items.length) return empty ? <div className="cap-dim">{empty}</div> : null
  return (
    <div className="cap-chips">
      {items.map((t) => <span key={t} className="cap-chip">{t}{counts?.[t] ? <em>×{counts[t] >= 1000 ? `${(counts[t] / 1000).toFixed(1)}k` : counts[t]}</em> : null}</span>)}
    </div>
  )
}

// ---------- fields ----------

export type FieldKind = 'bool' | 'json' | 'number' | 'secret' | 'select' | 'text'
export interface FieldSpec { key: string; label: string; kind: FieldKind; description?: string; placeholder?: string; required?: boolean; options?: { value: string; label: string }[]; isSet?: boolean; url?: string; env?: string }

/** One settings field, edited as text and turned into its real type by whoever saves it. */
export function FieldRow({ field, value, onChange, disabled }: { field: FieldSpec; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const id = `f-${field.key}`
  const control = field.kind === 'bool'
    ? <Switch on={value === 'true'} onChange={(v) => onChange(v ? 'true' : 'false')} disabled={disabled} label={field.label} />
    : field.kind === 'select'
      ? <Select value={value} options={(field.options ?? []).map((o) => ({ value: o.value, label: o.label }))} onChange={onChange} disabled={disabled} width={280} align="end" />
      : field.kind === 'json'
        ? <textarea id={id} className="answer mono" rows={4} spellCheck={false} value={value} placeholder={field.placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        : <input id={id} className={`answer${field.kind === 'secret' || field.kind === 'number' ? ' mono' : ''}`} type={field.kind === 'secret' ? 'password' : field.kind === 'number' ? 'number' : 'text'}
            autoComplete="off" spellCheck={false} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
            placeholder={field.kind === 'secret' && field.isSet ? 'Saved. Type to replace it' : field.placeholder} />
  return (
    <div className="srow ctlrow">
      <div className="tx">
        <label className="t1" htmlFor={id}><span>{field.label}</span>{field.required ? null : <span className="cap-opt-l">optional</span>}{field.kind === 'secret' && field.isSet ? <span className="badge ok">Saved</span> : null}</label>
        {field.description ? <div className="t2">{field.description}</div> : null}
        {field.env ? <div className="t3">Kept as {field.env}</div> : null}
        {field.url ? <button className="cap-link" onClick={() => void window.hermesNative.openExternal(field.url!)}>Where to get it<Icon name="external" size={12} /></button> : null}
      </div>
      <div className="ctl">{control}</div>
    </div>
  )
}

/** A memory provider's name to show: "Built-in notes" for none, the words its description spells out
 *  when the name is their initials ("omh" from "Oh My Hermes …"), else capitalised. (Hermes Remote.) */
export function memoryName(name: string, description?: string | null): string {
  if (!name) return 'Built-in notes'
  const words = String(description ?? '').split(/\s+/).filter(Boolean)
  if (name.length >= 2 && name.length <= 5 && words.length >= name.length && words.slice(0, name.length).map((w) => w[0]?.toLowerCase()).join('') === name.toLowerCase()) return words.slice(0, name.length).join(' ')
  const cut = /^([A-Z][\w-]*(?:\s[A-Z][\w-]*)?)\s+[—–-]\s/.exec(String(description ?? ''))
  if (cut && cut[1].toLowerCase().replace(/\s/g, '') === name.toLowerCase()) return cut[1]
  return pretty(name)
}
export const MEMORY_STATUS: Record<string, { label: string; tone: 'ok' | 'need' | 'bad' }> = {
  ready: { label: 'Ready', tone: 'ok' }, needs_config: { label: 'Needs setup', tone: 'need' }, unavailable: { label: 'Not available', tone: 'bad' }, missing: { label: 'Missing', tone: 'bad' },
}

export function timeAgoSec(sec?: number | null): string {
  if (!sec) return ''
  const s = Math.max(0, Date.now() / 1000 - sec)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  const d = Math.round(s / 86400)
  if (d < 30) return d === 1 ? 'yesterday' : `${d} days ago`
  return new Date(sec * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined })
}
