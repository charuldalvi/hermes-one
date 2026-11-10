// One row per Hermes setting on the All settings page, with the control its type asks for (Desktop
// config-field.tsx): a switch, a number, text, a choice, a list of chips, JSON for structured values,
// or a key-style field that never shows what it holds. Each row saves itself and says so.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { isSecretKey, sameValue, type FieldSchema } from '../../../lib/api-config'
import { Icon } from '../../../lib/icons'
import { setState } from '../../../lib/store'
import { Badge, confirm, Select, Switch, type Option } from '../../ui'
import { choiceLabel, FREE_INPUT_KEYS } from './cfg-groups'

export interface FieldModel { key: string; schema: FieldSchema; label: string; desc?: string; group: string | null; page: string; sub: string }
type SaveFn = (key: string, value: unknown) => Promise<void>

/** Thrown by the page when you said no to a guarded change; the row just goes quiet. */
export class Declined extends Error { constructor() { super('declined') } }

/** Open the Models page on one of its tabs. */
export function goModels(tab: 'main' | 'backups' | 'helpers' | 'subagents' | 'mixture') {
  try { sessionStorage.setItem('models-tab', tab) } catch { /* not critical */ }
  setState({ settingsPage: 'models' })
}

function useRowSave(key: string, value: unknown, onSave: SaveFn) {
  const [st, setSt] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [err, setErr] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const save = async (next: unknown) => {
    if (sameValue(next, value)) return true
    clearTimeout(timer.current)
    setSt('saving'); setErr('')
    try {
      await onSave(key, next)
      setSt('saved'); timer.current = setTimeout(() => setSt('idle'), 1600)
      return true
    } catch (e: any) {
      if (e instanceof Declined) { setSt('idle'); return false }
      setErr(e?.message ?? String(e)); setSt('error')
      return false
    }
  }
  return { st, err, setErr, save, busy: st === 'saving' }
}

const isObjList = (v: unknown) => Array.isArray(v) && v.some((x) => x !== null && typeof x === 'object')
const isPlainObj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)

export function FieldRow({ f, value, def, hasDef, choices, onSave, extra }: {
  f: FieldModel; value: unknown; def: unknown; hasDef: boolean; choices?: string[]; onSave: SaveFn; extra?: ReactNode
}) {
  const { key, schema } = f
  const row = useRowSave(key, value, onSave)
  const [open, setOpen] = useState(false)
  const changed = hasDef && !sameValue(value, def)
  const secret = isSecretKey(key) && !isPlainObj(value) && !Array.isArray(value)
  const type = schema.type ?? 'string'

  let control: ReactNode
  let wide = false
  if (key === 'model') control = <ModelCtl value={value} />
  else if (key === 'fallback_providers') { control = <FallbackCtl value={value} />; wide = true }
  else if (secret) control = <SecretCtl label={f.label} value={value} busy={row.busy} onCommit={row.save} clearTo={typeof def === 'string' ? def : ''} />
  else if (type === 'boolean' || typeof value === 'boolean') control = <Switch on={value === true || value === 'true'} disabled={row.busy} label={f.label} onChange={(v) => void row.save(v)} />
  else if (isPlainObj(value) || isObjList(value)) { control = <JsonCtl value={value} onCommit={row.save} onError={row.setErr} />; wide = true }
  else if (type === 'list' || Array.isArray(value)) { control = <ChipsCtl value={Array.isArray(value) ? value : value == null || value === '' ? [] : [value]} onCommit={row.save} />; wide = true }
  else if (choices && FREE_INPUT_KEYS.has(key)) control = <TextCtl value={value} onCommit={row.save} suggestions={choices.filter(Boolean)} />
  else if (choices) control = <ChoiceCtl k={key} schema={schema} value={value} choices={choices} disabled={row.busy} onCommit={row.save} />
  else if (type === 'number' || typeof value === 'number') control = <NumberCtl value={value} onCommit={row.save} onError={row.setErr} />
  else {
    const long = type === 'text' || String(value ?? '').length > 80 || /instructions|prompt|persona/.test(key)
    control = <TextCtl value={value} onCommit={row.save} multiline={long} />
    wide = long
  }

  return (
    <div className={`srow ctlrow cf-row${wide ? ' wide' : ''}`} id={`cf-${key}`}>
      <div className="tx">
        <div className="t1">
          <span>{f.label}</span>
          {changed ? <span className="cf-changed" title="Different from Hermes' default">Changed</span> : null}
          <span className={`x-state ${row.st}`}>{row.st === 'saving' ? 'Saving…' : row.st === 'saved' ? 'Saved' : ''}</span>
        </div>
        {f.desc ? <div className={`t2 cf-desc${open ? ' open' : ''}`} title={open ? undefined : f.desc} onClick={() => setOpen(!open)}>{f.desc}</div> : null}
        {extra}
        <div className="cf-meta">
          <span className="t3">{key}</span>
          {changed && key !== 'model' && key !== 'fallback_providers' ? <button className="x-link" disabled={row.busy} onClick={() => void row.save(def)}>Reset to default</button> : null}
        </div>
        {wide ? <div className="cf-wide">{control}</div> : null}
        {row.st === 'error' || (row.err && row.st !== 'saving') ? <div className="x-state error">{row.err}</div> : null}
      </div>
      {!wide ? <div className="ctl">{control}</div> : null}
    </div>
  )
}

