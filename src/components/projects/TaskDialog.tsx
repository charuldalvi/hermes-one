// One task, opened: what it's waiting on, what the bot said, the brief, notes back and forth, every
// attempt and its history. The decision sits under the work (rule 7: nothing approved unseen), in the
// same words as Hermes Remote's Check it screen: Looks good / Change, Answer, Start / Not needed, Try again.
import { useEffect, useMemo, useRef, useState } from 'react'
import * as kb from '../../lib/api-kanban'
import { toast } from '../../lib/hermes'
import { Icon } from '../../lib/icons'
import type { Bot } from '../../lib/store'
import { openPanel } from '../Sidebar'
import { Badge, confirm, Dialog, ErrorLine, Select, Spinner, useAsync, type Option } from '../ui'
import { assigneeOptions } from './dialogs'
import { botName, Face, Md, StateLine, type CTask } from './parts'

export interface TaskActs {
  move: (id: string, to: string, quiet?: boolean) => Promise<boolean>
  start: (id: string, quiet?: boolean) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  refresh: () => void
}

type NoteMode = 'note' | 'change' | 'answer'

export function TaskDialog({ id, slug, base, eventId, wf, bots, assignees, acts, onClose }: {
  id: string | null; slug: string; base?: CTask; eventId: number; wf: kb.KWorkflow; bots: Bot[]; assignees: string[]; acts: TaskActs; onClose: () => void
}) {
  // The task stays on screen while the dialog plays its exit.
  const last = useRef<{ id: string; base?: CTask } | null>(null)
  if (id) last.current = { id, base: base ?? (last.current?.id === id ? last.current.base : undefined) }
  const shown = last.current
  return (
    <Dialog open={!!id} onClose={onClose} wide width={880}
      title={shown ? <TaskTitle base={shown.base} /> : undefined}
      footer={undefined}>
      {shown ? <TaskBody key={`${slug}:${shown.id}`} id={shown.id} slug={slug} base={shown.base} eventId={eventId} wf={wf} bots={bots} assignees={assignees} acts={acts} onClose={onClose} /> : null}
    </Dialog>
  )
}

function TaskTitle({ base }: { base?: CTask }) {
  return <><Icon name="list" /><span className="pj-dt">{base ? kb.columnLabel(base.t.status) : 'Task'}</span></>
}

