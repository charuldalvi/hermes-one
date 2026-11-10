// Scheduled: every job every bot runs on its own, in one list. Each row says which bot, when in
// plain words, when it runs next and how the last run went; switch it off to pause it. Make a job
// from scratch or from a blueprint, change it, run it now, stop a run, see past runs, delete it.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { profiles as loadProfiles } from '../../lib/api'
import { allCronJobs, cronAction, deleteCron, type CronJob } from '../../lib/api-system'
import { prettyName, toast } from '../../lib/hermes'
import { Icon } from '../../lib/icons'
import { setState, useStore } from '../../lib/store'
import { BotFace } from '../BotFace'
import { confirm, Empty, ErrorLine, Popover, Search, Select, Spinner, Switch, Tabs, useAsync, type Option } from '../ui'
import { BlueprintGallery } from './system/Blueprints'
import { JobDetail, StateBadge, type JobActions } from './system/JobDetail'
import { JobEditor } from './system/JobEditor'
import { errorSummary, failedLast, isRunning, isScriptOnly, jobKey, jobState, jobTitle, overdue, scheduleWords } from './system/jobs'
import { ago, errText, isTimeout, ms, usePoll, Warn, when } from './system/parts'

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
type Filter = 'all' | 'on' | 'paused' | 'failed'

function JobRow({ job, starting, busy, actions, onOpen }: { job: CronJob; starting: boolean; busy: boolean; actions: JobActions; onOpen: () => void }) {
  const bots = useStore((s) => s.bots)
  const [menu, setMenu] = useState(false)
  const dots = useRef<HTMLButtonElement>(null)
  const bot = bots.find((b) => b.profile === job.profile)
  const st = jobState(job)
  const running = st === 'running' || starting
  const failed = failedLast(job)
  const next = st === 'paused' ? (job.paused_reason ? `paused: ${job.paused_reason}` : 'paused') : st === 'completed' ? (job.last_run_at ? `ran ${when(job.last_run_at)}` : 'done') : job.next_run_at ? (overdue(job) ? `was due ${ago(job.next_run_at)}` : `next ${when(job.next_run_at)}`) : ''
  return (
    <div className="srow click" onClick={onOpen}>
      <BotFace profile={job.profile} size={30} poseKey={bot?.poseKey} mood={running ? 'writing' : st === 'paused' || st === 'completed' ? 'doze' : failed ? 'hand' : 'idle'} watch={false} />
      <div className="tx">
        <div className="t1"><span>{jobTitle(job)}</span><StateBadge job={job} starting={starting} />{isScriptOnly(job) ? <span className="badge quiet">Script</span> : null}</div>
        <div className="t2">{bot ? (bot.isChief ? 'Hermes' : bot.name) : prettyName(job.profile)} · {scheduleWords(job)}{next ? ` · ${next}` : ''}</div>
        {failed && job.last_error ? <div className="sy-err" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={job.last_error}>{errorSummary(job.last_error)}</div>
          : job.last_delivery_error ? <div className="sy-err" title={job.last_delivery_error}>The result didn’t arrive: {errorSummary(job.last_delivery_error)}</div>
          : job.last_run_at && st !== 'completed' ? <div className="t3" style={{ fontFamily: 'inherit' }}>Last ran {ago(job.last_run_at)}{job.last_status === 'ok' ? ', went fine' : ''}</div> : null}
      </div>
      <div className="act" onClick={(e) => e.stopPropagation()}>
        {busy ? <Spinner size={13} /> : null}
        {running ? <button className="hbtn" title="Stop this run" aria-label="Stop" onClick={() => actions.stop(job)}><Icon name="stop" size={15} /></button>
          : st !== 'completed' ? <button className="hbtn" title="Run now" aria-label="Run now" onClick={() => actions.run(job)}><Icon name="play" size={15} /></button> : null}
        {st !== 'completed' ? <Switch on={st !== 'paused' && st !== 'off'} onChange={() => actions.toggle(job)} label={st === 'paused' ? 'Resume' : 'Pause'} disabled={busy} /> : null}
        <button ref={dots} className="hbtn" aria-label="More" onClick={() => setMenu(!menu)}><Icon name="dots" size={16} /></button>
        <Popover anchor={dots.current} open={menu} onClose={() => setMenu(false)} width={210} align="end">
          <button className="mi" onClick={() => { setMenu(false); onOpen() }}><Icon name="clock" size={15} /><span className="ml">Past runs and details</span></button>
          <button className="mi" onClick={() => { setMenu(false); actions.edit(job) }}><Icon name="edit" size={15} /><span className="ml">Change</span></button>
          {st !== 'completed' ? <button className="mi" onClick={() => { setMenu(false); actions.run(job) }}><Icon name="play" size={15} /><span className="ml">Run now</span></button> : null}
          {st !== 'completed' ? <button className="mi" onClick={() => { setMenu(false); actions.toggle(job) }}><Icon name={st === 'paused' ? 'play' : 'pause'} size={15} /><span className="ml">{st === 'paused' ? 'Resume' : 'Pause'}</span></button> : null}
          <button className="mi" onClick={() => { setMenu(false); actions.remove(job) }}><Icon name="trash" size={15} /><span className="ml" style={{ color: 'var(--tint-red)' }}>Delete</span></button>
        </Popover>
      </div>
    </div>
  )
}

