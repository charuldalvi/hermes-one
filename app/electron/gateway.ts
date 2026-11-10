// Finds the local Hermes gateway and mints one-use tickets for it, the way Hermes Desktop does
// (apps/desktop/electron/local-gateway.ts): `hermes gateway ensure --json` names the endpoint, and the
// gateway's private control channel (same user only) hands out a ticket per connection. On a Mac or Linux
// that's a Unix socket this file talks to itself; on Windows it's a named pipe, reached through Hermes' own
// Python client (local-gateway-python.ts does the same), which also checks it's really Hermes on the other end.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

export interface GatewayEndpoint {
  api_origin: string
  instance_id: string
  profile_id: string
  control_home?: string | null
  runtime_protocol: number
  capabilities: string[]
}

const IS_WIN = process.platform === 'win32'

/** Where Hermes keeps its data when HERMES_HOME isn't set: ~/.hermes, or %LOCALAPPDATA%\hermes on Windows. */
export function defaultHermesHome(): string {
  if (!IS_WIN) return path.join(os.homedir(), '.hermes')
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), `hermes${process.env.HERMES_DATA_DIR_SUFFIX ?? ''}`)
}

/** The `hermes` command: HERMES_BIN, else where Hermes' installer puts it (Windows: <home>\bin\hermes.exe or .cmd). */
function hermesBin(): string {
  if (process.env.HERMES_BIN) return process.env.HERMES_BIN
  if (!IS_WIN) return path.join(os.homedir(), '.local/bin/hermes')
  for (const home of [process.env.HERMES_HOME, defaultHermesHome()]) {
    if (!home) continue
    for (const name of ['hermes.exe', 'hermes.cmd']) { const p = path.join(home, 'bin', name); if (existsSync(p)) return p }
  }
  return 'hermes' // on PATH
}
const HERMES_BIN = hermesBin()
let cached: GatewayEndpoint | null = null

/** Run `hermes <args>` and give back what it printed, when it looks like the answer (JSON). */
function run(bin: string, args: string[], timeoutMs = 90_000, looksRight = (out: string) => out.trim().startsWith('{')): Promise<string> {
  const extra = IS_WIN ? [] : ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin']
  const dirs = [path.isAbsolute(bin) ? path.dirname(bin) : '', ...extra, process.env.PATH ?? ''].filter(Boolean)
  // Windows runs a .cmd only through the shell, with its path quoted (it may have spaces).
  const shell = IS_WIN && /\.cmd$/i.test(bin)
  return new Promise((resolve, reject) => {
    execFile(shell ? `"${bin}"` : bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, shell, windowsHide: true, env: { ...process.env, PATH: dirs.join(path.delimiter) } },
      (error, stdout, stderr) => {
        if (stdout && looksRight(String(stdout))) return resolve(String(stdout))
        reject(new Error(`hermes ${args.join(' ')} failed${error ? `: ${error.message}` : ''}${stderr ? ` (${String(stderr).trim().split('\n').pop()})` : ''}`))
      })
  })
}

// One `ensure` at a time: when Hermes has stopped, it starts Hermes again (about 20 s), and the chat,
// tickets and REST calls that all notice at once must not each start their own.
let inflight: Promise<GatewayEndpoint> | null = null

export function ensureEndpoint(refresh = false): Promise<GatewayEndpoint> {
  if (cached && !refresh) return Promise.resolve(cached)
  if (!inflight) inflight = lookUp().finally(() => { inflight = null })
  return inflight
}

async function lookUp(): Promise<GatewayEndpoint> {
  const payload = JSON.parse(await run(HERMES_BIN, ['gateway', 'ensure', '--json']))
  const endpoint = payload?.endpoint as GatewayEndpoint | undefined
  if (!endpoint?.api_origin || !endpoint.instance_id) throw new Error(`Hermes isn't ready (${payload?.state ?? 'unknown'}${payload?.detail ? `: ${payload.detail}` : ''})`)
  const origin = new URL(endpoint.api_origin)
  if (!['127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Hermes gave a non-local address; refusing to connect')
  cached = endpoint
  return endpoint
}

async function controlSocketPath(home: string): Promise<string> {
  const direct = path.join(home, 'gateway.sock')
  try { if ((await fs.lstat(direct)).isSocket()) return direct } catch { /* try the pointer */ }
  const pointer = (await fs.readFile(path.join(home, 'gateway.sock.path'), 'utf8')).trim()
  if (!path.isAbsolute(pointer) || path.basename(pointer) !== 'control.sock') throw new Error('Invalid gateway control pointer')
  return pointer
}

function askControlSocket(socketPath: string, request: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    let buffer = ''
    const deadline = setTimeout(() => socket.destroy(new Error('Hermes ticket timed out')), 5000)
    socket.on('error', (e) => { clearTimeout(deadline); reject(e) })
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'))
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      if (!buffer.includes('\n')) return
      clearTimeout(deadline)
      try { resolve(JSON.parse(buffer.split('\n')[0])) } catch (e) { reject(e) }
      socket.destroy()
    })
  })
}

export type TicketPurpose = 'interactive' | 'native-http' | 'native-profile-create' | 'native-profile-registry'

export async function mintTicket(purpose: TicketPurpose = 'interactive', profileHome?: string, retried = false): Promise<string> {
  const endpoint = await ensureEndpoint(false)
  const home = profileHome || endpoint.profile_id
  const controlHome = endpoint.control_home || endpoint.profile_id
  try {
    if (IS_WIN) return await mintWithPython(endpoint, home, controlHome, purpose)
    const reply = await askControlSocket(await controlSocketPath(controlHome), {
      protocol: 1, id: 1, verb: 'session-ticket',
      params: { profile_id: home, instance_id: endpoint.instance_id, purpose, ...(purpose === 'interactive' ? { scope: 'host' } : {}) },
    })
    const grant = reply?.result
    if (!reply?.ok || typeof grant?.ticket !== 'string') throw new Error(reply?.error || 'Hermes refused a ticket')
    return grant.ticket
  } catch (error) {
    // A restarted gateway has a new instance id: look it up again once.
    if (!retried) { await ensureEndpoint(true); return mintTicket(purpose, profileHome, true) }
    throw error
  }
}

