// Small parts every settings page uses, in the reference's look: a switch, tabs with a sliding pill,
// a search field, popovers and dialogs that spring open with a slight bounce, a picker, logos, and a
// hook that loads data and keeps its error. Colour only means something (rule 4): switches stay mono.
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../lib/icons'
import { useStore } from '../lib/store'
import { BotFace } from './BotFace'

// ---------- data ----------

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const run = useCallback(async (quiet = false) => {
    const n = ++seq.current
    if (!quiet) setLoading(true)
    try { const v = await load(); if (n === seq.current) { setData(v); setError(undefined) } } catch (e: any) { if (n === seq.current) setError(e?.message ?? String(e)) } finally { if (n === seq.current) setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { void run() }, [run])
  return { data, error, loading, reload: run, setData }
}

// ---------- controls ----------

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      className={`sw${on ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); onChange(!on) }}><i /></button>
  )
}

/** Tabs whose pill slides on a spring to the one you pick. */
/** A segmented control. An item with an icon shows just the icon, its label as the tooltip. */
export function Tabs<T extends string>({ items, value, onChange, className }: { items: { key: T; label: string; count?: number; icon?: string }[]; value: T; onChange: (v: T) => void; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)
  useLayoutEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-k="${CSS.escape(value)}"]`)
    const p = pill.current
    if (!el || !p) return
    if (!placed.current) p.style.transition = 'none'
    p.style.width = `${el.offsetWidth}px`
    p.style.transform = `translateX(${el.offsetLeft}px)`
    if (!placed.current) { void p.offsetWidth; p.style.transition = ''; placed.current = true }
  }, [value, items.length, items.map((i) => i.count).join(',')])
  return (
    <div className={`tabs ${className ?? ''}`} ref={box} role="tablist">
      <span className="pill" ref={pill} />
      {items.map((it) => (
        <button key={it.key} data-k={it.key} role="tab" aria-selected={it.key === value} className={`${it.key === value ? 'on' : ''}${it.icon ? ' ico' : ''}`} onClick={() => onChange(it.key)} {...(it.icon ? { title: it.label, 'aria-label': it.label } : {})}>
          {it.icon ? <Icon name={it.icon} size={15} /> : it.label}{it.count !== undefined ? <em>{it.count}</em> : null}
        </button>
      ))}
    </div>
  )
}

export function Search({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <label className="search">
      <Icon name="search" size={15} />
      <input value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.stopPropagation(); onChange('') } }} />
      {value ? <button onClick={() => onChange('')} aria-label="Clear"><Icon name="x" size={13} /></button> : null}
    </label>
  )
}

export function Spinner({ size = 14 }: { size?: number }) { return <span className="spin" style={{ width: size, height: size }} aria-label="Working" /> }

export function Badge({ children, tone }: { children: ReactNode; tone?: 'ok' | 'need' | 'bad' | 'run' | 'quiet' }) { return <span className={`badge ${tone ?? ''}`}>{children}</span> }

/** A brand's logo from its URL, or its first letter on a tile when there is none (or it fails). */
export function Logo({ src, name, size = 32 }: { src?: string | null; name: string; size?: number }) {
  const [bad, setBad] = useState(false)
  const letter = (name.replace(/^[^a-z0-9]+/i, '')[0] ?? '?').toUpperCase()
  return (
    <span className="logo-t" style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }}>
      {src && !bad ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} referrerPolicy="no-referrer" /> : <b style={{ fontSize: Math.round(size * 0.42) }}>{letter}</b>}
    </span>
  )
}

export function Empty({ title, body, face = true }: { title: string; body?: string; face?: boolean }) {
  return <div className="empty">{face ? <BotFace profile="default" size={96} mood="doze" watch={false} disc={false} /> : null}<b>{title}</b>{body ? <span>{body}</span> : null}</div>
}

