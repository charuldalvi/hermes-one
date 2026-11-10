// Mixture of agents: several models answer, one more combines their answers. Named line-ups
// (presets), each with reference models, a combining model and a few tuning knobs. Slot edits save
// themselves once every slot is complete; preset actions save at once.
import { useEffect, useRef, useState } from 'react'
import { prettyModel } from '../../../lib/api'
import { moa, saveMoa, type MoaConfig, type MoaPreset, type MoaSlot } from '../../../lib/api-config'
import { toast } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { Badge, confirm, ErrorLine, Select, Switch, useAsync } from '../../ui'
import { ModelPicker } from './models-picker'
import { NumberSave, SkeletonRows, useNameOf } from './models-shared'

const complete = (s: MoaSlot) => !!(s.provider?.trim() && s.model?.trim())
const allComplete = (c: MoaConfig) => Object.values(c.presets).every((p) => p.reference_models.length > 0 && p.reference_models.every(complete) && complete(p.aggregator))

const FANOUT = [
  { value: 'user_turn', label: 'Once per message', hint: 'Default' },
  { value: 'per_iteration', label: 'Every step', hint: 'Slower, costs more' },
]

export function MixtureTab({ profile }: { profile: string }) {
  const nameOf = useNameOf()
  const loaded = useAsync(() => moa(profile), [profile])
  const [cfg, setCfg] = useState<MoaConfig | null>(null)
  const [sel, setSel] = useState('')
  const [newName, setNewName] = useState('')
  const [state, setStateV] = useState<'idle' | 'waiting' | 'saving' | 'saved'>('idle')
  const last = useRef<MoaConfig | null>(null) // what Hermes has
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gen = useRef(0)

  useEffect(() => {
    if (!loaded.data) return
    setCfg(loaded.data); last.current = loaded.data
    setSel((s) => (s && loaded.data!.presets[s] ? s : loaded.data!.default_preset || Object.keys(loaded.data!.presets)[0] || ''))
  }, [loaded.data])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const persist = async (next: MoaConfig, done?: string) => {
    const g = ++gen.current
    setStateV('saving')
    try {
      const saved = await saveMoa(profile, next)
      if (g !== gen.current) return
      const { ok: _ok, ...rest } = saved
      void _ok
      last.current = rest as MoaConfig; setCfg(rest as MoaConfig); setStateV('saved')
      setTimeout(() => setStateV((s) => (s === 'saved' ? 'idle' : s)), 1500)
      if (done) toast(done)
    } catch (e: any) {
      if (g !== gen.current) return
      setStateV('idle')
      if (last.current) setCfg(last.current)
      toast(`Couldn’t save the mixture: ${e?.message ?? e}`)
    }
  }
  /** Inline edits wait until every slot has a model, then save after a short pause. */
  const edit = (next: MoaConfig) => {
    setCfg(next)
    if (timer.current) clearTimeout(timer.current)
    gen.current++
    if (!allComplete(next)) { setStateV('waiting'); return }
    setStateV('waiting')
    timer.current = setTimeout(() => void persist(next), 600)
  }
  const now = (next: MoaConfig, done: string) => { if (timer.current) clearTimeout(timer.current); setCfg(next); void persist(next, done) }

  if (loaded.error && !cfg) return <ErrorLine text={`Couldn’t read the mixture: ${loaded.error}`} onRetry={() => void loaded.reload()} />
  if (!cfg) return <SkeletonRows n={4} />
  const name = sel && cfg.presets[sel] ? sel : cfg.default_preset
  const preset = cfg.presets[name] ?? Object.values(cfg.presets)[0]
  if (!preset) return <ErrorLine text="Hermes sent a mixture with no line-ups." onRetry={() => void loaded.reload()} />
  const names = Object.keys(cfg.presets)
  const upd = (fn: (p: MoaPreset) => MoaPreset) => edit({ ...cfg, presets: { ...cfg.presets, [name]: fn(preset) } })
  const slot = (s: MoaSlot, p: string, m: string): MoaSlot => ({ ...s, provider: p, model: m })

  return (
    <>
      <p className="x-note">Several models answer the same question and one more combines their answers into one. It’s slower and costs more, and often gives {nameOf(profile)} better answers on hard problems. Pick it as a model (“Mixture of agents”) on the Main tab or in a chat to use it.</p>
      <div className="md-presets">
        <Select width={240} value={name} onChange={setSel} options={names.map((n) => ({ value: n, label: n, hint: n === cfg.default_preset ? 'Default' : undefined }))}
          render={(o) => <><span className="sv">{o?.label ?? name}</span>{o?.value === cfg.default_preset ? <Badge tone="quiet">Default</Badge> : null}</>} />
        <label className="x-row" style={{ gap: 8, fontSize: 'var(--text-base)', color: 'var(--text-secondary)' }}>
          <Switch on={preset.enabled !== false} label="Line-up on" onChange={(v) => upd((p) => ({ ...p, enabled: v }))} /> On
        </label>
        {name !== cfg.default_preset ? <button className="b-text x-btn-sm" onClick={() => now({ ...cfg, default_preset: name }, `“${name}” is the default line-up.`)}>Make default</button> : null}
        <button className="b-text x-btn-sm" disabled={names.length <= 1} title={names.length <= 1 ? 'Keep at least one line-up' : undefined} onClick={async () => {
          if (!(await confirm({ title: `Delete the “${name}” line-up?`, body: 'Its models and settings go away. Other line-ups stay.', action: 'Delete', danger: true }))) return
          const presets = { ...cfg.presets }; delete presets[name]
          const fallback = Object.keys(presets)[0]
          setSel(fallback)
          now({ ...cfg, presets, default_preset: cfg.default_preset === name ? fallback : cfg.default_preset, active_preset: cfg.active_preset === name ? '' : cfg.active_preset }, `Deleted “${name}”.`)
        }}>Delete</button>
        <span style={{ flex: 1 }} />
        <span className={`x-state ${state === 'saved' ? 'saved' : ''}`}>{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'waiting' && !allComplete(cfg) ? 'Pick a model for every slot to save' : ''}</span>
      </div>

      <div className="ssec"><h2>Models that answer</h2><span>{preset.reference_models.length}</span></div>
      <div className="card">
        {preset.reference_models.map((s, i) => (
          <div key={`${name}-${i}`} className={`md-slot${s.enabled === false ? ' off' : ''}`}>
            <span className="n">{i + 1}</span>
            <ModelPicker profile={profile} provider={s.provider} model={s.model} exclude={['moa']} align="start"
              onPick={(p, m) => upd((x) => ({ ...x, reference_models: x.reference_models.map((r, k) => (k === i ? slot(r, p, m) : r)) }))} />
            <span className="act">
              <Switch on={s.enabled !== false} label={`Model ${i + 1} on`} onChange={(v) => upd((x) => ({ ...x, reference_models: x.reference_models.map((r, k) => (k === i ? { ...r, enabled: v } : r)) }))} />
              <button className="x-icon-btn danger" aria-label="Remove" disabled={preset.reference_models.length <= 1}
                onClick={() => upd((x) => ({ ...x, reference_models: x.reference_models.filter((_, k) => k !== i) }))}><Icon name="trash" size={14} /></button>
            </span>
          </div>
        ))}
        <div className="md-add">
          <button className="b-text x-btn-sm" onClick={() => upd((x) => ({ ...x, reference_models: [...x.reference_models, { provider: '', model: '', enabled: true }] }))}><Icon name="plus" size={14} /> Add a model</button>
        </div>
      </div>

      <div className="ssec"><h2>Model that combines</h2><span>Billed for every answer</span></div>
      <div className="card">
        <div className="md-slot">
          <span className="n"><Icon name="spark" size={13} /></span>
          <ModelPicker profile={profile} provider={preset.aggregator.provider} model={preset.aggregator.model} exclude={['moa']} align="start"
            onPick={(p, m) => upd((x) => ({ ...x, aggregator: slot(x.aggregator, p, m) }))} />
          <span />
        </div>
      </div>

      <div className="ssec"><h2>Fine-tuning</h2></div>
      <div className="card">
        <Knob title="Answer temperature" text="How adventurous the answering models are. Empty keeps each model’s own default.">
          <NumberSave value={preset.reference_temperature} placeholder="Default" step={0.1} onSave={async (n) => upd((x) => ({ ...x, reference_temperature: n }))} />
        </Knob>
        <Knob title="Combining temperature" text="The same for the model that combines.">
          <NumberSave value={preset.aggregator_temperature} placeholder="Default" step={0.1} onSave={async (n) => upd((x) => ({ ...x, aggregator_temperature: n }))} />
        </Knob>
        <Knob title="Time limit per answer" text="Seconds to wait for each answering model. Empty waits as long as it takes.">
          <NumberSave value={preset.reference_timeout} placeholder="None" min={1} onSave={async (n) => upd((x) => ({ ...x, reference_timeout: n }))} />
        </Knob>
        <Knob title="When a model fails" text="Whether a missing answer is reported or the rest carry on.">
          <Select width={220} align="end" value={preset.degraded_reference_policy ?? 'loud'} onChange={(v) => upd((x) => ({ ...x, degraded_reference_policy: v as 'loud' | 'silent' }))}
            options={[{ value: 'loud', label: 'Say so', hint: 'Default' }, { value: 'silent', label: 'Carry on quietly' }]} />
        </Knob>
        <Knob title="How often to ask them all" text="Once per message is usually enough.">
          <Select width={240} align="end" value={preset.fanout ?? 'user_turn'} onChange={(v) => upd((x) => ({ ...x, fanout: v }))}
            options={[...FANOUT, ...(preset.fanout && !FANOUT.some((f) => f.value === preset.fanout) ? [{ value: preset.fanout, label: preset.fanout.replace('every_n:', 'Every ') + (preset.fanout.startsWith('every_n:') ? ' steps' : ''), hint: '' }] : [])]} />
        </Knob>
      </div>

      <div className="ssec"><h2>New line-up</h2></div>
      <div className="x-row">
        <input className="answer" style={{ width: 240, height: 32, padding: '0 10px' }} placeholder="Name, e.g. deep" value={newName}
          onChange={(e) => setNewName(e.target.value.replace(/\s+/g, '-'))} onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget.nextElementSibling as HTMLButtonElement | null)?.click() }} />
        <button className="b-soft" disabled={!newName.trim() || !!cfg.presets[newName.trim()] || !allComplete(cfg)} title={cfg.presets[newName.trim()] ? 'That name is taken' : undefined} onClick={() => {
          const n = newName.trim()
          setSel(n); setNewName('')
          now({ ...cfg, presets: { ...cfg.presets, [n]: { ...preset, reference_models: preset.reference_models.map((r) => ({ ...r })), aggregator: { ...preset.aggregator } } } }, `Added “${n}”, a copy of “${name}”.`)
        }}>Copy “{name}” as a new line-up</button>
      </div>
      {preset.reference_models.some((r) => r.model) ? <p className="x-note" style={{ marginTop: 14 }}>Now: {preset.reference_models.filter((r) => r.enabled !== false && r.model).map((r) => prettyModel(r.model)).join(', ')} answer; {prettyModel(preset.aggregator.model) || 'nobody'} combines.</p> : null}
    </>
  )
}

function Knob({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="srow ctlrow" style={{ alignItems: 'center' }}>
      <div className="tx"><div className="t1"><span>{title}</span></div><div className="t2">{text}</div></div>
      <div className="md-ctl">{children}</div>
    </div>
  )
}
