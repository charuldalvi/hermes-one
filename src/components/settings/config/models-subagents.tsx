// Subagents: when a bot hands part of a job to a helper agent, what runs it. A strategy (one model
// for every subagent, named model routes the agent picks from, or running as one of your bots) and
// that strategy's routes. Same routes Desktop's delegation settings use.
import { useEffect, useState } from 'react'
import { prettyModel } from '../../../lib/api'
import {
  configValues, delegationRouting, getNested, saveConfig, saveModelRoutes, saveProfileRoutes, setDelegationBackend,
  type DelegationRouting, type ModelRoute, type ProfileRoute,
} from '../../../lib/api-config'
import { toast } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { setState } from '../../../lib/store'
import { Badge, confirm, Dialog, Empty, ErrorLine, Select, Spinner, Switch, useAsync } from '../../ui'
import { EFFORTS, EFFORT_WORDS, effortWord, ModelPicker, providerName } from './models-picker'
import { SkeletonRows, useNameOf } from './models-shared'

export function SubagentsTab({ profile }: { profile: string }) {
  const nameOf = useNameOf()
  const r = useAsync(() => delegationRouting(profile), [profile])
  const [choosing, setChoosing] = useState<string | null>(null)
  const routing = r.data

  const choose = async (name: string) => {
    if (!routing || name === routing.configured) return
    setChoosing(name)
    try { await setDelegationBackend(profile, name); toast(`Subagents now use “${routing.backends.find((b) => b.name === name)?.label ?? name}”.`); await r.reload(true) }
    catch (e: any) { toast(`Couldn’t switch: ${e?.message ?? e}`) } finally { setChoosing(null) }
  }

  return (
    <>
      <p className="x-note">When {nameOf(profile)} hands part of a job to a subagent, this decides what runs it.</p>
      {r.error ? <ErrorLine text={`Couldn’t read subagent settings: ${r.error}`} onRetry={() => void r.reload()} /> : null}
      {r.loading && !routing ? <SkeletonRows n={3} /> : null}
      {routing ? (
        <>
          {routing.blocked_reason ? (
            <div className="x-warn"><Icon name="alert" size={15} /><span><b>Subagents are stopped.</b> {routing.blocked_reason} Pick another way below or fix it, until then every subagent is refused.</span></div>
          ) : null}
          <div className="md-strategy flow">
            {routing.backends.map((b) => (
              <button key={b.name} className={b.name === routing.configured ? 'on' : ''} disabled={!!choosing || (!b.available && b.name !== routing.configured)} onClick={() => void choose(b.name)}>
                <span className="t">{b.name === routing.configured ? <Icon name="check" size={14} /> : null}{b.label || b.name}{choosing === b.name ? <Spinner size={12} /> : null}</span>
                <span className="d">{b.description}</span>
                {!b.available && b.reason ? <span className="d" style={{ color: 'var(--tint-amber)' }}>{b.reason}</span> : null}
              </button>
            ))}
          </div>
          {routing.configured === 'default' ? <DefaultRoute profile={profile} name={nameOf(profile)} /> : null}
          {routing.configured === 'model_map' ? <ModelRoutes profile={profile} routing={routing} onSaved={(m) => r.setData({ ...routing, model_map: m })} /> : null}
          {routing.configured === 'profile_routes' ? <ProfileRoutes profile={profile} routing={routing} nameOf={nameOf} onSaved={(p) => r.setData({ ...routing, profile_routes: p })} /> : null}
          {!['default', 'model_map', 'profile_routes'].includes(routing.configured) ? <p className="x-note">This way of running subagents comes from a plugin and has no settings here.</p> : null}
          <p className="x-note" style={{ marginTop: 16 }}>Limits like how many subagents run at once, their step limit and time limit are in <button className="x-link" onClick={() => { try { sessionStorage.setItem('config-page', 'model') } catch { /* opens on its last page */ } setState({ settingsPage: 'config', scope: profile }) }}>All settings › Model › Subagents</button>.</p>
        </>
      ) : null}
    </>
  )
}

// ---------- one model for every subagent ----------