// ---------- controls ----------

function TextCtl({ value, onCommit, multiline, suggestions, placeholder = 'Not set' }: { value: unknown; onCommit: (v: unknown) => Promise<boolean>; multiline?: boolean; suggestions?: string[]; placeholder?: string }) {
  const shown = value == null ? '' : String(value)
  const [v, setV] = useState(shown)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setV(shown) }, [shown])
  const listId = useRef(`cf-dl-${Math.random().toString(36).slice(2)}`).current
  const commit = () => { focused.current = false; if (v !== shown) void onCommit(v === '' && value == null ? null : v).then((ok) => { if (!ok) setV(shown) }) }
  const common = {
    value: v, placeholder, className: 'answer', spellCheck: false,
    onFocus: () => { focused.current = true },
    onChange: (e: any) => setV(e.target.value),
    onBlur: commit,
    onKeyDown: (e: any) => {
      if (e.key === 'Escape') { setV(shown); (e.target as HTMLElement).blur() }
      if (e.key === 'Enter' && (!multiline || e.metaKey)) (e.target as HTMLElement).blur()
    },
  }
  if (multiline) return <textarea {...common} rows={Math.min(10, Math.max(3, Math.ceil(v.length / 70)))} />
  return (
    <>
      <input {...common} list={suggestions?.length ? listId : undefined} />
      {suggestions?.length ? <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist> : null}
    </>
  )
}

function NumberCtl({ value, onCommit, onError }: { value: unknown; onCommit: (v: unknown) => Promise<boolean>; onError: (s: string) => void }) {
  const shown = value == null || value === '' ? '' : String(value)
  const [v, setV] = useState(shown)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setV(shown) }, [shown])
  const commit = () => {
    focused.current = false
    const t = v.trim()
    if (t === shown) return
    if (t === '') { void onCommit(null); return }
    const n = Number(t)
    if (!Number.isFinite(n)) { onError('That isn’t a number.'); return }
    onError('')
    void onCommit(n).then((ok) => { if (!ok) setV(shown) })
  }
  return (
    <input className="answer cf-num" inputMode="decimal" value={v} placeholder="Not set" spellCheck={false}
      onFocus={() => { focused.current = true }} onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); if (e.key === 'Escape') { setV(shown); onError(''); (e.target as HTMLElement).blur() } }} />
  )
}

function ChoiceCtl({ k, schema, value, choices, disabled, onCommit }: { k: string; schema: FieldSchema; value: unknown; choices: string[]; disabled?: boolean; onCommit: (v: unknown) => Promise<boolean> }) {
  const cur = value == null ? '' : String(value)
  const opts: Option[] = choices.map((c) => {
    const label = choiceLabel(k, c, schema)
    return { value: c, label, hint: c && label.toLowerCase().replace(/ /g, '_') !== c.toLowerCase() ? c : undefined }
  })
  return <Select value={cur} options={opts} disabled={disabled} width={320} align="end" placeholder="Not set" onChange={(v) => void onCommit(v)} />
}