export function ErrorLine({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return <div className="errline"><i className="dot bad" /><span>{text}</span>{onRetry ? <button className="b-text" onClick={onRetry}>Try again</button> : null}</div>
}

// ---------- popovers and dialogs ----------

/** Mounts, then plays a short exit before unmounting, so closing feels as soft as opening. */
function useExit(open: boolean, ms = 140) {
  const [mounted, setMounted] = useState(open)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (open) { setMounted(true); setLeaving(false); return }
    if (!mounted) return
    setLeaving(true)
    const t = setTimeout(() => { setMounted(false); setLeaving(false) }, ms)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return { mounted, leaving }
}

/** A card that springs out of the thing you clicked, kept on screen, closed by a click outside or Esc. */
export function Popover({ anchor, open, onClose, children, width = 300, align = 'start', side = 'below', className }: {
  anchor: HTMLElement | null; open: boolean; onClose: () => void; children: ReactNode; width?: number; align?: 'start' | 'end'; side?: 'below' | 'above'; className?: string
}) {
  const { mounted, leaving } = useExit(open)
  const card = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; origin: string; maxH: number } | null>(null)
  useLayoutEffect(() => {
    if (!mounted || !anchor) return
    let up: boolean | null = null
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const h = card.current?.scrollHeight ?? 240
      const vw = window.innerWidth, vh = window.innerHeight
      let left = align === 'end' ? r.right - width : r.left
      left = Math.max(12, Math.min(vw - width - 12, left))
      const below = vh - r.bottom - 16, above = r.top - 16
      // The side is chosen once per opening, so the card never jumps across the anchor as it grows.
      if (up === null) up = side === 'above' ? above > 200 || above > below : below < Math.min(h, 260) && above > below
      const maxH = Math.max(160, (up ? above : below) - 4)
      setPos(up ? { left, bottom: vh - r.top + 8, maxH, origin: `${align === 'end' ? 'right' : 'left'} bottom` } : { left, top: r.bottom + 8, maxH, origin: `${align === 'end' ? 'right' : 'left'} top` })
    }
    place()
    const ro = new ResizeObserver(() => place())
    if (card.current) ro.observe(card.current)
    window.addEventListener('resize', place)
    return () => { ro.disconnect(); window.removeEventListener('resize', place) }
  }, [mounted, anchor, width, align, side])
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const down = (e: PointerEvent) => { if (!card.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose() }
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', down, true)
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', down, true) }
  }, [open, onClose, anchor])
  if (!mounted) return null
  return createPortal(
    <div ref={card} className={`pop${leaving ? ' out' : ''} ${className ?? ''}`} role="dialog"
      style={{ width, left: pos?.left ?? -9999, ...(pos?.bottom !== undefined ? { bottom: pos.bottom } : { top: pos?.top ?? -9999 }), maxHeight: pos?.maxH, transformOrigin: pos?.origin }}>
      {children}
    </div>, document.body)
}

export function Dialog({ open, onClose, title, children, footer, width = 520, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; wide?: boolean }) {
  const { mounted, leaving } = useExit(open, 160)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [open, onClose])
  if (!mounted) return null
  return createPortal(
    <div className={`scrim${leaving ? ' out' : ''}`} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`dlg${leaving ? ' out' : ''}${wide ? ' wide' : ''}`} style={{ width }} role="dialog" aria-modal="true">
        {title ? <div className="dh"><span className="dt">{title}</span><button className="hbtn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div> : null}
        <div className="db">{children}</div>
        {footer ? <div className="df">{footer}</div> : null}
      </div>
    </div>, document.body)
}

// One "are you sure" at a time, asked from anywhere: `await confirm({...})` is true when you agree.
type Ask = { title: string; body?: ReactNode; action: string; danger?: boolean; resolve: (ok: boolean) => void }
let showAsk: ((a: Ask | null) => void) | null = null
export function confirm(a: Omit<Ask, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => { if (!showAsk) return resolve(window.confirm(a.title)); showAsk({ ...a, resolve }) })
}
export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { showAsk = (a) => { setAsk(a); setOpen(!!a) }; return () => { showAsk = null } }, [])
  const done = (ok: boolean) => { ask?.resolve(ok); setOpen(false) }
  return (
    <Dialog open={open} onClose={() => done(false)} width={440}
      footer={<><span className="sp" /><button className="b-text" onClick={() => done(false)}>Cancel</button><button className={ask?.danger ? 'b-danger' : 'b-pri'} autoFocus onClick={() => done(true)}>{ask?.action}</button></>}>
      <div className="ask-t">{ask?.title}</div>
      {ask?.body ? <div className="ask-b">{ask.body}</div> : null}
    </Dialog>
  )
}

