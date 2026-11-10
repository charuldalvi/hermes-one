// An app's screen, drawn with Hermes One's own parts: the blocks of the guide (text, rows, toggles,
// fields, buttons, stats, charts, images, a player, a web view…). Taps go back through `run`, which the
// open app view (AppView) carries out: most run an action in the app's worker and redraw.
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { renderMarkdown } from '../../lib/markdown'
import { Icon } from '../../lib/icons'
import { appsApi, onAppsEvent, player, usePlayer, type Action, type AppSummary, type Block } from '../../lib/apps'
import { getFeed, onFeed } from '../../lib/feed'
import { Badge, Popover, Switch, Tabs } from '../ui'
import { Glyph } from './Glyph'

export interface RunApi {
  app: AppSummary
  run: (action: Action | Action[] | undefined | null, extra?: Record<string, unknown>) => void
  /** Run an app action from its web page; resolves with what the action returned. */
  act: (name: string, args?: unknown) => Promise<unknown>
}
export const Run = createContext<RunApi | null>(null)
const useRun = () => useContext(Run) as RunApi

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Consecutive rows join into one list card, so they sit flush like settings rows.
function groupRows(blocks: unknown[]): Block[] {
  const out: Block[] = []
  let rows: Block[] = []
  const flush = () => { if (rows.length) out.push({ type: 'list', items: rows }); rows = [] }
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== 'object') continue
    const b = block as Block
    if (b.type === 'row') rows.push(b)
    else { flush(); out.push(b) }
  }
  flush()
  return out
}

export function Blocks({ blocks, tight }: { blocks: unknown; tight?: boolean }) {
  return (
    <div className={`ha-blocks${tight ? ' tight' : ''}`}>
      {groupRows(Array.isArray(blocks) ? blocks : []).map((block, i) => <BlockView key={`${block.type}:${i}`} block={block} />)}
    </div>
  )
}

