// One app, opened from Connected (Hermes Remote's ConnectorsApp.kt plus what Hermes Desktop adds): whether
// it's working, its numbers, the switch, its accounts (managed apps) or where it runs (servers on this Mac),
// and what Hermes may do there, tool by tool, with the three presets. Tool changes save as you make them,
// against the rules you were looking at.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../lib/icons'
import { toast } from '../../lib/hermes'
import { setState } from '../../lib/store'
import type { Account } from '../../lib/api'
import {
  ALIAS_RE, FACET_LABEL, PRESETS, agoText, appPending, appTrouble, cleanAlias, connectorTools, dayText, facetOrder, memberDisabled, mcpTest,
  orgLockedTools, plain, plural, policy as readPolicy, presetDisabled, presetOf, removeAccount, removeServer, renameAccount, saveServerConfigs,
  serverConfigs, serverLogs, serverTarget, serverToolOn, setDisabledTools, setManagedEnabled, setServerEnabled, setServerKey, toggleServerTool,
  toolTitle, usagePrefix, usageSum, humanize, type AppEntry, type ConnectorTool, type Facet, type McpTest, type Policy, type Preset, type UsageCounts,
} from '../../lib/api-market'
import { Badge, Dialog, Logo, Popover, Search, Spinner, Switch, Tabs, confirm } from '../ui'
import type { ConnectRequest } from './ConnectFlow'
import { Chip, KindBadge, Note, RowButton, Skeleton } from './parts'

export interface AppDetailProps {
  entry: AppEntry
  policy: Policy | null
  usage: UsageCounts | null
  profile: string
  botName: string
  /** A managed twin of this server that's also on: Hermes would see its tools twice. */
  twin?: AppEntry
  onClose: () => void
  onConnect: (r: ConnectRequest) => void
  /** Something changed: reload, and show `note` if given. */
  onChanged: (note?: string) => void
}

export function AppDetail(props: AppDetailProps) {
  const [open, setOpen] = useState(true)
  const close = () => { setOpen(false); setTimeout(props.onClose, 170) }
  const connect = (r: ConnectRequest) => { close(); props.onConnect(r) }
  const e = props.entry
  return (
    <Dialog open={open} onClose={close} width={640}
      title={<><Logo src={e.logo} name={e.name} size={28} /><span>{e.name}</span><KindBadge>{e.kind === 'managed' ? 'Managed' : e.kind === 'plugin' ? 'From a plugin' : 'On this Mac'}</KindBadge></>}>
      {e.kind === 'managed' ? <HostedDetail {...props} onConnect={connect} /> : <ServerDetail {...props} onConnect={connect} onRemoved={(n) => { close(); props.onChanged(n) }} />}
      <p className="mk-foot">{e.kind === 'managed' ? 'Managed apps follow your Nous account, so every agent shares them.' : `Servers on this Mac belong to ${props.botName}. Other agents have their own.`}</p>
    </Dialog>
  )
}

function StatusLine({ text, tone }: { text: string; tone: 'ok' | 'need' | 'bad' | 'off' | 'run' }) {
  return <div className="mk-status"><i className={`dot ${tone}`} />{text}</div>
}

function Stats({ tools, week, today }: { tools?: number; week?: number; today?: number }) {
  const last = today === undefined || week === undefined ? '–' : today > 0 ? 'today' : week > 0 ? 'this week' : '–'
  return (
    <div className="mk-facts">
      <div><b>{tools ?? '–'}</b><span>tools</span></div>
      <div><b>{week ?? '–'}</b><span>uses this week</span></div>
      <div><b>{last}</b><span>last used</span></div>
    </div>
  )
}

function SwitchCard({ title, sub, on, disabled, onChange }: { title: string; sub: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="card mk-gap"><div className="srow">
      <div className="tx"><div className="t1"><span>{title}</span></div><div className="t2">{sub}</div></div>
      <Switch on={on} onChange={onChange} disabled={disabled} label={title} />
    </div></div>
  )
}

const FACET_TONE: Record<Facet, 'ok' | 'run' | 'need' | 'off'> = { read: 'ok', write: 'run', destructive: 'need', unclassified: 'off' }

// ---------- a managed app ----------