function ChipsCtl({ value, onCommit }: { value: unknown[]; onCommit: (v: unknown) => Promise<boolean> }) {
  const [draft, setDraft] = useState('')
  const numeric = value.length > 0 && value.every((x) => typeof x === 'number')
  const toItem = (s: string): unknown => (numeric && s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : s)
  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
    if (!parts.length) return
    const next = [...value]
    for (const p of parts) if (!next.some((x) => String(x) === p)) next.push(toItem(p))
    setDraft('')
    void onCommit(next)
  }
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= value.length) return; const next = [...value]; [next[i], next[j]] = [next[j], next[i]]; void onCommit(next) }
  return (
    <div className="cf-chips">
      {value.map((it, i) => (
        <span className="cf-chip" key={`${i}:${String(it)}`}>
          {value.length > 1 && i > 0 ? <button className="mv" aria-label="Move earlier" onClick={() => move(i, -1)}><Icon name="chevR" size={11} /></button> : null}
          <span className="cv">{String(it)}</span>
          <button aria-label={`Remove ${String(it)}`} onClick={() => void onCommit(value.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
        </span>
      ))}
      <input className="cf-chip-in" value={draft} placeholder={value.length ? 'Add…' : 'Add an item, Enter to keep it'} spellCheck={false}
        onChange={(e) => { const t = e.target.value; if (t.includes(',')) add(t); else setDraft(t) }}
        onPaste={(e) => { const t = e.clipboardData.getData('text'); if (/[,\n]/.test(t)) { e.preventDefault(); add(draft + t) } }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft) } if (e.key === 'Escape') setDraft('') }}
        onBlur={() => add(draft)} />
    </div>
  )
}

function JsonCtl({ value, onCommit, onError }: { value: unknown; onCommit: (v: unknown) => Promise<boolean>; onError: (s: string) => void }) {
  const shown = JSON.stringify(value ?? null, null, 2)
  const [v, setV] = useState(shown)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setV(shown) }, [shown])
  const commit = () => {
    focused.current = false
    if (v === shown) return
    let parsed: unknown
    try { parsed = JSON.parse(v) } catch { onError('That isn’t valid JSON. Nothing was saved.'); return }
    onError('')
    void onCommit(parsed)
  }
  return <textarea className="answer mono" rows={Math.min(14, Math.max(4, shown.split('\n').length))} value={v} spellCheck={false}
    onFocus={() => { focused.current = true }} onChange={(e) => setV(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === 'Escape') { setV(shown); onError('') } }} />
}

/** A key, token or password in config.yaml: only whether it is set, never what it is. */
function SecretCtl({ label, value, busy, onCommit, clearTo }: { label: string; value: unknown; busy: boolean; onCommit: (v: unknown) => Promise<boolean>; clearTo: string }) {
  const isSet = value != null && value !== '' && value !== false
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState('')
  const save = async () => { if (!v.trim()) return; const ok = await onCommit(v.trim()); if (ok) { setV(''); setEditing(false) } }
  const clear = async () => {
    if (!(await confirm({ title: `Clear ${label}?`, body: 'Hermes stops using this value. Anything that needs it stops working until you add it again.', action: 'Clear', danger: true }))) return
    await onCommit(clearTo)
  }
  if (editing) {
    return (
      <div className="cf-secret edit">
        <input className="answer" type="password" autoFocus value={v} placeholder={isSet ? 'Paste the new value' : 'Paste the value'} autoComplete="off"
          onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') { setV(''); setEditing(false) } }} />
        <button className="b-soft x-btn-sm" disabled={!v.trim() || busy} onClick={() => void save()}>Save</button>
        <button className="b-text x-btn-sm" onClick={() => { setV(''); setEditing(false) }}>Cancel</button>
      </div>
    )
  }
  return (
    <div className="cf-secret">
      {isSet ? <Badge tone="ok"><Icon name="lock" size={12} />Set</Badge> : <Badge tone="quiet">Not set</Badge>}
      <span className="sp" />
      <button className="b-soft x-btn-sm" disabled={busy} onClick={() => setEditing(true)}>{isSet ? 'Replace' : 'Add'}</button>
      {isSet ? <button className="x-icon-btn danger" aria-label={`Clear ${label}`} disabled={busy} onClick={() => void clear()}><Icon name="trash" size={15} /></button> : null}
    </div>
  )
}

function ModelCtl({ value }: { value: unknown }) {
  return (
    <div className="cf-pointer">
      <span className="x-mono cf-ellipsis" title={String(value ?? '')}>{String(value ?? '') || 'Not set'}</span>
      <button className="b-soft x-btn-sm" onClick={() => goModels('main')}>Change on Models</button>
    </div>
  )
}

function FallbackCtl({ value }: { value: unknown }) {
  const list = Array.isArray(value) ? value : []
  const name = (e: any) => (e && typeof e === 'object' ? `${e.provider ?? '?'} · ${e.model ?? '?'}` : String(e))
  return (
    <div className="cf-fallback">
      {list.length ? <ol>{list.map((e, i) => <li key={i}><span className="x-mono">{name(e)}</span></li>)}</ol> : <span className="x-quiet">No fallback models. If the main model fails, the reply fails.</span>}
      <button className="b-soft x-btn-sm" onClick={() => goModels('backups')}>Edit on the Models page</button>
    </div>
  )
}
