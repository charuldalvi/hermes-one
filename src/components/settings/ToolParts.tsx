// Settings › Tools, opened: one group of tools and everything that sets it up. Which provider it uses
// (with the keys each needs, a one-time install, and an image or video model to pick), where commands
// run, Computer Use's permissions on this Mac, and the real-browser-profile switch. Parity with Hermes
// Desktop's toolset detail (toolset-config-panel, terminal-backend-panel, computer-use-panel,
// browser-real-profile-panel) and Hermes Remote's ToolsetSheet.
import { useEffect, useState } from 'react'
import type { Toolset } from '../../lib/api'
import {
  computerUseStatus, configRecord, deleteEnvKey, followAction, grantComputerUse, patchConfig, runPostSetup, setTerminalBackend, setToolsetEnv,
  setToolsetModel, setToolsetProvider, tail, terminalBackends, toolsetConfig, toolsetModels, type ProviderStatus, type TerminalBackend, type ToolEnvVar, type ToolProvider,
} from '../../lib/api-capabilities'
import { toast } from '../../lib/hermes'
import { Icon } from '../../lib/icons'
import { setState } from '../../lib/store'
import { Badge, confirm, Dialog, ErrorLine, Spinner, Switch, useAsync } from '../ui'
import { Chips, errText, LogBox, Note } from './cap-parts'

const MODEL_CATALOG = new Set(['image_gen', 'video_gen'])
const Loading = ({ text }: { text: string }) => <div className="cap-row cap-dim" style={{ padding: '6px 0' }}><Spinner />{text}</div>

/** What each group lets Hermes do, in plain words (Hermes' own descriptions are mostly tool names). */
export const BLURB: Record<string, string> = {
  web: 'Search the web and read pages.', browser: 'Open websites in a browser, and click, type and scroll as you would.', terminal: 'Run commands and programs.',
  file: 'Read, write and change files.', code_execution: 'Write and run small programs to work things out.', vision: 'Look at images and say what’s in them.',
  video: 'Watch videos and say what happens (needs a model that can).', image_gen: 'Make images from a description.', video_gen: 'Make and edit short videos.',
  x_search: 'Search posts on X.', tts: 'Read replies out loud.', stt: 'Turn voice messages into text.', skills: 'Find, read and write skills.',
  todo: 'Keep a to-do list while it works.', kanban: 'Work from a shared task board.', memory: 'Remember things between chats.', context_engine: 'Tools from the context engine in use.',
  session_search: 'Look back through past chats.', connections: 'Use the apps you’ve connected, and ask you to connect more.', clarify: 'Ask you a question when something isn’t clear.',
  delegation: 'Hand parts of a job to helpers.', cronjob: 'Set up jobs that run on a schedule.', discord: 'Read and join in on Discord.', discord_admin: 'Look after a Discord server: channels, roles and pins.',
  yuanbao: 'Work in Yuanbao groups and messages.', computer_use: 'Use the apps on this Mac: look, click and type.', a2a: 'Talk to other AI agents.',
  homeassistant: 'Control your smart home through Home Assistant.', messaging: 'Send messages through your chat apps.', spotify: 'Play and control music on Spotify.',
}
/** True when a description is only the tool names again ("web_search, web_extract"). */
export function onlyToolNames(desc: string | undefined, tools: string[] = []) {
  if (!desc) return true
  const parts = desc.split(/,\s*/).map((s) => s.trim()).filter(Boolean)
  return parts.length > 0 && parts.every((p) => tools.includes(p)) && parts.length === tools.length
}

// ---------- the dialog ----------

