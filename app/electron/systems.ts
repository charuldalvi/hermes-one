// Systems: Hermes on this computer, or on another one, one at a time (the sidebar footer switches).
//
//   local    Hermes on this Mac/PC: `hermes gateway ensure`, one-use tickets from its private control channel.
//   address  Hermes behind Tailscale or another address (https://<machine>.ts.net, http://100.x.y.z:9129), as
//            Hermes Remote reaches it: signed in with the Hermes password (the RFC 8252 native flow) or a
//            pairing link; REST carries `Authorization: Bearer`, the socket a ticket from /api/auth/ws-ticket.
//   ssh      Hermes on a computer you can SSH into: `hermes gateway ensure` runs there, an SSH tunnel brings its
//            gateway to 127.0.0.1 here, and tickets come from Hermes' own ticket client run there over SSH, so
//            everything works exactly as it does locally.
//
// The list lives in <userData>/systems.json; sign-ins (access and refresh tokens) are encrypted with the
// system keychain (safeStorage) in <userData>/system-tokens.bin.
import { app, safeStorage } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { ensureEndpoint, mintTicket, TICKET_SCRIPT, TicketHelper, type GatewayEndpoint, type TicketPurpose } from './gateway'

export type SystemKind = 'local' | 'address' | 'ssh'
export interface SystemDef {
  id: string; name: string; kind: SystemKind
  url?: string; user?: string
  host?: string; port?: number; key?: string; hermes?: string
}
export interface SystemRow extends SystemDef { active: boolean; detail: string; signedIn?: boolean }

export interface Conn {
  def: SystemDef
  endpoint(refresh?: boolean): Promise<GatewayEndpoint>
  ticket(purpose: TicketPurpose, profileHome?: string): Promise<string>
  /** Headers that sign a REST call; `home` is the profile's home on that computer (native tickets need it). */
  restAuth(purpose: TicketPurpose, home: string): Promise<Record<string, string>>
  /** The profile's home on that computer, from its root and a profile name. */
  profileHome(root: string, profile: string | null): Promise<string>
  close(): void
}

const LOCAL: SystemDef = { id: 'local', name: process.platform === 'darwin' ? 'This Mac' : 'This PC', kind: 'local' }
const file = () => path.join(app.getPath('userData'), 'systems.json')
const tokenFile = () => path.join(app.getPath('userData'), 'system-tokens.bin')
const readJson = (p: string) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const fail = (message: string) => new Error(message)
const shq = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`

// ---------------------------------------------------------------------------------------------------
// Sign-ins for address systems: { [id]: { access_token, refresh_token, expires_at, provider } }
// ---------------------------------------------------------------------------------------------------
interface Tokens { access_token: string; refresh_token?: string; expires_at?: number; provider?: string }
function loadTokens(): Record<string, Tokens> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return {}
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(tokenFile())))
  } catch { return {} }
}
function saveTokens(all: Record<string, Tokens>) {
  if (!safeStorage.isEncryptionAvailable()) throw fail('This computer can’t keep the sign-in safely (no keychain), so it wasn’t saved.')
  fs.writeFileSync(tokenFile(), safeStorage.encryptString(JSON.stringify(all)), { mode: 0o600 })
}
const setTokens = (id: string, t: Tokens | null) => { const all = loadTokens(); if (t) all[id] = t; else delete all[id]; saveTokens(all) }

/** A base address the way Hermes Remote takes it: https://host[:port] or http://<private address>:port, no path. */
export function cleanAddress(raw: string): string {
  let text = String(raw ?? '').trim()
  if (!text) throw fail('Type the address of that computer’s Hermes.')
  if (!/^[a-z]+:\/\//i.test(text)) text = (/^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(text) || /^localhost(:\d+)?$/.test(text) ? 'http://' : 'https://') + text
  let u: URL
  try { u = new URL(text) } catch { throw fail('That isn’t an address Hermes One can use.') }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw fail('Use an https:// or http:// address.')
  // Plain http only inside your own network (Tailscale 100.x, LAN, this computer): a password must not cross the internet unencrypted.
  if (u.protocol === 'http:' && !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|localhost$|\[::1\]$)/.test(u.hostname) && !u.hostname.endsWith('.ts.net')) {
    throw fail('Plain http is only for addresses inside your own network (like Tailscale’s 100.x addresses). Use https:// for this one.')
  }
  return `${u.protocol}//${u.host}`
}

