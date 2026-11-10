// Main models: Chief and every bot in one list, each with the model it thinks with, its context
// window, and (opened) its context override, default thinking effort and speed.
import { useCallback, useEffect, useState } from 'react'
import { prettyModel, profiles, type Profile } from '../../../lib/api'
import {
  assignAux, configValues, getNested, modelInfoFor, saveField, tokens, type ModelInfo, type StaleAux,
} from '../../../lib/api-config'
import { toast } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { useStore } from '../../../lib/store'
import { BotFace } from '../../BotFace'
import { Badge, ErrorLine, Select, Spinner, useAsync } from '../../ui'
import { EFFORTS, EFFORT_WORDS, findProvider, ModelPicker, providerName, useCatalog } from './models-picker'
import { assignWithConfirm, NumberSave, SkeletonRows, useNameOf } from './models-shared'

export function MainTab({ onOpenHelpers }: { onOpenHelpers: (profile: string) => void }) {
  const list = useAsync(profiles, [])
  const bots = useStore((s) => s.bots)
  const nameOf = useNameOf()
  const [stale, setStale] = useState<{ profile: string; provider: string; model: string; slots: StaleAux[] } | null>(null)
  const [resetting, setResetting] = useState(false)
  useCatalog('default', true)

  const rows = [...(list.data ?? [])].sort((a, b) => (a.is_default || a.name === 'default' ? -1 : b.is_default || b.name === 'default' ? 1 : nameOf(a.name).localeCompare(nameOf(b.name))))

  const resetHelpers = async () => {
    if (!stale) return
    setResetting(true)
    try {
      await assignAux(stale.profile, '__reset__', { provider: stale.provider, model: stale.model })
      toast(`${nameOf(stale.profile)}’s helpers now follow the main model.`)
      setStale(null)
    } catch (e: any) { toast(`Couldn’t move the helpers: ${e?.message ?? e}`) } finally { setResetting(false) }
  }

  return (
    <>
      <p className="x-note">New chats and scheduled jobs use these. A chat that’s already open keeps its model until you change it in that chat.</p>
      {stale ? (
        <div className="x-warn x-reveal">
          <Icon name="alert" size={15} />
          <span>{stale.slots.length === 1 ? 'One helper job' : `${stale.slots.length} helper jobs`} for {nameOf(stale.profile)} still {stale.slots.length === 1 ? 'uses' : 'use'} {[...new Set(stale.slots.map((s) => providerName(s.provider)))].join(', ')}, not the new main model. They keep billing that provider.</span>
          <button className="b-text x-btn-sm" disabled={resetting} onClick={() => void resetHelpers()}>{resetting ? 'Moving…' : 'Follow the main model'}</button>
          <button className="b-text x-btn-sm" onClick={() => onOpenHelpers(stale.profile)}>See helpers</button>
          <button className="x-icon-btn" aria-label="Dismiss" onClick={() => setStale(null)}><Icon name="x" size={14} /></button>
        </div>
      ) : null}
      {list.error ? <ErrorLine text={`Couldn’t read your agents: ${list.error}`} onRetry={() => void list.reload()} /> : null}
      {list.loading && !list.data ? <SkeletonRows n={4} /> : null}
      {list.data ? (
        <div className="card md-who flow">
          {rows.map((p) => (
            <ModelRow key={p.name} prof={p} name={nameOf(p.name)} poseKey={bots.find((b) => b.profile === p.name)?.poseKey}
              onStale={(slots, provider, model) => setStale({ profile: p.name, provider, model, slots })} />
          ))}
        </div>
      ) : null}
    </>
  )
}