export function ToolsetDialog({ profile, toolset, bot, calls, onClose, onToggle, onChanged }: {
  profile: string; toolset: Toolset & { platform_label?: string }; bot: string; calls: Record<string, number>; onClose: () => void; onToggle: (on: boolean) => void; onChanged: () => void
}) {
  const tools = toolset.tools ?? []
  const name = toolset.name
  return (
    <Dialog open onClose={onClose} wide title={<span className="cap-dh"><span className="nm">{toolset.label || name}</span>{toolset.configured === false ? <Badge tone="need">Needs a key</Badge> : null}</span>}
      footer={<><span className="cap-dim">Changes apply to new chats.</span><span className="sp" /><button className="b-text" onClick={onClose}>Close</button></>}>
      <div className="cap-meta">
        <span>{tools.length ? `${tools.length} tool${tools.length === 1 ? '' : 's'}` : 'No tools of its own'}</span>
        {toolset.available === false ? <span>Not available on this Mac yet</span> : null}
        <span style={{ marginLeft: 'auto' }} className="cap-row"><span className="cap-dim">{toolset.enabled ? 'On' : 'Off'}</span><Switch on={toolset.enabled} onChange={onToggle} label={`${toolset.label || name} on`} /></span>
      </div>
      {BLURB[name] || !onlyToolNames(toolset.description, tools) ? <p className="cap-desc">{BLURB[name] ?? toolset.description}</p> : null}
      {BLURB[name] && !onlyToolNames(toolset.description, tools) && toolset.description!.length > 60 ? <p className="cap-dim" style={{ whiteSpace: 'pre-wrap', margin: '-6px 0 14px' }}>{toolset.description!.trim()}</p> : null}
      <div className="cap-h3">What {bot} can do with it</div>
      <Chips items={tools} counts={calls} empty="Nothing to show." />

      {name === 'vision' ? (
        <>
          <div className="cap-h3">Model</div>
          <Note>Seeing images uses the vision model set in Models.<button className="b-text" onClick={() => setState({ settingsPage: 'models' })}>Open Models</button></Note>
        </>
      ) : null}
      {name === 'computer_use' ? <><div className="cap-h3">Permissions on this Mac</div><ComputerUsePanel onChanged={onChanged} /></> : null}
      {name === 'browser' ? <><div className="cap-h3">Signing in to sites</div><BrowserProfile profile={profile} /></> : null}
      {name === 'terminal' ? <><div className="cap-h3">Where commands run</div><TerminalPanel profile={profile} bot={bot} onChanged={onChanged} /></> : null}
      <ProviderPanel profile={profile} toolset={name} onChanged={onChanged} />
    </Dialog>
  )
}

// ---------- providers ----------

const STATUS: Record<ProviderStatus, { label: string; tone: 'ok' | 'need' }> = {
  ready: { label: 'Ready', tone: 'ok' }, needs_keys: { label: 'Needs a key', tone: 'need' }, needs_auth: { label: 'Needs sign-in', tone: 'need' }, needs_setup: { label: 'Needs installing', tone: 'need' },
}
/** Keys saved here are patched in without a refetch, so they win over the server's word. */
function statusOf(p: ToolProvider, env: Record<string, boolean>): ProviderStatus {
  if (p.env_vars.length) return p.env_vars.every((v) => env[v.key]) ? (p.status === 'needs_setup' ? 'needs_setup' : 'ready') : 'needs_keys'
  return p.status ?? 'ready'
}
function servesCapability(p: ToolProvider, backend?: string | null, viaNous?: boolean) {
  if (p.managed_nous_feature) return !!viaNous
  return !!(p.web_backend && backend === p.web_backend && !viaNous && p.is_active)
}