function DefaultRoute({ profile, name }: { profile: string; name: string }) {
  const cfg = useAsync(() => configValues(profile), [profile])
  const [sel, setSel] = useState({ provider: '', model: '', effort: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (cfg.data) setSel({ provider: String(getNested(cfg.data, 'delegation.provider') ?? ''), model: String(getNested(cfg.data, 'delegation.model') ?? ''), effort: String(getNested(cfg.data, 'delegation.reasoning_effort') ?? '') })
  }, [cfg.data])
  const save = async (patch: Record<string, string>, done: string) => {
    const before = sel
    setSel({ ...sel, ...(patch.provider !== undefined ? { provider: patch.provider } : {}), ...(patch.model !== undefined ? { model: patch.model } : {}), ...(patch.reasoning_effort !== undefined ? { effort: patch.reasoning_effort } : {}) })
    setBusy(true)
    try { await saveConfig(profile, { delegation: patch }); toast(done) } catch (e: any) { setSel(before); toast(`Couldn’t save: ${e?.message ?? e}`) } finally { setBusy(false) }
  }
  if (cfg.error) return <ErrorLine text={cfg.error} onRetry={() => void cfg.reload()} />
  if (!cfg.data) return <SkeletonRows n={2} />
  return (
    <div className="card">
      <div className="srow ctlrow" style={{ alignItems: 'center' }}>
        <div className="tx"><div className="t1"><span>Subagent model</span></div><div className="t2">{sel.model ? `Every subagent uses ${prettyModel(sel.model)}.` : `Subagents use ${name}’s own model.`}</div></div>
        <div className="md-ctl">
          <ModelPicker profile={profile} provider={sel.model ? sel.provider : null} model={sel.model || null} busy={busy}
            extras={[{ key: 'parent', label: `Same as ${name}`, hint: 'Its own model', active: !sel.model, onPick: () => { if (sel.model) void save({ provider: '', model: '' }, `Subagents use ${name}’s own model.`) } }]}
            onPick={(p, m) => void save({ provider: p, model: m }, `Subagents use ${prettyModel(m)}.`)} />
        </div>
      </div>
      <div className="srow ctlrow" style={{ alignItems: 'center' }}>
        <div className="tx"><div className="t1"><span>Subagent thinking</span></div><div className="t2">How long subagents think. “Same as {name}” follows the agent that started them.</div></div>
        <div className="md-ctl">
          <Select width={220} align="end" value={sel.effort || '__same'} disabled={busy}
            options={[{ value: '__same', label: `Same as ${name}` }, ...EFFORTS.filter((e) => e !== 'none').map((e) => ({ value: e, label: EFFORT_WORDS[e] }))]}
            onChange={(v) => void save({ reasoning_effort: v === '__same' ? '' : v }, 'Subagent thinking saved.')} />
        </div>
      </div>
    </div>
  )
}

// ---------- named model routes ----------

const TIERS = [{ value: '', label: 'Usual speed' }, { value: 'normal', label: 'Standard' }, { value: 'fast', label: 'Fast' }, { value: 'ultrafast', label: 'Ultrafast' }]