function ModelRow({ prof, name, poseKey, onStale }: { prof: Profile; name: string; poseKey?: string; onStale: (slots: StaleAux[], provider: string, model: string) => void }) {
  const id = prof.name
  const isChief = id === 'default' || prof.is_default
  const [sel, setSel] = useState({ provider: prof.provider ?? '', model: prof.model ?? '' })
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<ModelInfo | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const loadInfo = useCallback(() => { modelInfoFor(id).then((i) => setInfo(i), () => setInfo(null)) }, [id])
  useEffect(() => { loadInfo() }, [loadInfo])
  useEffect(() => { setSel({ provider: prof.provider ?? '', model: prof.model ?? '' }) }, [prof.provider, prof.model])

  const pick = async (provider: string, model: string) => {
    const before = sel
    setSel({ provider, model }); setBusy(true)
    try {
      const r = await assignWithConfirm(id, provider, model, findProvider(id, provider)?.api_url ?? findProvider('default', provider)?.api_url)
      if (!r) { setSel(before); return }
      const fp = r.provider || provider, fm = r.model || model
      setSel({ provider: fp, model: fm })
      toast(`${name} now uses ${prettyModel(fm)} for new chats.`)
      if (r.notice) toast(r.notice)
      if (r.stale_aux?.length) onStale(r.stale_aux, fp, fm)
      setInfo(undefined); loadInfo()
    } catch (e: any) {
      setSel(before)
      toast(`Couldn’t change ${name}’s model: ${e?.message ?? e}`)
    } finally { setBusy(false) }
  }

  const ctx = info?.effective_context_length
  return (
    <>
      <div className="srow">
        <BotFace profile={id} size={30} poseKey={poseKey} watch={false} />
        <div className="tx">
          <div className="t1"><span>{name}</span>{isChief ? <Badge tone="quiet">Leads your agents</Badge> : null}</div>
          <div className="t2" style={{ display: 'flex', gap: 8, alignItems: 'center', WebkitLineClamp: 1 }}>
            <span>{sel.model ? providerName(sel.provider) || 'Provider not set' : 'No model chosen yet'}</span>
            {sel.model ? <span className="ctx">{info === undefined ? '…' : ctx ? `${tokens(ctx)} context${info?.config_context_length ? ' (your limit)' : ''}` : 'context unknown'}</span> : null}
          </div>
        </div>
        <div className="md-ctl">
          <ModelPicker profile={id} provider={sel.provider} model={sel.model} busy={busy} onPick={(p, m) => void pick(p, m)} placeholder="Choose a model" />
          <button className="x-icon-btn" aria-label={open ? 'Hide details' : 'Show details'} aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name="chevR" size={15} className={`x-chev${open ? ' open' : ''}`} />
          </button>
        </div>
      </div>
      {open ? <Details profile={id} name={name} provider={sel.provider} model={sel.model} info={info} onInfo={() => { setInfo(undefined); loadInfo() }} /> : null}
    </>
  )
}

const SPEEDS = [
  { value: 'normal', label: 'Standard', hint: 'Usual speed and price' },
  { value: 'fast', label: 'Fast', hint: 'Always, where the provider offers it' },
  { value: 'auto', label: 'Fast at the start of each turn', hint: 'Then standard' },
  { value: 'cold', label: 'Fast on the first turn only', hint: 'Then standard' },
  { value: 'ultrafast', label: 'Ultrafast', hint: 'Only some models' },
]