// ---- Windows: tickets from Hermes' own Python client (gateway_client._session_ticket), in a small helper
// process that stays up while tickets are wanted. Its script is Hermes Desktop's (local-gateway-python.ts).
export const TICKET_SCRIPT = `
import json, os, sys
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
with redirect_stdout(sys.stderr):
    from hermes_cli.gateway_client import _session_ticket
    from hermes_cli.gateway_runtime_discovery import DiscoveryError
while True:
    line = sys.stdin.buffer.readline(65537)
    if not line or len(line) > 65536 or not line.endswith(b'\\n'):
        break
    request = json.loads(line)
    try:
        with redirect_stdout(sys.stderr):
            endpoint = SimpleNamespace(**{'control_home': None, **request['endpoint']})
            home = Path(endpoint.profile_id)
            if str(home.resolve()) != endpoint.profile_id or endpoint.runtime_protocol != 1:
                raise ValueError('invalid ticket endpoint')
            ticket = _session_ticket(home, endpoint, purpose=request['purpose'],
                                     scope='host' if request['purpose'] == 'interactive' else None)
        reply = {'id': request['id'], 'ticket': ticket}
    except DiscoveryError as exc:
        reply = {'id': request['id'], 'error': exc.reason}
    except Exception as exc:
        reply = {'id': request['id'], 'error': type(exc).__name__}
    print(json.dumps(reply), flush=True)
`

/** Hermes' Python and its code folder: the launcher names its interpreter (`--print-runtime-command`). */
let runtime: Promise<{ python: string; root: string }> | null = null
function hermesRuntime() {
  runtime ??= (async () => {
    const out = await run(HERMES_BIN, ['--print-runtime-command'], 30_000, (o) => o.trim().startsWith('['))
    const python = JSON.parse(out)?.[0]
    if (typeof python !== 'string' || !path.isAbsolute(python) || !existsSync(python)) throw new Error('Hermes didn’t say which Python it runs on')
    const binDir = path.isAbsolute(HERMES_BIN) ? path.dirname(HERMES_BIN) : ''
    const roots = [process.env.HERMES_AGENT_ROOT, path.join(process.env.HERMES_HOME || defaultHermesHome(), 'hermes-agent'), binDir && path.resolve(binDir, '..', '..')]
    const root = roots.find((r) => !!r && existsSync(path.join(r, 'hermes_cli', 'gateway_client.py')))
    if (!root) throw new Error('Hermes’ code folder (hermes-agent) wasn’t found; set HERMES_AGENT_ROOT')
    return { python, root }
  })().catch((error) => { runtime = null; throw error })
  return runtime
}

/** Hermes' ticket client in a helper process (here, or on another computer over SSH): JSON lines in and out. */
export class TicketHelper {
  private child: ChildProcessWithoutNullStreams
  private waiting = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private next = 0
  private buffer = ''
  private idle?: ReturnType<typeof setTimeout>
  closed = false

  constructor(command: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
    this.child = spawn(command, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env })
    this.child.stderr.resume()
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (d) => this.receive(String(d)))
    this.child.on('error', () => this.close())
    this.child.stdin.on('error', () => this.close())
    this.child.on('close', () => this.close())
  }

  ask(endpoint: object, purpose: string): Promise<string> {
    clearTimeout(this.idle)
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('Hermes’ ticket helper stopped'))
      const id = ++this.next
      const timer = setTimeout(() => this.close(), 20_000)
      this.waiting.set(id, { resolve, reject, timer })
      this.child.stdin.write(`${JSON.stringify({ id, endpoint, purpose })}\n`)
    })
  }

  private receive(data: string) {
    this.buffer += data
    if (this.buffer.length > 65536) return this.close()
    let end: number
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 1)
      let reply: any
      try { reply = JSON.parse(line) } catch { return this.close() }
      const waiter = this.waiting.get(reply?.id)
      if (!waiter) return this.close()
      this.waiting.delete(reply.id)
      clearTimeout(waiter.timer)
      if (typeof reply.ticket === 'string' && reply.ticket) waiter.resolve(reply.ticket)
      else waiter.reject(new Error(`Hermes refused a ticket${reply.error ? ` (${reply.error})` : ''}`))
    }
    if (!this.waiting.size) this.idle = setTimeout(() => this.close(), 30_000)
  }

  close() {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.idle)
    for (const w of this.waiting.values()) { clearTimeout(w.timer); w.reject(new Error('Hermes’ ticket helper stopped')) }
    this.waiting.clear()
    this.child.kill()
  }
}

const helpers = new Map<string, TicketHelper>()
async function mintWithPython(endpoint: GatewayEndpoint, home: string, controlHome: string, purpose: TicketPurpose): Promise<string> {
  const { python, root } = await hermesRuntime()
  let helper = helpers.get(home)
  if (!helper || helper.closed) {
    helper = new TicketHelper(python, ['-P', '-u', '-c', TICKET_SCRIPT], { ...process.env, PYTHONPATH: root, HERMES_HOME: home, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, root)
    helpers.set(home, helper)
  }
  return helper.ask({ profile_id: home, instance_id: endpoint.instance_id, runtime_protocol: endpoint.runtime_protocol ?? 1, control_home: controlHome === home ? null : controlHome }, purpose)
}
