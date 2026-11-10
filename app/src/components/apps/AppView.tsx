// An open app on the Apps page: its screens (home, and the ones it opens on top, with a way back), its
// own buttons, and a ⋯ menu: Reload, Log, Change this…, Undo the last change, Show its files, Remove.
// The app redraws when it changes by itself (a timer, a bot using its tools) and as often as it asks.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { prettyName, toast } from '../../lib/hermes'
import { Icon } from '../../lib/icons'
import { ago, appsApi, chatFromApp, closeApp, isWide, onAppsEvent, runAnywhere, takeGoto, useApps, type Action, type AppSummary, type Screen } from '../../lib/apps'
import { useStore } from '../../lib/store'
import { confirm, Dialog, ErrorLine, Popover, Spinner } from '../ui'
import { Blocks, Run, type RunApi } from './Blocks'
import { AppTile, Glyph } from './Glyph'

type Page = { screen: string; params: unknown }
const firstLine = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0]
const isAction = (v: unknown): v is Action | Action[] => Array.isArray(v) ? v.every((a) => a && typeof a === 'object' && typeof a.do === 'string') && v.length > 0 : !!v && typeof v === 'object' && typeof (v as Action).do === 'string'

export function builderName(bot: string | undefined, bots: { profile: string; name: string }[]) {
  if (!bot) return ''
  if (bot === 'default' || bot === 'hermes') return 'Hermes'
  return bots.find((b) => b.profile === bot)?.name ?? prettyName(bot)
}

