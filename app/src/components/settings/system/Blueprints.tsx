// Ready-made jobs (a morning briefing, a weekly review, a price watch …): pick one, fill in its few
// blanks, and Hermes makes the job for the bot you choose. Plugins can add their own blueprints.
import { useEffect, useMemo, useState } from 'react'
import { blueprints, deliveryTargets, instantiateBlueprint, type Blueprint, type BlueprintField, type CronJob } from '../../../lib/api-system'
import { Icon } from '../../../lib/icons'
import { useStore } from '../../../lib/store'
import { BotFace } from '../../BotFace'
import { Badge, Dialog, ErrorLine, Search, Select, Spinner, useAsync, type Option } from '../../ui'
import { defaultDeliver, targetLabel } from './jobs'
import { errText, Field } from './parts'

const nice = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/[_-]/g, ' ')

function Slot({ field, value, onChange, deliverOptions }: { field: BlueprintField; value: string; onChange: (v: string) => void; deliverOptions: Option[] }) {
  if (field.name === 'deliver') return <Select value={value} options={deliverOptions} onChange={onChange} width={360} />
  if (field.type === 'enum' || field.type === 'weekdays') {
    const opts = field.options.map((o) => ({ value: o, label: nice(o) }))
    if (value && !field.options.includes(value)) opts.unshift({ value, label: nice(value) })
    return <Select value={value} options={opts} onChange={onChange} width={300} />
  }
  if (field.type === 'time') return <input type="time" className="answer" style={{ width: 160, colorScheme: 'dark' }} value={value} onChange={(e) => onChange(e.target.value)} />
  return <input className="answer" value={value} placeholder={field.help || field.label} onChange={(e) => onChange(e.target.value)} />
}

export function BlueprintGallery({ open, onClose, initialProfile = 'default', onCreated }: { open: boolean; onClose: () => void; initialProfile?: string; onCreated: (job: CronJob) => void }) {
  const bots = useStore((s) => s.bots)
  const [profile, setProfile] = useState(initialProfile)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<Blueprint | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setProfile(initialProfile); setPick(null); setQ(''); setError('') } }, [open])

  const list = useAsync(() => (open ? blueprints(profile) : Promise.resolve([] as Blueprint[])), [open, profile])
  const targets = useAsync(() => (open ? deliveryTargets(profile).catch(() => []) : Promise.resolve([])), [open, profile])

  const deliverOptions: Option[] = useMemo(() => {
    const field = pick?.fields.find((f) => f.name === 'deliver')
    const ids = new Set<string>([...(targets.data ?? []).map((t) => t.id), ...(field?.options ?? []).filter((o) => o !== 'origin')])
    return [...ids].map((id) => ({ value: id, label: targetLabel(id, bots, targets.data) }))
  }, [pick, targets.data, bots])

  const choose = (b: Blueprint) => {
    const v: Record<string, string> = {}
    for (const f of b.fields) {
      const seed = f.default ?? ''
      v[f.name] = f.name === 'deliver' && (seed === '' || seed === 'origin') ? defaultDeliver(targets.data ?? [], profile) : seed
    }
    setValues(v); setPick(b); setError('')
  }

  const groups = useMemo(() => {
    const t = q.trim().toLowerCase()
    const shown = (list.data ?? []).filter((b) => !t || `${b.title} ${b.description} ${b.category} ${b.tags.join(' ')}`.toLowerCase().includes(t))
    const by = new Map<string, Blueprint[]>()
    for (const b of shown) { const k = nice(b.category || 'general'); by.set(k, [...(by.get(k) ?? []), b]) }
    return [...by.entries()]
  }, [list.data, q])

  const missing = pick?.fields.find((f) => !f.optional && !(values[f.name] ?? '').trim())
  const submit = async () => {
    if (!pick || missing) { setError(missing ? `Fill in “${missing.label}”.` : ''); return }
    setSaving(true); setError('')
    try {
      const job = await instantiateBlueprint(profile, pick.key, values)
      onCreated({ ...job, profile })
    } catch (e) { setError(errText(e).replace(/^\d+:\s*/, '')) } finally { setSaving(false) }
  }

  const botOptions: Option[] = [...bots].sort((a, b) => (a.isChief ? -1 : b.isChief ? 1 : a.name.localeCompare(b.name))).map((b) => ({ value: b.profile, label: b.isChief ? 'Hermes' : b.name, icon: <BotFace profile={b.profile} size={20} poseKey={b.poseKey} watch={false} /> }))
  return (
    <Dialog open={open} onClose={() => { if (!saving) onClose() }} wide width={880}
      title={pick ? <><button className="hbtn" onClick={() => setPick(null)} aria-label="Back"><Icon name="chevR" size={16} style={{ transform: "rotate(180deg)" }} /></button><span>{pick.title}</span></> : 'Start from a blueprint'}
      footer={pick ? <>
        {error ? <span className="sy-err" style={{ flex: 1, minWidth: 0 }}>{error}</span> : <span className="sp" />}
        <button className="b-text" onClick={() => setPick(null)} disabled={saving}>Back</button>
        <button className="b-pri" onClick={() => void submit()} disabled={saving}>{saving ? 'Scheduling…' : 'Schedule it'}</button>
      </> : undefined}>
      <div className="stools" style={{ marginTop: 4 }}>
        {!pick ? <Search value={q} onChange={setQ} placeholder="Search blueprints" /> : null}
        <div className="pp"><span className="pl">For</span>
          <Select value={profile} options={botOptions} onChange={(p) => { setProfile(p); setPick(null) }} width={300} align="end"
            render={(o) => <>{o?.icon}<span className="sv">{o?.label ?? 'Hermes'}</span></>} />
        </div>
      </div>
      {pick ? (
        <div className="sy-form sy-reveal">
          <p className="free" style={{ margin: 0 }}>{pick.description}</p>
          {pick.fields.map((f) => (
            <Field key={f.name} label={f.name === 'deliver' ? 'Send the result to' : f.label} optional={f.optional} hint={f.name !== 'deliver' && f.type !== 'text' ? f.help : undefined}>
              <Slot field={f} value={values[f.name] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} deliverOptions={deliverOptions} />
            </Field>
          ))}
          {pick.scheduleHuman ? <div className="sy-summary"><Icon name="clock" size={15} /><span>Normally runs {pick.scheduleHuman}; your answers above set the exact time.</span></div> : null}
        </div>
      ) : list.loading && !list.data ? <div className="empty"><Spinner size={18} /><span>Loading blueprints…</span></div>
        : list.error ? <ErrorLine text={`Couldn’t load blueprints: ${list.error}`} onRetry={() => void list.reload()} />
        : !groups.length ? <div className="empty"><b>{q ? 'Nothing matches' : 'No blueprints here'}</b></div>
        : groups.map(([cat, items]) => (
          <div key={cat}>
            <div className="ssec" style={{ marginTop: 18 }}><h2>{cat}</h2><span>{items.length}</span></div>
            <div className="tiles flow">
              {items.map((b) => (
                <button key={b.key} className="tile-c" onClick={() => choose(b)}>
                  <div className="th"><div className="tx"><div className="tt">{b.title}</div><div className="ts">{b.scheduleHuman ? nice(b.scheduleHuman) : 'On a schedule'}</div></div>
                    {b.source === 'plugin' ? <Badge tone="quiet">{b.plugin ?? 'Plugin'}</Badge> : null}</div>
                  <div className="td">{b.description}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
    </Dialog>
  )
}