async function jsonFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 20_000) })
  const text = await res.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  return { res, body, text }
}
const reach = (base: string, error: unknown) => {
  const msg = String((error as any)?.cause?.code ?? (error as any)?.message ?? error)
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return fail(`Can’t find ${new URL(base).hostname}. Is Tailscale on, on both computers?`)
  if (/ECONNREFUSED/.test(msg)) return fail(`${new URL(base).host} refused the connection. Is Hermes serving there?`)
  if (/abort|timeout/i.test(msg)) return fail(`${new URL(base).host} didn’t answer in time.`)
  return fail(`Couldn’t reach ${new URL(base).host}: ${msg}`)
}
const tokensFrom = (body: any): Tokens => {
  if (!body?.access_token) throw fail('That computer’s Hermes didn’t give a sign-in back.')
  return { access_token: body.access_token, refresh_token: body.refresh_token, expires_at: Number(body.expires_at) || undefined, provider: body.provider }
}

/** Sign in with the Hermes user name and password (the same flow Hermes Remote uses). */
export async function passwordSignIn(base: string, user: string, password: string): Promise<Tokens> {
  const verifier = crypto.randomBytes(36).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  const state = crypto.randomBytes(9).toString('base64url')
  const q = new URLSearchParams({ code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: 'http://127.0.0.1:53682/cb', state, provider: 'basic' })
  let cookies = ''
  try {
    const start = await fetch(`${base}/auth/native/authorize?${q}`, { redirect: 'manual', signal: AbortSignal.timeout(20_000) })
    if (![200, 302, 303].includes(start.status)) throw fail(start.status === 404 ? 'That address doesn’t sign in like Hermes does. Is it Hermes’ own address?' : `That computer’s Hermes answered ${start.status}.`)
    cookies = (start.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  } catch (error: any) { throw error?.message?.startsWith('That') ? error : reach(base, error) }
  const login = await jsonFetch(`${base}/auth/password-login`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookies ? { cookie: cookies } : {}) }, body: JSON.stringify({ provider: 'basic', username: user, password, next: '' }) })
  if (login.res.status === 401) throw fail('Wrong user name or password.')
  if (login.res.status === 429) throw fail('Too many tries. Wait a minute, then try again.')
  if (!login.res.ok || !login.body?.next) throw fail(login.body?.detail ? String(login.body.detail) : `Signing in failed (${login.res.status}).`)
  const next = new URL(login.body.next)
  if (next.searchParams.get('state') !== state || !next.searchParams.get('code')) throw fail('Signing in got muddled; try again.')
  const token = await jsonFetch(`${base}/auth/native/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: next.searchParams.get('code'), code_verifier: verifier }) })
  if (!token.res.ok) throw fail(`Signing in failed (${token.res.status}).`)
  return tokensFrom(token.body)
}

/** A pairing link (hermesremote://pair?v=1&u=<server>&n=<user>&c=<code>&k=<verifier>): its server, user and tokens. */
export async function pairingSignIn(link: string): Promise<{ url: string; user: string; tokens: Tokens }> {
  let u: URL
  try { u = new URL(String(link).trim()) } catch { throw fail('That isn’t a pairing link.') }
  const server = u.searchParams.get('u'), code = u.searchParams.get('c'), verifier = u.searchParams.get('k')
  if (!/^hermes[a-z-]*:$/i.test(u.protocol) || !server || !code || !verifier) throw fail('That isn’t a pairing link.')
  const base = cleanAddress(server)
  let r
  try { r = await jsonFetch(`${base}/auth/native/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, code_verifier: verifier }) }) } catch (error) { throw reach(base, error) }
  if (r.res.status === 400 || r.res.status === 401) throw fail('That pairing link has expired or was used already. Make a new one on that computer.')
  if (!r.res.ok) throw fail(`Pairing failed (${r.res.status}).`)
  return { url: base, user: u.searchParams.get('n') ?? '', tokens: tokensFrom(r.body) }
}