export function ScheduledPage({ profile }: { profile: string }) {
  void profile // always Chief here: the page lists every bot's jobs and makes jobs for any of them
  const bots = useStore((s) => s.bots)
  const [fallback, setFallback] = useState<string[]>([])
  useEffect(() => { if (!bots.length) loadProfiles().then((ps) => setFallback(ps.map((p) => p.name))).catch(() => setFallback(['default'])) }, [bots.length])
  const names = bots.length ? bots.map((b) => b.profile) : fallback
  const namesKey = [...names].sort().join(',')
  const { data, error, loading, reload, setData } = useAsync(() => (names.length ? allCronJobs(names) : new Promise<never>(() => {})), [namesKey])

  const [filter, setFilter] = useState<Filter>('all')
  const [botFilter, setBotFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [starting, setStarting] = useState<Record<string, number>>({})
  const [editor, setEditor] = useState<{ open: boolean; job?: CronJob | null }>({ open: false })
  const [gallery, setGallery] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const jobs = data?.jobs ?? []
  const anyLive = jobs.some(isRunning) || Object.keys(starting).length > 0
  usePoll(() => void reload(true), anyLive ? 2500 : 12_000, !!data)

  const patchJob = useCallback((key: string, p: Partial<CronJob> | null) => setData((d) => (d ? { ...d, jobs: p === null ? d.jobs.filter((j) => jobKey(j) !== key) : d.jobs.map((j) => (jobKey(j) === key ? { ...j, ...p } : j)) } : d)), [setData])
  const setBusyKey = (key: string, on: boolean) => setBusy((b) => { const n = { ...b }; if (on) n[key] = true; else delete n[key]; return n })

  const actions: JobActions = useMemo(() => ({
    edit: (j) => setEditor({ open: true, job: j }),
    toggle: async (j) => {
      const key = jobKey(j)
      const pausing = jobState(j) !== 'paused'
      const before = { state: j.state, enabled: j.enabled }
      patchJob(key, pausing ? { state: 'paused', enabled: false } : { state: 'scheduled', enabled: true })
      setBusyKey(key, true)
      try {
        const updated = await cronAction(j, pausing ? 'pause' : 'resume')
        if (updated && typeof updated === 'object' && updated.id) patchJob(key, { ...updated, profile: j.profile })
        toast(pausing ? `Paused “${jobTitle(j)}”` : `“${jobTitle(j)}” is on again`)
      } catch (e) { patchJob(key, before); toast(`Couldn’t ${pausing ? 'pause' : 'resume'} it: ${errText(e)}`) } finally { setBusyKey(key, false) }
    },
    run: async (j) => {
      const key = jobKey(j)
      if (starting[key]) return
      setStarting((s) => ({ ...s, [key]: Date.now() }))
      toast(`Running “${jobTitle(j)}” now`)
      window.setTimeout(() => void reload(true), 1500)
      try {
        const after = await cronAction(j, 'trigger')
        toast(after?.last_status === 'error' ? `“${jobTitle(j)}” failed: ${errorSummary(after.last_error) || 'see its past runs'}` : `“${jobTitle(j)}” finished`)
      } catch (e) {
        toast(isTimeout(e) ? `“${jobTitle(j)}” is still running. Its result will arrive as usual.` : /already running|claimed/i.test(errText(e)) ? 'It’s already running.' : `Couldn’t run it: ${errText(e)}`)
      } finally {
        setStarting((s) => { const n = { ...s }; delete n[key]; return n })
        void reload(true)
      }
    },
    stop: async (j) => {
      const key = jobKey(j)
      setBusyKey(key, true)
      try {
        const r = await cronAction(j, 'cancel')
        toast(r?.cancelled === false ? 'Nothing was running.' : `Stopping “${jobTitle(j)}”…`)
        window.setTimeout(() => void reload(true), 2000)
      } catch (e) { toast(`Couldn’t stop it: ${errText(e)}`) } finally { setBusyKey(key, false) }
    },
    remove: async (j) => {
      const ok = await confirm({ title: `Delete “${jobTitle(j)}”?`, body: 'It won’t run again. What it already sent stays in your chats.', action: 'Delete', danger: true })
      if (!ok) return
      const key = jobKey(j)
      setOpenKey((k) => (k === key ? null : k))
      patchJob(key, null)
      try { await deleteCron(j); toast(`Deleted “${jobTitle(j)}”`) } catch (e) { toast(`Couldn’t delete it: ${errText(e)}`); void reload(true) }
    },
  }), [patchJob, reload, starting])

  const counts = useMemo(() => ({
    all: jobs.length,
    on: jobs.filter((j) => ['scheduled', 'running'].includes(jobState(j))).length,
    paused: jobs.filter((j) => jobState(j) === 'paused').length,
    failed: jobs.filter((j) => failedLast(j) && jobState(j) !== 'completed').length,
  }), [jobs])
  const shown = useMemo(() => {
    const t = query.trim().toLowerCase()
    return jobs.filter((j) => {
      const st = jobState(j)
      if (filter === 'on' && !['scheduled', 'running'].includes(st)) return false
      if (filter === 'paused' && st !== 'paused') return false
      if (filter === 'failed' && !(failedLast(j) && st !== 'completed')) return false
      if (botFilter !== 'all' && j.profile !== botFilter) return false
      if (!t) return true
      const bot = bots.find((b) => b.profile === j.profile)
      return `${jobTitle(j)} ${j.prompt ?? ''} ${scheduleWords(j)} ${bot?.name ?? j.profile}`.toLowerCase().includes(t)
    })
  }, [jobs, filter, botFilter, query, bots])
  const sections = useMemo(() => {
    const soon = (j: CronJob) => (isRunning(j) ? -Infinity : Number.isNaN(ms(j.next_run_at)) ? Infinity : ms(j.next_run_at))
    const active = shown.filter((j) => ['scheduled', 'running', 'off'].includes(jobState(j))).sort((a, b) => soon(a) - soon(b))
    const paused = shown.filter((j) => jobState(j) === 'paused').sort((a, b) => jobTitle(a).localeCompare(jobTitle(b)))
    const done = shown.filter((j) => jobState(j) === 'completed').sort((a, b) => (ms(b.last_run_at) || 0) - (ms(a.last_run_at) || 0))
    return [
      { key: 'active', title: 'Coming up', items: active },
      { key: 'paused', title: 'Paused', items: paused },
      { key: 'done', title: 'Finished', hint: 'One-time jobs that already ran', items: done },
    ].filter((s) => s.items.length)
  }, [shown])

  const botsWithJobs = new Set(jobs.map((j) => j.profile))
  const botOptions: Option[] = [{ value: 'all', label: 'All agents' }, ...[...bots].sort((a, b) => (a.isChief ? -1 : b.isChief ? 1 : a.name.localeCompare(b.name))).filter((b) => botsWithJobs.has(b.profile)).map((b) => ({
    value: b.profile, label: b.isChief ? 'Hermes' : b.name, icon: <BotFace profile={b.profile} size={20} poseKey={b.poseKey} watch={false} />, hint: String(jobs.filter((j) => j.profile === b.profile).length),
  }))]
  const late = jobs.filter(overdue)
  const openJob = openKey ? jobs.find((j) => jobKey(j) === openKey) ?? null : null
  const failedBots = data?.failed ?? []
  const nBots = botsWithJobs.size

  return (
    <>
      <div className="shead">
        <div className="tx">
          <h1>Scheduled</h1>
          <p>{data && jobs.length ? `Jobs your agents run on their own. ${counts.on} on${counts.paused ? `, ${counts.paused} paused` : ''}, across ${nBots} ${nBots === 1 ? 'agent' : 'agents'}.` : 'Jobs your agents run on their own, like a news digest every morning or a weekly review.'}</p>
        </div>
        <button className="b-soft" onClick={() => setGallery(true)}>From a blueprint</button>
        <button className="b-pri" onClick={() => setEditor({ open: true, job: null })}>New job</button>
      </div>

      {late.length ? (
        <Warn action={<button className="b-text" onClick={() => setState({ view: 'settings', settingsPage: 'system' })}>Open System</button>}>
          <b>{late.length === 1 ? `“${jobTitle(late[0])}” is late.` : `${late.length} jobs are late.`}</b> Hermes’ timer may have stopped. Restarting Hermes usually fixes it.
        </Warn>
      ) : null}
      {failedBots.length ? <ErrorLine text={`Couldn’t load the jobs of ${failedBots.map((p) => bots.find((b) => b.profile === p)?.name ?? prettyName(p)).join(', ')}.`} onRetry={() => void reload()} /> : null}
      {error ? <ErrorLine text={`Couldn’t load scheduled jobs: ${error}`} onRetry={() => void reload()} /> : null}

      {jobs.length ? (
        <div className="stools">
          <Search value={query} onChange={setQuery} placeholder="Search jobs" />
          <Tabs<Filter> value={filter} onChange={setFilter} items={[
            { key: 'all', label: 'All', count: counts.all }, { key: 'on', label: 'On', count: counts.on },
            ...(counts.paused ? [{ key: 'paused' as Filter, label: 'Paused', count: counts.paused }] : []),
            ...(counts.failed ? [{ key: 'failed' as Filter, label: 'Failed', count: counts.failed }] : []),
          ]} />
          {botOptions.length > 2 ? <Select value={botFilter} options={botOptions} onChange={setBotFilter} width={260} align="end" /> : null}
        </div>
      ) : null}

      {loading && !data ? <div className="empty"><Spinner size={18} /><span>Looking at every agent’s jobs…</span></div>
        : data && !jobs.length ? <Empty title="No scheduled jobs yet" body="Make one here, start from a blueprint, or just ask Hermes, like “every morning at 8, tell me the weather”." />
        : data && !shown.length ? <div className="empty"><b>Nothing matches</b><span>Try another search or filter.</span></div>
        : sections.map((s, i) => (
          <Fragment key={s.key}>
            <div className="ssec" style={i === 0 ? { marginTop: 6 } : undefined}><h2>{s.title}</h2><span>{s.hint ?? s.items.length}</span></div>
            <div className="card flow">
              {s.items.map((j) => (
                <JobRow key={jobKey(j)} job={j} starting={!!starting[jobKey(j)]} busy={!!busy[jobKey(j)]} actions={actions} onOpen={() => setOpenKey(jobKey(j))} />
              ))}
            </div>
          </Fragment>
        ))}

      <JobDetail job={openJob} open={!!openJob} onClose={() => setOpenKey(null)} actions={actions} starting={openJob ? !!starting[jobKey(openJob)] : false} />
      <JobEditor open={editor.open} job={editor.job} initialProfile={botFilter !== 'all' ? botFilter : 'default'} onClose={() => setEditor({ open: false, job: editor.job })}
        onSaved={(job, created) => {
          setEditor({ open: false, job: editor.job })
          toast(created ? `Scheduled “${jobTitle(job)}”: ${lowerFirst(scheduleWords(job))}` : `Saved “${jobTitle(job)}”`)
          if (!created) patchJob(jobKey(job), job)
          void reload(true)
        }} />
      <BlueprintGallery open={gallery} onClose={() => setGallery(false)} initialProfile={botFilter !== 'all' ? botFilter : 'default'}
        onCreated={(job) => { setGallery(false); toast(`Scheduled “${jobTitle(job)}”${job.schedule_display ? `: ${lowerFirst(scheduleWords(job))}` : ''}`); void reload(true) }} />
    </>
  )
}
