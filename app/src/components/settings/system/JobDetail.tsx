// One scheduled job up close: when it runs, where the result goes, what it was told, how the last
// run went, and its past runs. Opening a run shows what the bot said that time.
import { useEffect, useMemo, useState } from 'react'
import { cronRuns, runMessages, type CronJob, type CronRun } from '../../../lib/api-system'
import { Icon } from '../../../lib/icons'
import { prettyName } from '../../../lib/hermes'
import { renderMarkdown } from '../../../lib/markdown'
import { useStore } from '../../../lib/store'
import { BotFace } from '../../BotFace'
import { Badge, Dialog, Spinner, useAsync } from '../../ui'
import { deliverWords, errorSummary, failedLast, isScriptOnly, jobState, jobTitle, overdue, repeatWords, scheduleWords } from './jobs'
import { ago, compact, duration, errText, usePoll, Warn, when } from './parts'

export interface JobActions {
  edit: (j: CronJob) => void
  run: (j: CronJob) => void
  stop: (j: CronJob) => void
  toggle: (j: CronJob) => void
  remove: (j: CronJob) => void
}

export function StateBadge({ job, starting }: { job: CronJob; starting?: boolean }) {
  const st = jobState(job)
  if (st === 'running' || starting) return <Badge tone="run"><i className="dot run" />Running now</Badge>
  if (st === 'paused') return <Badge tone="need">Paused</Badge>
  if (st === 'completed') return <Badge tone="quiet">Done</Badge>
  if (st === 'off') return <Badge tone="quiet">Off</Badge>
  if (failedLast(job)) return <Badge tone="bad">Failed last time</Badge>
  if (overdue(job)) return <Badge tone="need">Late</Badge>
  return null
}

const END_REASONS: Record<string, string> = {
  cron_complete: 'Finished', startup_orphan_reap: 'Cut short when Hermes restarted', cancelled: 'Stopped', user_stop: 'Stopped', error: 'Failed',
}

function textOf(m: { content?: any; display_content?: any; text?: string }): string {
  const c = m.display_content ?? m.content ?? m.text
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).filter(Boolean).join('\n')
  return ''
}

function RunRow({ run, job }: { run: CronRun; job: CronJob }) {
  const [open, setOpen] = useState(false)
  const output = useAsync(async () => {
    if (!open || run.source === 'cron_output' || run.id.startsWith('cron_output:')) return null
    const msgs = await runMessages(run.id, run.profile ?? job.profile)
    const said = [...msgs].reverse().find((m) => m.role === 'assistant' && textOf(m).trim())
    return said ? textOf(said) : ''
  }, [open, run.id])
  const title = run.title ?? ''
  const failed = /^(FAILED|CANCELLED|MISSED)\b/.test(title) || run.end_reason === 'error'
  const active = run.is_active && !run.ended_at
  const label = run.source === 'cron_output' ? (title.replace(/^(OK|COMPLETED) · /, '') || run.preview || 'Run') : when(run.started_at) || 'Run'
  const took = run.end_reason === 'startup_orphan_reap' ? 'cut short' : run.ended_at && run.started_at ? duration(run.ended_at - run.started_at) : ''
  const tokens = (run.input_tokens ?? 0) + (run.output_tokens ?? 0)
  return (
    <div>
      <button className="sy-run" onClick={() => setOpen(!open)} aria-expanded={open}>
        {active ? <Spinner size={12} /> : <Icon name={failed ? 'alert' : run.end_reason === 'startup_orphan_reap' ? 'info' : 'check'} size={15} />}
        <span className="tt">{label}</span>
        <span className="tm">{active ? 'running' : [took, tokens ? `${compact(tokens)} tokens` : ''].filter(Boolean).join(' · ') || ago(run.started_at)}</span>
        <Icon name={open ? 'chevD' : 'chevR'} size={14} />
      </button>
      {open ? (
        <div className="sy-run-body sy-reveal">
          <div className="sy-inline" style={{ fontSize: 12 }}>
            <span>{when(run.started_at)}</span>
            {run.end_reason ? <span>· {END_REASONS[run.end_reason] ?? run.end_reason.replace(/_/g, ' ')}</span> : null}
            {run.tool_call_count ? <span>· {run.tool_call_count} tool {run.tool_call_count === 1 ? 'call' : 'calls'}</span> : null}
            {run.model ? <span>· {run.model.split('/').pop()}</span> : null}
          </div>
          {failed && title ? <div className="sy-err">{title.replace(/^[A-Z]+ · /, '')}</div> : null}
          {run.source === 'cron_output' || run.id.startsWith('cron_output:') ? (
            run.preview ? <div className="sy-text">{run.preview}</div> : <div className="sy-note">No output was saved for this run.</div>
          ) : output.loading ? <div className="sy-inline"><Spinner size={12} />Loading what it said…</div>
            : output.error ? <div className="sy-err">Couldn’t load it: {output.error}</div>
            : output.data ? <div className="sy-out md" dangerouslySetInnerHTML={{ __html: renderMarkdown(output.data) }} />
            : <div className="sy-note">It didn’t say anything this time.</div>}
        </div>
      ) : null}
    </div>
  )
}

