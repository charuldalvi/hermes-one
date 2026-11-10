// Projects: Hermes' kanban boards, where Chief puts the work and the bots take it. Pick a board, see
// it as columns (drag a card to move it) or as the crew (who is on what), open a card to check it,
// answer it, or start it now. Hermes Remote's Crew tab and Hermes Desktop's kanban, on one page.
//
// Live: the renderer can't open the kanban events socket (the plugin socket takes only the native
// ticket header, which a browser WebSocket can't send), so the board is read every 5 s while the
// window is visible, and only redrawn when its latest event id moves.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as kb from '../lib/api-kanban'
import { toast } from '../lib/hermes'
import { Icon } from '../lib/icons'
import { setState, useStore } from '../lib/store'
import { BotFace } from './BotFace'
import { BoardView, type BoardActions, type Lane } from './projects/Board'
import { CrewView } from './projects/Crew'
import { BoardDialog, NewTaskDialog, assigneeOptions } from './projects/dialogs'
import { botName, type CTask } from './projects/parts'
import { TaskDialog, type TaskActs } from './projects/TaskDialog'
import { PageFrame } from './Settings'
import { confirm, ErrorLine, Popover, Search, Select, Spinner, Tabs, useAsync, type Option } from './ui'
import '../styles/projects.css'

const KEY_BOARD = 'hermes-one.projects.board'
const KEY_VIEW = 'hermes-one.projects.view'
const read = (k: string) => { try { return localStorage.getItem(k) ?? '' } catch { return '' } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

/** The board, read now and every 5 s while visible; a slow read is never stacked on another. */
function useLiveBoard(slug: string | undefined, archived: boolean) {
  const [s, setS] = useState<{ key?: string; board?: kb.KBoard; error?: string; loading: boolean }>({ loading: true })
  const sig = useRef('')
  const seq = useRef(0)
  const inflight = useRef(false)
  const key = `${slug}|${archived}`
  const load = useCallback(async (quiet = false) => {
    if (!slug) return
    if (quiet && inflight.current) return
    const n = ++seq.current
    inflight.current = true
    if (!quiet) setS((x) => ({ ...x, loading: true }))
    try {
      const b = await kb.board(slug, archived)
      if (n !== seq.current) return
      const total = b.columns.reduce((a, c) => a + c.tasks.length, 0)
      const next = `${key}|${b.latest_event_id}|${total}|${b.assignees.join(',')}`
      if (quiet && next === sig.current) { setS((x) => (x.error ? { ...x, error: undefined } : x)); return }
      sig.current = next
      setS({ key, board: b, loading: false })
    } catch (e: any) {
      if (n === seq.current) setS((x) => ({ ...x, loading: false, error: e?.message ?? String(e) }))
    } finally { if (n === seq.current) inflight.current = false }
  }, [slug, archived, key])
  useEffect(() => { sig.current = ''; setS({ loading: true }); void load() }, [load])
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void load(true) }
    const t = setInterval(tick, 5000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick) }
  }, [load])
  // A board from the previous selection never shows under the new one's name.
  return { ...s, board: s.key === key ? s.board : undefined, reload: load }
}

