// All settings: every setting Hermes has (the ~900 fields of its config schema), for Chief or one bot.
// Grouped like Hermes Desktop's settings pages, with a search across all of them, a mark on anything
// that differs from Hermes' default, and config.yaml itself for people who'd rather edit the file.
// Each field saves on its own (PUT /api/config with just that nested key; Hermes deep-merges).
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import '../../styles/config.css'
import {
  configDefaults, configSchema, configValues, getNested, isSecretKey, saveConfig, sameValue, setNested,
  type ConfigRecord, type FieldSchema,
} from '../../lib/api-config'
import { toast } from '../../lib/hermes'
import { Icon } from '../../lib/icons'
import { useStore } from '../../lib/store'
import { Badge, confirm, Empty, ErrorLine, Popover, Search, Switch, Tabs, useAsync } from '../ui'
import { Declined, FieldRow, goModels, type FieldModel } from './config/cfg-fields'
import { choicesFor, CONFIG_PAGES, EXTRA_KEYS, fieldDescription, fieldLabel, groupLabel, OTHER_PAGE, placeAll, pretty, type PageDef } from './config/cfg-groups'
import { RawEditor } from './config/cfg-raw'

const LOCAL_REASONING = 'display.platforms.cli.show_reasoning'
const TRUTHY = new Set(['true', '1', 'yes', 'on', 'raw', 'verbose'])
const SHOW_MAX = 150

/** What a row shows. Reasoning blocks read the local key a `/reasoning show|hide` saves first (Desktop configFieldValue). */
function shownValue(cfg: ConfigRecord, key: string): unknown {
  if (key !== 'display.show_reasoning') return getNested(cfg, key)
  const v = getNested(cfg, LOCAL_REASONING) ?? getNested(cfg, key)
  return typeof v === 'string' ? TRUTHY.has(v.trim().toLowerCase()) : v
}
function infer(v: unknown): FieldSchema {
  return { type: typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : Array.isArray(v) ? 'list' : 'string' }
}
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
/** Only the branches of `next` that differ from `base` (Desktop diffConfig). */
function diffConfig(base: ConfigRecord, next: ConfigRecord): ConfigRecord {
  const out: ConfigRecord = {}
  for (const k of Object.keys(next)) {
    if (k.startsWith('_')) continue
    const a = base?.[k], b = next[k]
    if (isObj(a) && isObj(b)) { const d = diffConfig(a, b); if (Object.keys(d).length) out[k] = d }
    else if (!sameValue(a, b)) out[k] = b
  }
  return out
}
function leaves(obj: ConfigRecord, pre = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (isObj(v) && Object.keys(v).length ? leaves(v, `${pre}${k}.`) : [`${pre}${k}`]))
}
const secretProp = (k: string) => isSecretKey(k) || /^(key|authorization|cookie)$/i.test(k) || (/_key$/i.test(k) && k !== 'record_key')
/** A copy with every key, token and password left out (for export, and so a reset never touches them). */
function withoutSecrets(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutSecrets)
  if (!isObj(v)) return v
  const out: ConfigRecord = {}
  for (const [k, x] of Object.entries(v)) {
    if (k.startsWith('_')) continue
    if (secretProp(k) && typeof x === 'string') continue
    out[k] = withoutSecrets(x)
  }
  return out
}

interface Section { id: string; label: string; hint?: string; base: FieldModel[]; groups: { key: string; label: string; rows: FieldModel[] }[]; count: number }
interface Built { rows: FieldModel[]; pages: (PageDef & { count: number })[]; byPage: Map<string, Section[]>; hay: Map<string, string>; rank: Map<string, number> }