function Details({ profile, name, provider, model, info, onInfo }: { profile: string; name: string; provider: string; model: string; info: ModelInfo | null | undefined; onInfo: () => void }) {
  const cfg = useAsync(() => configValues(profile), [profile])
  const caps = findProvider(profile, provider)?.capabilities?.[model] ?? findProvider('default', provider)?.capabilities?.[model]
  const mcaps = info?.capabilities ?? {}
  const [effort, setEffort] = useState<string | undefined>()
  const [speed, setSpeed] = useState<string | undefined>()
  const [saving, setSaving] = useState<string | null>(null)
  useEffect(() => {
    if (!cfg.data) return
    const raw = String(getNested(cfg.data, 'agent.reasoning_effort') ?? '').trim().toLowerCase()
    setEffort(raw === 'false' || raw === 'disabled' || raw === 'off' ? 'none' : raw || 'medium')
    setSpeed(String(getNested(cfg.data, 'agent.service_tier') ?? '') || 'normal')
  }, [cfg.data])

  const save = async (key: string, value: unknown, set: (v: any) => void, before: unknown, label: string) => {
    set(value); setSaving(key)
    try { await saveField(profile, key, value); toast(`${name}: ${label} saved.`) } catch (e: any) { set(before); toast(`Couldn’t save ${label}: ${e?.message ?? e}`) } finally { setSaving(null) }
  }

  const reasoning = caps?.reasoning !== false
  const fastOk = !!(caps?.fast || caps?.ultrafast)
  const speedOpts = SPEEDS.filter((s) => s.value !== 'ultrafast' || caps?.ultrafast || speed === 'ultrafast')
  const capsWords = [
    mcaps.supports_tools ? 'Uses tools' : null, mcaps.supports_vision ? 'Sees images' : null,
    mcaps.supports_reasoning || caps?.reasoning ? 'Can think first' : null, caps?.fast ? 'Has a fast mode' : null,
    mcaps.max_output_tokens ? `Writes up to ${tokens(mcaps.max_output_tokens)} at once` : null,
  ].filter(Boolean) as string[]

  return (
    <div className="srow x-reveal" style={{ display: 'block', paddingLeft: 60, background: 'var(--gray-950)' }}>
      {cfg.error ? <ErrorLine text={`Couldn’t read ${name}’s settings: ${cfg.error}`} onRetry={() => void cfg.reload()} /> : null}
      <div style={{ display: 'grid', gap: 12, padding: '4px 0 6px' }}>
        <div className="x-row">
          <div className="tx" style={{ flex: 1, minWidth: 0 }}>
            <div className="t1" style={{ fontSize: 'var(--text-base)' }}>Context window</div>
            <div className="t2" style={{ fontSize: 'var(--text-xs)' }}>
              {info === undefined ? 'Checking…' : info === null ? 'Hermes couldn’t ask the provider.' : `Detected ${tokens(info.auto_context_length)}. Hermes uses ${tokens(info.effective_context_length)}.`} Set a lower limit to keep long chats cheaper; empty uses what’s detected.
            </div>
          </div>
          <NumberSave value={info?.config_context_length || null} placeholder={info?.auto_context_length ? tokens(info.auto_context_length) : 'Auto'} min={0} width={120}
            onSave={async (n) => { await saveField(profile, 'model_context_length', n ?? 0); toast(n ? `${name}’s context limit is ${tokens(n)}.` : `${name} uses the detected context window.`); onInfo() }} />
        </div>
        {reasoning ? (
          <div className="x-row">
            <div className="tx" style={{ flex: 1, minWidth: 0 }}>
              <div className="t1" style={{ fontSize: 'var(--text-base)' }}>Thinking</div>
              <div className="t2" style={{ fontSize: 'var(--text-xs)' }}>How long {name} thinks before answering in new chats. Each chat can still change it.</div>
            </div>
            {cfg.loading && !cfg.data ? <Spinner /> : (
              <Select width={220} align="end" value={effort} disabled={saving === 'agent.reasoning_effort'}
                options={EFFORTS.map((e) => ({ value: e, label: EFFORT_WORDS[e], hint: e === 'medium' ? 'Default' : undefined }))}
                onChange={(v) => void save('agent.reasoning_effort', v, setEffort, effort, 'thinking')} />
            )}
          </div>
        ) : null}
        {fastOk || (speed && speed !== 'normal') ? (
          <div className="x-row">
            <div className="tx" style={{ flex: 1, minWidth: 0 }}>
              <div className="t1" style={{ fontSize: 'var(--text-base)' }}>Speed</div>
              <div className="t2" style={{ fontSize: 'var(--text-xs)' }}>Fast mode answers sooner and usually costs more.</div>
            </div>
            {cfg.loading && !cfg.data ? <Spinner /> : (
              <Select width={280} align="end" value={speed} disabled={saving === 'agent.service_tier'}
                options={speedOpts.map((s) => ({ value: s.value, label: s.label, hint: s.hint }))}
                onChange={(v) => void save('agent.service_tier', v, setSpeed, speed, 'speed')} />
            )}
          </div>
        ) : null}
        {capsWords.length ? <div className="x-row">{capsWords.map((w) => <Badge key={w} tone="quiet">{w}</Badge>)}</div> : null}
        {model ? <div className="t3" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-icon)' }}>{provider} · {model}</div> : null}
      </div>
    </div>
  )
}
