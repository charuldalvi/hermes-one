// Adding servers on this Mac (Hermes Remote's ConnectorsAddServer.kt and InstallSheet, plus Hermes
// Desktop's mcp.json editor): one from Hermes' catalog with the keys it declares, your own by web address
// or command, and the whole list edited by hand.
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../lib/icons'
import type { McpEntry } from '../../lib/api'
import { addServer, brandTitle, envFields, installCatalogServer, saveServerConfigs, serverConfigs } from '../../lib/api-market'
import { Dialog, Logo, Spinner, Tabs, confirm } from '../ui'
import type { ConnectRequest } from './ConnectFlow'
import { Note, openLink } from './parts'

export interface Added { message: string; signIn?: ConnectRequest }

/** "Runs on this Mac · sign in", "· needs a key", "· no sign-in". */
export function catalogMeta(e: McpEntry): string {
  const f = envFields(e.required_env)
  return 'Runs on this Mac · ' + (e.auth_type === 'oauth' ? 'sign in' : f.some((x) => x.required) || e.auth_type === 'api_key' ? 'needs a key' : 'no sign-in')
}

// ---------- from the catalog ----------

export function InstallServerDialog({ entry, logo, profile, botName, onClose, onDone }: { entry: McpEntry; logo?: string; profile: string; botName: string; onClose: () => void; onDone: (r: Added) => void }) {
  const [open, setOpen] = useState(true)
  const fields = envFields(entry.required_env)
  const [env, setEnv] = useState<Record<string, string>>({})
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()
  const name = brandTitle(entry.name)
  const close = () => { setOpen(false); setTimeout(onClose, 170) }
  const raw = entry as McpEntry & { command?: string | null; args?: string[]; post_install?: string; install_url?: string | null; bootstrap?: string[]; source?: string }
  const target = entry.url || [raw.command, (raw.args ?? []).join(' ')].filter(Boolean).join(' ')
  const ready = fields.filter((f) => f.required).every((f) => env[f.name]?.trim())
  const oauth = entry.auth_type === 'oauth'

  const add = async () => {
    const ok = await confirm({ title: `Add ${name}?`, body: `Hermes connects to it from this Mac and can use its tools in every chat with ${botName}.`, action: oauth ? 'Add and sign in' : 'Add' })
    if (!ok) return
    setWorking(true); setError(undefined)
    try {
      const r = await installCatalogServer(profile, entry, env)
      setOpen(false)
      setTimeout(() => onDone({
        message: r.background ? `Adding ${name} on this Mac. It shows up here when it’s ready.` : `Added ${name}.`,
        signIn: oauth && !r.background ? { kind: 'server', name, logo, server: entry.name, profile } : undefined,
      }), 170)
    } catch (e: any) { setError(e?.message ?? String(e)); setWorking(false) }
  }
  return (
    <Dialog open={open} onClose={close} width={540} title={<><Logo src={logo} name={name} size={28} /><span>Add {name}</span></>}
      footer={<><span className="mk-muted">{catalogMeta(entry)}</span><span className="sp" /><button className="b-text" onClick={close}>Cancel</button><button className="b-pri" disabled={!ready || working} onClick={add}>{working ? <Spinner size={12} /> : null}{oauth ? 'Add and sign in' : 'Add'}</button></>}>
      {entry.description ? <p className="mk-about">{entry.description}</p> : null}
      {fields.map((f) => (
        <label className="mk-field" key={f.name}>
          <span>{f.prompt ?? f.name}{f.required ? '' : ' (optional)'}</span>
          <input className="answer mono" type="password" autoComplete="off" placeholder={f.name} value={env[f.name] ?? ''} onChange={(ev) => setEnv((m) => ({ ...m, [f.name]: ev.target.value }))} />
        </label>
      ))}
      {fields.length ? <p className="mk-muted">Keys are saved in {botName}’s keys on this Mac and never shown again.</p> : null}
      <div className="mk-lab">What runs</div>
      <div className="mk-code">{target || entry.name}{raw.install_url ? `\nBuilt from ${raw.install_url}` : ''}{raw.bootstrap?.length ? `\n${raw.bootstrap.join('\n')}` : ''}</div>
      <p className="mk-muted">Hermes runs it on this Mac with your keys.{raw.install_url ? ' It downloads and builds it first, which can take a minute.' : ''}</p>
      {raw.post_install?.trim() ? <p className="mk-muted mk-pre-wrap">{raw.post_install.trim()}</p> : null}
      {raw.source && /^https?:\/\//.test(raw.source) ? <button className="b-text mk-left" onClick={() => openLink(raw.source)}><Icon name="external" size={14} />Read about it</button> : null}
      {error ? <Note tone="bad">{error}</Note> : null}
    </Dialog>
  )
}

// ---------- your own ----------

interface Draft { name?: string; url?: string; command?: string; env: Record<string, string> }

/** "https://mcp.example.com/mcp" → "example". */
function nameFromUrl(url: string): string | undefined {
  const host = /^https?:\/\/([^/:?#]+)/.exec(url.trim())?.[1]
  if (!host) return undefined
  const parts = host.toLowerCase().split('.').filter((p) => p && !['mcp', 'www', 'api', 'server'].includes(p))
  return parts.slice(0, -1).pop() || parts[0]
}
/** Splits a command line on spaces, keeping quoted parts together. */
export function splitCommand(c: string): string[] {
  const out: string[] = []
  for (const m of c.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3])
  return out.length ? out : [c]
}
/** "npx -y @modelcontextprotocol/server-github" → "github". */
function nameFromCommand(c: string): string | undefined {
  const last = [...splitCommand(c)].reverse().find((p) => !p.startsWith('-'))
  const n = last?.split('/').pop()?.replace(/^server-/, '').replace(/^mcp-/, '').replace(/-mcp$/, '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  return n || undefined
}
/** A copied snippet as a server: an mcp.json block (`mcpServers` or a bare map), a URL, or a command line. */
function parseSnippet(text: string): Draft | null {
  const t = text.trim()
  if (!t) return null
  if (/^https?:\/\//.test(t)) return { url: t.split('\n')[0].trim(), env: {} }
  if (t.startsWith('{')) {
    let root: any
    try { root = JSON.parse(t) } catch { return null }
    const servers = root.mcpServers ?? root.servers ?? root.mcp_servers
    let n: string | undefined, cfg: any
    if (servers && typeof servers === 'object') { const k = Object.keys(servers)[0]; if (!k) return null; n = k; cfg = servers[k] }
    else if ('url' in root || 'command' in root) cfg = root
    else { const k = Object.keys(root)[0]; if (!k) return null; n = k; cfg = root[k] }
    if (!cfg || typeof cfg !== 'object') return null
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(cfg.env ?? {})) env[k] = String(v ?? '')
    const cmd = typeof cfg.command === 'string' ? [cfg.command, ...(Array.isArray(cfg.args) ? cfg.args : [])].map((a: string) => (/\s/.test(a) ? `"${a}"` : a)).join(' ') : undefined
    return { name: n?.toLowerCase().replace(/[^a-z0-9_-]/g, ''), url: cfg.url ?? cfg.serverUrl, command: cmd, env }
  }
  const first = t.split('\n')[0].trim()
  return first.split(' ').length >= 2 || /^(npx|uvx|docker|node|python)/.test(first) ? { command: first, env: {} } : null
}

type Auth = 'none' | 'oauth' | 'header'

export function AddServerDialog({ profile, botName, onClose, onAdded }: { profile: string; botName: string; onClose: () => void; onAdded: (r: Added) => void }) {
  const [open, setOpen] = useState(true)
  const [kind, setKind] = useState<'url' | 'cmd'>('url')
  const [url, setUrl] = useState('')
  const [auth, setAuth] = useState<Auth>('none')
  const [bearer, setBearer] = useState('')
  const [command, setCommand] = useState('')
  const [env, setEnv] = useState<{ k: string; v: string }[]>([])
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const [snippet, setSnippet] = useState<string | null>(null)
  const [note, setNote] = useState<string>()
  const [error, setError] = useState<string>()
  const [working, setWorking] = useState(false)
  const close = () => { setOpen(false); setTimeout(onClose, 170) }

  useEffect(() => { if (!touched && kind === 'url') { const n = nameFromUrl(url); if (n) setName(n) } }, [url, kind, touched])
  useEffect(() => { if (!touched && kind === 'cmd') { const n = nameFromCommand(command); if (n) setName(n) } }, [command, kind, touched])

  const fill = (text: string) => {
    const d = parseSnippet(text)
    if (!d) { setNote('That doesn’t read as a server. Fill it in below.'); return }
    if (d.name) { setName(d.name); setTouched(true) }
    if (d.url) { setKind('url'); setUrl(d.url) } else if (d.command) {
      setKind('cmd'); setCommand(d.command); setEnv(Object.entries(d.env).map(([k, v]) => ({ k, v })))
    }
    setSnippet(null)
    setNote('Filled in from what you pasted.')
  }

  const vars = useMemo(() => { const m: Record<string, string> = {}; for (const r of env) if (r.k.trim()) m[r.k.trim()] = r.v; return m }, [env])
  const ready = !!name.trim() && (kind === 'url' ? /^https?:\/\/\S+/.test(url.trim()) && (auth !== 'header' || !!bearer.trim()) : !!command.trim())
  const add = async () => {
    const n = name.trim()
    const what = kind === 'url' ? `Hermes connects to ${url.trim()} from this Mac.` : `Hermes runs “${command.trim()}” on this Mac, as you.`
    if (!(await confirm({ title: `Add ${n}?`, body: what, action: kind === 'url' && auth === 'oauth' ? 'Add and sign in' : 'Add' }))) return
    setWorking(true); setError(undefined)
    try {
      if (kind === 'url') await addServer(profile, { name: n, url: url.trim(), auth, bearer: bearer.trim() || undefined })
      else { const parts = splitCommand(command.trim()); await addServer(profile, { name: n, command: parts[0], args: parts.slice(1), env: vars }) }
      const title = brandTitle(n)
      setOpen(false)
      setTimeout(() => onAdded({ message: `Added ${title}.`, signIn: kind === 'url' && auth === 'oauth' ? { kind: 'server', name: title, server: n, profile } : undefined }), 170)
    } catch (e: any) { setError(e?.message ?? String(e)); setWorking(false) }
  }

  return (
    <Dialog open={open} onClose={close} width={560} title="Add your own server"
      footer={<><span className="sp" /><button className="b-text" onClick={close}>Cancel</button><button className="b-pri" disabled={!ready || working} onClick={add}>{working ? <Spinner size={12} /> : null}{kind === 'url' && auth === 'oauth' ? 'Add and sign in' : 'Add'}</button></>}>
      <p className="mk-about">Hermes runs it on this Mac for {botName} and can use its tools.</p>
      <Tabs<'url' | 'cmd'> items={[{ key: 'url', label: 'Web address' }, { key: 'cmd', label: 'Command on this Mac' }]} value={kind} onChange={setKind} />
      {kind === 'url' ? (
        <>
          <label className="mk-field"><span>Address</span><input className="answer mono" autoFocus placeholder="https://mcp.example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value.trim())} /></label>
          <div className="mk-field"><span>How it signs in</span>
            <Tabs<Auth> items={[{ key: 'none', label: 'No sign-in' }, { key: 'oauth', label: 'With my account' }, { key: 'header', label: 'With a key' }]} value={auth} onChange={setAuth} />
          </div>
          {auth === 'oauth' ? <p className="mk-muted">After adding it, its sign-in page opens in your browser.</p> : null}
          {auth === 'header' ? <label className="mk-field"><span>Key</span><input className="answer mono" type="password" autoComplete="off" placeholder="Sent as a Bearer key" value={bearer} onChange={(e) => setBearer(e.target.value)} /></label> : null}
        </>
      ) : (
        <>
          <label className="mk-field"><span>Command</span><input className="answer mono" autoFocus placeholder="npx -y @modelcontextprotocol/server-filesystem ~/Documents" value={command} onChange={(e) => setCommand(e.target.value)} /></label>
          <div className="mk-field"><span>Keys it needs</span>
            {env.map((r, i) => (
              <div className="mk-envrow" key={i}>
                <input className="answer mono" placeholder="NAME" value={r.k} onChange={(e) => setEnv((l) => l.map((x, j) => (j === i ? { ...x, k: e.target.value.replace(/\s/g, '') } : x)))} />
                <input className="answer mono" type="password" autoComplete="off" placeholder="value" value={r.v} onChange={(e) => setEnv((l) => l.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
                <button className="hbtn" aria-label="Remove key" onClick={() => setEnv((l) => l.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
              </div>
            ))}
            <button className="b-text mk-left" onClick={() => setEnv((l) => [...l, { k: '', v: '' }])}><Icon name="plus" size={14} />Add a key</button>
          </div>
          <Note tone="need">It runs on this Mac as you, with your files and accounts.</Note>
        </>
      )}
      <label className="mk-field"><span>Name</span><input className="answer mono" placeholder="example" value={name} onChange={(e) => { setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40)); setTouched(true) }} /></label>
      {snippet === null ? (
        <button className="mk-paste" onClick={() => setSnippet('')}><Icon name="copy" size={15} /><span>Paste a snippet to fill this in</span><span className="mk-muted">mcp.json, a web address or a command</span></button>
      ) : (
        <label className="mk-field"><span>Snippet</span>
          <textarea className="answer mono" rows={5} autoFocus placeholder={'{ "mcpServers": { "example": { "url": "https://…" } } }'} value={snippet}
            onChange={(e) => setSnippet(e.target.value)} onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t) { e.preventDefault(); fill(t) } }} />
          <div className="mk-inline-r end"><button className="b-text" onClick={() => setSnippet(null)}>Cancel</button><button className="b-soft" disabled={!snippet.trim()} onClick={() => fill(snippet)}>Fill in</button></div>
        </label>
      )}
      {note ? <Note onDismiss={() => setNote(undefined)}>{note}</Note> : null}
      {error ? <Note tone="bad">{error}</Note> : null}
    </Dialog>
  )
}

// ---------- by hand ----------

/** The whole list of this bot's servers as mcp.json, edited by hand and saved in one go. */
export function ServersJsonDialog({ profile, botName, onClose, onSaved }: { profile: string; botName: string; onClose: () => void; onSaved: () => void }) {
  const [open, setOpen] = useState(true)
  const [text, setText] = useState<string | null>(null)
  const [orig, setOrig] = useState('')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const close = () => { setOpen(false); setTimeout(onClose, 170) }
  useEffect(() => {
    serverConfigs(profile).then((m) => { const s = JSON.stringify({ mcpServers: m }, null, 2); setText(s); setOrig(s) }).catch((e) => { setError(e?.message ?? String(e)); setText('') })
  }, [profile])
  const parse = (): Record<string, any> | null => {
    try {
      const j = JSON.parse(text ?? '')
      const m = j?.mcpServers ?? j?.mcp_servers ?? j
      if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('Expected an object of servers.')
      for (const [k, v] of Object.entries(m)) if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`“${k}” should be an object.`)
      return m
    } catch (e: any) { setError(`That isn’t valid: ${e?.message ?? e}`); return null }
  }
  const save = async () => {
    const m = parse()
    if (!m) return
    setSaving(true); setError(undefined)
    try { await saveServerConfigs(profile, m); setOpen(false); setTimeout(onSaved, 170) } catch (e: any) { setError(e?.message ?? String(e)); setSaving(false) }
  }
  const dirty = text !== null && text !== orig
  return (
    <Dialog open={open} onClose={close} wide title={`${botName}’s servers as mcp.json`}
      footer={<>
        <button className="b-text" disabled={!text} onClick={() => { const m = parse(); if (m) { setText(JSON.stringify({ mcpServers: m }, null, 2)); setError(undefined) } }}>Tidy up</button>
        <span className="sp" /><button className="b-text" onClick={close}>Cancel</button>
        <button className="b-pri" disabled={!dirty || saving} onClick={save}>{saving ? <Spinner size={12} /> : null}Save</button>
      </>}>
      <p className="mk-about">Every server this agent has on this Mac. Saving replaces the whole list, so removing one here removes it. Servers that come with a plugin aren’t listed.</p>
      {text === null ? <div className="mk-center"><Spinner /></div> : <textarea className="answer mono mk-json" spellCheck={false} value={text} onChange={(e) => { setText(e.target.value); setError(undefined) }} />}
      {error ? <Note tone="bad">{error}</Note> : null}
    </Dialog>
  )
}