function build(fields: Record<string, FieldSchema>, seed: ConfigRecord, order: string[]): Built {
  const all = { ...fields }
  for (const k of EXTRA_KEYS) { const v = getNested(seed, k); if (!all[k] && v !== undefined) all[k] = infer(v) }
  const placed = placeAll(all)
  const rows: FieldModel[] = Object.keys(all).map((key) => {
    const p = placed.get(key)!
    const label = fieldLabel(key, p.group)
    return { key, schema: all[key], label, desc: fieldDescription(key, label, all[key]), group: p.group, page: p.page, sub: p.sub }
  })
  const otherCats = [...new Set(rows.filter((r) => r.page === 'other').map((r) => r.sub))]
    .sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999) || a.localeCompare(b))
  const other: PageDef = { ...OTHER_PAGE, subs: otherCats.map((c) => ({ id: c, label: pretty(c) })) }
  const byPage = new Map<string, Section[]>()
  const pages: (PageDef & { count: number })[] = []
  for (const def of [...CONFIG_PAGES, other]) {
    const secs: Section[] = []
    for (const s of def.subs) {
      const mine = rows.filter((r) => r.page === def.id && r.sub === s.id)
      if (!mine.length) continue
      const groups = new Map<string, FieldModel[]>()
      for (const r of mine) if (r.group) groups.set(r.group, [...(groups.get(r.group) ?? []), r])
      secs.push({ id: s.id, label: s.label, hint: s.hint, base: mine.filter((r) => !r.group), groups: [...groups].map(([key, rs]) => ({ key, label: groupLabel(key), rows: rs })), count: mine.length })
    }
    if (secs.length) { byPage.set(def.id, secs); pages.push({ ...def, count: secs.reduce((n, s) => n + s.count, 0) }) }
  }
  const hay = new Map(rows.map((r) => [r.key, `${r.key} ${r.label} ${r.desc ?? ''} ${r.schema.category ?? ''} ${r.group ? groupLabel(r.group) : ''}`.toLowerCase()]))
  // page order, then sub-section, then group: search results read in the same order as the pages
  const rank = new Map<string, number>()
  for (const p of pages) for (const s of byPage.get(p.id)!) for (const r of [...s.base, ...s.groups.flatMap((g) => g.rows)]) rank.set(r.key, rank.size)
  return { rows, pages, byPage, hay, rank }
}

/** Where the Models page has a friendlier editor for a whole sub-section. */
const MODELS_POINTER: Record<string, { tab: Parameters<typeof goModels>[0]; text: string }> = {
  'model/fallbacks': { tab: 'backups', text: 'Models › Backups' },
  'model/delegation': { tab: 'subagents', text: 'Models › Subagents' },
  'model/moa': { tab: 'mixture', text: 'Models › Mixture of agents' },
  'helpers/aux': { tab: 'helpers', text: 'Models › Helpers' },
}