export function Projects() {
  const bots = useStore((s) => s.bots)
  const boardsQ = useAsync(() => kb.boards(), [])
  const wfQ = useAsync(() => kb.workflow(), [])
  const wf = wfQ.data?.columns?.length ? wfQ.data : kb.FALLBACK_WORKFLOW
  const [picked, setPicked] = useState(() => read(KEY_BOARD))
  const [view, setView] = useState<'board' | 'crew'>(() => (read(KEY_VIEW) === 'crew' ? 'crew' : 'board'))
  const [archived, setArchived] = useState(false)
  const [q, setQ] = useState('')
  const [who, setWho] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [newIn, setNewIn] = useState<string | null>(null)
  const [boardForm, setBoardForm] = useState<'new' | 'edit' | null>(null)
  const [pending, setPending] = useState<Record<string, string>>({})
  const [tick, setTick] = useState(0)

  const allBoards = boardsQ.data?.boards ?? []
  const boards = useMemo(() => allBoards.filter((b) => !b.archived), [allBoards])
  const slug = boards.find((b) => b.slug === picked)?.slug
    ?? (boardsQ.data ? boards.find((b) => b.is_current)?.slug ?? boardsQ.data.current ?? boards[0]?.slug ?? 'default' : boardsQ.error ? picked || 'default' : undefined)
  const meta = boards.find((b) => b.slug === slug)
  const name = meta?.name || slug || 'Board'
  const live = useLiveBoard(slug, archived)
  const reloadBoard = live.reload
  const reloadBoards = boardsQ.reload

  const pick = (s: string) => { setPicked(s); write(KEY_BOARD, s); setOpenId(null); setWho(''); setPending({}) }
  useEffect(() => { write(KEY_VIEW, view) }, [view])
  // Board counts in the picker stay fresh too, at a gentler pace.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void boardsQ.reload(true) }, 30_000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // "Working 12m" counters move on their own.
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 15_000); return () => clearInterval(t) }, [])
  // Other parts of the app can open a task here: dispatchEvent(new CustomEvent('hermes:open-task', { detail: { board, id } })).
  useEffect(() => {
    const onOpen = (e: Event) => { const d = (e as CustomEvent).detail ?? {}; if (d.board) pick(String(d.board)); if (d.id) setOpenId(String(d.id)) }
    window.addEventListener('hermes:open-task', onOpen)
    return () => window.removeEventListener('hermes:open-task', onOpen)
  }, [])

  // Every task once, with the column a move in flight is heading to, and what it means for you.
  const cards = useMemo<CTask[]>(() => {
    const out: CTask[] = []
    for (const col of live.board?.columns ?? []) for (const t of col.tasks) {
      const to = pending[t.id]
      if (to === '__gone') continue
      const task = to ? { ...t, status: to } : t
      out.push({ t: task, w: kb.classify(task) })
    }
    return out
  }, [live.board, pending])
  const cardsRef = useRef(cards)
  cardsRef.current = cards
  const find = useCallback((id: string) => cardsRef.current.find((c) => c.t.id === id), [])

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return cards.filter((c) => (!who || (who === '__none' ? !c.t.assignee : c.t.assignee === who))
      && (!term || `${c.t.title} ${c.t.body ?? ''} ${c.t.id} ${c.t.tenant ?? ''} ${botName(c.t.assignee, bots)}`.toLowerCase().includes(term)))
  }, [cards, q, who, bots])

  const lanes = useMemo<Lane[]>(() => {
    const order = (live.board?.columns ?? []).map((c) => c.name)
    return order.map((key) => ({
      key,
      // Cards moved here a moment ago lead the column until the board catches up.
      cards: [...shown.filter((c) => c.t.status === key && pending[c.t.id]), ...shown.filter((c) => c.t.status === key && !pending[c.t.id])],
    })).filter((l) => l.cards.length || l.key !== 'scheduled')
  }, [live.board, shown, pending])

  const open = cards.filter((c) => c.w.kind !== 'away')
  const counts = {
    you: open.filter((c) => kb.needsYou(c.w)).length,
    working: open.filter((c) => c.w.kind === 'working').length,
    next: open.filter((c) => c.w.kind === 'coming' && c.w.next).length,
    coming: open.filter((c) => c.w.kind === 'coming' && !c.w.next).length,
    done: open.filter((c) => c.w.kind === 'done').length,
  }

  // ---------- actions (optimistic, rolled back with a toast when Hermes says no) ----------

  const settle = (id: string) => setPending((p) => { const { [id]: _, ...rest } = p; return rest })
  const friendly = (msg: string) => /parent|dependenc/i.test(msg) ? 'It waits for earlier steps to finish first.' : msg

  const move = useCallback(async (id: string, to: string, quiet = false): Promise<boolean> => {
    const c = find(id)
    if (!c || !slug) return false
    const from = c.t.status
    if (from === to) return true
    if (to !== 'archived' && !kb.movesFrom(wf, from).includes(to)) { toast(kb.lockedReason(to)); return false }
    if (from === 'running' && to !== 'done') {
      const ok = await confirm({ title: `Stop ${botName(c.t.assignee, bots)}?`, body: `It’s working on this right now. Moving it to ${kb.columnLabel(to)} stops that work.`, action: 'Move it' })
      if (!ok) return false
    }
    setPending((p) => ({ ...p, [id]: to }))
    try {
      await kb.patchTask(slug, id, { status: to })
      if (!quiet && to === 'archived') toast('Put away')
      await reloadBoard()
      return true
    } catch (e: any) {
      toast(`Couldn’t move it to ${kb.columnLabel(to)}: ${friendly(e?.message ?? String(e))}`)
      return false
    } finally { settle(id) }
  }, [find, slug, wf, bots, reloadBoard])

  const start = useCallback(async (id: string, quiet = false): Promise<boolean> => {
    const c = find(id)
    if (!c || !slug) return false
    if (c.t.status !== 'ready' && !(await move(id, 'ready', true))) return false
    try {
      await kb.dispatch(slug)
      if (!quiet) toast(c.t.assignee ? `Asked ${botName(c.t.assignee, bots)} to start` : 'Asked the agents to start')
      void reloadBoard()
      return true
    } catch (e: any) { toast(`Couldn’t start it: ${e?.message ?? e}`); return false }
  }, [find, slug, move, bots, reloadBoard])

  const remove = useCallback(async (id: string): Promise<boolean> => {
    const c = find(id)
    if (!c || !slug) return false
    const ok = await confirm({ title: `Delete “${kb.shortTitle(c.t.title)}”?`, body: 'It leaves the board with its notes and history, and can’t be brought back. Put it away instead to keep it.', action: 'Delete', danger: true })
    if (!ok) return false
    setPending((p) => ({ ...p, [id]: '__gone' }))
    try { await kb.deleteTask(slug, id); toast('Deleted'); await reloadBoard(); void reloadBoards(true); return true }
    catch (e: any) { toast(`Couldn’t delete it: ${e?.message ?? e}`); return false }
    finally { settle(id) }
  }, [find, slug, reloadBoard, reloadBoards])

  const boardActs: BoardActions = useMemo(() => ({
    open: (id) => setOpenId(id), move: (id, to) => void move(id, to), start: (id) => void start(id), remove: (id) => void remove(id), newIn: (col) => setNewIn(col),
  }), [move, start, remove])
  const taskActs: TaskActs = useMemo(() => ({ move, start, remove, refresh: () => { void reloadBoard(true); void reloadBoards(true) } }), [move, start, remove, reloadBoard, reloadBoards])

  const askChief = () => {
    setState({ view: 'chat' })
    const text = `Plan this on the “${name}” board${slug && slug !== 'default' ? ` (${slug})` : ''} and add the steps there: `
    // Once the chat (and its composer) has mounted.
    setTimeout(() => window.dispatchEvent(new CustomEvent('hermes:prefill', { detail: text })), 80)
  }

  // ---------- board menu ----------

  const [menu, setMenu] = useState(false)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const startReady = async () => {
    setMenu(false)
    if (!slug) return
    try {
      const r = await kb.dispatch(slug)
      const n = Array.isArray(r?.spawned) ? r.spawned.length : 0
      toast(n ? `Started ${n} thing${n === 1 ? '' : 's'}` : counts.next ? 'Asked the agents to start what’s ready' : 'Nothing is ready to start')
      void live.reload()
    } catch (e: any) { toast(`Couldn’t start: ${e?.message ?? e}`) }
  }
  const parked = open.filter((c) => c.w.kind === 'yours' && c.w.ask === 'start')
  const putAwayParked = async () => {
    setMenu(false)
    if (!slug || !parked.length) return
    const ok = await confirm({ title: `Put away ${parked.length} parked step${parked.length === 1 ? '' : 's'}?`, body: 'They’re waiting for your go-ahead. Put away, nothing on them runs; you can bring them back from “Show put-away tasks”.', action: 'Put away' })
    if (!ok) return
    const ids = parked.map((c) => c.t.id)
    setPending((p) => ({ ...p, ...Object.fromEntries(ids.map((id) => [id, 'archived'])) }))
    try {
      const r = await kb.bulk(slug, ids, { archive: true })
      const failed = (r?.results ?? []).filter((x) => !x.ok).length
      toast(failed ? `Put away ${ids.length - failed}; ${failed} didn’t change` : `Put away ${ids.length}`)
      await reloadBoard()
    } catch (e: any) { toast(`Couldn’t put them away: ${e?.message ?? e}`) } finally { setPending((p) => { const n = { ...p }; for (const id of ids) delete n[id]; return n }) }
  }
  const makeMain = async () => {
    setMenu(false)
    if (!slug) return
    try { await kb.makeCurrent(slug); toast(`Hermes now adds new work to ${name}`); void boardsQ.reload(true) } catch (e: any) { toast(`Couldn’t change it: ${e?.message ?? e}`) }
  }
  const archiveBoard = async (forGood: boolean) => {
    setMenu(false)
    if (!slug || slug === 'default') return
    const total = meta?.total ?? open.length
    const ok = await confirm(forGood
      ? { title: `Delete ${name} for good?`, body: `This deletes the board and ${total === 1 ? 'its 1 task' : `all ${total} of its tasks`} from this Mac. It can’t be undone.`, action: 'Delete for good', danger: true }
      : { title: `Archive ${name}?`, body: 'It leaves the Board and nothing on it runs. It’s kept on this Mac.', action: 'Archive' })
    if (!ok) return
    try {
      const r = await kb.removeBoard(slug, forGood)
      toast(forGood ? `Deleted ${name}` : `Archived ${name}`)
      pick(r?.current && r.current !== slug ? r.current : 'default')
      void boardsQ.reload(true)
    } catch (e: any) { toast(`Couldn’t ${forGood ? 'delete' : 'archive'} it: ${e?.message ?? e}`) }
  }

  // ---------- page ----------

  const whoOptions = useMemo<Option[]>(() => {
    const busy = new Set(cards.map((c) => c.t.assignee ?? ''))
    return [{ value: '', label: 'Everyone' }, ...assigneeOptions(bots, live.board?.assignees ?? []).filter((o) => o.value && busy.has(o.value)),
      ...(busy.has('') ? [{ value: '__none', label: 'Not assigned yet' }] : [])]
  }, [cards, bots, live.board])

  const empty = !!live.board && !cards.some((c) => c.w.kind !== 'away') && !archived
  const loading = !live.board && (live.loading || boardsQ.loading)
  const crewCount = new Set(open.map((c) => c.t.assignee ?? '')).size

  return (
    <PageFrame icon="kanban" title="Board" wide
      right={<button className="hbtn" title="Read the board again" onClick={() => { void live.reload(); void boardsQ.reload(true) }}>{live.loading && live.board ? <Spinner size={13} /> : <Icon name="refresh" />}</button>}>
      <div className="pj-page">
        <div className="shead">
          <div className="tx">
            <h1>Board</h1>
            <p>{meta?.description?.trim() || 'Hermes’ kanban: work Hermes planned, in columns, and which agent is doing it.'}</p>
          </div>
          <button className="b-pri" onClick={() => setNewIn('ready')} disabled={!slug}><Icon name="plus" size={15} />New task</button>
        </div>

        <div className="stools pj-tools">
          <BoardPicker boards={boards} slug={slug} onPick={pick} onNew={() => setBoardForm('new')} loading={boardsQ.loading && !boardsQ.data} />
          <Tabs items={[{ key: 'board' as const, label: 'Board', count: open.length || undefined }, { key: 'crew' as const, label: 'Crew', count: crewCount || undefined }]} value={view} onChange={setView} />
          <Search value={q} onChange={setQ} placeholder="Find a task" />
          {whoOptions.length > 2 ? <Select value={who} options={whoOptions} onChange={setWho} width={260} align="end"
            render={(o) => <>{o?.icon}<span className="sv">{o?.label ?? 'Everyone'}</span></>} /> : null}
          <button ref={menuBtn} className={`hbtn pj-menubtn${menu ? ' on' : ''}`} aria-label="Board options" title="Board options" onClick={() => setMenu(!menu)}><Icon name="dots" /></button>
          <Popover anchor={menuBtn.current} open={menu} onClose={() => setMenu(false)} width={280} align="end">
            <button className="mi" onClick={() => void startReady()}><Icon name="play" size={15} /><span className="ml">Start everything that’s ready</span></button>
            {parked.length > 1 ? <button className="mi" onClick={() => void putAwayParked()}><Icon name="box" size={15} /><span className="ml">Put away {parked.length} parked steps</span></button> : null}
            <button className="mi" onClick={() => { setMenu(false); setArchived(!archived) }}><Icon name="eye" size={15} /><span className="ml">Show put-away tasks</span>{archived ? <Icon name="check" size={14} /> : null}</button>
            {meta && !meta.is_current ? <button className="mi" onClick={() => void makeMain()}><Icon name="star" size={15} /><span className="ml">Make it Hermes’ main board</span></button> : null}
            <div className="mh">This board</div>
            <button className="mi" onClick={() => { setMenu(false); setBoardForm('edit') }} disabled={!meta}><Icon name="edit" size={15} /><span className="ml">Rename…</span></button>
            <button className="mi" onClick={() => void archiveBoard(false)} disabled={slug === 'default'}><Icon name="download" size={15} /><span className="ml">Archive…</span>{slug === 'default' ? <span className="mhint">Always kept</span> : null}</button>
            <button className="mi pj-danger" onClick={() => void archiveBoard(true)} disabled={slug === 'default'}><Icon name="trash" size={15} /><span className="ml">Delete for good…</span></button>
          </Popover>
        </div>

        {live.board && !empty ? (
          <div className="pj-sum">
            {counts.you ? <span><i className="dot need" />{counts.you} need{counts.you === 1 ? 's' : ''} you</span> : null}
            {counts.working ? <span><i className="dot run" />{counts.working} at work</span> : null}
            {counts.next ? <span>{counts.next} up next</span> : null}
            {counts.coming ? <span>{counts.coming} coming up</span> : null}
            {counts.done ? <span><i className="dot ok" />{counts.done} done</span> : null}
            {!counts.you && !counts.working ? <span className="quiet">{counts.next ? 'Starting within a minute.' : 'No one is working on this board right now.'}</span> : null}
          </div>
        ) : null}

        {boardsQ.error && !boardsQ.data ? <ErrorLine text={`Couldn’t read the boards: ${boardsQ.error}`} onRetry={() => void boardsQ.reload()} /> : null}
        {live.error ? <ErrorLine text={live.board ? `Lost touch with the board (${live.error}). Showing what it last said.` : `Couldn’t read this board: ${live.error}`} onRetry={() => void live.reload()} /> : null}

        {loading ? <Skeleton />
          : empty ? (
            <>
              {/* An empty board still shows its columns, so it reads as the kanban it is. */}
              <div className="pj-emptybar">
                <BotFace profile="default" size={64} watch={false} disc={false} />
                <span className="pj-et"><b>Nothing on this board yet.</b> Ask Hermes to plan something and the agents take it from there, or add a task yourself.</span>
                <button className="b-soft pj-btn" onClick={askChief}><Icon name="chat" size={15} />Ask Hermes</button>
                <button className="b-soft pj-btn" onClick={() => setNewIn('ready')}><Icon name="plus" size={15} />New task</button>
              </div>
              {view === 'board' ? <BoardView lanes={lanes} wf={wf} bots={bots} act={boardActs} tick={tick} /> : null}
            </>
          )
          : live.board ? (
            <>
              {(q || who) && !shown.length ? <div className="pj-nomatch">Nothing matches. <button className="b-text sm" onClick={() => { setQ(''); setWho('') }}>Show everything</button></div> : null}
              {view === 'board'
                ? <BoardView lanes={lanes} wf={wf} bots={bots} act={boardActs} tick={tick} />
                : <CrewView cards={shown} bots={bots} onOpen={setOpenId} tick={tick} />}
            </>
          ) : null}
      </div>

      <TaskDialog id={openId} slug={slug ?? 'default'} base={openId ? find(openId) : undefined} eventId={live.board?.latest_event_id ?? 0}
        wf={wf} bots={bots} assignees={live.board?.assignees ?? []} acts={taskActs} onClose={() => setOpenId(null)} />
      <NewTaskDialog open={!!newIn} onClose={() => setNewIn(null)} boards={boards} board={slug ?? 'default'} startIn={newIn ?? 'ready'} bots={bots}
        assignees={live.board?.assignees ?? []}
        onCreated={(s, t) => {
          void boardsQ.reload(true)
          if (s === slug) { void live.reload(); toast(t?.status === 'ready' ? 'Added. It starts within a minute.' : 'Added') }
          else toast(`Added to ${boards.find((b) => b.slug === s)?.name ?? s}`)
        }} />
      <BoardDialog open={!!boardForm} onClose={() => setBoardForm(null)} edit={boardForm === 'edit' ? meta : undefined}
        onDone={(s) => { void boardsQ.reload(true); if (boardForm === 'new') pick(s) }} />
    </PageFrame>
  )
}