function TaskBody({ id, slug, base, eventId, wf, bots, assignees, acts, onClose }: {
  id: string; slug: string; base?: CTask; eventId: number; wf: kb.KWorkflow; bots: Bot[]; assignees: string[]; acts: TaskActs; onClose: () => void
}) {
  const detail = useAsync(() => kb.task(slug, id), [slug, id])
  // Live: whenever the board moves on, read the task again (quietly, no spinner).
  const seen = useRef(eventId)
  useEffect(() => { if (eventId !== seen.current) { seen.current = eventId; void detail.reload(true) } }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps

  const d = detail.data
  const t: kb.KTask | undefined = d?.task ?? base?.t
  const parents = useMemo(() => (d?.links.parents ?? []).map((pid) => d?.link_tasks?.find((l) => l.id === pid) ?? { id: pid, title: pid, status: 'done' }), [d])
  const children = d?.child_results ?? []
  const reason = kb.blockReason(d?.events)
  const w: kb.Work | undefined = t ? (d ? kb.classify(t, { parents, reason }) : base?.w ?? kb.classify(t)) : undefined

  const [busy, setBusy] = useState<string | null>(null)
  const [mode, setMode] = useState<NoteMode>('note')
  const [note, setNote] = useState('')
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const [editing, setEditing] = useState(false)
  const [eTitle, setETitle] = useState('')
  const [eBody, setEBody] = useState('')
  const [fullBrief, setFullBrief] = useState(false)
  const [fold, setFold] = useState<Record<string, boolean>>({})
  const [log, setLog] = useState<{ text: string; loading: boolean; error?: string } | null>(null)

  if (!t || !w) {
    return detail.error ? <ErrorLine text={detail.error} onRetry={() => void detail.reload()} /> : <div className="pj-loading"><Spinner size={18} /></div>
  }

  const who = botName(t.assignee, bots)
  const whoFor = t.assignee ? who : 'the agents'
  const isBot = !!t.assignee && bots.some((b) => b.profile === t.assignee)
  const running = t.status === 'running'
  const summary = d?.task.latest_summary ?? t.latest_summary
  const ask = w.kind === 'yours' ? w.reason : w.kind === 'stuck' ? w.reason : undefined
  const after = parents.filter((p) => p.status !== 'done' && p.status !== 'archived')
  const moves = kb.movesFrom(wf, t.status)

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try { await fn(); void detail.reload(true); acts.refresh() } catch (e: any) { toast(`Couldn’t do that: ${e?.message ?? e}`) } finally { setBusy(null) }
  }
  const focusNote = (m: NoteMode) => { setMode(m); setTimeout(() => { noteRef.current?.focus(); noteRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, 0) }

  const sendNote = () => {
    const text = note.trim()
    if (!text) return
    void run('note', async () => {
      await kb.addComment(slug, id, text)
      setNote('')
      if (mode === 'change' || mode === 'answer') {
        // The note first, then back in the queue with a nudge, so the bot reads it as it starts again.
        if (t.status !== 'ready' && !(await acts.move(id, 'ready', true))) return
        await acts.start(id, true)
        toast(mode === 'change' ? `Sent back to ${whoFor}` : `Sent to ${whoFor}`)
        setMode('note')
      } else toast(running ? `Sent. ${who} reads it within a few seconds.` : 'Note added')
    })
  }

  const setAssignee = async (p: string) => {
    if (p === (t.assignee ?? '')) return
    const to = p ? botName(p, bots) : 'anyone'
    if (running) {
      const ok = await confirm({ title: `Hand it to ${to}?`, body: `${who} is working on it right now. Handing it over stops that work, and it starts again for ${to}.`, action: 'Hand it over' })
      if (!ok) return
    }
    void run('who', async () => {
      if (running) await kb.reclaim(slug, id, `handed to ${p || 'anyone'} from Hermes One`)
      await kb.patchTask(slug, id, { assignee: p })
      toast(p ? `Handed to ${to}` : 'No one assigned now')
    })
  }

  const saveEdit = () => {
    const title = eTitle.trim()
    if (!title) return
    void run('edit', async () => {
      await kb.patchTask(slug, id, { ...(title !== t.title ? { title } : {}), ...(eBody !== (t.body ?? '') ? { body: eBody } : {}) })
      setEditing(false)
    })
  }

  const openLog = async () => {
    setLog({ text: '', loading: true })
    try { const r = await kb.taskLog(slug, id); setLog({ text: r.exists ? r.content : '', loading: false }) } catch (e: any) { setLog({ text: '', loading: false, error: e?.message ?? String(e) }) }
  }

  const statusOptions: Option[] = [
    { value: t.status, label: kb.columnLabel(t.status), hint: 'Now' },
    ...moves.map((k) => ({ value: k, label: kb.columnLabel(k), hint: kb.COLUMN_WORDS[k]?.help.split('.')[0] })),
    ...(t.status !== 'archived' ? [{ value: 'archived', label: 'Put away', hint: 'Off the board' }] : []),
  ]
  const priorityOptions: Option[] = [...kb.PRIORITIES.map((p) => ({ value: String(p.value), label: p.label })),
    ...(t.priority && !kb.PRIORITIES.some((p) => p.value === t.priority) ? [{ value: String(t.priority), label: kb.priorityLabel(t.priority) }] : [])]
  const people = assigneeOptions(bots, [...assignees, ...(t.assignee ? [t.assignee] : [])])

  // The footer: the one decision this task asks for, in Hermes Remote's words.
  const B = (key: string, label: string, fn: () => void, cls = 'b-soft') => (
    <button key={key} className={`${cls} pj-btn`} disabled={!!busy} onClick={fn}>{busy === key ? <Spinner size={12} /> : null}{label}</button>
  )
  let actions: React.ReactNode[] = []
  if (w.kind === 'yours' && w.ask === 'check') actions = [B('change', 'Change', () => focusNote('change')), B('good', 'Looks good', () => void run('good', async () => { if (await acts.move(id, 'done', true)) toast('Marked done') }), 'b-pri')]
  else if (w.kind === 'yours' && w.ask === 'answer') actions = [B('answer', `Answer ${whoFor}`, () => focusNote('answer'), 'b-pri')]
  else if (w.kind === 'yours' && w.ask === 'start') actions = [B('away', 'Not needed', () => void run('away', async () => { if (await acts.move(id, 'archived', true)) toast('Put away') })), B('start', 'Start', () => void run('start', () => acts.start(id)), 'b-pri')]
  else if (w.kind === 'stuck') actions = [B('note', 'Add a note', () => focusNote('note')), B('retry', 'Try again', () => void run('retry', () => acts.start(id)), 'b-pri')]
  else if (w.kind === 'working') actions = [B('stop', 'Stop', () => void (async () => {
    const ok = await confirm({ title: `Stop ${who}?`, body: 'The work so far is kept with the task. It goes back to Up next, and starts again on the next minute unless you move it.', action: 'Stop', danger: true })
    if (ok) void run('stop', async () => { await kb.reclaim(slug, id, 'stopped from Hermes One'); toast(`Stopped ${who}`) })
  })()), B('msg', `Message ${who}`, () => focusNote('note'))]
  else if (w.kind === 'coming') actions = [B('start', 'Start now', () => void run('start', () => acts.start(id)), 'b-pri')]
  else if (w.kind === 'done' || w.kind === 'away') actions = [B('reopen', 'Do it again', () => void run('reopen', async () => { if (await acts.move(id, 'ready', true)) toast('Back in Up next') }))]

  const notePlaceholder = mode === 'change' ? 'What should change? e.g. Make the intro shorter' : mode === 'answer' ? `Your answer for ${whoFor}` : running ? `Message ${who}…` : 'Add a note…'
  const noteAction = mode === 'change' ? `Send back to ${whoFor}` : mode === 'answer' ? `Send to ${whoFor}` : running ? 'Send' : 'Add note'
  const comments = d?.comments ?? []
  const runs = d?.runs ?? []
  const events = d?.events ?? []
  const body = t.body ?? ''

  return (
    <div className="pj-det">
      <div className="pj-main">
        {editing ? (
          <div className="form pj-edit">
            <input className="answer pj-etitle" value={eTitle} onChange={(e) => setETitle(e.target.value)} autoFocus />
            <textarea className="answer" rows={8} value={eBody} placeholder="The brief. Markdown works." onChange={(e) => setEBody(e.target.value)} />
            <div className="pj-row"><span className="sp" /><button className="b-text" onClick={() => setEditing(false)}>Cancel</button>{B('edit', 'Save', saveEdit)}</div>
          </div>
        ) : (
          <>
            <h2 className="pj-title">{t.title}</h2>
            <div className="pj-byline">
              <Face profile={t.assignee} bots={bots} size={22} mood={w.kind === 'working' ? 'thinking' : undefined} />
              <span>{(w.kind === 'coming' || (w.kind === 'yours' && w.ask === 'start') ? 'For ' : 'From ') + (t.assignee ? who : 'anyone')}</span>
              <span className="sl">·</span><span>{kb.agoLong(t.completed_at ?? t.current_run_started_at ?? t.started_at ?? t.created_at)}</span>
              <StateLine w={w}>{w.kind === 'working' ? <span className="tm">{kb.span(w.since)}</span> : null}</StateLine>
            </div>
          </>
        )}
        {detail.error ? <ErrorLine text={detail.error} onRetry={() => void detail.reload()} /> : null}

        {ask ? <Note tone={w.kind === 'stuck' ? 'bad' : 'need'} label={w.kind === 'stuck' ? `What stopped ${whoFor}` : `${who} asks`}><p>{ask}</p></Note> : null}
        {w.kind === 'yours' && w.ask === 'start' && !ask ? <Note tone="need" label="Waiting for your go-ahead"><p>Nothing runs until you start it.</p></Note> : null}
        {t.status === 'ready' && !t.assignee ? <Note tone="quiet" label="No one picked yet"><p>Hermes hands it to the default agent on its next round, or pick who does it on the right.</p></Note> : null}
        {d?.task.diagnostics?.length ? (
          <Note tone={d.task.diagnostics.some((x) => x.severity !== 'warning') ? 'bad' : 'need'} label="Hermes noticed">
            {d.task.diagnostics.map((x, i) => <p key={i}><b>{x.title}</b>{x.detail ? ` ${x.detail}` : ''}</p>)}
          </Note>
        ) : null}
        {summary ? <Note label={`What ${t.assignee ? who : 'the agent'} says`}><Md text={summary} /></Note> : null}
        {d?.task.result && d.task.result.trim() !== summary?.trim() ? <Note label="The result"><Md text={d.task.result} /></Note> : null}
        {after.length ? (
          <Note label="Waits for">
            <ul className="pj-links">{after.map((p) => <li key={p.id}><span className="tt">{kb.shortTitle(p.title)}</span><span className="pj-mi">{kb.columnLabel(p.status)}</span></li>)}</ul>
          </Note>
        ) : null}

        {!editing ? (
          <section className="pj-sec">
            <div className="pj-sech"><span>The brief</span><span className="sp" />
              <button className="b-text sm" onClick={() => { setETitle(t.title); setEBody(body); setEditing(true) }}><Icon name="edit" size={13} />Edit</button>
            </div>
            {body.trim() ? (
              <>
                <Md text={fullBrief || body.length <= 1400 ? body : body.slice(0, 1400) + '…'} className="pj-md" />
                {body.length > 1400 && !fullBrief ? <button className="b-text sm" onClick={() => setFullBrief(true)}>Show all</button> : null}
              </>
            ) : <p className="pj-quiet">No details yet.</p>}
          </section>
        ) : null}

        {children.length ? (
          <section className="pj-sec">
            <div className="pj-sech"><span>Steps</span><em>{children.filter((c) => c.status === 'done').length} of {children.length} done</em></div>
            <div className="pj-steps">
              {children.map((c) => (
                <div key={c.id} className="pj-step">
                  <i className={`dot ${c.status === 'done' ? 'ok' : c.status === 'running' ? 'run' : c.status === 'blocked' || c.status === 'review' ? 'need' : 'off'}`} />
                  <span className="tt">{c.title}</span><span className="pj-mi">{kb.columnLabel(c.status)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="pj-sec">
          <div className="pj-sech"><span>Notes</span>{comments.length ? <em>{comments.length}</em> : null}</div>
          {comments.length ? (
            <div className="pj-thread">
              {comments.map((c) => (
                <div key={c.id} className={`pj-cmt${kb.isYou(c.author) ? ' pj-mine' : ''}`}>
                  <div className="pj-cmth">
                    {kb.isYou(c.author) ? <span className="pj-you">You</span> : <><Face profile={c.author} bots={bots} size={18} /><span>{botName(c.author, bots)}</span></>}
                    <span className="tm">{kb.agoLong(c.created_at)}</span>
                  </div>
                  <Md text={c.body} className="pj-md sm" />
                </div>
              ))}
            </div>
          ) : null}
          <div className={`pj-compose${mode !== 'note' ? ' pj-asking' : ''}`}>
            {mode !== 'note' ? <div className="pj-mode"><span>{mode === 'change' ? 'Tell ' + whoFor + ' what to change' : 'Answer ' + whoFor}</span><button className="b-text sm" onClick={() => setMode('note')}>Just a note</button></div> : null}
            <textarea ref={noteRef} className="answer" rows={3} value={note} placeholder={notePlaceholder} onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendNote() } }} />
            <div className="pj-row">
              <span className="pj-hint">{running && mode === 'note' ? `${who} reads it within a few seconds.` : mode === 'note' ? 'The agent reads notes when it picks this up.' : 'It goes back to Up next with your note.'}</span>
              <span className="sp" />
              <button className="b-soft pj-btn" disabled={!note.trim() || !!busy} onClick={sendNote}>{busy === 'note' ? <Spinner size={12} /> : null}{noteAction}</button>
            </div>
          </div>
        </section>

        {runs.length ? (
          <Fold label="Attempts" count={runs.length} open={!!fold.runs} onToggle={() => setFold({ ...fold, runs: !fold.runs })}>
            {runs.map((r, i) => {
              const rw = kb.runWords(r)
              return (
                <div key={r.id} className="pj-run">
                  <div className="pj-runh">
                    <Face profile={r.profile} bots={bots} size={18} />
                    <span>{r.profile ? botName(r.profile, bots) : 'An agent'}</span><span className="sl">·</span><span className="pj-quiet">Attempt {i + 1}</span>
                    <span className="sp" />
                    <Badge tone={rw.tone === 'quiet' ? undefined : rw.tone}>{rw.text}</Badge>
                    <span className="tm">{kb.when(r.started_at)}{r.started_at ? ` · ${kb.span(r.started_at, r.ended_at)}` : ''}</span>
                  </div>
                  {r.summary ? <Md text={r.summary.length > 1600 ? r.summary.slice(0, 1600) + '…' : r.summary} className="pj-md sm" /> : null}
                  {r.error ? <div className="pj-err">{r.error}</div> : null}
                </div>
              )
            })}
          </Fold>
        ) : null}
        {events.length ? (
          <Fold label="History" count={events.length} open={!!fold.events} onToggle={() => setFold({ ...fold, events: !fold.events })}>
            <div className="pj-hist">
              {[...events].reverse().map((e) => {
                const ew = kb.eventWords(e)
                return <div key={e.id} className="pj-ev"><span className="tm">{kb.when(e.created_at)}</span><span className="tx">{ew.text}{ew.detail ? <em> · {ew.detail}</em> : null}</span></div>
              })}
            </div>
          </Fold>
        ) : null}
        {runs.length ? (
          <Fold label="Raw log" open={!!fold.log} onToggle={() => { const o = !fold.log; setFold({ ...fold, log: o }); if (o && !log) void openLog() }}>
            {log?.loading ? <Spinner /> : log?.error ? <ErrorLine text={log.error} onRetry={() => void openLog()} /> : log?.text ? <pre className="pj-log">{log.text}</pre> : <p className="pj-quiet">Nothing was written.</p>}
            {log && !log.loading ? <button className="b-text sm" onClick={() => void openLog()}><Icon name="refresh" size={13} />Read again</button> : null}
          </Fold>
        ) : null}
      </div>

      <aside className="pj-side">
        <label className="pj-field"><span>Who does it</span>
          <Select value={t.assignee ?? ''} options={people} onChange={(v) => void setAssignee(v)} width={300} align="end" disabled={!!busy}
            render={(o) => <>{o?.icon ?? <Face profile={t.assignee} bots={bots} size={20} />}<span className="sv">{o?.label ?? who}</span></>} />
        </label>
        <label className="pj-field"><span>Where it is</span>
          <Select value={t.status} options={statusOptions} onChange={(v) => void run('move', async () => { await acts.move(id, v) })} width={300} align="end" disabled={!!busy} />
        </label>
        <label className="pj-field"><span>How urgent</span>
          <Select value={String(t.priority ?? 0)} options={priorityOptions} onChange={(v) => void run('prio', () => kb.patchTask(slug, id, { priority: Number(v) }))} width={220} align="end" disabled={!!busy} />
        </label>
        <dl className="pj-facts">
          <dt>Added</dt><dd title={kb.when(t.created_at)}>{kb.agoLong(t.created_at)}{t.created_by ? ` by ${kb.isYou(t.created_by) ? 'you' : botName(t.created_by, bots)}` : ''}</dd>
          {t.started_at ? <><dt>Started</dt><dd title={kb.when(t.started_at)}>{kb.agoLong(t.started_at)}</dd></> : null}
          {t.completed_at ? <><dt>Finished</dt><dd title={kb.when(t.completed_at)}>{kb.agoLong(t.completed_at)}</dd></> : null}
          {t.tenant ? <><dt>Tag</dt><dd>{t.tenant}</dd></> : null}
          {t.skills?.length ? <><dt>Skills</dt><dd>{t.skills.join(', ')}</dd></> : null}
          {t.model_override ? <><dt>Model</dt><dd>{t.model_override.split('/').pop()}{t.reasoning_effort ? ` · ${t.reasoning_effort}` : ''}</dd></> : null}
          {t.consecutive_failures ? <><dt>Failed tries</dt><dd>{t.consecutive_failures}</dd></> : null}
          {t.workspace_path ? <><dt>Folder</dt><dd><button className="lnk" onClick={() => void window.hermesNative.reveal(t.workspace_path!)}>{t.workspace_path.split('/').pop()}</button></dd></> : null}
          <dt>Id</dt><dd><button className="lnk" title="Copy" onClick={() => { void navigator.clipboard.writeText(t.id); toast('Copied') }}>{t.id}</button></dd>
        </dl>
        {d?.attachments?.length ? (
          <div className="pj-files">
            <span className="pj-flab">Files</span>
            {d.attachments.map((a) => (
              <button key={a.id} className="src" title={a.stored_path ?? a.filename} onClick={() => { if (a.stored_path) void (window.hermesNative.openPath?.(a.stored_path) ?? window.hermesNative.reveal(a.stored_path)) }}>
                <Icon name={a.content_type?.startsWith('image/') ? 'image' : 'file'} size={13} />{a.filename}
              </button>
            ))}
          </div>
        ) : null}
        <div className="pj-sidelinks">
          {isBot && t.assignee ? <button className="b-text sm" onClick={() => { onClose(); openPanel(t.assignee!) }}><Icon name="panelR" size={13} />See {who}’s work</button> : null}
          {t.status !== 'archived' ? <button className="b-text sm" disabled={!!busy} onClick={() => void run('away', async () => { if (await acts.move(id, 'archived', true)) toast('Put away') })}><Icon name="box" size={13} />Put away</button> : null}
          <button className="b-ghost-danger pj-sm" disabled={!!busy} onClick={() => void (async () => { if (await acts.remove(id)) onClose() })()}><Icon name="trash" size={13} />Delete</button>
        </div>
      </aside>

      {actions.length ? <div className="pj-actions">{actions}</div> : null}
    </div>
  )
}

function Note({ label, tone, children }: { label: string; tone?: 'need' | 'bad' | 'quiet'; children: React.ReactNode }) {
  return <div className={`pj-note ${tone ?? ''}`}><div className="pj-notel">{tone && tone !== 'quiet' ? <i className={`dot ${tone}`} /> : null}{label}</div>{children}</div>
}

function Fold({ label, count, open, onToggle, children }: { label: string; count?: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="pj-sec">
      <button className="pj-fold big" aria-expanded={open} onClick={onToggle}><Icon name="chevR" size={14} /><span>{label}</span>{count ? <em>{count}</em> : null}</button>
      {open ? <div className="pj-foldb">{children}</div> : null}
    </section>
  )
}