export function ConfigPage({ profile }: { profile: string }) {
  const bots = useStore((s) => s.bots)
  const who = profile === 'default' ? 'Hermes' : bots.find((b) => b.profile === profile)?.name ?? profile
  const data = useAsync(async () => {
    const [schema, values, defaults] = await Promise.all([configSchema(profile), configValues(profile), configDefaults().catch(() => ({} as ConfigRecord))])
    return { schema, values, defaults }
  }, [profile])
  const [values, setValuesState] = useState<ConfigRecord | null>(null)
  const live = useRef<ConfigRecord | null>(null)
  const setValues = (v: ConfigRecord) => { live.current = v; setValuesState(v) }
  useEffect(() => { if (data.data) setValues(data.data.values) }, [data.data])

  const [view, setView] = useState<'form' | 'yaml'>('form')
  const [page, setPageState] = useState(() => { try { return sessionStorage.getItem('config-page') || 'model' } catch { return 'model' } })
  const setPage = (p: string) => { setPageState(p); try { sessionStorage.setItem('config-page', p) } catch { /* fine */ } ; document.querySelector('.sbody')?.scrollTo({ top: 0 }) }
  const [q, setQ] = useState('')
  const dq = useDeferredValue(q.trim().toLowerCase())
  const [onlyChanged, setOnlyChanged] = useState(false)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => setShowAll(false), [dq, onlyChanged])
  const [menu, setMenu] = useState(false)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const fileIn = useRef<HTMLInputElement>(null)
  const rawDirty = useRef(false)
  const onDirty = useCallback((d: boolean) => { rawDirty.current = d }, [])

  const built = useMemo(() => (data.data ? build(data.data.schema.fields, data.data.values, data.data.schema.category_order) : null),
    // the seed only adds keys some schemas lack; it never changes the layout afterwards
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.data?.schema])
  const defaults = data.data?.defaults ?? {}
  const isChanged = useCallback((r: FieldModel) => {
    if (!values) return false
    const d = getNested(defaults, r.key)
    return d !== undefined && !sameValue(shownValue(values, r.key), d)
  }, [values, defaults])

  const onSave = useCallback(async (key: string, value: unknown) => {
    const cur = live.current
    if (!cur) return
    const old = getNested(cur, key), oldLocal = getNested(cur, LOCAL_REASONING)
    if (key === 'toolsets' && Array.isArray(old) && old.length && Array.isArray(value) && value.length === 0) {
      const ok = await confirm({ title: 'Turn off every toolset?', body: 'An empty list switches off memory, the terminal, web search, subagents and most tools until you add them back.', action: 'Clear the list', danger: true })
      if (!ok) throw new Declined()
    }
    let patch = setNested({}, key, value), next = setNested(cur, key, value)
    if (key === 'display.show_reasoning') { patch = setNested(patch, LOCAL_REASONING, value); next = setNested(next, LOCAL_REASONING, value) }
    setValues(next)
    try { await saveConfig(profile, patch) } catch (e: any) {
      let back = setNested(live.current ?? cur, key, old)
      if (key === 'display.show_reasoning') back = setNested(back, LOCAL_REASONING, oldLocal)
      setValues(back)
      toast(`Couldn’t save ${key}: ${e?.message ?? e}`)
      throw e
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  // ---------- export, import, reset ----------

  const exportJson = () => {
    setMenu(false)
    if (!values) return
    const blob = new Blob([JSON.stringify(withoutSecrets(values), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `hermes-config-${profile}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    toast('Exported. Keys and passwords were left out.')
  }
  const applyPatch = async (patch: ConfigRecord, title: string, action: string, body: string, danger = false) => {
    const keys = leaves(patch)
    if (!keys.length) return false
    const tsCur = getNested(live.current ?? {}, 'toolsets'), tsNext = patch.toolsets
    if (Array.isArray(tsNext) && !tsNext.length && Array.isArray(tsCur) && tsCur.length) {
      if (!(await confirm({ title: 'This turns off every toolset', body: 'The change empties the toolsets list, which switches off memory, the terminal, web search, subagents and most tools.', action: 'Continue', danger: true }))) return false
    }
    const list = keys.slice(0, 8).join(', ') + (keys.length > 8 ? ` and ${keys.length - 8} more` : '')
    if (!(await confirm({ title, body: <>{body}<div className="cf-keylist">{list}</div></>, action, danger }))) return false
    try { await saveConfig(profile, patch); await data.reload(true); return true } catch (e: any) { toast(`Couldn’t save: ${e?.message ?? e}`); return false }
  }
  const importJson = async (file: File) => {
    let incoming: unknown
    try { incoming = JSON.parse(await file.text()) } catch { toast('That file isn’t valid JSON.'); return }
    if (!isObj(incoming) || !live.current) { toast('That file doesn’t hold Hermes settings.'); return }
    const patch = diffConfig(live.current, incoming)
    const n = leaves(patch).length
    if (!n) { toast('Nothing to change: that file matches these settings.'); return }
    if (await applyPatch(patch, `Change ${n} ${n === 1 ? 'setting' : 'settings'} for ${who}?`, 'Import', 'Settings in the file replace the ones here. Anything the file leaves out stays as it is.')) toast(`Imported ${n} ${n === 1 ? 'setting' : 'settings'}.`)
  }
  const resetAll = async () => {
    setMenu(false)
    if (!live.current) return
    const defs = { ...defaults }
    delete defs.model; delete defs.model_context_length; delete defs.fallback_providers
    const patch = withoutSecrets(diffConfig(live.current, defs)) as ConfigRecord
    const n = leaves(patch).length
    if (!n) { toast('Everything already matches Hermes’ defaults.'); return }
    if (await applyPatch(patch, `Reset ${n} ${n === 1 ? 'setting' : 'settings'} to Hermes’ defaults?`, 'Reset settings',
      `For ${who}. The main model, its context window, fallback models and any keys or passwords stay as they are. Export first if you might want these back.`, true)) toast('Settings reset to Hermes’ defaults.')
  }
  const switchView = async (v: 'form' | 'yaml') => {
    if (v === view) return
    if (view === 'yaml' && rawDirty.current && !(await confirm({ title: 'Discard your config.yaml changes?', body: 'They haven’t been saved.', action: 'Discard', danger: true }))) return
    rawDirty.current = false
    setView(v)
    if (v === 'form') void data.reload(true)
  }

  // ---------- what to show ----------

  const searching = !!dq || onlyChanged
  const hits = useMemo(() => {
    if (!built || !searching) return []
    const words = dq.split(/\s+/).filter(Boolean)
    return built.rows.filter((r) => (!words.length || words.every((w) => built.hay.get(r.key)!.includes(w))) && (!onlyChanged || isChanged(r)))
      .sort((a, b) => (built.rank.get(a.key) ?? 0) - (built.rank.get(b.key) ?? 0))
  }, [built, dq, onlyChanged, searching, isChanged])
  const hitCount = useMemo(() => { const m = new Map<string, number>(); for (const r of hits) m.set(r.page, (m.get(r.page) ?? 0) + 1); return m }, [hits])

  const head = (
    <div className="shead"><div className="tx"><h1>All settings</h1>
      <p>Every setting Hermes has, for <b>{who}</b>. Each change saves on its own and applies to new conversations.</p></div></div>
  )
  if (!data.data || !values || !built) {
    return (
      <>
        {head}
        {data.error ? <ErrorLine text={data.error} onRetry={() => void data.reload()} /> : <div className="card">{Array.from({ length: 7 }, (_, i) => <div key={i} className="x-skel" />)}</div>}
      </>
    )
  }
  const pageDef = built.pages.find((p) => p.id === page) ?? built.pages[0]

  const row = (r: FieldModel) => {
    const v = shownValue(values, r.key)
    const d = getNested(defaults, r.key)
    return (
      <FieldRow key={r.key} f={r} value={v} def={d} hasDef={d !== undefined} choices={choicesFor(r.key, r.schema, v, values)} onSave={onSave}
        extra={r.key === 'delegation.model' || r.key === 'delegation.provider'
          ? <div className="cf-extra">Routing subagents to different models or agents is on <button className="x-link" onClick={() => goModels('subagents')}>Models › Subagents</button>.</div> : undefined} />
    )
  }
  const inUse = (group: string) => {
    const [sec, prov] = group.split('.')
    if ((sec !== 'tts' && sec !== 'stt') || group.split('.').length !== 2) return false
    const cur = String(getNested(values, `${sec}.provider`) ?? '') || (sec === 'tts' ? 'edge' : 'local')
    return cur === prov && (sec === 'tts' || getNested(values, 'stt.enabled') !== false)
  }

  return (
    <>
      {head}
      <div className="stools">
        <Tabs items={[{ key: 'form', label: 'Settings' }, { key: 'yaml', label: 'config.yaml' }]} value={view} onChange={(v) => void switchView(v)} />
        {view === 'form' ? <Search value={q} onChange={setQ} placeholder={`Search ${built.rows.length} settings`} /> : <span className="sp" style={{ flex: 1 }} />}
        {view === 'form' ? <label className="cf-only"><Switch on={onlyChanged} onChange={setOnlyChanged} label="Only changed" />Only changed</label> : null}
        <button ref={menuBtn} className="x-icon-btn" aria-label="More" onClick={() => setMenu(!menu)}><Icon name="dots" /></button>
        <Popover anchor={menuBtn.current} open={menu} onClose={() => setMenu(false)} width={260} align="end">
          <button className="mi" onClick={exportJson}><Icon name="download" size={15} /><span className="ml">Export as JSON</span></button>
          <button className="mi" onClick={() => { setMenu(false); fileIn.current?.click() }}><Icon name="upload" size={15} /><span className="ml">Import from JSON…</span></button>
          <button className="mi" onClick={() => void resetAll()}><Icon name="refresh" size={15} /><span className="ml">Reset all to defaults…</span></button>
          <div className="x-pop-hint">Export leaves keys and passwords out. Import and reset ask before changing anything.</div>
        </Popover>
        <input ref={fileIn} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importJson(f) }} />
      </div>

      {view === 'yaml' ? <RawEditor profile={profile} onDirty={onDirty} onSaved={() => void data.reload(true)} /> : (
        <div className="cf-layout">
          <nav className="cf-nav">
            {built.pages.map((p) => (
              <button key={p.id} className={`cf-nv${!searching && p.id === pageDef.id ? ' on' : ''}${searching && !hitCount.get(p.id) ? ' dim' : ''}`}
                onClick={() => { setQ(''); setOnlyChanged(false); setPage(p.id) }}>
                <Icon name={p.icon} size={15} /><span className="nm">{p.label}</span><em>{searching ? hitCount.get(p.id) ?? 0 : p.count}</em>
              </button>
            ))}
          </nav>
          <div className="cf-main" key={searching ? 'search' : pageDef.id}>
            {searching ? <Results hits={hits} built={built} showAll={showAll} onShowAll={() => setShowAll(true)} row={row} onlyChanged={onlyChanged} q={dq} /> : (
              <div className="flow">
                {built.byPage.get(pageDef.id)!.map((s) => {
                  const ptr = MODELS_POINTER[`${pageDef.id}/${s.id}`]
                  return (
                    <section key={s.id} className="cf-sec">
                      <div className="ssec"><h2>{s.label}</h2><span>{s.count}</span>{s.hint ? <span className="cf-hint">{s.hint}</span> : null}</div>
                      {ptr ? <div className="x-note">The picker on <button className="x-link" onClick={() => goModels(ptr.tab)}>{ptr.text}</button> is the easier way to change these.</div> : null}
                      {s.base.length ? <div className="card">{s.base.map(row)}</div> : null}
                      {s.groups.map((g) => (
                        <div key={g.key} className="cf-group">
                          <div className="cf-gh"><span>{g.label}</span><em>{g.rows.length}</em>{inUse(g.key) ? <Badge tone="ok">In use</Badge> : null}</div>
                          <div className="card">{g.rows.map(row)}</div>
                        </div>
                      ))}
                    </section>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function Results({ hits, built, showAll, onShowAll, row, onlyChanged, q }: {
  hits: FieldModel[]; built: Built; showAll: boolean; onShowAll: () => void; row: (r: FieldModel) => React.ReactNode; onlyChanged: boolean; q: string
}) {
  if (!hits.length) {
    return onlyChanged && !q
      ? <Empty title="Nothing changed" body="Every setting here matches Hermes' default." />
      : <Empty title="No setting matches" body="Try another word, or part of the setting's name as it appears in config.yaml." />
  }
  const shown = showAll ? hits : hits.slice(0, SHOW_MAX)
  const pageLabel = new Map(built.pages.map((p) => [p.id, p.label]))
  const subLabel = (r: FieldModel) => built.byPage.get(r.page)?.find((s) => s.id === r.sub)?.label ?? pretty(r.sub)
  const blocks: { id: string; title: string; rows: FieldModel[] }[] = []
  for (const r of shown) {
    const id = `${r.page}|${r.sub}|${r.group ?? ''}`
    const last = blocks[blocks.length - 1]
    if (last?.id === id) last.rows.push(r)
    else blocks.push({ id, title: [pageLabel.get(r.page), subLabel(r), r.group ? groupLabel(r.group) : null].filter(Boolean).join(' › '), rows: [r] })
  }
  return (
    <div className="flow">
      <div className="cf-count">{hits.length} {hits.length === 1 ? 'setting' : 'settings'}{onlyChanged ? ' changed from the default' : ''}</div>
      {blocks.map((b) => (
        <div key={b.id} className="cf-group">
          <div className="cf-gh"><span>{b.title}</span></div>
          <div className="card">{b.rows.map(row)}</div>
        </div>
      ))}
      {!showAll && hits.length > SHOW_MAX ? <button className="b-soft cf-more" onClick={onShowAll}>Show all {hits.length}</button> : null}
    </div>
  )
}