// ---------- pickers ----------

export interface Option { value: string; label: string; hint?: string; icon?: ReactNode; group?: string; disabled?: boolean }

/** A button that opens a springy list to pick one value from, with a search when the list is long. */
export function Select({ value, options, onChange, placeholder = 'Choose', width = 300, render, disabled, align = 'start' }: {
  value?: string; options: Option[]; onChange: (v: string) => void; placeholder?: string; width?: number; render?: (o?: Option) => ReactNode; disabled?: boolean; align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const btn = useRef<HTMLButtonElement>(null)
  const cur = options.find((o) => o.value === value)
  const t = q.trim().toLowerCase()
  const shown = t ? options.filter((o) => `${o.label} ${o.hint ?? ''} ${o.group ?? ''}`.toLowerCase().includes(t)) : options
  let lastGroup: string | undefined
  return (
    <>
      <button ref={btn} className={`sel${open ? ' open' : ''}`} disabled={disabled} onClick={() => { setOpen(!open); setQ('') }}>
        {render ? render(cur) : <>{cur?.icon}<span className="sv">{cur?.label ?? placeholder}</span></>}
        <Icon name="chevD" size={14} />
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} width={width} align={align}>
        {options.length > 9 ? <div className="pop-search"><Search value={q} onChange={setQ} placeholder="Search" autoFocus /></div> : null}
        <div className="pop-list">
          {shown.map((o) => {
            const head = o.group && o.group !== lastGroup ? o.group : undefined
            lastGroup = o.group
            return (
              <div key={o.value}>
                {head ? <div className="mh">{head}</div> : null}
                <button className={`mi${o.value === value ? ' on' : ''}`} disabled={o.disabled} onClick={() => { setOpen(false); if (o.value !== value) onChange(o.value) }}>
                  {o.icon}<span className="ml">{o.label}</span>{o.hint ? <span className="mhint">{o.hint}</span> : null}{o.value === value ? <Icon name="check" size={14} /> : null}
                </button>
              </div>
            )
          })}
          {!shown.length ? <div className="mh">Nothing matches.</div> : null}
        </div>
      </Popover>
    </>
  )
}

/** Which bot a page is about: Chief or a teammate. */
export function ProfilePicker({ value, onChange, label = 'For' }: { value: string; onChange: (p: string) => void; label?: string }) {
  const bots = useStore((s) => s.bots)
  const opts: Option[] = [...bots].sort((a, b) => (a.isChief ? -1 : b.isChief ? 1 : a.name.localeCompare(b.name))).map((b) => ({
    value: b.profile, label: b.isChief ? 'Quicksilver' : b.name, hint: b.isChief ? 'Leads your agents' : b.role?.slice(0, 40),
    icon: <BotFace profile={b.profile} size={22} poseKey={b.poseKey} watch={false} />,
  }))
  return (
    <div className="pp"><span className="pl">{label}</span>
      <Select value={value} options={opts} onChange={onChange} width={320} align="end"
        render={(o) => <>{o ? <BotFace profile={o.value} size={20} watch={false} /> : null}<span className="sv">{o?.label ?? 'Quicksilver'}</span></>} />
    </div>
  )
}

/** A text field that saves when you leave it (or press Enter on one line), showing "Saved". */
export function SaveField({ value, onSave, placeholder, multiline, rows = 3, mono }: { value: string; onSave: (v: string) => Promise<unknown>; placeholder?: string; multiline?: boolean; rows?: number; mono?: boolean }) {
  const [v, setV] = useState(value)
  const [state, setStateV] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [err, setErr] = useState('')
  useEffect(() => { setV(value) }, [value])
  const save = async () => {
    if (v === value) return
    setStateV('saving')
    try { await onSave(v); setStateV('saved'); setTimeout(() => setStateV('idle'), 1600) } catch (e: any) { setErr(e?.message ?? String(e)); setStateV('error') }
  }
  const common = { value: v, placeholder, onChange: (e: any) => setV(e.target.value), onBlur: () => void save(), className: `answer${mono ? ' mono' : ''}` }
  return (
    <div className="savef">
      {multiline ? <textarea {...common} rows={rows} /> : <input {...common} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />}
      <span className={`sstate ${state}`}>{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? err : ''}</span>
    </div>
  )
}