function ModelRoutes({ profile, routing, onSaved }: { profile: string; routing: DelegationRouting; onSaved: (m: DelegationRouting['model_map']) => void }) {
  const routes = routing.model_map.options
  const [edit, setEdit] = useState<{ index: number; route: ModelRoute } | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async (options: ModelRoute[], def: string | null, done: string) => {
    setBusy(true)
    try { const res = await saveModelRoutes(profile, { options, default: def }); onSaved(res.model_map); toast(done); return true }
    catch (e: any) { toast(`Couldn’t save the routes: ${e?.message ?? e}`); return false } finally { setBusy(false) }
  }
  const remove = async (i: number) => {
    const rt = routes[i]
    if (!(await confirm({ title: `Delete the “${rt.name}” route?`, body: 'The agent can’t pick it for subagents any more.', action: 'Delete', danger: true }))) return
    const next = routes.filter((_, k) => k !== i)
    void save(next, routing.model_map.default === rt.name ? null : routing.model_map.default, `Deleted “${rt.name}”.`)
  }
  return (
    <>
      <div className="ssec"><h2>Model routes</h2><span>The agent reads each description to choose one</span><span className="sp" />
        <button className="b-text x-btn-sm" disabled={busy} onClick={() => setEdit({ index: -1, route: { name: '', description: '', provider: '', model: '' } })}><Icon name="plus" size={14} /> Add a route</button>
      </div>
      <div className="card">
        {!routes.length ? <Empty title="No routes yet" body="Add one, like “cheap” for quick lookups or “deep” for hard problems." face={false} /> : null}
        <div className="flow">
          {routes.map((rt, i) => (
            <div key={rt.name} className="srow click" onClick={() => setEdit({ index: i, route: { ...rt } })}>
              <div className="tx">
                <div className="t1"><span>{rt.name}</span>{routing.model_map.default === rt.name ? <Badge tone="quiet">Default</Badge> : null}</div>
                <div className="t2">{rt.description}</div>
                <div className="t3">{rt.model ? `${providerName(rt.provider) || rt.base_url || ''} · ${rt.model}` : ''}{rt.reasoning_effort ? ` · thinking ${effortWord(rt.reasoning_effort).toLowerCase()}` : ''}{rt.service_tier ? ` · ${rt.service_tier}` : ''}{rt.api_key ? ' · own key' : ''}</div>
              </div>
              <div className="act" onClick={(e) => e.stopPropagation()}>
                <button className="x-icon-btn danger" aria-label={`Delete ${rt.name}`} disabled={busy} onClick={() => void remove(i)}><Icon name="trash" size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {routes.length ? (
        <div className="srow ctlrow" style={{ padding: '12px 0 0', alignItems: 'center' }}>
          <div className="tx"><div className="t1"><span>When the agent doesn’t pick</span></div><div className="t2">The route a subagent gets if none is named.</div></div>
          <div className="md-ctl">
            <Select width={240} align="end" value={routing.model_map.default ?? ''} disabled={busy} onChange={(v) => void save(routes, v || null, 'Default route saved.')}
              options={[{ value: '', label: 'The agent’s own model' }, ...routes.map((rt) => ({ value: rt.name, label: rt.name }))]} />
          </div>
        </div>
      ) : null}
      <RouteDialog profile={profile} edit={edit} busy={busy} onClose={() => setEdit(null)} taken={routes.map((x, k) => (k === edit?.index ? '' : x.name))}
        onSave={async (route) => {
          if (!edit) return
          const next = edit.index < 0 ? [...routes, route] : routes.map((x, k) => (k === edit.index ? { ...route, original_name: x.name } : x))
          const def = edit.index >= 0 && routing.model_map.default === routes[edit.index].name ? route.name : routing.model_map.default
          if (await save(next, def, edit.index < 0 ? `Added “${route.name}”.` : `Saved “${route.name}”.`)) setEdit(null)
        }} />
    </>
  )
}

function RouteDialog({ profile, edit, busy, taken, onClose, onSave }: { profile: string; edit: { index: number; route: ModelRoute } | null; busy: boolean; taken: string[]; onClose: () => void; onSave: (r: ModelRoute) => void }) {
  const [r, setR] = useState<ModelRoute>({ name: '', description: '', model: '' })
  const [key, setKey] = useState('')
  const [own, setOwn] = useState(false)
  useEffect(() => { if (edit) { setR(edit.route); setKey(''); setOwn(!!edit.route.base_url && !edit.route.provider) } }, [edit])
  const hadKey = !!edit?.route.api_key
  const nameBad = !r.name.trim() ? '' : taken.includes(r.name.trim()) ? 'Another route has this name.' : ''
  const ok = r.name.trim() && !nameBad && r.description.trim() && r.model.trim() && (r.provider || r.base_url)
  const submit = () => {
    if (!ok) return
    const out: ModelRoute = { ...r, name: r.name.trim(), description: r.description.trim() }
    delete out.original_name
    // A stored key comes back only as a preview; sending the preview keeps the real one.
    if (key.trim()) out.api_key = key.trim()
    else if (!hadKey) delete out.api_key
    onSave(out)
  }
  return (
    <Dialog open={!!edit} onClose={onClose} width={560} title={edit?.index === -1 ? 'Add a model route' : `Edit “${edit?.route.name}”`}
      footer={<><span className="sp" /><button className="b-text" onClick={onClose}>Cancel</button><button className="b-pri" disabled={!ok || busy} onClick={submit}>{busy ? 'Saving…' : 'Save route'}</button></>}>
      <div style={{ display: 'grid', gap: 14, paddingTop: 6 }}>
        <div className="x-grid2">
          <div className="x-field"><label>Name</label><input className="answer" value={r.name} placeholder="deep" onChange={(e) => setR({ ...r, name: e.target.value })} autoFocus />{nameBad ? <span className="x-state error">{nameBad}</span> : null}</div>
          <div className="x-field"><label>Model</label>
            {own ? <input className="answer x-mono" value={r.model} placeholder="model-id" onChange={(e) => setR({ ...r, model: e.target.value })} />
              : <ModelPicker profile={profile} provider={r.provider} model={r.model || null} align="start" width={420} onPick={(p, m) => setR({ ...r, provider: p, model: m, base_url: undefined })} />}
          </div>
        </div>
        <div className="x-field"><label>When to use it</label>
          <textarea className="answer" rows={2} value={r.description} placeholder="Hard reasoning, long code changes. The agent reads this to decide." onChange={(e) => setR({ ...r, description: e.target.value })} />
        </div>
        <div className="x-grid2">
          <div className="x-field"><label>Thinking</label>
            <Select width={240} value={r.reasoning_effort ?? ''} onChange={(v) => setR({ ...r, reasoning_effort: v || undefined })}
              options={[{ value: '', label: 'Usual thinking' }, ...EFFORTS.map((e) => ({ value: e, label: EFFORT_WORDS[e] }))]} />
          </div>
          <div className="x-field"><label>Speed</label>
            <Select width={240} value={r.service_tier ?? ''} onChange={(v) => setR({ ...r, service_tier: v || undefined })} options={TIERS} />
          </div>
        </div>
        <label className="x-row" style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)' }}>
          <Switch on={own} label="Use my own server" onChange={(v) => { setOwn(v); setR(v ? { ...r, provider: '', base_url: r.base_url ?? '' } : { ...r, base_url: undefined }) }} /> Use my own server address instead of a provider
        </label>
        {own ? (
          <div className="x-field x-reveal"><label>Server address</label><input className="answer x-mono" value={r.base_url ?? ''} placeholder="http://localhost:8000/v1" onChange={(e) => setR({ ...r, base_url: e.target.value })} /></div>
        ) : null}
        <div className="x-field"><label>Own API key <span className="x-quiet">(optional)</span></label>
          <input className="answer" type="password" autoComplete="off" value={key} placeholder={hadKey ? 'A key is saved. Type a new one to replace it' : 'Uses the provider’s usual key'} onChange={(e) => setKey(e.target.value)} />
        </div>
      </div>
    </Dialog>
  )
}

// ---------- running as one of your bots ----------

function ProfileRoutes({ profile, routing, nameOf, onSaved }: { profile: string; routing: DelegationRouting; nameOf: (p: string) => string; onSaved: (p: DelegationRouting['profile_routes']) => void }) {
  const pr = routing.profile_routes
  const [busy, setBusy] = useState<string | null>(null)
  const save = async (profiles: ProfileRoute[], def: string | null, key: string, done: string) => {
    setBusy(key)
    try { const res = await saveProfileRoutes(profile, { profiles, default: def }); onSaved(res.profile_routes); toast(done) }
    catch (e: any) { toast(`Couldn’t save: ${e?.message ?? e}`) } finally { setBusy(null) }
  }
  const on = (n: string) => pr.profiles.some((p) => p.name === n)
  return (
    <>
      <div className="ssec"><h2>Agents a subagent can run as</h2><span>{pr.profiles.length} of {routing.profiles.length}</span></div>
      <div className="card flow">
        {routing.profiles.map((n) => {
          const entry = pr.profiles.find((p) => p.name === n)
          return (
            <div key={n} className="srow ctlrow">
              <div className="tx">
                <div className="t1"><span>{nameOf(n)}</span>{pr.default === n ? <Badge tone="quiet">Default</Badge> : null}</div>
                {entry ? (
                  <input className="answer" style={{ height: 30, padding: '0 10px', fontSize: 'var(--text-base)', marginTop: 4 }} defaultValue={entry.description ?? ''} placeholder="When to use this agent (the agent reads this)"
                    onBlur={(e) => { const d = e.target.value.trim(); if (d !== (entry.description ?? '')) void save(pr.profiles.map((p) => (p.name === n ? { ...p, description: d || undefined } : p)), pr.default, n, `${nameOf(n)}: description saved.`) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                ) : <div className="t2">Not offered to subagents.</div>}
              </div>
              <div className="act" style={{ paddingTop: 4 }}>
                {busy === n ? <Spinner /> : null}
                <Switch on={on(n)} disabled={!!busy} label={`Offer ${nameOf(n)}`} onChange={(v) => {
                  const next = v ? [...pr.profiles, { name: n }] : pr.profiles.filter((p) => p.name !== n)
                  void save(next, !v && pr.default === n ? null : pr.default, n, v ? `${nameOf(n)} can run subagents.` : `${nameOf(n)} no longer runs subagents.`)
                }} />
              </div>
            </div>
          )
        })}
      </div>
      {pr.profiles.length ? (
        <div className="srow ctlrow" style={{ padding: '12px 0 0', alignItems: 'center' }}>
          <div className="tx"><div className="t1"><span>When the agent doesn’t pick</span></div><div className="t2">The agent a subagent runs as if none is named.</div></div>
          <div className="md-ctl">
            <Select width={240} align="end" value={pr.default ?? ''} disabled={!!busy} onChange={(v) => void save(pr.profiles, v || null, '__default', 'Default saved.')}
              options={[{ value: '', label: 'No default' }, ...pr.profiles.map((p) => ({ value: p.name, label: nameOf(p.name) }))]} />
          </div>
        </div>
      ) : null}
    </>
  )
}
