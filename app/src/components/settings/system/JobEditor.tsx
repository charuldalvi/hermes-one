// Make or change a scheduled job: which bot, what it should do, when (friendly presets, or any
// schedule Hermes understands), where the result goes, skills to load, and a few rarer options.
import { useEffect, useMemo, useState } from 'react'
import { modelOptions, prettyModel } from '../../../lib/api'
import { createCron, deliveryTargets, updateCron, type CronJob, type DeliveryTarget } from '../../../lib/api-system'
import { Icon } from '../../../lib/icons'
import { useStore } from '../../../lib/store'
import { BotFace } from '../../BotFace'
import { Dialog, Select, Spinner, useAsync, type Option } from '../../ui'
import { DAY_OPTIONS, PRESETS, blankSched, defaultDeliver, isScriptOnly, schedFromJob, schedSummary, schedToString, splitDeliver, targetLabel, type Sched } from './jobs'
import { errText, Field, Fold } from './parts'
import { SkillPicker } from './SkillPicker'

type CatchUp = 'default' | 'run' | 'skip'
const SEP = '\u0000'

export function JobEditor({ open, onClose, job, initialProfile = 'default', onSaved }: {
  open: boolean; onClose: () => void; job?: CronJob | null; initialProfile?: string; onSaved: (job: CronJob, created: boolean) => void
}) {
  const bots = useStore((s) => s.bots)
  const edit = !!job
  const [profile, setProfile] = useState(initialProfile)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [sched, setSched] = useState<Sched>(blankSched())
  const [schedTouched, setSchedTouched] = useState(false)
  const [deliver, setDeliver] = useState<string[]>([])
  const [touchedDeliver, setTouchedDeliver] = useState(false)
  const [skills, setSkills] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [repeat, setRepeat] = useState<'forever' | 'times'>('forever')
  const [times, setTimes] = useState('3')
  const [catchUp, setCatchUp] = useState<CatchUp>('default')
  const [paused, setPaused] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tried, setTried] = useState(false)

  // A fresh form each time it opens: the job's values, or blanks for a new one.
  useEffect(() => {
    if (!open) return
    setError(''); setTried(false); setSaving(false); setSchedTouched(false)
    if (job) {
      setProfile(job.profile); setName(job.name ?? ''); setPrompt(job.prompt ?? ''); setSched(schedFromJob(job))
      setDeliver(splitDeliver(job.deliver)); setTouchedDeliver(true); setSkills([...(job.skills ?? []), ...(job.skill && !(job.skills ?? []).includes(job.skill) ? [job.skill] : [])])
      setModel(job.model ? `${job.provider ?? ''}${SEP}${job.model}` : '')
      setRepeat(job.repeat?.times && job.repeat.times > 1 ? 'times' : 'forever'); setTimes(String(job.repeat?.times && job.repeat.times > 1 ? job.repeat.times : 3))
      setCatchUp(job.catch_up === true ? 'run' : job.catch_up === false ? 'skip' : 'default'); setPaused(false)
    } else {
      setProfile(initialProfile); setName(''); setPrompt(''); setSched(blankSched()); setDeliver([]); setTouchedDeliver(false); setSkills([])
      setModel(''); setRepeat('forever'); setTimes('3'); setCatchUp('default'); setPaused(false)
    }
  }, [open, job?.id, job?.profile])

  const targetsQ = useAsync(() => (open ? deliveryTargets(profile) : Promise.resolve([] as DeliveryTarget[])), [open, profile])
  const targets = targetsQ.data ?? []
  useEffect(() => { if (open && !touchedDeliver && targetsQ.data) setDeliver([defaultDeliver(targetsQ.data, profile)]) }, [open, touchedDeliver, targetsQ.data, profile])
  const modelsQ = useAsync(() => (open ? modelOptions().catch(() => undefined) : Promise.resolve(undefined)), [open])

  const scriptOnly = !!job && isScriptOnly(job)
  const schedule = schedToString(sched)
  const missing = !schedule && (!job || schedTouched) ? 'schedule' : !scriptOnly && !prompt.trim() ? 'prompt' : ''
  const set = (p: Partial<Sched>) => { setSchedTouched(true); setSched((s) => ({ ...s, ...p })) }

  const botOptions: Option[] = useMemo(() => [...bots].sort((a, b) => (a.isChief ? -1 : b.isChief ? 1 : a.name.localeCompare(b.name))).map((b) => ({
    value: b.profile, label: b.isChief ? 'Quicksilver' : b.name, hint: b.role?.slice(0, 36), icon: <BotFace profile={b.profile} size={20} poseKey={b.poseKey} watch={false} />,
  })), [bots])
  const modelOpts: Option[] = useMemo(() => {
    const out: Option[] = [{ value: '', label: 'The agent’s own model', hint: 'Default' }]
    for (const p of modelsQ.data?.providers ?? []) {
      if (p.authenticated === false) continue
      const off = new Set(p.unavailable_models ?? [])
      for (const m of p.models ?? []) if (!off.has(m)) out.push({ value: `${p.slug}${SEP}${m}`, label: prettyModel(m), hint: m, group: p.name })
    }
    if (model && !out.some((o) => o.value === model)) { const [pv, md] = model.split(SEP); out.push({ value: model, label: prettyModel(md), hint: pv, group: 'Set on this job' }) }
    return out
  }, [modelsQ.data, model])

  const toggleTarget = (id: string) => {
    setTouchedDeliver(true)
    // "Nowhere, just keep it" can't be combined with a place to send it.
    setDeliver((d) => (d.includes(id) ? (d.length > 1 ? d.filter((x) => x !== id) : d) : id === 'local' ? ['local'] : [...d.filter((x) => x !== 'local'), id]))
  }

  const save = async () => {
    setTried(true)
    if (missing) return
    setSaving(true); setError('')
    const [provider, mdl] = model ? model.split(SEP) : ['', '']
    const deliverStr = (deliver.length ? deliver : ['local']).join(',')
    try {
      if (!job) {
        const created = await createCron(profile, {
          name: name.trim(), prompt: prompt.trim(), schedule, deliver: deliverStr, skills: skills.length ? skills : undefined, paused,
          repeat: repeat === 'times' ? Math.max(1, Math.round(Number(times) || 1)) : undefined,
          ...(mdl ? { model: mdl, provider: provider || null } : {}),
          ...(catchUp !== 'default' ? { catch_up: catchUp === 'run' } : {}),
        })
        onSaved({ ...created, profile }, true)
      } else {
        // An untouched schedule is left alone, so opening and saving never rewrites how it's stored.
        const updates: Record<string, unknown> = { name: name.trim(), deliver: deliverStr, ...(schedTouched ? { schedule } : {}) }
        if (!scriptOnly || prompt.trim()) updates.prompt = prompt.trim()
        if (!scriptOnly) { updates.model = mdl || null; updates.provider = mdl ? provider || null : null }
        const before = [...(job.skills ?? [])].sort().join(',')
        if (skills.slice().sort().join(',') !== before) updates.skills = skills
        const wasCatch: CatchUp = job.catch_up === true ? 'run' : job.catch_up === false ? 'skip' : 'default'
        if (catchUp !== wasCatch) updates.catch_up = catchUp === 'default' ? null : catchUp === 'run'
        const wasTimes = job.repeat?.times ?? null
        const nowTimes = repeat === 'times' ? Math.max(1, Math.round(Number(times) || 1)) : null
        if ((wasTimes ?? 0) > 1 || nowTimes) { if (nowTimes !== wasTimes) updates.repeat = nowTimes ?? 'forever' }
        const updated = await updateCron(job, updates)
        onSaved({ ...updated, profile: job.profile }, false)
      }
    } catch (e) { setError(errText(e)); setSaving(false) }
  }

  const bot = bots.find((b) => b.profile === profile)
  return (
    <Dialog open={open} onClose={() => { if (!saving) onClose() }} width={600}
      title={edit ? 'Change this job' : 'New scheduled job'}
      footer={<>
        {error ? <span className="sy-err" style={{ flex: 1, minWidth: 0 }}>{error}</span> : <span className="sp" />}
        <button className="b-text" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="b-pri" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : edit ? 'Save changes' : 'Create job'}</button>
      </>}>
      <div className="sy-form">
        {edit ? (
          <div className="sy-inline"><BotFace profile={profile} size={22} poseKey={bot?.poseKey} watch={false} /><span>Runs as <b style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{bot ? (bot.isChief ? 'Quicksilver' : bot.name) : profile}</b></span></div>
        ) : (
          <Field label="Which agent runs it" hint="The job uses this agent’s skills, tools and memory.">
            <Select value={profile} options={botOptions} onChange={(p) => { setProfile(p); setTouchedDeliver(false); setSkills([]) }} width={360}
              render={(o) => <>{o?.icon}<span className="sv">{o?.label ?? 'Pick an agent'}</span></>} />
          </Field>
        )}
        <Field label="Name" optional>
          <input className="answer" value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning news" />
        </Field>
        {scriptOnly ? (
          <Field label="What it runs" hint="This job runs a script on your Mac instead of asking the agent. Change the script with Quicksilver or in the terminal.">
            <div className="sy-text sy-mono">{job?.script}</div>
          </Field>
        ) : (
          <Field label="What should it do?" bad={tried && missing === 'prompt'} hint={tried && missing === 'prompt' ? 'Say what the agent should do each time.' : 'Write it like a message to the agent. It runs on its own, so include everything it needs.'}>
            <textarea className="answer" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Summarise the top AI news from today and send me the five that matter most." />
          </Field>
        )}

        <Field label="When" bad={tried && missing === 'schedule'} hint={tried && missing === 'schedule' ? 'Pick when it should run.' : undefined}>
          <Select value={sched.preset} options={PRESETS.map((p) => ({ value: p.value, label: p.label }))} onChange={(v) => set({ preset: v as Sched['preset'] })} width={300} />
          <div className="sy-inline">
            {sched.preset === 'daily' || sched.preset === 'weekdays' ? <><span>at</span><input type="time" className="answer" value={sched.time} onChange={(e) => set({ time: e.target.value })} /></> : null}
            {sched.preset === 'weekly' ? <><span>on</span><Select value={sched.day} options={DAY_OPTIONS} onChange={(v) => set({ day: v })} width={200} /><span>at</span><input type="time" className="answer" value={sched.time} onChange={(e) => set({ time: e.target.value })} /></> : null}
            {sched.preset === 'monthly' ? <><span>on day</span><input type="number" min={1} max={28} className="answer" value={sched.dom} onChange={(e) => set({ dom: e.target.value })} /><span>at</span><input type="time" className="answer" value={sched.time} onChange={(e) => set({ time: e.target.value })} /></> : null}
            {sched.preset === 'hourly' ? <><span>at minute</span><input type="number" min={0} max={59} className="answer" value={sched.minute} onChange={(e) => set({ minute: e.target.value })} /><span>past the hour</span></> : null}
            {sched.preset === 'interval' ? <><span>every</span><input type="number" min={1} className="answer" value={sched.every} onChange={(e) => set({ every: e.target.value })} />
              <Select value={sched.unit} options={[{ value: 'm', label: 'minutes' }, { value: 'h', label: 'hours' }, { value: 'd', label: 'days' }]} onChange={(v) => set({ unit: v as Sched['unit'] })} width={160} /></> : null}
            {sched.preset === 'once' ? <><span>on</span><input type="datetime-local" className="answer" value={sched.at} onChange={(e) => set({ at: e.target.value })} /></> : null}
          </div>
          {sched.preset === 'custom' ? (
            <input className="answer mono" value={sched.text} onChange={(e) => set({ text: e.target.value })} placeholder="every monday 9am · weekdays at 18:30 · 0 9 * * 1-5 · in 2h" />
          ) : null}
          <div className="sy-summary"><Icon name="clock" size={15} /><span>{schedSummary(sched)}</span></div>
          {sched.preset === 'custom' ? <span className="sy-hint">Hermes understands “every 2h”, “every monday 9am”, “weekdays at 18:30”, “in 30m” (once), a date like 2026-12-01T09:00, or a cron line.</span> : null}
        </Field>

        <Field label="Send the result to" hint={targets.some((t) => deliver.includes(t.id) && !t.home_target_set) ? 'A platform without a home chat can’t receive it yet. Set one in Messaging.' : 'Pick one or more.'}>
          {targetsQ.loading && !targetsQ.data ? <div className="sy-inline"><Spinner size={12} />Loading places…</div> : (
            <div className="sy-chips">
              {[...targets, ...deliver.filter((d) => !targets.some((t) => t.id === d)).map((id) => ({ id, name: id, home_target_set: true }))].map((t) => (
                <button key={t.id} className={`sy-chip${deliver.includes(t.id) ? ' on' : ''}`} onClick={() => toggleTarget(t.id)} title={!t.home_target_set ? 'Needs a home chat first' : undefined}>
                  {deliver.includes(t.id) ? <Icon name="check" size={13} /> : null}<span>{targetLabel(t.id, bots, targets)}</span>{!t.home_target_set ? <i className="dot need" /> : null}
                </button>
              ))}
            </div>
          )}
        </Field>

        {!scriptOnly ? (
          <Field label="Skills to load first" optional hint="Only if the job needs a particular skill every time.">
            <SkillPicker profile={profile} value={skills} onChange={setSkills} />
          </Field>
        ) : null}

        <Fold label="More options" open={edit && (!!job?.model || (job?.repeat?.times ?? 0) > 1 || job?.catch_up != null)}>
          <div className="sy-form" style={{ paddingTop: 0 }}>
            {!scriptOnly ? (
              <Field label="Model" hint="Use a different model just for this job.">
                <Select value={model} options={modelOpts} onChange={setModel} width={380} />
              </Field>
            ) : null}
            <Field label="How many times">
              <div className="sy-inline">
                <Select value={repeat} options={[{ value: 'forever', label: 'Keep going' }, { value: 'times', label: 'A set number of times' }]} onChange={(v) => setRepeat(v as 'forever' | 'times')} width={260} />
                {repeat === 'times' ? <><input type="number" min={1} className="answer" value={times} onChange={(e) => setTimes(e.target.value)} /><span>times, then stop</span></> : null}
              </div>
            </Field>
            <Field label="If a run is missed" hint="When your Mac was asleep or Hermes wasn’t running at that time.">
              <Select value={catchUp} options={[{ value: 'default', label: 'Let Hermes decide' }, { value: 'run', label: 'Run it once when Hermes is back' }, { value: 'skip', label: 'Skip it and wait for the next time' }]} onChange={(v) => setCatchUp(v as CatchUp)} width={340} />
            </Field>
            {!edit ? (
              <label className="sy-inline" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} /> Make it paused for now
              </label>
            ) : null}
          </div>
        </Fold>
      </div>
    </Dialog>
  )
}