export function AppView({ app }: { app: AppSummary }) {
  const [stack, setStack] = useState<Page[]>([{ screen: 'home', params: {} }])
  const [trees, setTrees] = useState<Record<number, Screen>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(0)
  const [reload, setReload] = useState(0)
  const [menu, setMenu] = useState(false)
  const [logs, setLogs] = useState(false)
  const [changing, setChanging] = useState(false)
  const bots = useStore((s) => s.bots)
  const goto = useApps((s) => s.goto)
  const moreBtn = useRef<HTMLButtonElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const depth = stack.length - 1
  const page = stack[depth]
  const tree = trees[depth]
  const rev = useRef<number | undefined>(undefined)
  const seq = useRef(0)
  const where = useRef({ depth, page })
  where.current = { depth, page }

  const draw = useCallback((at: number, screen: Screen | undefined, newRev?: number) => {
    if (screen) setTrees((t) => ({ ...t, [at]: screen }))
    if (newRev !== undefined) rev.current = newRev
  }, [])

  const pull = useCallback(async (force: boolean) => {
    const n = ++seq.current
    const { depth: at, page: p } = where.current
    try {
      const got = await appsApi().screen(app.id, p.screen, p.params, force ? undefined : rev.current)
      if (n !== seq.current) return
      if (!got.same && got.screen) setTrees((t) => ({ ...t, [at]: got.screen as Screen }))
      rev.current = got.rev
      setError(null)
    } catch (e) {
      if (n === seq.current) setError(String((e as Error)?.message ?? e))
    }
  }, [app.id])

  // A new screen (or a new version of the app): draw it fresh.
  useEffect(() => { rev.current = undefined; void pull(true) }, [pull, depth, page, reload, app.version])
  // The app changed by itself: draw again (the runtime answers "same" when nothing did).
  useEffect(() => onAppsEvent((e) => { if (e.kind === 'changed' && e.app === app.id && e.rev !== rev.current) void pull(false) }), [app.id, pull])
  // A screen that asks to be redrawn every few seconds (clocks, timers, progress).
  useEffect(() => {
    const every = Number(tree?.refresh)
    if (!(every > 0)) return
    const t = setInterval(() => void pull(true), Math.max(1, Math.min(3600, every)) * 1000)
    return () => clearInterval(t)
  }, [tree?.refresh, pull])
  // A screen the app asked to show (its notification was clicked, or it said "open").
  useEffect(() => {
    if (!goto || goto.app !== app.id) return
    takeGoto()
    if (goto.screen === 'home') { setStack([{ screen: 'home', params: {} }]); setTrees({}) }
    else setStack((s) => [...s, { screen: goto.screen, params: goto.params ?? {} }])
  }, [goto, app.id])
  useLayoutEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [depth])

  const back = useCallback(() => {
    const at = where.current.depth
    if (at === 0) { closeApp(); return }
    setTrees((t) => { const next = { ...t }; delete next[at]; return next })
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
  }, [])
  const toRoot = () => { setTrees((t) => ({ 0: t[0] })); setStack((s) => s.slice(0, 1)) }

  // Run an action in the app; the screen it was tapped on comes back redrawn.
  const actRaw = useCallback(async (name: string, args: unknown) => {
    const { depth: at, page: p } = where.current
    setBusy((b) => b + 1)
    try {
      const done = await appsApi().act(app.id, name, args, p.screen, p.params)
      draw(at, done.screen, done.rev)
      return done.result
    } finally { setBusy((b) => b - 1) }
  }, [app.id, draw])

  const perform = async (action: Action | Action[] | null | undefined, extra?: Record<string, unknown>): Promise<void> => {
    if (!action) return
    if (Array.isArray(action)) { for (const a of action) await perform(a); return }
    if (typeof action !== 'object') return
    switch (action.do) {
      case 'act': {
        try {
          const result = await actRaw(String(action.name ?? ''), { ...(action.args ?? {}), ...(extra ?? {}) })
          if (isAction(result)) await perform(result)
        } catch (e) { toast(firstLine(e)) }
        break
      }
      case 'open': setStack((s) => [...s, { screen: String(action.screen ?? 'home'), params: action.params ?? {} }]); break
      case 'back': back(); break
      case 'refresh': setReload((n) => n + 1); break
      case 'confirm':
        if (await confirm({ title: String(action.text ?? action.title ?? 'Are you sure?'), action: String(action.button ?? 'OK'), danger: !!action.danger })) await perform(action.then)
        break
      case 'pick': pick(action); break
      case 'locate': locate(action); break
      default: runAnywhere(app.id, action)
    }
  }
  const performRef = useRef(perform)
  performRef.current = perform

  const pick = (action: Action) => {
    if (!action.act) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = action.kind === 'photo' || action.kind === 'camera' ? 'image/*' : action.kind === 'video' ? 'video/*' : Array.isArray(action.types) ? action.types.join(',') : ''
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const { depth: at, page: p } = where.current
      setBusy((b) => b + 1)
      try {
        const done = await appsApi().upload(app.id, file, { action: String(action.act), args: action.args ?? {}, screen: p.screen, params: p.params })
        draw(at, done.screen, done.rev)
        if (isAction(done.result)) await performRef.current(done.result)
      } catch (e) { toast(firstLine(e)) } finally { setBusy((b) => b - 1) }
    }
    input.click()
  }
  const locate = (action: Action) => {
    if (!navigator.geolocation) { toast('This Mac can’t tell where it is'); return }
    navigator.geolocation.getCurrentPosition(
      (spot) => void performRef.current({ do: 'act', name: action.act, args: { ...(action.args ?? {}), lat: spot.coords.latitude, lon: spot.coords.longitude, accuracy: spot.coords.accuracy, at: spot.timestamp } }),
      () => toast('This Mac couldn’t tell where it is. Location Services may be off for Hermes One.'),
      { timeout: 15_000 },
    )
  }

  const runApi = useMemo<RunApi>(() => ({
    app,
    run: (action, extra) => { void performRef.current(action, extra) },
    act: async (name, args) => {
      const result = await actRaw(name, args)
      if (isAction(result)) void performRef.current(result)
      return result
    },
  }), [app, actRaw])

  const askFix = (detail: string) => chatFromApp(app.name, undefined, `${detail} (app id "${app.id}").\nPlease fix it and publish it again.`, true)
  const undo = async () => {
    try { const r = await appsApi().undo(app.id); toast(`${app.name} is back to version ${r.version}`) } catch (e) { toast(firstLine(e)) }
  }
  const remove = async () => {
    const ok = await confirm({ title: `Remove ${app.name}?`, body: 'Its files and data stay on this Mac, so an agent can bring it back.', action: 'Remove', danger: true })
    if (!ok) return
    try { await appsApi().remove(app.id); closeApp(); toast(`Removed ${app.name}`) } catch (e) { toast(firstLine(e)) }
  }

  const title = tree?.title ?? (depth === 0 ? app.name : '')
  const builder = builderName(app.bot, bots)
  return (
    <Run.Provider value={runApi}>
      <div className="chat ha-open">
        <div className="hdr drag">
          <span className="crumb">
            <button className="ha-crumb nodrag" onClick={closeApp}><Icon name="grid" /><span>Apps</span></button>
            <span className="sl">/</span>
            {depth > 0 ? (
              <><button className="ha-crumb nodrag" onClick={toRoot}>{app.name}</button><span className="sl">/</span><span className="cur">{title}</span></>
            ) : <span className="cur">{app.name}</span>}
          </span>
          <span className="sp" />
          <span className="nodrag ha-tools">
            {busy > 0 ? <Spinner /> : null}
            {(Array.isArray(tree?.actions) ? tree!.actions! : []).filter(Boolean).slice(0, 2).map((item, i) => (
              <button key={i} className="hbtn" title={item.label} aria-label={item.label ?? 'Action'} onClick={() => void perform(item.action)}><Glyph name={item.icon} size={16} /></button>
            ))}
            <button ref={moreBtn} className={`hbtn${menu ? ' on' : ''}`} aria-label="More" onClick={() => setMenu((m) => !m)}><Icon name="dots" /></button>
          </span>
        </div>
        <Popover anchor={moreBtn.current} open={menu} onClose={() => setMenu(false)} width={268} align="end">
          <div className="mh">Version {app.version}{builder ? ` · made by ${builder}` : ''}{app.publishedAt ? ` · ${ago(app.publishedAt)}` : ''}</div>
          <div className="pop-list">
            <button className="mi" onClick={() => { setMenu(false); setReload((n) => n + 1) }}><Icon name="refresh" size={15} /><span className="ml">Reload</span></button>
            <button className="mi" onClick={() => { setMenu(false); setLogs(true) }}><Icon name="terminal" size={15} /><span className="ml">Show its log</span></button>
            <button className="mi" onClick={() => { setMenu(false); setChanging(true) }}><Icon name="edit" size={15} /><span className="ml">Change this…</span></button>
            {app.versions.length > 1 ? <button className="mi" onClick={() => { setMenu(false); void undo() }}><Glyph name="back" size={15} /><span className="ml">Undo the last change</span></button> : null}
            <button className="mi" onClick={() => { setMenu(false); void appsApi().reveal(app.id, 'source').catch((e) => toast(firstLine(e))) }}><Icon name="folder" size={15} /><span className="ml">Show its files</span></button>
            <button className="mi ha-danger" onClick={() => { setMenu(false); void remove() }}><Icon name="trash" size={15} /><span className="ml">Remove app</span></button>
          </div>
        </Popover>
        <div className="ha-scroll" ref={scroller}>
          <div className={`ha-col${isWide(tree) ? ' wide' : ''}`} key={depth}>
            {depth > 0 ? <button className="ha-back" onClick={back}><Glyph name="back" size={15} /><span>{trees[depth - 1]?.title ?? app.name}</span></button> : null}
            <div className="ha-head">
              {depth === 0 ? <AppTile app={app} size={40} /> : null}
              <div className="ha-head-tx">
                <h1>{title || ' '}</h1>
                {tree?.subtitle ? <p>{tree.subtitle}</p> : !tree && !error ? <p>Opening…</p> : null}
              </div>
            </div>
            {changing ? <ChangeBox app={app} where={title || app.name} onDone={() => setChanging(false)} /> : null}
            {tree && error ? <ErrorLine text={firstLine(error)} onRetry={() => setReload((n) => n + 1)} /> : null}
            {tree ? <Blocks blocks={tree.body} /> : error ? (
              <div className="ha-broken">
                <AppTile app={app} size={48} />
                <b>{app.name} didn’t open</b>
                <pre className="ha-code">{error}</pre>
                <div className="ha-broken-row">
                  <button className="b-soft" onClick={() => setReload((n) => n + 1)}>Try again</button>
                  <button className="b-pri" onClick={() => askFix(`${app.name} didn’t open. The error was:\n${error}`)}>Ask Hermes to fix it</button>
                </div>
              </div>
            ) : <div className="ha-loading"><Spinner size={18} /></div>}
          </div>
        </div>
        <LogDialog app={app} open={logs} onClose={() => setLogs(false)} onAsk={(tail) => askFix(`${app.name} isn’t working right. Its recent log:\n${tail}`)} />
      </div>
    </Run.Provider>
  )
}

