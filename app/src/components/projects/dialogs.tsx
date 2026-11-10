// The Projects page's forms: a new task (what, who, where it starts, how urgent, which board) and a
// board's name and purpose (new or renamed). Both spring open from ui.tsx's Dialog; ⌘↩ submits.
import { useEffect, useMemo, useRef, useState } from 'react'
import * as kb from '../../lib/api-kanban'
import { toast } from '../../lib/hermes'
import type { Bot } from '../../lib/store'
import { Dialog, ErrorLine, Select, Spinner, type Option } from '../ui'
import { botName, Face } from './parts'

/** Every bot that can take work: the team first (Chief on top), then board-only names. */
export function assigneeOptions(bots: Bot[], extra: string[] = [], anyone = 'Anyone'): Option[] {
  const names = new Set<string>()
  const out: Option[] = [{ value: '', label: anyone, hint: 'Hermes picks', icon: <Face profile={null} bots={bots} size={20} /> }]
  for (const b of [...bots].sort((a, c) => (a.isChief ? -1 : c.isChief ? 1 : a.name.localeCompare(c.name)))) {
    names.add(b.profile)
    out.push({ value: b.profile, label: b.isChief ? 'Hermes' : b.name, hint: b.isChief ? 'Leads your agents' : b.role?.slice(0, 40), icon: <Face profile={b.profile} bots={bots} size={20} /> })
  }
  for (const p of extra) if (p && !names.has(p)) { names.add(p); out.push({ value: p, label: botName(p, bots), icon: <Face profile={p} bots={bots} size={20} /> }) }
  return out
}

const START_OPTIONS: Option[] = [
  { value: 'ready', label: 'Up next', hint: 'Starts within a minute' },
  { value: 'triage', label: 'Ideas', hint: 'Written up first' },
]
const PRIORITY_OPTIONS: Option[] = kb.PRIORITIES.map((p) => ({ value: String(p.value), label: p.label }))

export function NewTaskDialog({ open, onClose, boards, board, startIn, bots, assignees, onCreated }: {
  open: boolean; onClose: () => void; boards: kb.KBoardMeta[]; board: string; startIn: string; bots: Bot[]; assignees: string[]
  onCreated: (slug: string, task: kb.KTask | null) => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [who, setWho] = useState('')
  const [start, setStart] = useState('ready')
  const [priority, setPriority] = useState('0')
  const [slug, setSlug] = useState(board)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    setTitle(''); setBody(''); setWho(''); setPriority('0'); setError(''); setBusy(false)
    setStart(startIn === 'triage' ? 'triage' : 'ready'); setSlug(board)
    setTimeout(() => titleRef.current?.focus(), 0)
  }, [open, board, startIn])
  const people = useMemo(() => assigneeOptions(bots, assignees), [bots, assignees])
  const boardOptions = useMemo<Option[]>(() => boards.filter((b) => !b.archived).map((b) => ({ value: b.slug, label: b.name || b.slug, hint: b.total ? String(b.total) : undefined })), [boards])

  const submit = async () => {
    const t = title.trim()
    if (!t || busy) return
    setBusy(true); setError('')
    try {
      const r = await kb.createTask(slug, { title: t, body: body.trim() || undefined, assignee: who || null, priority: Number(priority), triage: start === 'triage' })
      if (r.warning) toast(r.warning)
      onCreated(slug, r.task)
      onClose()
    } catch (e: any) { setError(e?.message ?? String(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New task" width={620}
      footer={<>
        <span className="pj-hint">⌘↩ to add</span><span className="sp" />
        <button className="b-text" onClick={onClose}>Cancel</button>
        <button className="b-pri pj-btn" disabled={!title.trim() || busy} onClick={() => void submit()}>{busy ? <Spinner size={12} /> : null}Add task</button>
      </>}>
      <div className="form pj-form" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() } }}>
        {error ? <ErrorLine text={error} /> : null}
        <label><span>What needs doing</span>
          <input ref={titleRef} autoFocus className="answer" value={title} placeholder={start === 'triage' ? 'A rough idea is fine' : 'e.g. Draft the launch email'} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); void submit() } }} />
        </label>
        <label><span>Details <em>optional</em></span>
          <textarea className="answer" rows={5} value={body} placeholder="What good looks like, links, anything that helps. Markdown works." onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className="pj-grid2">
          <label><span>Who does it</span>
            <Select value={who} options={people} onChange={setWho} width={300}
              render={(o) => <>{o?.icon}<span className="sv">{o?.label ?? 'Anyone'}</span></>} />
          </label>
          <label><span>Starts in</span><Select value={start} options={START_OPTIONS} onChange={setStart} width={260} /></label>
          <label><span>How urgent</span><Select value={priority} options={PRIORITY_OPTIONS} onChange={setPriority} width={200} /></label>
          <label><span>Board</span><Select value={slug} options={boardOptions} onChange={setSlug} width={280} /></label>
        </div>
      </div>
    </Dialog>
  )
}

/** A new board, or a board's name and purpose. Calls back with the board's slug. */
export function BoardDialog({ open, onClose, edit, onDone }: { open: boolean; onClose: () => void; edit?: kb.KBoardMeta; onDone: (slug: string) => void }) {
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    setName(edit?.name ?? ''); setAbout(edit?.description ?? ''); setError(''); setBusy(false)
    setTimeout(() => nameRef.current?.focus(), 0)
  }, [open, edit])
  const slug = kb.slugify(name)

  const submit = async () => {
    const n = name.trim()
    if (!n || busy) return
    setBusy(true); setError('')
    try {
      if (edit) {
        await kb.updateBoard(edit.slug, { name: n, description: about.trim() })
        toast('Board updated')
        onDone(edit.slug)
      } else {
        const r = await kb.createBoard({ slug: slug || `board-${Date.now().toString(36)}`, name: n, ...(about.trim() ? { description: about.trim() } : {}) })
        toast(`Made ${r.board?.name || n}`)
        onDone(r.board?.slug ?? slug)
      }
      onClose()
    } catch (e: any) { setError(e?.message ?? String(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onClose={onClose} title={edit ? 'Rename board' : 'New board'} width={500}
      footer={<><span className="sp" /><button className="b-text" onClick={onClose}>Cancel</button>
        <button className="b-pri pj-btn" disabled={!name.trim() || busy} onClick={() => void submit()}>{busy ? <Spinner size={12} /> : null}{edit ? 'Save' : 'Make board'}</button></>}>
      <div className="form pj-form" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() } }}>
        {error ? <ErrorLine text={error} /> : null}
        <label><span>Name</span>
          <input ref={nameRef} autoFocus className="answer" value={name} placeholder="e.g. Spring launch" onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }} />
          {!edit && name.trim() ? <em>Hermes calls it <code className="pj-code">{slug || 'board-…'}</code></em> : null}
        </label>
        <label><span>What it’s for <em>optional</em></span>
          <textarea className="answer" rows={3} value={about} placeholder="One line the agents read when they pick up work here." onChange={(e) => setAbout(e.target.value)} />
        </label>
      </div>
    </Dialog>
  )
}