function accountLine(a: Account): string {
  const updated = (a as any).updated_at as string | undefined
  switch (a.status) {
    case 'active': return dayText(a.created_at) ? `Connected ${dayText(a.created_at)}` : 'Connected'
    case 'pending': return 'Finishing sign-in'
    case 'expired': return `Access ran out${agoText(updated) ? ` ${agoText(updated)}` : ''}`
    case 'revoked': return 'Access taken back'
    case 'failed': return 'Sign-in didn’t finish'
    case 'inactive': return 'Paused at Nous'
    default: return a.status ? a.status[0].toUpperCase() + a.status.slice(1) : ''
  }
}
const accountName = (a: Account) => a.alias?.trim() || a.label || a.connector

function HostedDetail({ entry, policy: initial, usage, onConnect, onChanged }: AppDetailProps) {
  const slug = entry.hostedSlug!
  const [pol, setPol] = useState<Policy | null>(initial)
  const [tools, setTools] = useState<ConnectorTool[] | null>(null)
  const [stale, setStale] = useState(false)
  const [toolsError, setToolsError] = useState<string>()
  const [refreshing, setRefreshing] = useState(false)
  const [disabled, setDisabled] = useState<Set<string>>(() => new Set(memberDisabled(initial, slug)))
  const [revision, setRevision] = useState<string | null>(initial?.revision ?? null)
  const [conflict, setConflict] = useState<string[] | null>(null)
  const [note, setNote] = useState<string>()
  const [enabled, setEnabled] = useState(entry.enabled)
  const [saving, setSaving] = useState(false)
  const [q, setQ] = useState('')
  const [facets, setFacets] = useState<Set<Facet>>(new Set())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const loadTools = async (refresh = false) => {
    try { const r = await connectorTools(slug, refresh); setTools(r.tools); setStale(r.stale); setToolsError(undefined) } catch (e) { setToolsError(plain(e)) }
  }
  useEffect(() => {
    // The newest rules first, so a save names the revision you're actually looking at.
    readPolicy().then((p) => { setPol(p); setRevision(p.revision); setDisabled(new Set(memberDisabled(p, slug))) }).catch(() => undefined)
    void loadTools()
    return () => clearTimeout(saveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const list = tools ?? []
  const locked = useMemo(() => orgLockedTools(pol, slug, list), [pol, tools])
  const canEdit = !!revision && enabled

  const save = (next: Set<string>) => {
    setDisabled(next)
    setConflict(null)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      const r = await setDisabledTools(slug, [...next].filter((s) => !locked.has(s)), revision)
      setSaving(false)
      if (r.kind === 'saved') { setRevision(r.revision); setNote(undefined); onChanged() }
      else if (r.kind === 'conflict') { setConflict(r.theirs); setRevision(r.revision) }
      else setNote(r.message)
    }, 600)
  }

  const toggleApp = async (on: boolean) => {
    setEnabled(on)
    try { await setManagedEnabled(slug, on); toast(on ? `${entry.name} is on.` : `${entry.name} is off. Its sign-in is kept.`); onChanged() } catch (e) { setEnabled(!on); setNote(plain(e)) }
  }

  const trouble = appTrouble(entry)
  const status = appPending(entry) ? { text: 'Finishing sign-in', tone: 'need' as const } : trouble ? { text: 'Needs you', tone: 'need' as const }
    : !enabled ? { text: 'Off · sign-in kept', tone: 'off' as const } : { text: 'Working · for every agent', tone: 'ok' as const }
  const prefix = usagePrefix(entry)
  const onCount = list.filter((t) => !disabled.has(t.slug) && !locked.has(t.slug)).length
  const preset = presetOf(disabled, list, locked)
  const t = q.trim().toLowerCase()
  const shown = list.filter((x) => (!facets.size || facets.has(x.facet)) && (!t || `${toolTitle(x, slug)} ${x.slug} ${x.description}`.toLowerCase().includes(t)))
    .sort((a, b) => facetOrder(a.facet) - facetOrder(b.facet))
  const facetCounts = list.reduce<Record<string, number>>((m, x) => { m[x.facet] = (m[x.facet] ?? 0) + 1; return m }, {})

  return (
    <>
      <StatusLine text={status.text} tone={status.tone} />
      {entry.description ? <p className="mk-about">{entry.description}</p> : null}
      <Stats tools={tools?.length} week={usageSum(usage?.week, prefix)} today={usageSum(usage?.today, prefix)} />
      <SwitchCard title="Hermes can use it" sub={entry.orgLocked ? 'Your organisation turned it off' : 'Off keeps the sign-in for later'} on={enabled} disabled={entry.orgLocked} onChange={toggleApp} />

      <div className="mk-lab">Accounts</div>
      <Accounts entry={entry} onConnect={onConnect} onChanged={onChanged} onNote={setNote} />

      <div className="mk-lab">
        <span>What Hermes may do</span>
        <span className="sp" />
        {saving ? <Spinner size={12} /> : null}
        {tools ? <span>{onCount} of {list.length} on</span> : null}
        <button className="hbtn" title="Read the tool list again" onClick={async () => { setRefreshing(true); await loadTools(true); setRefreshing(false) }}>{refreshing ? <Spinner size={12} /> : <Icon name="refresh" size={14} />}</button>
      </div>
      {list.length ? (
        <Tabs<Preset | 'mix'> className="mk-presets"
          items={[...PRESETS.map((p) => ({ key: p.key as Preset | 'mix', label: p.label })), ...(preset ? [] : [{ key: 'mix' as const, label: 'Your own mix' }])]}
          value={preset ?? 'mix'} onChange={(k) => { if (k !== 'mix' && canEdit) save(presetDisabled(k, list, locked)) }} />
      ) : null}
      {conflict ? (
        <div className="mk-needs">
          <div className="tx"><b>Someone changed these while you were looking.</b><span>Your choices are still here; nothing was saved.</span></div>
          <div className="act"><button className="b-text" onClick={() => { setDisabled(new Set(conflict)); setConflict(null) }}>Use theirs</button><button className="b-soft" onClick={() => save(disabled)}>Save mine</button></div>
        </div>
      ) : null}
      {stale ? <Note>This list may be out of date; Nous didn’t answer just now.</Note> : null}
      {tools === null && !toolsError ? <Skeleton rows={4} />
        : tools === null ? <p className="mk-muted">{toolsError}</p>
        : !list.length ? <p className="mk-muted">{entry.name} lists no tools yet.</p>
        : (
          <>
            {!enabled ? <p className="mk-muted">Turn {entry.name} on to change its tools.</p> : !revision ? <p className="mk-muted">Rules can’t be changed right now.</p> : null}
            {list.length > 8 ? (
              <div className="mk-toolbar">
                <Search value={q} onChange={setQ} placeholder={`Search ${list.length} tools`} />
                {(['read', 'write', 'destructive'] as Facet[]).filter((f) => facetCounts[f]).map((f) => (
                  <Chip key={f} on={facets.has(f)} onClick={() => setFacets((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n })}>{FACET_LABEL[f]} {facetCounts[f]}</Chip>
                ))}
              </div>
            ) : null}
            <div className="card mk-tools">
              {shown.map((x) => {
                const isLocked = locked.has(x.slug)
                return (
                  <div className="srow mk-tool" key={x.slug} title={x.description}>
                    <i className={`dot ${FACET_TONE[x.facet]}`} />
                    <div className="tx"><div className="t1"><span>{toolTitle(x, slug)}</span></div><div className="t2">{isLocked ? 'Off by your organisation' : FACET_LABEL[x.facet]}{x.description ? ` · ${x.description}` : ''}</div></div>
                    <Switch on={!disabled.has(x.slug) && !isLocked} disabled={!canEdit || isLocked} label={toolTitle(x, slug)}
                      onChange={(on) => { const n = new Set(disabled); if (on) n.delete(x.slug); else n.add(x.slug); save(n) }} />
                  </div>
                )
              })}
              {!shown.length ? <div className="srow"><span className="mk-muted">No tools match.</span></div> : null}
            </div>
          </>
        )}
      {note ? <Note tone="need" onDismiss={() => setNote(undefined)}>{note}</Note> : null}
    </>
  )
}

function Accounts({ entry, onConnect, onChanged, onNote }: { entry: AppEntry; onConnect: (r: ConnectRequest) => void; onChanged: (n?: string) => void; onNote: (n: string) => void }) {
  const slug = entry.hostedSlug!
  const [menu, setMenu] = useState<{ id: string; el: HTMLElement } | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [alias, setAlias] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const rename = async (a: Account) => {
    setBusy(a.connection_id)
    try { await renameAccount(a.connection_id, alias); setNaming(null); onChanged(`Renamed to ${alias}.`) } catch (e) { onNote(plain(e)) } finally { setBusy(null) }
  }
  const remove = async (a: Account) => {
    const ok = await confirm({ title: `Remove ${accountName(a)}?`, body: `Hermes stops acting as this ${entry.name} account. You can connect it again any time.`, action: 'Remove', danger: true })
    if (!ok) return
    setBusy(a.connection_id)
    try { await removeAccount(a.connection_id); onChanged(`Removed ${accountName(a)}.`) } catch (e) { onNote(plain(e)) } finally { setBusy(null) }
  }
  const cur = entry.accounts.find((a) => a.connection_id === menu?.id)
  return (
    <div className="card">
      {entry.accounts.map((a) => (
        <div key={a.connection_id}>
          <div className="srow">
            <span className="mk-avatar">{(accountName(a)[0] ?? '?').toUpperCase()}</span>
            <div className="tx">
              <div className="t1"><span>{accountName(a)}</span>{a.active && entry.accounts.length > 1 ? <Badge tone="quiet">In use</Badge> : null}</div>
              <div className={`t2${a.status !== 'active' ? ' mk-warn' : ''}`}>{accountLine(a)}</div>
            </div>
            {busy === a.connection_id ? <Spinner /> : <button className="hbtn" aria-label="Account options" onClick={(ev) => setMenu({ id: a.connection_id, el: ev.currentTarget })}><Icon name="dots" /></button>}
          </div>
          {naming === a.connection_id ? (
            <div className="mk-inline">
              <input className="answer mono" autoFocus value={alias} placeholder="work" onChange={(ev) => setAlias(cleanAlias(ev.target.value))} onKeyDown={(ev) => { if (ev.key === 'Enter' && ALIAS_RE.test(alias)) void rename(a); if (ev.key === 'Escape') setNaming(null) }} />
              <button className="b-text" onClick={() => setNaming(null)}>Cancel</button>
              <button className="b-soft" disabled={!ALIAS_RE.test(alias)} onClick={() => void rename(a)}>Save</button>
            </div>
          ) : null}
        </div>
      ))}
      {adding ? (
        <div className="mk-inline col">
          <span className="mk-muted">A short name for it, like work or personal.</span>
          <div className="mk-inline-r">
            <input className="answer mono" autoFocus value={alias} placeholder="work" onChange={(ev) => setAlias(cleanAlias(ev.target.value))} onKeyDown={(ev) => { if (ev.key === 'Enter' && ALIAS_RE.test(alias)) onConnect({ kind: 'hosted', name: entry.name, logo: entry.logo, slug, alias }) }} />
            <button className="b-text" onClick={() => { setAdding(false); setAlias('') }}>Cancel</button>
            <button className="b-soft" disabled={!ALIAS_RE.test(alias)} onClick={() => onConnect({ kind: 'hosted', name: entry.name, logo: entry.logo, slug, alias })}>Connect</button>
          </div>
        </div>
      ) : (
        <button className="srow click mk-addrow" onClick={() => { if (!entry.accounts.length) onConnect({ kind: 'hosted', name: entry.name, logo: entry.logo, slug }); else { setAdding(true); setAlias('') } }}>
          <span className="mk-avatar add"><Icon name="plus" size={14} /></span>
          <span>{entry.accounts.length ? 'Add another account' : 'Connect an account'}</span>
        </button>
      )}
      <Popover anchor={menu?.el ?? null} open={!!menu} onClose={() => setMenu(null)} width={200} align="end">
        {cur ? <>
          <button className="mi" onClick={() => { setMenu(null); setNaming(cur.connection_id); setAlias(cur.alias ?? '') }}><Icon name="edit" size={14} /><span className="ml">Rename</span></button>
          <button className="mi" onClick={() => { setMenu(null); onConnect({ kind: 'hosted', name: entry.name, logo: entry.logo, slug, reconnect: true, connectionId: cur.connection_id }) }}><Icon name="refresh" size={14} /><span className="ml">Reconnect</span></button>
          <button className="mi" onClick={() => { setMenu(null); void remove(cur) }}><Icon name="trash" size={14} /><span className="ml">Remove</span></button>
        </> : null}
      </Popover>
    </div>
  )
}

// ---------- a server on this Mac ----------

function ServerDetail({ entry, usage, profile, botName, twin, onConnect, onChanged, onRemoved }: AppDetailProps & { onRemoved: (note: string) => void }) {
  const server = entry.server!
  const fromPlugin = server.source === 'plugin'
  const [enabled, setEnabled] = useState(entry.enabled)
  const [test, setTest] = useState<McpTest | null>(null)
  const [testing, setTesting] = useState(entry.enabled ? 1 : 0)
  const [note, setNote] = useState<string>()
  const [cfgs, setCfgs] = useState<Record<string, Record<string, any>> | null>(null)
  const [keyOpen, setKeyOpen] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [logs, setLogs] = useState<{ source: 'stdio' | 'agent'; lines: string[] | null } | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!testing) return
    let stop = false
    setTest(null)
    mcpTest(profile, server.name).then((r) => { if (!stop) setTest(r) })
    return () => { stop = true }
  }, [testing, profile, server.name])
  useEffect(() => { if (!fromPlugin) serverConfigs(profile).then(setCfgs).catch(() => setCfgs(null)) }, [profile, fromPlugin])
  useEffect(() => {
    if (!logs) return
    let stop = false
    const pull = () => serverLogs(profile, server.name, logs.source).then((lines) => { if (!stop) setLogs((l) => (l && l.source === logs.source ? { ...l, lines } : l)) }).catch(() => undefined)
    void pull()
    const t = setInterval(pull, 2500)
    return () => { stop = true; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs?.source, profile, server.name])

  const needsSignIn = !!server.url && (server.auth === 'oauth' || /oauth/i.test(test?.error ?? ''))
  const status = !enabled ? { text: 'Off', tone: 'off' as const } : test === null && testing > 0 ? { text: 'Checking…', tone: 'run' as const }
    : test?.ok ? { text: `Working · for ${botName}`, tone: 'ok' as const } : needsSignIn ? { text: 'Needs you to sign in', tone: 'need' as const }
    : test ? { text: 'Not answering', tone: 'need' as const } : { text: `On · for ${botName}`, tone: 'ok' as const }
  const prefix = usagePrefix(entry)
  const tools = test?.ok ? test.tools : []
  const cfg = cfgs?.[server.name]

  const toggle = async (on: boolean) => {
    setEnabled(on)
    try { await setServerEnabled(profile, server.name, on); toast(on ? `${entry.name} is on.` : `${entry.name} is off.`); onChanged(); if (on) setTesting((n) => n + 1) } catch (e: any) { setEnabled(!on); setNote(e?.message) }
  }
  const toggleTool = async (tool: string) => {
    if (!cfgs || !cfg) return
    const next = { ...cfgs, [server.name]: toggleServerTool(cfg, tool) }
    setCfgs(next)
    try { await saveServerConfigs(profile, next) } catch (e: any) { setCfgs(cfgs); toast(e?.message ?? 'That didn’t save.') }
  }
  const saveKeyNow = async () => {
    setBusy('key')
    try { await setServerKey(profile, server.name, key.trim()); setKey(''); setKeyOpen(false); toast(`Saved the key for ${entry.name}.`); setTesting((n) => n + 1) } catch (e) { setNote(plain(e)) } finally { setBusy(null) }
  }
  const remove = async () => {
    const ok = await confirm({ title: `Remove ${entry.name}?`, body: `It leaves ${botName}’s servers on this Mac. Nothing else is deleted.`, action: 'Remove', danger: true })
    if (!ok) return
    setBusy('remove')
    try { await removeServer(profile, server.name); onRemoved(`Removed ${entry.name}.`) } catch (e: any) { setNote(e?.message); setBusy(null) }
  }
  const tq = q.trim().toLowerCase()
  const shownTools = tools.filter((x) => !tq || `${x.name} ${x.description}`.toLowerCase().includes(tq))
  const onCount = cfg ? tools.filter((x) => serverToolOn(cfg, x.name)).length : tools.length
  // What its tool list costs in every chat, roughly (Hermes Desktop's cost overlay): about four characters a token.
  const chars = tools.filter((x) => !cfg || serverToolOn(cfg, x.name)).reduce((n, x) => n + (x.schemaChars ?? 0), 0)
  const tokens = chars ? Math.round(chars / 4) : 0

  return (
    <>
      <StatusLine text={status.text} tone={status.tone} />
      {entry.catalog?.description ? <p className="mk-about">{entry.catalog.description}</p> : null}
      <Stats tools={test?.ok ? tools.length : entry.runtime?.tools || undefined} week={usageSum(usage?.week, prefix)} today={usageSum(usage?.today, prefix)} />
      {fromPlugin ? (
        <Note>Provided by the plugin {server.plugin ?? ''}. Turn it on or off in <button className="mk-link" onClick={() => setState({ view: 'settings', settingsPage: 'plugins' })}>Plugins</button>.</Note>
      ) : (
        <SwitchCard title="Hermes can use it" sub="Off keeps its settings for later" on={enabled} onChange={toggle} />
      )}
      {twin && enabled ? (
        <div className="mk-needs">
          <div className="tx"><b>Both are on, so Hermes sees every {twin.name} tool twice.</b><span>The managed {twin.name} from your Nous account is on too.</span></div>
          {!fromPlugin ? <div className="act"><button className="b-soft" onClick={() => void toggle(false)}>Turn off this one</button></div> : null}
        </div>
      ) : null}

      <div className="mk-lab">Where it runs</div>
      <div className="mk-code">{serverTarget(server) || server.name}</div>
      <div className="mk-meta">{[server.transport ? `Connects over ${server.transport}` : null, server.auth === 'oauth' ? 'Signs in with your account' : server.auth ? `Sign-in: ${server.auth}` : null].filter(Boolean).join(' · ')}</div>
      <div className="mk-actions">
        <RowButton onClick={() => setTesting((n) => n + 1)} busy={testing > 0 && test === null}>Test</RowButton>
        {needsSignIn && !fromPlugin ? <RowButton onClick={() => onConnect({ kind: 'server', name: entry.name, logo: entry.logo, server: server.name, profile })}>Sign in</RowButton> : null}
        {!fromPlugin ? <RowButton onClick={() => setKeyOpen((v) => !v)}>{server.url ? 'Set a key' : 'Set an API key'}</RowButton> : null}
        <RowButton onClick={() => setLogs((l) => (l ? null : { source: server.command ? 'stdio' : 'agent', lines: null }))}>{logs ? 'Hide log' : 'Log'}</RowButton>
        <span className="sp" />
        {!fromPlugin ? <RowButton kind="text" onClick={remove} busy={busy === 'remove'}>Remove</RowButton> : null}
      </div>
      {keyOpen ? (
        <div className="mk-inline col">
          <span className="mk-muted">{server.url ? 'Hermes sends it as a Bearer key with every request.' : 'Hermes passes it to the server as an environment key.'} It’s saved in {botName}’s keys and never shown again.</span>
          <div className="mk-inline-r">
            <input className="answer mono" type="password" autoFocus value={key} placeholder="Paste the key" autoComplete="off" onChange={(ev) => setKey(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter' && key.trim()) void saveKeyNow() }} />
            <button className="b-text" onClick={() => { setKeyOpen(false); setKey('') }}>Cancel</button>
            <RowButton onClick={saveKeyNow} busy={busy === 'key'} disabled={!key.trim()}>Save</RowButton>
          </div>
        </div>
      ) : null}
      {test && !test.ok && test.error ? <p className="mk-muted mk-err">{test.error}</p> : null}
      {logs ? (
        <div className="mk-logs">
          <Tabs<'stdio' | 'agent'> items={[{ key: 'stdio', label: 'Its output' }, { key: 'agent', label: 'Hermes log' }]} value={logs.source} onChange={(s) => setLogs({ source: s, lines: null })} />
          <pre className="mk-pre">{logs.lines === null ? 'Reading…' : logs.lines.length ? logs.lines.slice(-200).join('\n') : 'Nothing logged yet.'}</pre>
        </div>
      ) : null}

      {tools.length ? (
        <>
          <div className="mk-lab"><span>What Hermes may do</span><span className="sp" /><span>{cfg ? `${onCount} of ${tools.length} on` : plural(tools.length, 'tool')}{test?.prompts ? ` · ${plural(test.prompts, 'prompt')}` : ''}{test?.resources ? ` · ${plural(test.resources, 'resource')}` : ''}{tokens ? ` · about ${tokens >= 1000 ? `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}k` : tokens} tokens a chat` : ''}</span></div>
          {tools.length > 8 ? <div className="mk-toolbar"><Search value={q} onChange={setQ} placeholder={`Search ${tools.length} tools`} /></div> : null}
          <div className="card mk-tools">
            {shownTools.map((x) => (
              <div className="srow mk-tool" key={x.name} title={x.description}>
                <i className="dot off" />
                <div className="tx"><div className="t1"><span>{humanize(x.name)}</span></div><div className="t2">{x.description.split('\n')[0] || 'No description'}{x.schemaChars ? ` · ~${Math.max(1, Math.round(x.schemaChars / 4))} tokens` : ''}</div></div>
                {cfg && !fromPlugin ? <Switch on={serverToolOn(cfg, x.name)} onChange={() => void toggleTool(x.name)} label={x.name} /> : null}
              </div>
            ))}
            {!shownTools.length ? <div className="srow"><span className="mk-muted">No tools match.</span></div> : null}
          </div>
        </>
      ) : null}
      {note ? <Note tone="need" onDismiss={() => setNote(undefined)}>{note}</Note> : null}
    </>
  )
}
