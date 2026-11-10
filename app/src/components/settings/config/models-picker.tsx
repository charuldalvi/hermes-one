// The model picker every Models section shares: one searchable list grouped by provider, signed-in
// providers first. Providers you haven't signed in to are listed too, greyed, with a way to the
// Keys and accounts page. Each profile has its own keys, so each profile has its own list; lists
// load the first time a picker for that profile opens and are shared by every picker after that.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { prettyModel } from '../../../lib/api'
import { modelCatalog, providerReady, type Catalog, type CatalogProvider } from '../../../lib/api-config'
import { Icon } from '../../../lib/icons'
import { setState } from '../../../lib/store'
import { Popover, Search, Spinner } from '../../ui'

// ---------- one model list per profile ----------

interface Entry { data?: Catalog; error?: string; loading: boolean; promise?: Promise<Catalog> }
const store = new Map<string, Entry>()
const subs = new Set<() => void>()
let version = 0
const emit = () => { version++; subs.forEach((f) => f()) }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }

/** The profile's providers and models; `refresh` asks each provider again instead of Hermes' hour-long cache. */
export function loadCatalog(profile: string, refresh = false): Promise<Catalog> {
  const e = store.get(profile)
  if (!refresh && e?.promise) return e.promise
  if (!refresh && e?.data) return Promise.resolve(e.data)
  const p = modelCatalog(profile, refresh).then(
    (data) => { store.set(profile, { data, loading: false }); emit(); return data },
    (err: any) => { store.set(profile, { data: store.get(profile)?.data, loading: false, error: err?.message ?? String(err) }); emit(); throw err },
  )
  store.set(profile, { data: e?.data, loading: true, promise: p })
  emit()
  return p
}
/** Forget every list, so the next picker reads fresh sign-ins (the page calls this when it opens). */
export function forgetCatalogs() { store.clear(); emit() }
export function useCatalog(profile: string, eager = false): Entry {
  useSyncExternalStore(subscribe, () => version)
  useEffect(() => { if (eager) void loadCatalog(profile).catch(() => undefined) }, [profile, eager])
  return store.get(profile) ?? { loading: false }
}
/** A provider's display name from any list already loaded ("openai-codex" → "ChatGPT or Codex Subscription"). */
export function providerName(slug?: string | null): string {
  if (!slug) return ''
  for (const e of store.values()) { const p = e.data?.providers.find((x) => x.slug === slug); if (p) return p.name }
  if (slug === 'auto') return 'Automatic'
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
export function findProvider(profile: string, slug?: string | null): CatalogProvider | undefined {
  return slug ? store.get(profile)?.data?.providers.find((p) => p.slug === slug) : undefined
}

/** Opens Keys and accounts on the place where this provider gets signed in or its key goes. */
export function openKeysFor(profile: string, p?: Pick<CatalogProvider, 'slug' | 'auth_type' | 'key_env'>) {
  try {
    const custom = p?.slug === 'custom' || p?.slug?.startsWith('custom:')
    const tab = custom ? 'endpoints' : p?.key_env || p?.auth_type === 'api_key' || p?.auth_type === 'aws_sdk' || p?.auth_type === 'vertex' ? 'keys' : 'accounts'
    sessionStorage.setItem('keys-tab', tab)
    if (p?.key_env) sessionStorage.setItem('keys-focus', p.key_env)
  } catch { /* storage off: Keys opens on its first tab */ }
  setState({ settingsPage: 'keys', scope: profile })
}

// ---------- thinking effort, shared by helpers, subagents and routes ----------

export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const
export const EFFORT_WORDS: Record<string, string> = { none: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' }
export const effortWord = (v?: string | null) => (v ? EFFORT_WORDS[v] ?? v : '')

// ---------- the picker ----------

export interface PickerExtra { key: string; label: string; hint?: string; active?: boolean; onPick: () => void }

const FIRST = 8
const norm = (s: string) => s.toLowerCase().replace(/[\s_\-./:]+/g, '')

export function ModelPicker({ profile, provider, model, onPick, disabled, busy, placeholder = 'Choose a model', extras, exclude, width = 400, align = 'end', className }: {
  profile: string; provider?: string | null; model?: string | null; onPick: (provider: string, model: string) => void
  disabled?: boolean; busy?: boolean; placeholder?: string; extras?: PickerExtra[]; exclude?: string[]; width?: number; align?: 'start' | 'end'; className?: string
}) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const extra = extras?.find((x) => x.active)
  const label = model ? prettyModel(model) : extra?.label ?? placeholder
  const hint = model ? providerName(provider) : extra?.hint
  return (
    <>
      <button ref={btn} type="button" className={`mp-btn${open ? ' open' : ''} ${className ?? ''}`} disabled={disabled || busy} onClick={() => setOpen(!open)} title={model ? `${provider ?? ''} · ${model}` : undefined}>
        <span className="mv" style={!model && !extra ? { color: 'var(--text-placeholder)' } : undefined}>{label}</span>
        {hint ? <span className="mpv">{hint}</span> : null}
        {busy ? <Spinner size={13} /> : <Icon name="chevD" size={14} />}
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} width={width} align={align} className="mp-pop">
        <PickerList profile={profile} provider={provider} model={model} extras={extras} exclude={exclude}
          onPick={(p, m) => { setOpen(false); if (p !== provider || m !== model) onPick(p, m) }} onClose={() => setOpen(false)} />
      </Popover>
    </>
  )
}

