// Small pieces the Connectors page and the Marketplace share: section heads, quiet notes, the
// "connecting" bridge (Chief reaching toward an app across a row of dots) and its steps, tier and kind
// badges, plugin pictures, filter chips, and optimistic switches that roll back when Hermes says no.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Icon } from '../../lib/icons'
import { toast } from '../../lib/hermes'
import type { MarketPlugin, Tier } from '../../lib/api-market'
import { BotFace, type Mood } from '../BotFace'
import { Logo, Spinner } from '../ui'
import '../../styles/market.css'

export function Section({ title, note, right }: { title: string; note?: string; right?: ReactNode }) {
  return <div className="ssec"><h2>{title}</h2>{note ? <span>{note}</span> : null}<span className="sp" />{right}</div>
}

/** A quiet note between sections: why something is missing, or what just happened. Click to dismiss. */
export function Note({ children, onDismiss, tone }: { children: ReactNode; onDismiss?: () => void; tone?: 'need' | 'ok' | 'bad' }) {
  return (
    <div className={`mk-note ${tone ?? ''}${onDismiss ? ' click' : ''}`} onClick={onDismiss} role={onDismiss ? 'button' : undefined}>
      {tone ? <i className={`dot ${tone}`} /> : <Icon name="info" size={15} />}
      <span>{children}</span>
      {onDismiss ? <Icon name="x" size={13} /> : null}
    </div>
  )
}

export function Pill({ children, tone }: { children: ReactNode; tone?: 'ok' | 'need' | 'bad' | 'run' }) {
  return <span className="mk-pill">{tone ? <i className={`dot ${tone}`} /> : null}{children}</span>
}

export function KindBadge({ children }: { children: ReactNode }) { return <span className="mk-kind">{children}</span> }

/** "Official" or "Verified" with a tick; Community plugins carry no badge. */
export function TierBadge({ tier }: { tier: Tier }) {
  if (tier === 'community') return null
  return <span className={`mk-tier ${tier}`}><Icon name="check" size={11} />{tier === 'official' ? 'Official' : 'Verified'}</span>
}

/** A filter chip that toggles; filled when on. */
export function Chip({ on, onClick, children, close }: { on: boolean; onClick: () => void; children: ReactNode; close?: boolean }) {
  return (
    <button className={`mk-chip${on ? ' on' : ''}`} onClick={onClick} aria-pressed={on}>
      {on && !close ? <Icon name="check" size={12} /> : null}{children}{close ? <Icon name="x" size={11} /> : null}
    </button>
  )
}

/** The plugin's own picture cropped to a tile, or its first letter when it has none (or it fails). */
export function PluginThumb({ p, size = 40 }: { p: Pick<MarketPlugin, 'title' | 'image'>; size?: number }) {
  const [bad, setBad] = useState(false)
  return (
    <span className="mk-thumb" style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }}>
      {p.image && !bad ? <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} /> : <b style={{ fontSize: Math.round(size * 0.42) }}>{(p.title[0] ?? '?').toUpperCase()}</b>}
    </span>
  )
}
/** The plugin's 2:1 banner, or a quiet block with its initial. */
export function Banner({ p, className }: { p: Pick<MarketPlugin, 'title' | 'image'>; className?: string }) {
  const [bad, setBad] = useState(false)
  return (
    <div className={`mk-banner ${className ?? ''}`}>
      {p.image && !bad ? <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} /> : <b>{(p.title[0] ?? '?').toUpperCase()}</b>}
    </div>
  )
}

/** A line with a dot whose colour carries the meaning (amber: take care, green: fine, grey: plain). */
export function DotLine({ tone, children, label }: { tone?: 'ok' | 'need' | 'bad' | 'run' | 'off'; children: ReactNode; label?: string }) {
  return <div className="mk-dl"><i className={`dot ${tone ?? 'off'}`} /><div>{label ? <em>{label}</em> : null}{children}</div></div>
}

export type Stage = 'opening' | 'waiting' | 'checking' | 'done' | 'failed'