class AddressConn implements Conn {
  private base: string
  private refreshing: Promise<Tokens> | null = null
  constructor(public def: SystemDef) { this.base = cleanAddress(def.url ?? '') }
  private async access(force = false): Promise<string> {
    let t = loadTokens()[this.def.id]
    if (!t?.access_token) throw Object.assign(fail(`Sign in to ${this.def.name} again.`), { code: 'signin' })
    const soon = t.expires_at && t.expires_at * (t.expires_at < 1e12 ? 1000 : 1) - Date.now() < 60_000
    if ((force || soon) && t.refresh_token) {
      this.refreshing ??= (async () => {
        const r = await jsonFetch(`${this.base}/auth/native/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: t!.refresh_token, provider: t!.provider ?? 'basic' }) })
        if (!r.res.ok) { setTokens(this.def.id, null); throw Object.assign(fail(`Your sign-in to ${this.def.name} ran out. Sign in again.`), { code: 'signin' }) }
        const fresh = tokensFrom(r.body)
        setTokens(this.def.id, { ...fresh, refresh_token: fresh.refresh_token ?? t!.refresh_token })
        return fresh
      })().finally(() => { this.refreshing = null })
      t = await this.refreshing
    }
    return t.access_token
  }
  async endpoint(): Promise<GatewayEndpoint> {
    try { await jsonFetch(`${this.base}/api/status`, { timeoutMs: 10_000 }) } catch (error) { throw reach(this.base, error) }
    return { api_origin: this.base, instance_id: `address:${this.def.id}`, profile_id: '', control_home: null, runtime_protocol: 1, capabilities: [] }
  }
  async ticket(): Promise<string> {
    for (const force of [false, true]) {
      let r
      try { r = await jsonFetch(`${this.base}/api/auth/ws-ticket`, { method: 'POST', headers: { authorization: `Bearer ${await this.access(force)}` } }) } catch (error: any) { if (error?.code === 'signin') throw error; throw reach(this.base, error) }
      if (r.res.status === 401 && !force) continue
      if (!r.res.ok || typeof r.body?.ticket !== 'string') throw fail(r.res.status === 401 ? `Sign in to ${this.def.name} again.` : `${this.def.name} wouldn’t open a connection (${r.res.status}).`)
      return r.body.ticket
    }
    throw fail(`Sign in to ${this.def.name} again.`)
  }
  async restAuth(): Promise<Record<string, string>> { return { authorization: `Bearer ${await this.access()}` } }
  async profileHome(): Promise<string> { return '' }
  close() {}
}

// ---------------------------------------------------------------------------------------------------
// SSH: Hermes' gateway there, tunnelled here, with tickets from its own client run there.
// ---------------------------------------------------------------------------------------------------
const freePort = () => new Promise<number>((resolve, reject) => {
  const srv = net.createServer()
  srv.once('error', reject)
  srv.listen(0, '127.0.0.1', () => { const port = (srv.address() as net.AddressInfo).port; srv.close(() => resolve(port)) })
})
const portOpen = (port: number) => new Promise<boolean>((resolve) => {
  const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); resolve(true) }); s.once('error', () => resolve(false))
})

class SshConn implements Conn {
  private tunnel: ChildProcess | null = null
  private remote: GatewayEndpoint | null = null
  private local = 0
  private python: Promise<{ python: string; root: string }> | null = null
  private helpers = new Map<string, TicketHelper>()
  private closed = false
  constructor(public def: SystemDef) {}
  private base(): string[] {
    const ctl = path.join(app.getPath('userData'), 'ssh')
    fs.mkdirSync(ctl, { recursive: true, mode: 0o700 })
    return [
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
      ...(process.platform === 'win32' ? [] : ['-o', 'ControlMaster=auto', '-o', `ControlPath=${path.join(ctl, '%C')}`, '-o', 'ControlPersist=120']),
      ...(this.def.port ? ['-p', String(this.def.port)] : []),
      ...(this.def.key ? ['-i', this.def.key.replace(/^~(?=\/|$)/, os.homedir()), '-o', 'IdentitiesOnly=yes'] : []),
    ]
  }
  /** `hermes <args>` on that computer, with ~/.local/bin on PATH (where Hermes' installer puts it). */
  private hermes(args: string): string { return `PATH="$HOME/.local/bin:$PATH" ${this.def.hermes ? shq(this.def.hermes) : 'hermes'} ${args}` }
  private run(command: string, timeoutMs = 90_000): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('ssh', [...this.base(), this.def.host!, command], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
        if (stdout && stdout.trim()) return resolve(String(stdout))
        const why = String(stderr || error?.message || '').trim().split('\n').pop() ?? ''
        if (/Permission denied|publickey/i.test(why)) return reject(fail(`SSH to ${this.def.host} was refused (no key it accepts). Check the key, or that \`ssh ${this.def.host}\` works without a password.`))
        if (/Could not resolve|Name or service not known|nodename nor servname/i.test(why)) return reject(fail(`Can’t find ${this.def.host}.`))
        if (/timed out|Connection refused/i.test(why)) return reject(fail(`${this.def.host} didn’t answer on SSH.`))
        if (/command not found|No such file/i.test(why)) return reject(fail(`Hermes isn’t on ${this.def.host}’s PATH. Set where it is.`))
        reject(fail(why || `SSH to ${this.def.host} failed.`))
      })
    })
  }
  async endpoint(refresh = false): Promise<GatewayEndpoint> {
    if (this.remote && this.tunnel && this.tunnel.exitCode === null && !refresh && await portOpen(this.local)) return this.view()
    const out = await this.run(this.hermes('gateway ensure --json'))
    const payload = JSON.parse(out.slice(out.indexOf('{')))
    const ep = payload?.endpoint as GatewayEndpoint | undefined
    if (!ep?.api_origin) throw fail(`Hermes on ${this.def.name} isn’t ready (${payload?.state ?? 'unknown'}).`)
    const rport = Number(new URL(ep.api_origin).port)
    if (!this.tunnel || this.tunnel.exitCode !== null || this.remote?.api_origin !== ep.api_origin) {
      this.tunnel?.kill()
      this.local = await freePort()
      this.tunnel = spawn('ssh', [...this.base(), '-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${this.local}:127.0.0.1:${rport}`, this.def.host!], { stdio: 'ignore', windowsHide: true })
      const t0 = Date.now()
      while (!(await portOpen(this.local))) {
        if (this.tunnel.exitCode !== null || Date.now() - t0 > 15_000) throw fail(`The SSH tunnel to ${this.def.name} didn’t open.`)
        await new Promise((r) => setTimeout(r, 150))
      }
    }
    this.remote = ep
    return this.view()
  }
  private view(): GatewayEndpoint { return { ...this.remote!, api_origin: `http://127.0.0.1:${this.local}` } }
  private runtime() {
    this.python ??= (async () => {
      const out = await this.run(this.hermes('--print-runtime-command'), 30_000)
      const argv = JSON.parse(out.slice(out.indexOf('[')))
      const python = argv?.[0]
      if (typeof python !== 'string' || !python.startsWith('/')) throw fail(`Hermes on ${this.def.name} didn’t say which Python it runs on.`)
      const root = /sys\.path\.insert\(0, '([^']+)'\)/.exec(String(argv.join(' ')))?.[1] ?? '$HOME/.hermes/hermes-agent'
      return { python, root }
    })().catch((error) => { this.python = null; throw error })
    return this.python
  }
  async ticket(purpose: TicketPurpose, profileHome?: string): Promise<string> {
    const ep = this.remote ?? await this.endpoint()
    const home = profileHome || ep.profile_id
    const control = ep.control_home || ep.profile_id
    const { python, root } = await this.runtime()
    let helper = this.helpers.get(home)
    if (!helper || helper.closed) {
      const script = `import base64;exec(base64.b64decode('${Buffer.from(TICKET_SCRIPT).toString('base64')}'))`
      const remote = `env HERMES_HOME=${shq(home)} PYTHONPATH=${root.startsWith('$') ? `"${root}"` : shq(root)} PYTHONIOENCODING=utf-8 PYTHONUTF8=1 ${shq(python)} -P -u -c ${shq(script)}`
      helper = new TicketHelper('ssh', [...this.base(), this.def.host!, remote], process.env)
      this.helpers.set(home, helper)
    }
    return helper.ask({ profile_id: home, instance_id: ep.instance_id, runtime_protocol: ep.runtime_protocol ?? 1, control_home: control === home ? null : control }, purpose)
  }
  async restAuth(purpose: TicketPurpose, home: string): Promise<Record<string, string>> { return { 'X-Hermes-Gateway-Ticket': await this.ticket(purpose, home) } }
  async profileHome(root: string, profile: string | null): Promise<string> {
    if (!profile || profile === 'default' || profile === 'current') return root
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile)) throw fail('Invalid profile name')
    return path.posix.join(root, 'profiles', profile)
  }
  close() {
    if (this.closed) return
    this.closed = true
    for (const h of this.helpers.values()) h.close()
    this.tunnel?.kill()
    if (process.platform !== 'win32') execFile('ssh', [...this.base(), '-O', 'exit', this.def.host!], () => {})
  }
}