/** Which board: a list with each board's size and what's happening on it, and "New board…". */
function BoardPicker({ boards, slug, onPick, onNew, loading }: { boards: kb.KBoardMeta[]; slug?: string; onPick: (s: string) => void; onNew: () => void; loading: boolean }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const cur = boards.find((b) => b.slug === slug)
  return (
    <>
      <button ref={btn} className={`sel pj-boardbtn${open ? ' open' : ''}`} onClick={() => setOpen(!open)} disabled={loading}>
        <Icon name="list" size={15} />
        <span className="sv">{loading ? 'Reading boards…' : cur?.name || slug || 'Board'}</span>
        {cur?.total ? <em>{cur.total}</em> : null}
        <Icon name="chevD" size={14} />
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} width={320}>
        <div className="mh">Boards</div>
        {boards.map((b) => {
          const c = b.counts ?? {}
          const working = c.running ?? 0
          const you = (c.review ?? 0) + (c.blocked ?? 0)
          return (
            <button key={b.slug} className={`mi pj-bmi${b.slug === slug ? ' on' : ''}`} onClick={() => { setOpen(false); onPick(b.slug) }}>
              <span className="ml">{b.name || b.slug}{b.is_current ? <span className="pj-main-tag" title="Hermes adds new work here">main</span> : null}</span>
              <span className="pj-bdots">
                {you ? <span title="Waiting on you or on hold"><i className="dot need" />{you}</span> : null}
                {working ? <span title="At work"><i className="dot run" />{working}</span> : null}
                <span title="Tasks">{b.total ?? 0}</span>
              </span>
              {b.slug === slug ? <Icon name="check" size={14} /> : null}
            </button>
          )
        })}
        <button className="mi pj-newboard" onClick={() => { setOpen(false); onNew() }}><Icon name="plus" size={15} /><span className="ml">New board…</span></button>
      </Popover>
    </>
  )
}

function Skeleton() {
  return (
    <div className="pj-cols pj-skelcols" aria-label="Reading the board">
      {[3, 2, 1, 2].map((n, i) => (
        <section key={i} className="pj-col">
          <header className="pj-colh"><span className="pj-skelbar" style={{ width: 64 + i * 10 }} /></header>
          <div className="pj-colb">{Array.from({ length: n }, (_, j) => <div key={j} className="pj-skel" style={{ animationDelay: `${(i + j) * 90}ms` }} />)}</div>
        </section>
      ))}
    </div>
  )
}