export function JobDetail({ job, open, onClose, actions, starting }: { job: CronJob | null; open: boolean; onClose: () => void; actions: JobActions; starting?: boolean }) {
  const bots = useStore((s) => s.bots)
  const [last, setLast] = useState<CronJob | null>(job)
  useEffect(() => { if (job) setLast(job) }, [job])
  const j = job ?? last
  const runs = useAsync(() => (open && j ? cronRuns(j) : Promise.resolve([] as CronRun[])), [open, j?.id, j?.profile])
  const st = j ? jobState(j) : 'scheduled'
  usePoll(() => void runs.reload(true), st === 'running' || starting ? 2500 : 10_000, open && !!j)
  const bot = j ? bots.find((b) => b.profile === j.profile) : undefined
  const latestErr = useMemo(() => (j?.latest_execution?.status === 'cancelled' ? (j.latest_execution.error ?? '').trim() : ''), [j])
  if (!j) return null
  const running = st === 'running' || !!starting
  const paused = st === 'paused'
  const lateBy = overdue(j) ? ago(j.next_run_at) : ''
  return (
    <Dialog open={open} onClose={onClose} width={680}
      title={<><BotFace profile={j.profile} size={26} poseKey={bot?.poseKey} mood={running ? 'writing' : paused ? 'doze' : 'idle'} watch={false} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{jobTitle(j)}</span><StateBadge job={j} starting={starting} /></>}
      footer={<>
        <button className="b-ghost-danger" onClick={() => actions.remove(j)}>Delete</button>
        <span className="sp" />
        {st !== 'completed' ? <button className="b-text" onClick={() => actions.toggle(j)}>{paused ? 'Resume' : 'Pause'}</button> : null}
        <button className="b-soft" onClick={() => actions.edit(j)}>Change</button>
        {running ? <button className="b-soft" onClick={() => actions.stop(j)}><Icon name="stop" size={13} /> Stop</button>
          : <button className="b-pri" onClick={() => actions.run(j)}>Run now</button>}
      </>}>
      {failedLast(j) && j.last_error ? (
        <Warn bad><b>The last run failed.</b> {errorSummary(j.last_error)}{j.failure_streak && j.failure_streak > 1 ? ` It has failed ${j.failure_streak} times in a row.` : ''}</Warn>
      ) : null}
      {j.last_delivery_error ? <Warn><b>The result didn’t arrive.</b> {errorSummary(j.last_delivery_error)}</Warn> : null}
      {latestErr ? <Warn><b>The last run was stopped.</b> {latestErr}</Warn> : null}
      {lateBy ? <Warn><b>This job is late.</b> It should have run {lateBy}. Hermes’ timer may have stopped; restarting Hermes in System usually fixes it.</Warn> : null}

      <div className="card">
        <dl className="sy-kv">
          <dt>Agent</dt><dd>{bot ? (bot.isChief ? 'Hermes' : bot.name) : prettyName(j.profile)}</dd>
          <dt>When</dt><dd>{scheduleWords(j)}{j.timezone ? <span className="sy-dim"> · {j.timezone}</span> : null}</dd>
          <dt>Next run</dt><dd>{paused ? `Paused${j.paused_reason ? `: ${j.paused_reason}` : ''}` : st === 'completed' ? 'Won’t run again' : j.next_run_at ? <>{when(j.next_run_at)} <span className="sy-dim">({ago(j.next_run_at)})</span></> : '—'}</dd>
          <dt>Last run</dt><dd>{j.last_run_at ? <>{when(j.last_run_at)} · {failedLast(j) ? <span className="sy-err">failed</span> : j.last_status === 'ok' ? 'went fine' : (j.last_status ?? '').replace(/_/g, ' ') || 'finished'}</> : 'Hasn’t run yet'}</dd>
          <dt>Sends the result to</dt><dd>{deliverWords(j.deliver, bots)}</dd>
          <dt>How many times</dt><dd>{repeatWords(j)}</dd>
          {j.catch_up != null ? <><dt>If a run is missed</dt><dd>{j.catch_up ? 'Runs it once when Hermes is back' : 'Skips it'}</dd></> : null}
          {j.model ? <><dt>Model</dt><dd className="sy-mono">{j.model}</dd></> : null}
          {(j.skills?.length || j.skill) ? <><dt>Skills</dt><dd className="sy-mono">{[...(j.skills ?? []), ...(j.skill ? [j.skill] : [])].join(', ')}</dd></> : null}
          {j.workdir ? <><dt>Works in</dt><dd className="sy-mono">{j.workdir}</dd></> : null}
          {j.created_at ? <><dt>Made</dt><dd>{when(j.created_at)}</dd></> : null}
        </dl>
      </div>

      <div className="ssec" style={{ marginTop: 22 }}><h2>{isScriptOnly(j) && !j.prompt ? 'What it runs' : 'What it’s asked to do'}</h2></div>
      <div className={`sy-text${isScriptOnly(j) && !j.prompt ? ' sy-mono' : ''}`}>{(isScriptOnly(j) && !j.prompt ? j.script : j.prompt) || '—'}</div>

      <div className="ssec" style={{ marginTop: 22 }}><h2>Past runs</h2>{runs.data?.length ? <span>{runs.data.length}</span> : null}<span className="sp" />
        <button className="hbtn" onClick={() => void runs.reload()} aria-label="Refresh"><Icon name="refresh" size={14} /></button>
      </div>
      <div className="card" style={{ padding: 4 }}>
        {starting ? <div className="sy-run"><Spinner size={12} /><span className="tt">Starting a run…</span><span className="tm">{when(Date.now())}</span></div> : null}
        {runs.loading && !runs.data ? <div className="sy-run"><Spinner size={12} /><span className="tt sy-dim">Loading past runs…</span></div>
          : runs.error ? <div className="sy-run"><span className="sy-err">Couldn’t load past runs: {errText(runs.error)}</span></div>
          : runs.data?.length ? <div className="sy-runs">{runs.data.map((r) => <RunRow key={r.id} run={r} job={j} />)}</div>
          : !starting ? <div className="sy-run"><span className="tt sy-dim">No runs yet. {j.next_run_at && !paused ? `The first one is ${ago(j.next_run_at)}.` : ''}</span></div> : null}
      </div>
    </Dialog>
  )
}