class LocalConn implements Conn {
  def = LOCAL
  endpoint(refresh = false) { return ensureEndpoint(refresh) }
  ticket(purpose: TicketPurpose, profileHome?: string) { return mintTicket(purpose, profileHome) }
  async restAuth(purpose: TicketPurpose, home: string) { return { 'X-Hermes-Gateway-Ticket': await mintTicket(purpose, home) } }
  async profileHome(root: string, profile: string | null): Promise<string> {
    if (!profile || profile === 'default' || profile === 'current') return root
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile)) throw fail('Invalid profile name')
    const dir = path.join(root, 'profiles', profile)
    // Windows: the system's own spelling of the path (as Python's resolve() gives it), which tickets must match.
    try { return process.platform === 'win32' ? fs.realpathSync.native(dir) : await fs.promises.realpath(dir) } catch { return dir }
  }
  close() {}
}

// ---------------------------------------------------------------------------------------------------
// The list and the active one.
// ---------------------------------------------------------------------------------------------------
export function createSystems() {
  const saved = readJson(file()) ?? {}
  let list: SystemDef[] = Array.isArray(saved.systems) ? saved.systems.filter((s: any) => s && s.id && s.name && (s.kind === 'address' || s.kind === 'ssh')) : []
  let activeId: string = list.some((s) => s.id === saved.active) ? saved.active : 'local'
  // A test copy can start on another system (HERMES_ONE_SYSTEM=<id>).
  if (process.env.HERMES_ONE_SYSTEM && list.some((s) => s.id === process.env.HERMES_ONE_SYSTEM)) activeId = process.env.HERMES_ONE_SYSTEM
  const save = () => fs.writeFileSync(file(), JSON.stringify({ active: activeId, systems: list }, null, 2))
  const make = (def: SystemDef): Conn => (def.kind === 'address' ? new AddressConn(def) : def.kind === 'ssh' ? new SshConn(def) : new LocalConn())
  let conn: Conn = make(list.find((s) => s.id === activeId) ?? LOCAL)

  const detail = (s: SystemDef) => (s.kind === 'local' ? 'Hermes here' : s.kind === 'ssh' ? `SSH · ${s.host}` : new URL(cleanAddress(s.url ?? '')).hostname.endsWith('.ts.net') ? `Tailscale · ${new URL(cleanAddress(s.url!)).hostname.split('.')[0]}` : new URL(cleanAddress(s.url!)).host)
  const idFor = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'system'}-${crypto.randomBytes(3).toString('hex')}`

  return {
    conn: () => conn,
    active: () => conn.def,
    rows(): SystemRow[] {
      const tokens = loadTokens()
      return [LOCAL, ...list].map((s) => ({ ...s, active: s.id === conn.def.id, detail: detail(s), ...(s.kind === 'address' ? { signedIn: !!tokens[s.id]?.access_token } : {}) }))
    },
    switchTo(id: string) {
      const def = id === 'local' ? LOCAL : list.find((s) => s.id === id)
      if (!def) throw fail('That system isn’t in the list any more.')
      if (def.id === conn.def.id) return false
      conn.close()
      activeId = def.id
      conn = make(def)
      save()
      return true
    },
    /** Add (and sign in to) a system; it doesn't switch. */
    async add(input: { kind: 'address' | 'ssh'; name: string; url?: string; user?: string; password?: string; pairing?: string; host?: string; port?: number; key?: string; hermes?: string }) {
      const name = String(input.name ?? '').trim().slice(0, 40)
      if (input.kind === 'address') {
        let url = input.url ? cleanAddress(input.url) : ''
        let user = String(input.user ?? '').trim()
        let tokens: Tokens
        if (input.pairing?.trim()) ({ url, user, tokens } = await pairingSignIn(input.pairing))
        else {
          if (!url) throw fail('Type the address of that computer’s Hermes.')
          if (!user || !input.password) throw fail('Type the Hermes user name and password of that computer.')
          tokens = await passwordSignIn(url, user, input.password)
        }
        const def: SystemDef = { id: idFor(name || new URL(url).hostname), name: name || new URL(url).hostname.split('.')[0], kind: 'address', url, user }
        setTokens(def.id, tokens)
        // It must open a connection too (the ticket route), not just sign in.
        await new AddressConn(def).ticket()
        list = [...list, def]; save()
        return def
      }
      const host = String(input.host ?? '').trim()
      if (!/^[A-Za-z0-9_.@:\-[\]]+$/.test(host) || host.startsWith('-')) throw fail('Type the computer as user@host, or a name from your SSH config.')
      const port = Number(input.port) || undefined
      if (port !== undefined && (port < 1 || port > 65535)) throw fail('That port isn’t a port.')
      const def: SystemDef = { id: idFor(name || host), name: name || host.replace(/^.*@/, ''), kind: 'ssh', host, port, key: input.key?.trim() || undefined, hermes: input.hermes?.trim() || undefined }
      const probe = new SshConn(def)
      try { await probe.endpoint(); await probe.ticket('interactive') } finally { probe.close() }
      list = [...list, def]; save()
      return def
    },
    /** Sign in again to an address system whose sign-in ran out. */
    async signIn(id: string, password: string) {
      const def = list.find((s) => s.id === id)
      if (!def || def.kind !== 'address') throw fail('That system doesn’t sign in with a password.')
      setTokens(id, await passwordSignIn(cleanAddress(def.url!), def.user ?? '', password))
    },
    remove(id: string) {
      if (id === 'local') throw fail('This computer stays in the list.')
      const wasActive = conn.def.id === id
      list = list.filter((s) => s.id !== id)
      try { setTokens(id, null) } catch { /* nothing kept */ }
      if (wasActive) { conn.close(); activeId = 'local'; conn = make(LOCAL) }
      save()
      return wasActive
    },
    close() { conn.close() },
  }
}
export type Systems = ReturnType<typeof createSystems>