function BlockView({ block }: { block: Block }) {
  const { run } = useRun()
  const tap = (action?: Action, extra?: Record<string, unknown>) => (e?: { stopPropagation?: () => void }) => { e?.stopPropagation?.(); run(action, extra) }
  switch (block.type) {
    case 'text':
      return <p className="ha-text" data-style={block.style ?? 'body'} data-color={block.color} style={{ textAlign: block.align === 'end' ? 'right' : block.align === 'center' ? 'center' : undefined }}>{str(block.text)}</p>
    case 'markdown':
      return <Markdown text={str(block.text)} />
    case 'section':
      return (
        <section className="ha-section">
          {block.label || block.trailing ? (
            <div className="ha-section-h">
              <span>{str(block.label)}</span>
              {block.trailing ? (block.action ? <button className="ha-link" onClick={tap(block.action)}>{str(block.trailing)}</button> : <span className="ha-trail">{str(block.trailing)}</span>)
                : block.action ? <button className="ha-link" onClick={tap(block.action)}>See all</button> : null}
            </div>
          ) : null}
          <Blocks blocks={block.children} />
        </section>
      )
    case 'card':
      return (
        <div className="ha-card" data-tone={block.tone} data-press={block.action ? '' : undefined} role={block.action ? 'button' : undefined} tabIndex={block.action ? 0 : undefined}
          onClick={block.action ? tap(block.action) : undefined} onKeyDown={block.action ? (e) => { if (e.key === 'Enter') run(block.action) } : undefined}>
          <Blocks blocks={block.children} tight />
        </div>
      )
    case 'row':
      return <div className="ha-list"><Row row={block} /></div>
    case 'list':
      return <div className="ha-list">{(Array.isArray(block.items) ? block.items : []).filter(Boolean).map((row: Block, i: number) => <Row key={i} row={row} />)}</div>
    case 'stack': {
      const dir = block.direction === 'column' ? 'column' : 'row'
      return (
        <div className="ha-stack" data-dir={dir} data-align={block.align} style={{ gap: Number.isFinite(block.gap) ? block.gap : undefined }}>
          {(Array.isArray(block.children) ? block.children : []).filter(Boolean).map((child: Block, i: number) => <div key={i} className="ha-cell"><BlockView block={child.type === 'row' ? { type: 'list', items: [child] } : child} /></div>)}
        </div>
      )
    }
    case 'grid':
      return (
        <div className="ha-grid" style={{ gridTemplateColumns: `repeat(${clamp(Number(block.columns) || 2, 1, 4)}, minmax(0, 1fr))`, gap: Number.isFinite(block.gap) ? block.gap : undefined }}>
          {(Array.isArray(block.children) ? block.children : []).filter(Boolean).map((child: Block, i: number) => <div key={i} className="ha-cell"><BlockView block={child.type === 'row' ? { type: 'list', items: [child] } : child} /></div>)}
        </div>
      )
    case 'image':
      return block.src ? (
        <figure className="ha-figure">
          <img className="ha-img" src={str(block.src)} alt={str(block.caption)} loading="lazy" draggable={false}
            style={{ aspectRatio: String(Number(block.ratio) > 0 ? block.ratio : 1.78), borderRadius: Number.isFinite(block.radius) ? block.radius : undefined, cursor: block.action ? 'pointer' : undefined }}
            onClick={block.action ? tap(block.action) : undefined} />
          {block.caption ? <figcaption>{str(block.caption)}</figcaption> : null}
        </figure>
      ) : null
    case 'button':
      return (
        <button className="ha-btn" data-style={['primary', 'secondary', 'danger'].includes(block.style) ? block.style : 'primary'} data-full={block.full ? '' : undefined} onClick={tap(block.action)}>
          {block.icon ? <Glyph name={block.icon} size={16} /> : null}<span>{str(block.label)}</span>
        </button>
      )
    case 'icon_button':
      return <button className="ha-iconbtn" data-filled={block.filled ? '' : undefined} aria-label={str(block.label) || 'Action'} title={str(block.label)} onClick={tap(block.action)}><Glyph name={block.icon} size={18} /></button>
    case 'toggle':
      return <ToggleLine block={block} />
    case 'slider':
      return <Slider block={block} />
    case 'segmented':
      return <Segmented block={block} />
    case 'chips':
      return <Chips block={block} />
    case 'field':
      return <Field block={block} />
    case 'progress':
      return (
        <div className="ha-progress">
          {block.label ? <span>{str(block.label)}</span> : null}
          <div className="ha-bar"><i style={{ width: `${clamp(Number(block.value) || 0, 0, 1) * 100}%` }} /></div>
        </div>
      )
    case 'stat':
      return (
        <div className="ha-stat">
          <span className="ha-stat-l">{str(block.label)}</span>
          <span className="ha-stat-v" data-tone={block.tone}>{str(block.value)}</span>
          {block.hint ? <span className="ha-stat-h">{str(block.hint)}</span> : null}
        </div>
      )
    case 'chart':
      return <Chart block={block} />
    case 'badge':
      return <span className="ha-badge"><Badge tone={({ ok: 'ok', amber: 'need', danger: 'bad', accent: undefined, quiet: 'quiet' } as Record<string, 'ok' | 'need' | 'bad' | 'quiet' | undefined>)[str(block.tone)]}>{str(block.text)}</Badge></span>
    case 'code':
      return <pre className="ha-code">{str(block.text)}</pre>
    case 'empty':
      return (
        <div className="ha-empty">
          <span className="ha-empty-art"><Glyph name={block.icon ?? 'spark'} size={24} /></span>
          <b>{str(block.title)}</b>
          {block.text ? <span>{str(block.text)}</span> : null}
          {block.action ? <button className="ha-btn" data-style="primary" onClick={tap(block.action)}>{str(block.button) || 'Go'}</button> : null}
        </div>
      )
    case 'player':
      return <Player compact={block.style === 'compact'} />
    case 'web':
      return <Web block={block} />
    case 'divider':
      return <hr className="ha-hr" />
    case 'spacer':
      return <div style={{ height: clamp(Number(block.size) || 12, 0, 400) }} />
    default:
      return <p className="ha-unknown">This part needs a newer Hermes One ({str(block.type) || 'no type'}).</p>
  }
}

