// The board: one column per stage, in Hermes' order, with friendly names. Cards drag between the
// columns a person may move them to (the workflow's own rules: Working, To check and Later are set by
// the bots, so they never light up as drop targets). Every card's "…" offers the same moves.
import { useCallback, useRef, useState, type DragEvent } from 'react'
import * as kb from '../../lib/api-kanban'
import { toast } from '../../lib/hermes'
import { Icon } from '../../lib/icons'
import type { Bot } from '../../lib/store'
import { Popover } from '../ui'
import { TaskCard, type CTask } from './parts'

export interface Lane { key: string; cards: CTask[] }

export interface BoardActions {
  open: (id: string) => void
  move: (id: string, to: string) => void
  start: (id: string) => void
  remove: (id: string) => void
  newIn: (column: string) => void
}

/** Columns a new task can be started in from their header. */
const NEW_IN = new Set(['triage', 'ready'])
const DOT: Record<string, string> = { running: 'run', review: 'need', blocked: 'need', done: 'ok' }

export function BoardView({ lanes, wf, bots, act, tick }: { lanes: Lane[]; wf: kb.KWorkflow; bots: Bot[]; act: BoardActions; tick: number }) {
  const [drag, setDrag] = useState<{ id: string; from: string } | null>(null)
  const dragRef = useRef<{ id: string; from: string } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const lastOver = useRef<string | null>(null)
  const dropped = useRef(false)
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null)
  const allowed = drag ? new Set(kb.movesFrom(wf, drag.from)) : null
  // Drop rules read the ref, so they hold from the first dragover, before the dimmed look renders.
  const canDrop = (key: string) => !!dragRef.current && kb.movesFrom(wf, dragRef.current.from).includes(key)

  const onDragStart = useCallback((e: DragEvent, c: CTask) => {
    e.dataTransfer.setData('text/plain', c.t.id)
    e.dataTransfer.effectAllowed = 'move'
    dropped.current = false; lastOver.current = null
    dragRef.current = { id: c.t.id, from: c.t.status }
    setMenu(null)
    // A tick later, so the browser takes its drag picture of the card before it dims.
    setTimeout(() => { if (dragRef.current) setDrag(dragRef.current) }, 0)
  }, [])
  const onMenu = useCallback((id: string, anchor: HTMLElement) => setMenu((m) => (m?.id === id ? null : { id, anchor })), [])
  const onDragEnd = useCallback(() => {
    // Let go over a column it can't go to: say why instead of silently snapping back.
    const d = dragRef.current, target = lastOver.current
    if (d && !dropped.current && target && target !== d.from && !kb.movesFrom(wf, d.from).includes(target)) toast(kb.lockedReason(target))
    dragRef.current = null
    setDrag(null); setOver(null)
  }, [wf])

  // The card the menu is about stays put while the menu plays its exit.
  const lastMenu = useRef<CTask | undefined>(undefined)
  const found = menu ? lanes.flatMap((l) => l.cards).find((c) => c.t.id === menu.id) : undefined
  if (found) lastMenu.current = found
  const menuCard = menu ? found : lastMenu.current
  const menuMoves = menuCard ? kb.movesFrom(wf, menuCard.t.status) : []
  const canStart = menuCard && ['ready', 'todo', 'triage', 'blocked'].includes(menuCard.t.status) && (menuCard.t.status === 'ready' || menuMoves.includes('ready'))

  return (
    <>
      <div className="pj-cols" role="list">
        {lanes.map((lane) => {
          const ok = !!allowed?.has(lane.key)
          const state = drag ? (lane.key === drag.from ? ' from' : ok ? ' ok' : ' no') : ''
          return (
            <section key={lane.key} className={`pj-col${state}${over === lane.key && ok ? ' over' : ''}`} role="listitem" aria-label={kb.columnLabel(lane.key)}
              onDragEnter={() => { if (dragRef.current) lastOver.current = lane.key }}
              onDragOver={(e) => {
                if (!dragRef.current) return
                lastOver.current = lane.key
                if (!canDrop(lane.key)) return
                e.preventDefault(); e.dataTransfer.dropEffect = 'move'
                if (over !== lane.key) setOver(lane.key)
              }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === lane.key ? null : o)) }}
              onDrop={(e) => {
                e.preventDefault()
                const d = dragRef.current
                const can = canDrop(lane.key)
                dropped.current = true
                dragRef.current = null
                setDrag(null); setOver(null)
                if (d && can) act.move(d.id, lane.key)
              }}>
              <header className="pj-colh" title={kb.COLUMN_WORDS[lane.key]?.help}>
                {DOT[lane.key] && lane.cards.length ? <i className={`dot ${DOT[lane.key]}`} /> : null}
                <span className="nm">{kb.columnLabel(lane.key)}</span>
                <em>{lane.cards.length || ''}</em>
                <span className="sp" />
                {NEW_IN.has(lane.key) ? <button className="hbtn" title={`New task in ${kb.columnLabel(lane.key)}`} aria-label={`New task in ${kb.columnLabel(lane.key)}`} onClick={() => act.newIn(lane.key)}><Icon name="plus" size={15} /></button> : null}
              </header>
              <div className="pj-colb flow">
                {lane.cards.map((c) => (
                  <TaskCard key={c.t.id} c={c} bots={bots} tick={tick} dragging={drag?.id === c.t.id}
                    onOpen={act.open} onMenu={onMenu}
                    onDragStart={c.t.status === 'archived' && !kb.movesFrom(wf, 'archived').length ? undefined : onDragStart} onDragEnd={onDragEnd} />
                ))}
                {!lane.cards.length ? <div className="pj-none">{drag && ok ? 'Drop here' : 'Nothing here'}</div> : null}
              </div>
            </section>
          )
        })}
      </div>
      <Popover anchor={menu?.anchor ?? null} open={!!found} onClose={() => setMenu(null)} width={240} align="end">
        {menuCard ? (
          <>
            <button className="mi" onClick={() => { setMenu(null); act.open(menuCard.t.id) }}><Icon name="eye" size={15} /><span className="ml">Open</span></button>
            {canStart ? <button className="mi" onClick={() => { setMenu(null); act.start(menuCard.t.id) }}><Icon name="play" size={15} /><span className="ml">Start now</span></button> : null}
            {menuMoves.length ? <div className="mh">Move to</div> : null}
            {menuMoves.map((k) => (
              <button key={k} className="mi" onClick={() => { setMenu(null); act.move(menuCard.t.id, k) }}><Icon name="chevR" size={15} /><span className="ml">{kb.columnLabel(k)}</span></button>
            ))}
            {menuCard.t.status !== 'archived' ? <button className="mi" onClick={() => { setMenu(null); act.move(menuCard.t.id, 'archived') }}><Icon name="box" size={15} /><span className="ml">Put away</span></button> : null}
            <button className="mi pj-danger" onClick={() => { setMenu(null); act.remove(menuCard.t.id) }}><Icon name="trash" size={15} /><span className="ml">Delete…</span></button>
          </>
        ) : null}
      </Popover>
    </>
  )
}