type Row = { kind: 'head'; key: string; node: ReactNode } | { kind: 'pick'; key: string; node: (kb: boolean) => ReactNode; act: () => void } | { kind: 'more'; key: string; node: ReactNode }

function PickerList({ profile, provider, model, extras, exclude, onPick, onClose }: {
  profile: string; provider?: string | null; model?: string | null; extras?: PickerExtra[]; exclude?: string[]; onPick: (p: string, m: string) => void; onClose: () => void
}) {
  const cat = useCatalog(profile, true)
  const [q, setQ] = useState('')
  const [wide, setWide] = useState<Set<string>>(new Set())
  const [showLocked, setShowLocked] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [kb, setKb] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const t = norm(q.trim())

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const x of extras ?? []) {
      if (t && !norm(`${x.label} ${x.hint ?? ''}`).includes(t)) continue
      out.push({ kind: 'pick', key: `x:${x.key}`, act: () => { x.onPick(); onClose() }, node: () => (
        <><Icon name={x.active ? 'check' : 'spark'} size={14} /><span className="ml">{x.label}</span>{x.hint ? <span className="mid" style={{ fontFamily: 'inherit' }}>{x.hint}</span> : null}</>
      ) })
    }
    const providers = (cat.data?.providers ?? []).filter((p) => !exclude?.includes(p.slug))
    const ready = providers.filter(providerReady).sort((a, b) => (a.slug === provider ? -1 : b.slug === provider ? 1 : 0))
    for (const p of ready) {
      const unavailable = new Set(p.unavailable_models ?? [])
      const pname = norm(p.name + p.slug)
      let ms = p.models ?? []
      if (t) ms = ms.filter((m) => norm(m).includes(t) || norm(prettyModel(m)).includes(t) || pname.includes(t))
      if (!ms.length) continue
      const all = ms.length
      const limit = t ? 80 : wide.has(p.slug) ? Infinity : FIRST
      let shown = ms.slice(0, limit)
      if (p.slug === provider && model && ms.includes(model) && !shown.includes(model)) shown = [model, ...shown.slice(0, -1)]
      out.push({ kind: 'head', key: `h:${p.slug}`, node: (
        <div className="mp-gh"><b>{p.name}</b>{p.free_tier ? <span>free tier</span> : null}<span className="sp" /><span>{p.total_models ?? p.models.length}</span></div>
      ) })
      for (const m of shown) {
        const on = p.slug === provider && m === model
        const locked = unavailable.has(m)
        const caps = p.capabilities?.[m]
        if (locked) {
          out.push({ kind: 'more', key: `l:${p.slug}:${m}`, node: (
            <div className="mp-locked" title="Your plan with this provider doesn't include this model"><Icon name="lock" size={13} /><span className="ml">{prettyModel(m)}</span><span className="mid">Not on your plan</span></div>
          ) })
          continue
        }
        out.push({ kind: 'pick', key: `m:${p.slug}:${m}`, act: () => onPick(p.slug, m), node: () => (
          <>
            <span className="ml">{prettyModel(m)}</span>
            {caps?.fast ? <span className="mid" style={{ fontFamily: 'inherit' }}>fast</span> : null}
            <span className="mid">{m}</span>
            {on ? <Icon name="check" size={14} /> : null}
          </>
        ) })
      }
      if (all > shown.length) out.push({ kind: 'more', key: `w:${p.slug}`, node: (
        <button className="mp-more" onClick={() => setWide((w) => new Set(w).add(p.slug))}>Show all {all} from {p.name}</button>
      ) })
    }
    // A model ID that isn't listed (new or private): use it with the current provider.
    const typed = q.trim()
    const home = ready.find((p) => p.slug === provider) ?? ready[0]
    if (typed.length > 2 && home && !ready.some((p) => p.models.includes(typed))) {
      out.push({ kind: 'pick', key: 'typed', act: () => onPick(home.slug, typed), node: () => (
        <><Icon name="plus" size={14} /><span className="ml">Use “{typed}”</span><span className="mid" style={{ fontFamily: 'inherit' }}>with {home.name}</span></>
      ) })
    }
    const locked = providers.filter((p) => !providerReady(p) && (!t || norm(p.name + p.slug).includes(t)))
    if (locked.length) {
      out.push({ kind: 'head', key: 'h:locked', node: <div className="mp-gh"><b>Not signed in</b><span className="sp" /><span>{locked.length}</span></div> })
      const shownLocked = t || showLocked ? locked : locked.slice(0, 3)
      for (const p of shownLocked) {
        out.push({ kind: 'more', key: `n:${p.slug}`, node: (
          <div className="mp-locked">
            <span className="ml">{p.name}</span>
            <button className="x-link" style={{ fontSize: 'var(--text-xs)' }} onClick={() => { onClose(); openKeysFor(profile, p) }}>
              {p.slug === 'custom' ? 'Add one in Keys and accounts' : 'Sign in on Keys and accounts'}
            </button>
          </div>
        ) })
      }
      if (shownLocked.length < locked.length) out.push({ kind: 'more', key: 'n:more', node: (
        <button className="mp-more" onClick={() => setShowLocked(true)}>{locked.length - shownLocked.length} more you haven’t signed in to</button>
      ) })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat.data, t, q, wide, showLocked, provider, model, extras, exclude, profile])

  const picks = rows.filter((r): r is Extract<Row, { kind: 'pick' }> => r.kind === 'pick')
  useEffect(() => { setKb(0) }, [t])
  useEffect(() => { list.current?.querySelector('.mp-item.kb')?.scrollIntoView({ block: 'nearest' }) }, [kb])

  const refresh = async () => {
    setRefreshing(true)
    try { await loadCatalog(profile, true) } catch { /* the list shows the error */ } finally { setRefreshing(false) }
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setKb((i) => Math.min(picks.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setKb((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); picks[kb]?.act() }
  }

  let pi = -1
  return (
    <>
      <div className="mp-top" onKeyDown={onKey}>
        <Search value={q} onChange={setQ} placeholder="Find a model or provider" autoFocus />
        <button className="x-icon-btn" onClick={() => void refresh()} disabled={refreshing || cat.loading} title="Ask every provider for its latest models" aria-label="Refresh the model list">
          {refreshing ? <Spinner size={13} /> : <Icon name="refresh" size={15} />}
        </button>
      </div>
      <div className="mp-list" ref={list}>
        {cat.loading && !cat.data ? <div className="mp-locked"><Spinner size={13} /><span className="ml">Reading your providers…</span></div> : null}
        {cat.error && !cat.data ? (
          <div className="mp-locked"><i className="dot bad" /><span className="ml" style={{ whiteSpace: 'normal' }}>{cat.error}</span><button className="x-link" onClick={() => void refresh()}>Try again</button></div>
        ) : null}
        {rows.map((r) => {
          if (r.kind === 'head' || r.kind === 'more') return <div key={r.key}>{r.node}</div>
          pi++
          const mine = pi
          const on = r.key === `m:${provider}:${model}`
          return (
            <button key={r.key} className={`mp-item${mine === kb ? ' kb' : ''}${on ? ' on' : ''}`} onMouseEnter={() => setKb(mine)} onClick={r.act}>
              {r.node(mine === kb)}
            </button>
          )
        })}
        {cat.data && !rows.length ? <div className="x-pop-hint">Nothing matches “{q}”.</div> : null}
      </div>
    </>
  )
}