/** Chief reaching toward the app across a bridge of dots that flow while it works. */
export function Bridge({ stage, logo }: { stage: Stage | 'working'; logo: ReactNode }) {
  const mood: Mood = stage === 'done' ? 'hop' : stage === 'checking' || stage === 'working' ? 'thinking' : stage === 'failed' ? 'idle' : 'search'
  const live = stage === 'opening' || stage === 'waiting' || stage === 'checking' || stage === 'working'
  return (
    <div className={`mk-bridge ${live ? 'live' : stage}`}>
      <BotFace profile="default" size={64} mood={mood} watch={false} />
      <span className="mk-dots">{[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ animationDelay: `${i * 110}ms` }} />)}</span>
      {logo}
    </div>
  )
}
export const BridgeLogo = ({ src, name }: { src?: string; name: string }) => <Logo src={src} name={name} size={60} />

export type Mark = 'done' | 'current' | 'pending' | 'failed'
export function Steps({ items }: { items: { text: string; mark: Mark }[] }) {
  return (
    <div className="mk-steps">
      {items.map((s, i) => (
        <div key={i} className={`mk-step ${s.mark}`}>
          <span className="mk-mark">{s.mark === 'done' ? <Icon name="check" size={12} /> : s.mark === 'failed' ? <Icon name="x" size={11} /> : s.mark === 'current' ? <i /> : null}</span>
          <span>{s.text}</span>
        </div>
      ))}
    </div>
  )
}

/** A row's small action button that shows a spinner while it works. */
export function RowButton({ children, onClick, busy, disabled, kind = 'soft' }: { children: ReactNode; onClick: () => void; busy?: boolean; disabled?: boolean; kind?: 'soft' | 'text' | 'pri' }) {
  return (
    <button className={kind === 'pri' ? 'b-pri' : kind === 'text' ? 'b-text' : 'b-soft'} disabled={disabled || busy} onClick={(e) => { e.stopPropagation(); onClick() }}>
      {busy ? <Spinner size={12} /> : null}{children}
    </button>
  )
}

/** Skeleton rows while a list loads. */
export function Skeleton({ rows = 4, tiles }: { rows?: number; tiles?: boolean }) {
  if (tiles) return <div className="tiles">{Array.from({ length: rows }, (_, i) => <div key={i} className="mk-skel tile" />)}</div>
  return <div className="card">{Array.from({ length: rows }, (_, i) => <div key={i} className="srow"><span className="mk-skel sq" /><span className="mk-skel ln" /></div>)}</div>
}

/**
 * Optimistic switches: the switch moves at once, the change saves in the background, and if Hermes
 * refuses it snaps back with a note. `value(key, fallback)` is what to draw.
 */
export function useFlips() {
  const [flips, setFlips] = useState<Record<string, boolean>>({})
  const value = useCallback((key: string, fallback: boolean) => (key in flips ? flips[key] : fallback), [flips])
  const flip = useCallback(async (key: string, on: boolean, save: () => Promise<unknown>, opts: { done?: string; failed?: (e: any) => string; reload?: () => Promise<unknown> | void } = {}) => {
    setFlips((f) => ({ ...f, [key]: on }))
    try {
      await save()
      if (opts.done) toast(opts.done)
      await opts.reload?.()
      setFlips((f) => { const n = { ...f }; delete n[key]; return n })
    } catch (e: any) {
      setFlips((f) => { const n = { ...f }; delete n[key]; return n })
      toast(opts.failed ? opts.failed(e) : e?.message ?? 'That didn’t save.')
    }
  }, [])
  return { value, flip }
}

/** Calls `fn` every `ms` while `on`, and once straight away. */
export function usePoll(on: boolean, ms: number, fn: () => Promise<boolean | void> | boolean | void, deps: unknown[] = []) {
  useEffect(() => {
    if (!on) return
    let stop = false
    let t: ReturnType<typeof setTimeout>
    const tick = async () => { if (stop) return; const done = await fn(); if (!stop && done !== true) t = setTimeout(tick, ms) }
    void tick()
    return () => { stop = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, ms, ...deps])
}

/** Opens a link in the browser. */
export const openLink = (url?: string | null) => { if (url && /^https?:\/\//.test(url)) void window.hermesNative.openExternal(url) }