function ProviderPanel({ profile, toolset, onChanged }: { profile: string; toolset: string; onChanged: () => void }) {
  const cfg = useAsync(() => toolsetConfig(profile, toolset), [profile, toolset])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [claimed, setClaimed] = useState(false)
  const [selecting, setSelecting] = useState<string | null>(null)
  const [nousNeeded, setNousNeeded] = useState<string | null>(null)
  const providers = cfg.data?.providers ?? []
  // which keys are saved, read from the config and patched in place when you save or remove one
  const env: Record<string, boolean> = {}
  for (const p of providers) for (const v of p.env_vars) env[v.key] = v.is_set
  const setEnv = (key: string, set: boolean) =>
    cfg.setData((cur) => cur && { ...cur, providers: cur.providers.map((p) => ({ ...p, env_vars: p.env_vars.map((v) => (v.key === key ? { ...v, is_set: set } : v)) })) })

  // open the provider in use (else the first ready one) once, when the setup first arrives
  useEffect(() => {
    if (claimed || !providers.length) return
    const first = providers.find((p) => p.is_active) ?? providers.find((p) => p.name === cfg.data?.active_provider) ?? providers.find((p) => statusOf(p, env) === 'ready') ?? providers[0]
    setExpanded(first.name); setClaimed(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.data])

  if (cfg.loading && !cfg.data) return <><div className="cap-h3">Provider</div><Loading text="Reading its setup…" /></>
  if (cfg.error && !cfg.data) return <><div className="cap-h3">Provider</div><ErrorLine text={`Couldn’t read its setup: ${cfg.error}`} onRetry={() => void cfg.reload()} /></>
  const c = cfg.data
  if (!c || !c.has_category) return null
  if (!providers.length) return <><div className="cap-h3">Provider</div><div className="cap-dim">Nothing to choose for this group.</div></>

  const use = async (p: ToolProvider, capability?: 'search' | 'extract') => {
    if (selecting) return
    setClaimed(true); setExpanded(p.name); setSelecting(p.name)
    try {
      const r = await setToolsetProvider(profile, toolset, p.name, capability)
      if (r?.needs_nous_auth) { setNousNeeded(p.name); toast(`${p.name} is chosen. Sign in to Nous Portal to switch it on.`) } else { setNousNeeded(null); toast(capability ? `${p.name} now handles ${capability === 'search' ? 'search' : 'reading pages'}` : `Using ${p.name}`) }
      if (capability || r?.needs_nous_auth) await cfg.reload(true)
      else cfg.setData((cur) => cur && { ...cur, active_provider: p.name, providers: cur.providers.map((x) => ({ ...x, is_active: x.name === p.name })) })
      onChanged()
    } catch (e) { toast(`Couldn’t switch to ${p.name}: ${errText(e)}`) } finally { setSelecting(null) }
  }
  const managedName = providers.find((p) => p.managed_nous_feature)?.name

  return (
    <>
      <div className="cap-h3">Provider<span className="sp" /><button className="hbtn" aria-label="Check again" title="Check again" onClick={() => void cfg.reload(true)}><Icon name="refresh" size={14} /></button></div>
      {toolset === 'web' && c.active_search_backend !== undefined ? (
        <div className="cap-row" style={{ marginBottom: 10 }}>
          <Badge tone="quiet">Search: {(c.search_via_nous && managedName) || c.active_search_backend || 'not set'}</Badge>
          <Badge tone="quiet">Reading pages: {(c.extract_via_nous && managedName) || c.active_extract_backend || 'not set'}</Badge>
        </div>
      ) : null}
      {nousNeeded ? <Note tone="need">{nousNeeded} comes with a Nous Portal subscription. Sign in under Keys and accounts to switch it on.<button className="b-text" onClick={() => setState({ settingsPage: 'keys' })}>Open Keys and accounts</button></Note> : null}
      {providers.map((p) => {
        const open = expanded === p.name
        const active = p.is_active || c.active_provider === p.name
        const st = statusOf(p, env)
        const caps = toolset === 'web' ? p.capabilities ?? [] : []
        const search = servesCapability(p, c.active_search_backend, c.search_via_nous)
        const extract = servesCapability(p, c.active_extract_backend, c.extract_via_nous)
        return (
          <div key={p.name} className={`cap-prov${open ? ' open' : ''}`}>
            <button className="ph" aria-expanded={open} onClick={() => { setClaimed(true); setExpanded(open ? null : p.name) }}>
              <b>{p.name}</b>
              {p.badge ? <Badge tone="quiet">{p.badge.replace(/★\s*/, '')}</Badge> : null}
              {active ? <Badge><Icon name="check" size={12} />In use</Badge> : null}
              {!active && st === 'ready' ? <Badge tone="ok">Ready</Badge> : null}
              {st !== 'ready' ? <Badge tone={STATUS[st].tone}>{STATUS[st].label}</Badge> : null}
              {search ? <Badge tone="quiet">Search</Badge> : null}
              {extract ? <Badge tone="quiet">Reading pages</Badge> : null}
              <span className="sp" />{selecting === p.name ? <Spinner /> : null}<Icon name="chevD" size={14} />
            </button>
            {open ? (
              <div className="pb">
                {p.tag ? <div className="cap-dim">{p.tag}</div> : null}
                {!caps.length ? (
                  active ? <div className="cap-row cap-dim"><i className="dot ok" />{toolset === 'tts' || toolset === 'stt' ? 'This is the voice Hermes uses.' : 'Hermes uses this one.'}</div>
                    : <div><button className="b-soft" disabled={!!selecting} onClick={() => void use(p)}>{selecting === p.name ? 'Switching…' : 'Use this one'}</button></div>
                ) : (
                  <div className="cap-row">
                    {caps.includes('search') ? <button className="b-soft" disabled={!!selecting || search} onClick={() => void use(p, 'search')}>{search ? 'Handles search' : 'Use for search'}</button> : null}
                    {caps.includes('extract') ? <button className="b-soft" disabled={!!selecting || extract} onClick={() => void use(p, 'extract')}>{extract ? 'Handles reading pages' : 'Use for reading pages'}</button> : null}
                  </div>
                )}
                {p.requires_nous_auth && st === 'needs_auth' ? <div className="cap-dim">Included with a Nous Portal subscription: sign in under Keys and accounts.</div> : null}
                {p.env_vars.length ? p.env_vars.map((v) => (
                  <EnvKey key={v.key} profile={profile} toolset={toolset} v={v} isSet={!!env[v.key]} onSet={(k, set) => { setEnv(k, set); onChanged() }} />
                )) : !p.post_setup && !p.requires_nous_auth ? <div className="cap-dim">No key needed.</div> : null}
                {p.post_setup ? <PostSetup profile={profile} toolset={toolset} k={p.post_setup} installed={p.status === 'ready'} onDone={() => { void cfg.reload(true); onChanged() }} /> : null}
                {MODEL_CATALOG.has(toolset) ? <ModelPicker profile={profile} toolset={toolset} provider={p.name} active={active} /> : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

function EnvKey({ profile, toolset, v, isSet, onSet }: { profile: string; toolset: string; v: ToolEnvVar; isSet: boolean; onSet: (key: string, set: boolean) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!value.trim()) return
    setBusy(true)
    try { const r = await setToolsetEnv(profile, toolset, { [v.key]: value }); onSet(v.key, r?.is_set?.[v.key] ?? true); setEditing(false); setValue(''); toast(`Saved ${v.key}`) } catch (e) { toast(`Couldn’t save ${v.key}: ${errText(e)}`) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!(await confirm({ title: `Remove ${v.key}?`, body: 'Tools that use it stop working until you add it again.', action: 'Remove', danger: true }))) return
    setBusy(true)
    try { await deleteEnvKey(profile, v.key); onSet(v.key, false); toast(`Removed ${v.key}`) } catch (e) { toast(`Couldn’t remove ${v.key}: ${errText(e)}`) } finally { setBusy(false) }
  }
  return (
    <div className="cap-key">
      <div className="kh">
        <span className="k">{v.key}</span>{isSet ? <Badge tone="ok"><Icon name="check" size={12} />Saved</Badge> : <Badge tone="quiet">Not set</Badge>}
        <span className="sp" />
        {v.url ? <button className="cap-link" onClick={() => void window.hermesNative.openExternal(v.url!)}>Get a key<Icon name="external" size={12} /></button> : null}
        {!editing ? <button className="b-text" onClick={() => setEditing(true)} disabled={busy}>{isSet ? 'Change' : 'Add'}</button> : null}
        {isSet && !editing ? <button className="b-ghost-danger" onClick={() => void remove()} disabled={busy}>Remove</button> : null}
      </div>
      {v.prompt && v.prompt !== v.key ? <div className="kp">{v.prompt}</div> : null}
      {editing ? (
        <div className="ke">
          <input className="answer mono" type={v.default ? 'text' : 'password'} autoFocus autoComplete="off" spellCheck={false} placeholder={v.default ?? v.prompt ?? v.key} value={value} disabled={busy}
            onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) } }} />
          <button className="b-soft" onClick={() => void save()} disabled={busy || !value.trim()}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="b-text" onClick={() => { setEditing(false); setValue('') }} disabled={busy}>Cancel</button>
        </div>
      ) : null}
    </div>
  )
}

/** A provider's one-time install (an npm, pip or app download) run by Hermes, its log tailed here. */
function PostSetup({ profile, toolset, k, installed, onDone }: { profile: string; toolset: string; k: string; installed: boolean; onDone: () => void }) {
  const [running, setRunning] = useState(false)
  const [lines, setLines] = useState<string[] | null>(null)
  const run = async () => {
    setRunning(true); setLines([])
    try {
      const r = await followAction(profile, await runPostSetup(profile, toolset, k), setLines)
      if (r.exit_code === 0) toast('Installed') ; else toast(`The install didn’t finish: ${tail(r, 1) || 'see the details'}`)
      onDone()
    } catch (e) { toast(`Couldn’t install: ${errText(e)}`) } finally { setRunning(false) }
  }
  return (
    <div className="cap-key">
      <div className="kh">
        <span className="kp" style={{ flex: 1 }}>{installed ? 'Installed on this Mac.' : 'Needs a one-time install on this Mac.'}</span>
        {installed ? <Badge tone="ok"><Icon name="check" size={12} />Installed</Badge> : null}
        <button className={installed ? 'b-text' : 'b-soft'} onClick={() => void run()} disabled={running}>
          <span className="cap-row">{running ? <Spinner size={12} /> : <Icon name="download" size={14} />}{running ? 'Installing…' : installed ? 'Install again' : 'Install'}</span>
        </button>
      </div>
      {lines && (lines.length || running) ? <LogBox lines={lines} /> : null}
    </div>
  )
}

function ModelPicker({ profile, toolset, provider, active }: { profile: string; toolset: string; provider: string; active: boolean }) {
  const m = useAsync(() => toolsetModels(profile, toolset, provider).catch(() => null), [profile, toolset, provider])
  const [saving, setSaving] = useState<string | null>(null)
  if (m.loading && !m.data) return <Loading text="Reading its models…" />
  const d = m.data
  if (!d?.has_models || !d.models.length) return null
  const selected = d.current ?? d.default
  const pick = async (id: string) => {
    setSaving(id)
    try { await setToolsetModel(profile, toolset, id, provider); m.setData({ ...d, current: id }); toast(`Model: ${d.models.find((x) => x.id === id)?.display || id}`) } catch (e) { toast(`Couldn’t pick that model: ${errText(e)}`) } finally { setSaving(null) }
  }
  return (
    <div>
      <div className="cap-h3" style={{ marginTop: 6 }}>Model<span className="cap-dim" style={{ fontWeight: 400 }}>{d.models.length} to choose from</span></div>
      {!active ? <div className="cap-dim" style={{ marginBottom: 8 }}>Use {provider} first, then pick its model.</div> : null}
      <div className="cap-opts">
        {d.models.map((x) => (
          <button key={x.id} className={`cap-opt${selected === x.id ? ' on' : ''}`} aria-pressed={selected === x.id} disabled={!active || !!saving} onClick={() => void pick(x.id)} style={!active ? { opacity: 0.6 } : undefined}>
            <span className="oh"><b>{x.display || x.id}</b>{selected === x.id ? <Badge><Icon name="check" size={12} />In use</Badge> : d.default === x.id ? <Badge tone="quiet">Default</Badge> : null}<span className="sp" />{saving === x.id ? <Spinner size={12} /> : null}</span>
            <span className="om">{x.speed ? <span>{x.speed}</span> : null}{x.strengths ? <span>{x.strengths}</span> : null}{x.price ? <span>{x.price}</span> : null}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- where commands run ----------

const BACKEND: Record<TerminalBackend['status'], { label: string; tone: 'ok' | 'need' | 'bad' }> = {
  ready: { label: 'Ready', tone: 'ok' }, needs_setup: { label: 'Needs setup', tone: 'need' }, unavailable: { label: 'Not available', tone: 'bad' },
}

export function TerminalPanel({ profile, bot, onChanged }: { profile: string; bot: string; onChanged?: () => void }) {
  const d = useAsync(() => terminalBackends(profile), [profile])
  const [selecting, setSelecting] = useState<string | null>(null)
  if (d.loading && !d.data) return <Loading text="Checking where commands can run…" />
  if (d.error && !d.data) return <ErrorLine text={`Couldn’t check: ${d.error}`} onRetry={() => void d.reload()} />
  if (!d.data) return null
  const pick = async (b: TerminalBackend) => {
    if (b.active || selecting) return
    if (b.status !== 'ready' && !(await confirm({ title: `Use ${b.label} anyway?`, body: `${b.detail || 'It isn’t set up yet.'} Until it is, ${bot} can’t run commands or work with files.`, action: 'Use it anyway' }))) return
    setSelecting(b.name)
    try {
      await setTerminalBackend(profile, b.name)
      d.setData((cur) => cur && { ...cur, active: b.name, backends: cur.backends.map((x) => ({ ...x, active: x.name === b.name })) })
      toast(`Commands now run on ${b.label}`); onChanged?.()
    } catch (e) { toast(`Couldn’t switch to ${b.label}: ${errText(e)}`) } finally { setSelecting(null) }
  }
  return (
    <div className="cap-opts">
      {d.data.backends.map((b) => (
        <button key={b.name} className={`cap-opt${b.active ? ' on' : ''}`} aria-pressed={b.active} disabled={!!selecting} onClick={() => void pick(b)}>
          <span className="oh"><b>{b.label}</b><Badge tone={BACKEND[b.status]?.tone}>{BACKEND[b.status]?.label ?? b.status}</Badge>{b.active ? <Badge><Icon name="check" size={12} />In use</Badge> : null}<span className="sp" />{selecting === b.name ? <Spinner size={12} /> : null}</span>
          <span className="od">{b.description}</span>
          {b.status !== 'ready' && b.detail ? <span className="ow">{b.detail}{b.active ? ' Commands won’t run until this is fixed.' : ''}</span> : null}
        </button>
      ))}
    </div>
  )
}

// ---------- Computer Use on this Mac ----------

const grantBadge = (g: boolean | null) => (g === true ? <Badge tone="ok">Allowed</Badge> : g === false ? <Badge tone="need">Not allowed</Badge> : <Badge tone="quiet">Unknown</Badge>)

export function ComputerUsePanel({ onChanged, onInstall }: { onChanged?: () => void; onInstall?: () => void }) {
  const s = useAsync(computerUseStatus, [])
  const [granting, setGranting] = useState(false)
  const grant = async () => {
    setGranting(true)
    try {
      const started = await grantComputerUse()
      toast('Approve the request in System Settings, then come back here.')
      await followAction('default', started, undefined, 1500, 150)
      await s.reload(true); onChanged?.()
    } catch (e) { toast(`Couldn’t ask for permission: ${errText(e)}`) } finally { setGranting(false) }
  }
  if (s.loading && !s.data) return <Loading text="Checking Computer Use…" />
  if (s.error && !s.data) return <ErrorLine text={`Couldn’t check Computer Use: ${s.error}`} onRetry={() => void s.reload()} />
  const d = s.data
  if (!d) return null
  if (!d.platform_supported) return <div className="cap-dim">Computer Use doesn’t work on this system ({d.platform}).</div>
  if (!d.installed) return <Note tone="need">Computer Use needs its helper app (cua-driver) installed first{onInstall ? '.' : ': use Install under its provider below.'}{onInstall ? <button className="b-text" onClick={onInstall}>Set it up</button> : null}</Note>
  const failing = (d.checks ?? []).filter((c) => c.status !== 'ok')
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="card">
        {d.can_grant ? (
          <>
            <div className="srow"><div className="tx"><div className="t1"><span>Accessibility</span></div><div className="t2">Lets it click, type and read what’s on screen.</div></div><div className="act">{grantBadge(d.accessibility)}</div></div>
            <div className="srow"><div className="tx"><div className="t1"><span>Screen recording</span></div><div className="t2">Lets it take pictures of app windows.</div></div><div className="act">{grantBadge(d.screen_recording)}</div></div>
          </>
        ) : <div className="srow"><div className="tx"><div className="t1"><span>Helper health</span></div></div><div className="act">{d.ready === true ? <Badge tone="ok">Ready</Badge> : d.ready === false ? <Badge tone="need">Not ready</Badge> : <Badge tone="quiet">Unknown</Badge>}</div></div>}
      </div>
      {failing.map((c) => <Note key={c.label} tone="need">{c.label}: {c.message}</Note>)}
      {d.error ? <Note tone="bad">{d.error}</Note> : null}
      <div className="cap-row">
        {d.ready ? <span className="cap-row cap-dim"><i className="dot ok" />Ready. Ask Hermes to look at an app and click around.</span>
          : d.can_grant ? <button className="b-soft" onClick={() => void grant()} disabled={granting}><span className="cap-row">{granting ? <Spinner size={12} /> : <Icon name="shield" size={14} />}{granting ? 'Waiting for you to allow it…' : 'Allow on this Mac'}</span></button> : null}
        <span className="sp" style={{ flex: 1 }} />
        {d.version ? <span className="cap-use">{d.version}</span> : null}
        <button className="b-text" onClick={() => void s.reload()}>Check again</button>
      </div>
      {d.can_grant && !d.ready ? <div className="cap-dim">macOS asks on behalf of CuaDriver, the helper that does the clicking, not Hermes.</div> : null}
    </div>
  )
}

// ---------- the browser's real profile ----------

function BrowserProfile({ profile }: { profile: string }) {
  const cfg = useAsync(() => configRecord(profile), [profile])
  const [busy, setBusy] = useState(false)
  const on = !!cfg.data?.browser?.use_real_profile
  const set = async (v: boolean) => {
    const before = cfg.data
    setBusy(true); cfg.setData((c) => c && { ...c, browser: { ...(c.browser ?? {}), use_real_profile: v } })
    try { await patchConfig(profile, { browser: { use_real_profile: v } }); toast(v ? 'New chats browse already signed in' : 'New chats use a clean browser; the copy is deleted') } catch (e) { cfg.setData(before); toast(`Couldn’t change that: ${errText(e)}`) } finally { setBusy(false) }
  }
  if (cfg.error && !cfg.data) return <ErrorLine text={`Couldn’t read this setting: ${cfg.error}`} onRetry={() => void cfg.reload()} />
  return (
    <div className="card">
      <div className="srow">
        <div className="tx"><div className="t1"><span>Use your real browser profile</span></div>
          <div className="t2">Copies your browser’s sign-ins and cookies into a separate copy Hermes browses with, so sites open signed in. Your own profile is never opened, and nothing leaves this Mac.</div></div>
        <div className="act"><Switch on={on} onChange={(v) => void set(v)} disabled={busy || !cfg.data} label="Use your real browser profile" /></div>
      </div>
    </div>
  )
}