function ChangeBox({ app, where, onDone }: { app: AppSummary; where: string; onDone: () => void }) {
  const [text, setText] = useState('')
  const send = () => {
    const t = text.trim()
    if (!t) return
    chatFromApp(app.name, undefined, `Change this app (id "${app.id}"). On the “${where}” screen: ${t}`, false)
    toast(`Hermes is on it. ${app.name} updates here when it’s done.`)
    onDone()
  }
  return (
    <div className="ha-change">
      <span>What should change on “{where}”? Hermes edits {app.name} and it updates here.</span>
      <textarea className="answer" autoFocus rows={3} value={text} placeholder="Make the buttons bigger, add a weekly view…" onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } if (e.key === 'Escape') onDone() }} />
      <div className="ha-change-row">
        <button className="b-text" onClick={onDone}>Cancel</button>
        <button className="b-pri" disabled={!text.trim()} onClick={send}>Send to Hermes</button>
      </div>
    </div>
  )
}

function LogDialog({ app, open, onClose, onAsk }: { app: AppSummary; open: boolean; onClose: () => void; onAsk: (tail: string) => void }) {
  const [text, setText] = useState('')
  const pre = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    const load = () => appsApi().logs(app.id).then((t) => { if (live) setText(t) }, () => {})
    void load()
    const t = setInterval(load, 2000)
    return () => { live = false; clearInterval(t) }
  }, [open, app.id])
  useLayoutEffect(() => { const el = pre.current; if (el) el.scrollTop = el.scrollHeight }, [text])
  const tail = text.split('\n').slice(-40).join('\n')
  return (
    <Dialog open={open} onClose={onClose} wide title={<><AppTile app={app} size={22} />{app.name} · log</>}
      footer={<>
        <button className="b-text" disabled={!text} onClick={() => void navigator.clipboard?.writeText(text).then(() => toast('Copied the log'))}>Copy</button>
        <span className="sp" />
        <button className="b-text" disabled={!text} onClick={() => { onClose(); onAsk(tail) }}>Ask Hermes about it</button>
        <button className="b-pri" onClick={onClose}>Done</button>
      </>}>
      {text ? <pre ref={pre} className="ha-log">{text}</pre>
        : <p className="ha-quiet">Nothing logged yet. What the app prints with console.log, its errors and its restarts show up here.</p>}
    </Dialog>
  )
}
