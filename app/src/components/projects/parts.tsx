// Small parts the Projects page shares: who a bot is called, its face, a card's state line, and the
// card itself (draggable between columns; its "…" opens the same moves as the task dialog).
import { memo, useMemo, type DragEvent, type ReactNode } from 'react'
import * as kb from '../../lib/api-kanban'
import { prettyName } from '../../lib/hermes'
import { renderMarkdown } from '../../lib/markdown'
import { Icon } from '../../lib/icons'
import type { Bot } from '../../lib/store'
import { BotFace, type Mood } from '../BotFace'

/** Markdown from a bot or a brief; links open in the browser, never inside the app. */
export function Md({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <div className={`md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }}
    onClick={(e) => { const a = (e.target as HTMLElement).closest('a'); if (a?.href) { e.preventDefault(); void window.hermesNative.openExternal(a.href) } }} />
}

/** A task plus what it means for you, read once per board load. */
export interface CTask { t: kb.KTask; w: kb.Work }

export function botName(profile: string | null | undefined, bots: Bot[]): string {
  if (!profile) return 'Anyone'
  if (profile === 'default') return 'Quicksilver'
  return bots.find((b) => b.profile === profile)?.name ?? prettyName(profile)
}

/** A bot's face, or a quiet empty ring for work no one has yet. */
export function Face({ profile, bots, size = 22, mood }: { profile?: string | null; bots: Bot[]; size?: number; mood?: Mood }) {
  if (!profile) return <span className="pj-noone" style={{ width: size, height: size }} aria-hidden="true" />
  const b = bots.find((x) => x.profile === profile)
  return <BotFace profile={profile} size={size} poseKey={b?.poseKey} mood={mood} watch={false} />
}

export function StateLine({ w, children }: { w: kb.Work; children?: ReactNode }) {
  const s = kb.stateWords(w)
  return (
    <span className={`pj-state ${s.tone}`}>
      {s.tone !== 'quiet' ? <i className={`dot ${s.tone}`} /> : null}
      <span className="tx">{s.text}</span>
      {children}
    </span>
  )
}

/** The short time on a card: how long it has worked, when it finished, or how old it is. */
export function cardTime(c: CTask): string {
  if (c.w.kind === 'working') return kb.span(c.w.since)
  if (c.w.kind === 'done') return kb.ago(c.t.completed_at)
  return kb.ago(c.t.created_at)
}

export const TaskCard = memo(function TaskCard({ c, bots, dragging, onOpen, onMenu, onDragStart, onDragEnd, tick }: {
  c: CTask; bots: Bot[]; dragging?: boolean; tick?: number
  onOpen: (id: string) => void; onMenu: (id: string, anchor: HTMLElement) => void
  onDragStart?: (e: DragEvent, c: CTask) => void; onDragEnd?: (e: DragEvent) => void
}) {
  void tick
  const { t, w } = c
  const preview = (w.kind === 'done' || (w.kind === 'yours' && w.ask === 'check')) && t.latest_summary
    ? t.latest_summary.split('\n').find((l) => l.trim())?.replace(/^[#>*\-\s]+/, '').slice(0, 140) : undefined
  const reason = w.kind === 'stuck' ? w.reason : undefined
  return (
    <article className={`pj-card${dragging ? ' dragging' : ''}${kb.needsYou(w) ? ' pj-needs' : ''}`} draggable={!!onDragStart} tabIndex={0}
      onDragStart={onDragStart ? (e) => onDragStart(e, c) : undefined} onDragEnd={onDragEnd}
      onClick={() => onOpen(t.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(t.id) } }}
      aria-label={t.title}>
      <div className="pj-ct">
        <span className="tt">{t.title}</span>
        <button className="pj-more" aria-label="More" title="Move or change"
          onClick={(e) => { e.stopPropagation(); onMenu(t.id, e.currentTarget) }} onKeyDown={(e) => e.stopPropagation()}>
          <Icon name="dots" size={15} />
        </button>
      </div>
      {/* The column already says most states; the line is for the ones that need a glance (colour = meaning). */}
      {w.kind === 'working' || w.kind === 'yours' || w.kind === 'stuck' || (w.kind === 'coming' && w.after) ? <StateLine w={w} /> : null}
      {reason ? <div className="pj-cx bad">{reason}</div> : preview ? <div className="pj-cx">{preview}</div> : null}
      <div className="pj-cm">
        <Face profile={t.assignee} bots={bots} size={22} mood={w.kind === 'working' ? 'thinking' : undefined} />
        <span className="nm">{botName(t.assignee, bots)}</span>
        <span className="sp" />
        {t.priority && t.priority > 0 ? <span className="pj-tag hi" title="Priority">{kb.priorityLabel(t.priority)}</span> : null}
        {t.tenant ? <span className="pj-tag" title="Tag">{t.tenant}</span> : null}
        {t.warnings?.count ? <span className="pj-mi bad" title={`${t.warnings.count} warning${t.warnings.count === 1 ? '' : 's'}`}><Icon name="alert" size={13} /></span> : null}
        {t.progress?.total ? <span className="pj-mi" title="Steps done"><Icon name="list" size={13} />{t.progress.done}/{t.progress.total}</span> : null}
        {t.comment_count ? <span className="pj-mi" title={`${t.comment_count} note${t.comment_count === 1 ? '' : 's'}`}><Icon name="chat" size={13} />{t.comment_count}</span> : null}
        <span className="pj-mi time">{cardTime(c)}</span>
      </div>
    </article>
  )
})