const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return (
    <div className="md ha-md" dangerouslySetInnerHTML={{ __html: html }} onClick={(e) => {
      const a = (e.target as HTMLElement).closest('a')
      if (a?.href) { e.preventDefault(); if (/^https?:/i.test(a.href)) void window.hermesNative.openExternal(a.href) }
    }} />
  )
})

function Row({ row }: { row: Block }) {
  const { run } = useRun()
  const [menu, setMenu] = useState(false)
  const more = useRef<HTMLButtonElement>(null)
  const items: { label?: string; icon?: string; danger?: boolean; action?: Action }[] = Array.isArray(row.menu) ? row.menu.filter(Boolean) : []
  const press = row.action || items.length > 0
  return (
    <div className="ha-row" data-press={press ? '' : undefined} role={row.action ? 'button' : undefined} tabIndex={row.action ? 0 : undefined}
      onClick={() => (row.action ? run(row.action) : items.length ? setMenu((m) => !m) : undefined)}
      onKeyDown={(e) => { if (e.key === 'Enter' && row.action) run(row.action) }}
      onContextMenu={(e) => { if (items.length) { e.preventDefault(); setMenu(true) } else if (row.hold) { e.preventDefault(); run(row.hold) } }}>
      {row.image ? <img className="ha-row-img" src={str(row.image)} alt="" loading="lazy" draggable={false} />
        : row.icon ? <span className="ha-row-icon"><Glyph name={row.icon} size={17} /></span> : null}
      <span className="ha-row-tx">
        <span className="ha-row-t">{str(row.title)}</span>
        {row.subtitle ? <span className="ha-row-s">{str(row.subtitle)}</span> : null}
      </span>
      {row.trailing !== undefined && row.trailing !== null && row.trailing !== '' ? <span className="ha-row-trail">{str(row.trailing)}</span> : null}
      {row.toggle ? <span onClick={(e) => e.stopPropagation()}><LiveSwitch on={!!row.toggle.on} onChange={(on) => run(row.toggle.action, { on })} label={str(row.title)} /></span> : null}
      {row.chevron ? <Icon name="chevR" size={15} className="ha-row-chev" /> : null}
      {items.length ? (
        <>
          <button ref={more} className="ha-row-more" aria-label="More" onClick={(e) => { e.stopPropagation(); setMenu((m) => !m) }}><Icon name="dots" size={16} /></button>
          {/* React events bubble out of portals: keep clicks in the menu away from the row. */}
          <span className="ha-portal" onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Popover anchor={more.current} open={menu} onClose={() => setMenu(false)} width={220} align="end">
              <div className="pop-list">
                {items.map((item, i) => (
                  <button key={i} className={`mi${item.danger ? ' ha-danger' : ''}`} onClick={() => { setMenu(false); run(item.action) }}>
                    {item.icon ? <Glyph name={item.icon} size={15} /> : null}<span className="ml">{str(item.label)}</span>
                  </button>
                ))}
              </div>
            </Popover>
          </span>
        </>
      ) : null}
    </div>
  )
}

/** A switch that flips at once and follows the app when its screen comes back. */
function LiveSwitch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label?: string }) {
  const [value, setValue] = useState(on)
  useEffect(() => setValue(on), [on])
  return <Switch on={value} label={label} onChange={(v) => { setValue(v); onChange(v) }} />
}

function ToggleLine({ block }: { block: Block }) {
  const { run } = useRun()
  return (
    <label className="ha-toggle">
      <span>{str(block.label)}</span>
      <LiveSwitch on={!!block.on} label={str(block.label)} onChange={(on) => run(block.action, { on })} />
    </label>
  )
}

function Slider({ block }: { block: Block }) {
  const { run } = useRun()
  const min = Number.isFinite(block.min) ? Number(block.min) : 0
  const max = Number(block.max) > min ? Number(block.max) : min + 1
  const [value, setValue] = useState<number>(Number.isFinite(block.value) ? Number(block.value) : min)
  useEffect(() => setValue(Number.isFinite(block.value) ? Number(block.value) : min), [block.value, min])
  const send = () => run(block.action, { value })
  return (
    <label className="ha-slider">
      {block.label ? <span className="ha-slider-h"><span>{str(block.label)}</span><span>{Number(block.step) >= 1 ? Math.round(value) : value.toFixed(2)}</span></span> : null}
      <input type="range" min={min} max={max} step={Number(block.step) > 0 ? block.step : 'any'} value={value}
        onChange={(e) => setValue(Number(e.target.value))} onPointerUp={send} onKeyUp={send} />
    </label>
  )
}

type Opt = { value: string | number; label?: string; count?: number }
const optsOf = (block: Block): Opt[] => (Array.isArray(block.options) ? block.options : []).filter(Boolean).map((o: any) => (typeof o === 'object' ? { value: o.value ?? o.label, label: o.label, count: o.count } : { value: o, label: String(o) }))

function Segmented({ block }: { block: Block }) {
  const { run } = useRun()
  const options = optsOf(block)
  const [chosen, setChosen] = useState(String(block.value ?? ''))
  useEffect(() => setChosen(String(block.value ?? '')), [block.value])
  if (!options.length) return null
  return (
    <div className="ha-seg">
      <Tabs items={options.map((o) => ({ key: String(o.value), label: str(o.label ?? o.value), count: o.count }))} value={chosen}
        onChange={(key) => { setChosen(key); const o = options.find((x) => String(x.value) === key); run(block.action, { value: o ? o.value : key }) }} />
    </div>
  )
}

function Chips({ block }: { block: Block }) {
  const { run } = useRun()
  const options = optsOf(block)
  const [chosen, setChosen] = useState(String(block.value ?? ''))
  useEffect(() => setChosen(String(block.value ?? '')), [block.value])
  return (
    <div className="ha-chips" role="tablist">
      {options.map((o) => (
        <button key={String(o.value)} role="tab" aria-selected={String(o.value) === chosen} className={String(o.value) === chosen ? 'on' : ''}
          onClick={() => { setChosen(String(o.value)); run(block.action, { value: o.value }) }}>
          {str(o.label ?? o.value)}{o.count !== undefined ? <em>{o.count}</em> : null}
        </button>
      ))}
    </div>
  )
}

function Field({ block }: { block: Block }) {
  const { run } = useRun()
  const [text, setText] = useState(str(block.value))
  useEffect(() => setText(str(block.value)), [block.value])
  const submit = () => {
    if (!text.trim() && !block.allowEmpty) return
    run(block.action, { text })
    if (block.clear !== false) setText('')
  }
  return (
    <form className="ha-field" onSubmit={(e) => { e.preventDefault(); submit() }}>
      {block.multiline ? (
        <textarea className="answer" rows={3} value={text} placeholder={str(block.placeholder)} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }} />
      ) : (
        <input className="answer" value={text} placeholder={str(block.placeholder)} onChange={(e) => setText(e.target.value)} />
      )}
      {block.button ? <button type="submit" className="ha-btn" data-style="secondary" disabled={!text.trim() && !block.allowEmpty}>{str(block.button)}</button> : null}
    </form>
  )
}

function Chart({ block }: { block: Block }) {
  const points: { label: string; value: number }[] = (Array.isArray(block.points) ? block.points : []).filter(Boolean).map((p: any) => ({ label: str(p.label), value: Number(p.value) || 0 }))
  if (!points.length) return null
  const top = Math.max(...points.map((p) => p.value), 0.0001)
  const w = 300
  const h = 110
  const step = points.length > 1 ? w / (points.length - 1) : 0
  const gap = points.length > 24 ? 2 : 6
  const bw = Math.max(1, (w - gap * (points.length - 1)) / points.length)
  return (
    <div className="ha-chart">
      {block.label ? <span className="ha-chart-l">{str(block.label)}</span> : null}
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        {block.kind === 'line'
          ? <polyline fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" points={points.map((p, i) => `${points.length > 1 ? i * step : w / 2},${h - 2 - (p.value / top) * (h - 6)}`).join(' ')} />
          : points.map((p, i) => { const bh = Math.max(2, (p.value / top) * h); return <rect key={i} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx={Math.min(4, bw / 2)} fill="currentColor" /> })}
      </svg>
      {points.length <= 12 && points.some((p) => p.label) ? <div className="ha-chart-x">{points.map((p, i) => <span key={i}>{p.label}</span>)}</div> : null}
    </div>
  )
}

function Player({ compact }: { compact: boolean }) {
  const state = usePlayer()
  const track = state.queue[state.index]
  const [, tick] = useState(0)
  useEffect(() => {
    if (!state.playing) return
    const t = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [state.playing])
  const audio = player.audio
  const live = !!track?.live || !audio || !Number.isFinite(audio.duration)
  const progress = !live && audio && audio.duration > 0 ? audio.currentTime / audio.duration : 0
  return (
    <div className="ha-player" data-compact={compact ? '' : undefined}>
      <span className="ha-player-art">{track?.art ? <img src={track.art} alt="" draggable={false} /> : <Glyph name="music" size={20} />}</span>
      <span className="ha-player-tx">
        <b>{track ? track.title || 'Playing' : 'Nothing playing'}</b>
        <span>{track ? track.artist ?? '' : 'Pick something to play.'}</span>
      </span>
      {track && live ? <span className="ha-live"><i className={state.playing ? 'dot run' : 'dot off'} />Live</span> : null}
      {track ? (
        <span className="ha-player-ctl">
          {!live || state.index > 0 ? <button aria-label="Previous" onClick={() => player.control('previous')}><Glyph name="previous" size={15} /></button> : null}
          <button className="ha-play" aria-label={state.playing ? 'Pause' : 'Play'} onClick={() => player.control('toggle')}><Glyph name={state.playing ? 'pause' : 'play'} size={16} /></button>
          {!live || state.index + 1 < state.queue.length ? <button aria-label="Next" disabled={state.index + 1 >= state.queue.length} onClick={() => player.control('next')}><Glyph name="next" size={15} /></button> : null}
        </span>
      ) : null}
      {track && !live && !compact ? <div className="ha-bar ha-player-bar"><i style={{ width: `${progress * 100}%` }} /></div> : null}
    </div>
  )
}

// The app's own page from its web/ folder, served by hermes-app:// with a strict CSP and loaded in a
// sandboxed frame (no same-origin, no network): it talks to the app only through window.hermes.
function Web({ block }: { block: Block }) {
  const { app, act } = useRun()
  const frame = useRef<HTMLIFrameElement>(null)
  const page = str(block.path || 'index.html').replace(/^\/+/, '')
  const src = `hermes-app://${app.id}/web/${page.split('/').map(encodeURIComponent).join('/')}?v=${app.version}`
  const wantsAgents = !!app.abilities?.includes('agents')
  useEffect(() => {
    const post = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ hermes: 1, ...message }, '*')
    const sendState = async () => { try { post({ type: 'state', state: (await appsApi().state(app.id)).state }) } catch { /* the app is restarting */ } }
    // The agents feed (lib/feed.ts), only for apps that asked for it with the "agents" ability.
    const sendAgents = () => { if (wantsAgents) post({ type: 'agents', feed: getFeed() }) }
    const offFeed = wantsAgents ? onFeed(sendAgents) : () => {}
    const onMessage = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data || event.data.hermes !== 1) return
      if (event.data.type === 'agents') sendAgents()
      else if (event.data.type === 'state') await sendState()
      else if (event.data.type === 'act') {
        try { post({ type: 'done', id: event.data.id, ok: true, value: (await act(String(event.data.name ?? ''), event.data.args ?? {})) ?? null }) } catch (error: any) { post({ type: 'done', id: event.data.id, ok: false, value: String(error?.message ?? error).split('\n')[0] }) }
      }
    }
    window.addEventListener('message', onMessage)
    const off = onAppsEvent((event) => { if (event.kind === 'changed' && event.app === app.id) void sendState() })
    return () => { window.removeEventListener('message', onMessage); off(); offFeed() }
  }, [app.id, act, wantsAgents])
  const height = block.height === 'fill' ? 'max(360px, calc(100vh - 240px))' : `${clamp(Number(block.height) || 420, 80, 4000)}px`
  return <iframe ref={frame} className="ha-web" title={`${app.name} page`} sandbox="allow-scripts" src={src} style={{ height }} />
}

