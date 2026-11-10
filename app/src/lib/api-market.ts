// The Connectors page and the Marketplace, as Hermes Remote has them (domain/Connectors.kt and
// domain/Marketplace.kt): managed apps from your Nous account over the socket, servers on this Mac per
// profile over REST, the plugin catalog, the skills hub, and the wording and judgements both pages share.
// Typed calls that already live in api.ts are reused; the rest are here.
import {
  at, get, rest, rpc, hostedCatalog, hostedList, accounts as listAccounts, mcpServers, mcpCatalog,
  type Account, type CatalogPlugin, type HostedApp, type HostedStatus, type McpEntry, type McpServer,
} from './api'
import { gateway } from './gateway'

const enc = encodeURIComponent
const ACCOUNT = { type: 'account' }

// ---------- what Hermes says when it refuses ----------

/** Hermes' reason for refusing a connectors call (`error.data.reason`); OLD_HERMES when it doesn't know the method. */
export function reasonOf(e: any): string | undefined {
  const r = e?.data?.reason
  if (typeof r === 'string' && r) return r
  return e?.code === -32601 ? 'OLD_HERMES' : undefined
}

/** The plain sentence for a failure: Hermes' reason in words, or its own message. */
export function plain(e: any): string {
  switch (reasonOf(e)) {
    case 'NEEDS_NOUS_AUTH': return 'Sign in to Nous to use managed apps. Your servers on this Mac still work.'
    case 'CONNECTORS_UNAVAILABLE': return 'Managed apps are not available for this account yet.'
    case 'OLD_HERMES': return 'This Hermes is too old for managed apps. Update it on your Mac.'
    case 'POLICY_CONFLICT': return 'Someone changed this while you were looking.'
    case 'ALIAS_TAKEN': return 'Another account already has that name.'
    case 'ORG_REQUIRED': return 'Pick an organisation on your Nous account first.'
    case 'ORG_ACCESS_DENIED': return 'This account can’t manage apps for its organisation.'
    case 'FORBIDDEN_SCOPE': return 'Your account isn’t allowed to change apps.'
    case 'CONNECTOR_REQUEST_FAILED': return 'Nous didn’t answer. Try again in a moment.'
    case 'LINK_STILL_VALID': return 'The sign-in page is still open. Use Open the page again.'
    case 'CONNECTOR_NOT_FOUND': return 'That app isn’t in the catalog any more.'
    case 'TOOLS_UNAVAILABLE': return 'The tool list can’t be read right now.'
    case 'READ_ONLY': return 'Rules can’t be changed right now.'
  }
  const m = e?.message
  return typeof m === 'string' && m.trim() ? m : 'Something went wrong.'
}

/** Failures that mean managed apps can't be used here at all, as opposed to one call failing. */
export const closesManaged = (e: any) => ['NEEDS_NOUS_AUTH', 'CONNECTORS_UNAVAILABLE', 'OLD_HERMES'].includes(reasonOf(e) ?? '')

// ---------- brand names ----------

const KNOWN: Record<string, string> = {
  gmail: 'Gmail', googlecalendar: 'Google Calendar', googledrive: 'Google Drive', googledocs: 'Google Docs', googlesheets: 'Google Sheets',
  googleslides: 'Google Slides', googlemeet: 'Google Meet', googletasks: 'Google Tasks', googlemaps: 'Google Maps', github: 'GitHub', gitlab: 'GitLab',
  hubspot: 'HubSpot', clickup: 'ClickUp', youtube: 'YouTube', linkedin: 'LinkedIn', paypal: 'PayPal', wordpress: 'WordPress', huggingface: 'Hugging Face',
  circleci: 'CircleCI', n8n: 'n8n', x: 'X', twitter: 'X', icloud: 'iCloud', awsknowledge: 'AWS Knowledge', microsoftlearn: 'Microsoft Learn',
  deepwiki: 'DeepWiki', betterstack: 'Better Stack', unrealengine: 'Unreal Engine', prisma: 'Prisma Postgres', twiliodocs: 'Twilio Docs',
  alltrails: 'AllTrails', motherduck: 'MotherDuck', comfycloud: 'Comfy Cloud', twelvedata: 'Twelve Data', rentahuman: 'Rent a Human', monday: 'monday.com',
}
const ALIASES: Record<string, string> = { twitter: 'x', hugging_face: 'huggingface', n8nofficial: 'n8n', prismapostgres: 'prisma', wordpresscom: 'wordpress', googlesuper: 'google' }

/** "google_calendar", "Google-Calendar" → "googlecalendar"; a few catalog names map onto their brand. */
export function brandKey(raw: string): string {
  const k = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
  return ALIASES[k] ?? ALIASES[raw.toLowerCase()] ?? k
}
export function brandTitle(raw: string): string {
  const k = brandKey(raw)
  if (KNOWN[k]) return KNOWN[k]
  const t = raw.replace(/[_-]+/g, ' ').trim().split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
  return t || raw
}
/** A brand's logo, the way Hermes' managed catalog draws them. */
export const brandLogo = (raw: string) => `https://logos.composio.dev/api/${enc(raw)}`

// ---------- managed apps: policy ----------

/** One policy layer's rules (organisation, role, or yours). `allowed` null means every app. */
export interface PolicyRules { allowed: Set<string> | null; denied: Set<string>; revision: string; tools: Record<string, string[]>; tagsDisable: string[]; tagsEnable: string[] }
/** Who may use what: your own layer and the ones above it you can't change. */
export interface Policy { member: PolicyRules | null; others: PolicyRules[]; revision: string | null }

const strs = (v: any): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
function parseRules(layer: any): PolicyRules {
  const body = layer?.body ?? {}
  const revision = String(layer?.revision ?? '')
  const tools: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(body.tools ?? {})) tools[k] = strs(v)
  const tags = body.tags ?? {}
  switch (body.mode) {
    case 'deny-all': return { allowed: new Set(), denied: new Set(), revision, tools: {}, tagsDisable: [], tagsEnable: [] }
    case 'allow': return { allowed: new Set(strs(body.connectors)), denied: new Set(), revision, tools, tagsDisable: strs(tags?.disable), tagsEnable: strs(tags?.enable) }
    case 'deny': return { allowed: null, denied: new Set(strs(body.disabled_connectors)), revision, tools, tagsDisable: strs(tags?.disable), tagsEnable: strs(tags?.enable) }
    default: return { allowed: null, denied: new Set(), revision, tools: {}, tagsDisable: [], tagsEnable: [] }
  }
}
export function parsePolicy(o: any): Policy {
  const layers: any[] = Array.isArray(o?.layers) ? o.layers : []
  const m = layers.find((l) => l?.kind === 'member')
  const member = m ? parseRules(m) : null
  return { member, others: layers.filter((l) => l?.kind !== 'member').map(parseRules), revision: member?.revision || o?.effective?.revision || null }
}
const allows = (r: PolicyRules, slug: string) => (r.allowed === null || r.allowed.has(slug)) && !r.denied.has(slug)
export const memberEnables = (p: Policy | null | undefined, slug: string) => (p?.member ? allows(p.member, slug) : true)
export const orgLocks = (p: Policy | null | undefined, slug: string) => !!p?.others.some((r) => !allows(r, slug))
export const memberDisabled = (p: Policy | null | undefined, slug: string) => p?.member?.tools[slug] ?? []
export const hasMemberTools = (p: Policy | null | undefined, slug: string) => !!p?.member && slug in p.member.tools
/** Tools a layer above yours keeps off, by name or by tag. */
export function orgLockedTools(p: Policy | null | undefined, slug: string, tools: ConnectorTool[]): Set<string> {
  const locked = new Set<string>()
  for (const r of p?.others ?? []) {
    for (const t of r.tools[slug] ?? []) locked.add(t)
    for (const t of tools) {
      const off = r.tagsDisable.some((x) => t.hints.includes(x))
      const missing = r.tagsEnable.length > 0 && !r.tagsEnable.some((x) => t.hints.includes(x))
      if (off || missing) locked.add(t.slug)
    }
  }
  return locked
}
export const policy = async () => parsePolicy(await rpc('connectors.policy.get'))

/** Turns an app on or off for Hermes; off keeps the sign-in. Retries once if the rules changed underneath. */
export async function setManagedEnabled(slug: string, enabled: boolean) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const revision = (await policy()).revision
    if (!revision) throw Object.assign(new Error('Rules can’t be changed right now.'), { data: { reason: 'READ_ONLY' } })
    try { await rpc('connectors.policy.set', { change: { type: 'connector', connector: slug, enabled }, expected_revision: revision }); return } catch (e) {
      if (attempt === 1 || reasonOf(e) !== 'POLICY_CONFLICT') throw e
    }
  }
}

// ---------- managed apps: tools ----------

/** What a tool does to the app: reads, writes, or can remove something for good. */
export type Facet = 'read' | 'write' | 'destructive' | 'unclassified'
export interface ConnectorTool { slug: string; name: string; description: string; facet: Facet; hints: string[]; categories: string[] }
const FACET_ORDER: Record<Facet, number> = { read: 0, write: 1, destructive: 2, unclassified: 3 }
export const facetOrder = (f: Facet) => FACET_ORDER[f]
export const FACET_LABEL: Record<Facet, string> = { read: 'Reads', write: 'Writes', destructive: 'Deletes things', unclassified: 'Unknown effect' }

export async function connectorTools(slug: string, refresh = false): Promise<{ tools: ConnectorTool[]; stale: boolean }> {
  const o = await rpc<any>('connectors.tools', { slug, refresh }, 60_000)
  const tools: ConnectorTool[] = (Array.isArray(o?.tools) ? o.tools : []).filter((t: any) => !t?.deprecated).map((t: any) => ({
    slug: String(t.slug ?? ''), name: String(t.name ?? ''), description: String(t.description ?? ''),
    facet: (['read', 'write', 'destructive'].includes(t.facet) ? t.facet : 'unclassified') as Facet,
    hints: strs(t.hints), categories: strs(t.categories),
  }))
  return { tools, stale: o?.stale === true }
}

/** "GOOGLECALENDAR_FIND_EVENT" → "Find event", without the app's own name in front. */
export function humanize(slug: string, connector = ''): string {
  const words = slug.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_.\-/]+/g, ' ').trim().toLowerCase().split(' ').filter(Boolean)
  const app = brandKey(connector.replace(/_mcp$/, ''))
  let rest = words
  if (words.length > 1 && app) {
    // Drop leading words that spell the app ("HIGGSFIELD_MCP_BALANCE" → "Balance").
    let i = 0, acc = ''
    while (i < words.length - 1 && app.startsWith(acc + brandKey(words[i]))) { acc += brandKey(words[i]); i++; if (acc === app) break }
    if (acc === app) { rest = words.slice(i); if (rest[0] === 'mcp' && rest.length > 1) rest = rest.slice(1) }
  }
  const s = rest.join(' ')
  return s ? s[0].toUpperCase() + s.slice(1) : slug
}
export const toolTitle = (t: { slug: string; name: string }, connector: string) => (t.name && !t.name.includes('_') ? t.name : humanize(t.slug, connector))

/** The three ready-made tool choices, from least to most Hermes may do. */
export type Preset = 'read-only' | 'no-deleting' | 'everything'
export const PRESETS: { key: Preset; label: string }[] = [{ key: 'read-only', label: 'Read only' }, { key: 'no-deleting', label: 'No deleting' }, { key: 'everything', label: 'Everything' }]
export function presetDisabled(preset: Preset, tools: ConnectorTool[], locked: Set<string>): Set<string> {
  const off = new Set(locked)
  for (const t of tools) {
    if (preset === 'read-only' && t.facet !== 'read') off.add(t.slug)
    if (preset === 'no-deleting' && t.facet === 'destructive') off.add(t.slug)
  }
  return off
}
/** The preset that `disabled` matches exactly, or null when it's your own mix. */
export function presetOf(disabled: Set<string>, tools: ConnectorTool[], locked: Set<string>): Preset | null {
  const known = new Set(tools.map((t) => t.slug))
  const off = new Set([...disabled].filter((s) => known.has(s)).concat([...locked]))
  for (const p of PRESETS) {
    const want = presetDisabled(p.key, tools, locked)
    if (want.size === off.size && [...want].every((s) => off.has(s))) return p.key
  }
  return null
}

export type ToolsSave = { kind: 'saved'; revision: string } | { kind: 'conflict'; theirs: string[]; revision: string | null } | { kind: 'failed'; message: string }
/** Saves which of an app's tools are off, against the rules revision you were looking at. */
export async function setDisabledTools(slug: string, disabled: Iterable<string>, expected: string | null): Promise<ToolsSave> {
  if (!expected) return { kind: 'failed', message: 'Rules can’t be changed right now.' }
  try {
    const o = await rpc<any>('connectors.policy.set', { change: { type: 'tools', connector: slug, disabled_tools: [...disabled].sort().slice(0, 2000) }, expected_revision: expected })
    return { kind: 'saved', revision: String(o?.revision ?? expected) }
  } catch (e) {
    if (reasonOf(e) === 'POLICY_CONFLICT') {
      const now = await policy().catch(() => null)
      return { kind: 'conflict', theirs: memberDisabled(now, slug), revision: now?.revision ?? null }
    }
    return { kind: 'failed', message: plain(e) }
  }
}

/** Turns an app's deleting tools off once it's connected, if you haven't chosen its tools yourself (Remote does this after a connect). */
export async function applyNoDeleting(slug: string) {
  const p = await policy().catch(() => null)
  if (!p || hasMemberTools(p, slug) || !p.revision) return
  const tools = (await connectorTools(slug).catch(() => null))?.tools
  if (!tools) return
  const off = presetDisabled('no-deleting', tools, orgLockedTools(p, slug, tools))
  if (off.size) await setDisabledTools(slug, off, p.revision)
}

// ---------- managed apps: accounts and connects ----------

export const renameAccount = (connectionId: string, alias: string) => rpc('connectors.accounts.rename', { connection_id: connectionId, alias })
export const removeAccount = (connectionId: string) => rpc('connectors.accounts.remove', { connection_id: connectionId })
/** A short account name Hermes accepts: lowercase letters, digits and dashes. */
export const ALIAS_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
export const cleanAlias = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32)

export interface OpTarget { name: string; kind: string; action: string; state: string; connectUrl?: string; connectionId?: string; detail?: string; instructions?: string }
export interface ConnectionOp { opId: string; seq: number; settled: boolean; targets: OpTarget[] }
const httpUrl = (u: any) => (typeof u === 'string' && /^https?:\/\//.test(u) ? u : undefined)
export function parseOp(o: any): ConnectionOp {
  return {
    opId: String(o?.op_id ?? ''), seq: Number(o?.seq ?? 0) || 0, settled: o?.settled === true || o?.settled_at != null,
    targets: (Array.isArray(o?.targets) ? o.targets : []).map((t: any) => ({
      name: String(t?.name ?? ''), kind: String(t?.kind ?? 'connector'), action: String(t?.action ?? 'connect'), state: String(t?.state ?? 'pending'),
      connectUrl: httpUrl(t?.connect_url), connectionId: t?.connection_id || undefined, detail: t?.detail || undefined, instructions: t?.instructions || undefined,
    })),
  }
}
/** `next` if it's newer, keeping each target's link and account id when the newer frame left them out (account broadcasts never carry links). */
export function mergeOp(prev: ConnectionOp | null, next: ConnectionOp, broadcast = false): ConnectionOp {
  if (!prev) return next
  if (next.opId !== prev.opId || (broadcast ? next.seq <= prev.seq : next.seq < prev.seq)) return prev
  const held = new Map(prev.targets.map((t) => [t.name, t]))
  return {
    ...next,
    targets: next.targets.map((t) => {
      const h = held.get(t.name)
      if (!h) return t
      const reissued = t.state === 'initiated' && h.state !== 'initiated'
      return { ...t, connectUrl: t.connectUrl ?? (reissued ? undefined : h.connectUrl), connectionId: t.connectionId ?? h.connectionId }
    }),
  }
}
export const targetConnected = (t?: OpTarget) => t?.state === 'connected'
export const targetDead = (t?: OpTarget) => t?.state === 'failed' || t?.state === 'expired'

/** Starts (or, with `reconnect`, repairs) a connect: the operation to follow and its sign-in link. */
export async function connectManaged(slug: string, opts: { reconnect?: boolean; alias?: string; connectionId?: string } = {}) {
  const alias = opts.alias?.trim() || undefined
  return parseOp(await rpc('connectors.connect', {
    owner: ACCOUNT, connectors: [slug], reconnect: !!opts.reconnect,
    ...(alias ? { alias } : {}), ...(opts.reconnect && !alias && opts.connectionId ? { connection_id: opts.connectionId } : {}),
  }))
}
export const opStatus = async (opId: string) => parseOp(await rpc('connectors.operation.status', { owner: ACCOUNT, op_id: opId }))
/** Back from the browser: Hermes reads the accounts now instead of at its next tick. */
export const wakeOp = (opId: string) => rpc('connectors.operation.wake', { owner: ACCOUNT, op_id: opId }, 15_000).catch(() => undefined)
/** Stops waiting for a connect: ends the operation, then removes any account it half-made, never the one a repair named. */
export async function giveUp(op: ConnectionOp, repairing?: string) {
  await rpc('connection.respond', { owner: ACCOUNT, op_id: op.opId, result: { settled_by: 'continue' } }).catch(() => undefined)
  for (const t of op.targets) {
    if (!targetConnected(t) && t.connectionId && t.connectionId !== repairing) await removeAccount(t.connectionId).catch(() => undefined)
  }
}
/** `connection.update` frames for connects started from these pages (broadcast without links). */
export function onAccountUpdate(cb: (op: ConnectionOp) => void) {
  return gateway.onEvent((e) => { if (e.type === 'connection.update' && e.payload?.owner?.type === 'account') cb(parseOp(e.payload)) })
}

// ---------- servers on this Mac (MCP, per profile) ----------

export interface McpRuntime { name: string; tools: number; status: string }
export async function mcpRuntimeMap(profile: string): Promise<Record<string, McpRuntime>> {
  try {
    const r = await rpc<any>('mcp.servers.status', { profile }, 20_000)
    const out: Record<string, McpRuntime> = {}
    for (const s of r?.servers ?? []) if (s?.name) out[s.name] = { name: s.name, tools: Number(s.tools ?? 0) || 0, status: String(s.status ?? 'configured') }
    return out
  } catch { return {} }
}
export interface McpTest { ok: boolean; error?: string; tools: { name: string; description: string; schemaChars?: number }[]; prompts?: number; resources?: number }
export async function mcpTest(profile: string, name: string): Promise<McpTest> {
  try {
    const o = await rest<any>('POST', at(`/api/mcp/servers/${enc(name)}/test`, { profile }))
    return { ok: o?.ok === true, error: o?.error || undefined, tools: (o?.tools ?? []).map((t: any) => ({ name: String(t?.name ?? ''), description: String(t?.description ?? ''), schemaChars: typeof t?.schema_chars === 'number' ? t.schema_chars : undefined })), prompts: o?.prompts, resources: o?.resources }
  } catch (e: any) { return { ok: false, error: e?.message ?? String(e), tools: [] } }
}
export async function reload() { await rpc('reload.mcp', { confirm: true }, 120_000).catch(() => undefined) }
export async function setServerEnabled(profile: string, name: string, enabled: boolean) {
  await rest('PUT', at(`/api/mcp/servers/${enc(name)}/enabled`, { profile }), { enabled })
  await reload()
}
export async function removeServer(profile: string, name: string) {
  await rest('DELETE', at(`/api/mcp/servers/${enc(name)}`, { profile }))
  await reload()
}
/** A server at `url` (OAuth sign-in, a key sent as a Bearer header, or none), or one run on this Mac with `command`. */
export async function addServer(profile: string, s: { name: string; url?: string; command?: string; args?: string[]; env?: Record<string, string>; auth?: 'none' | 'oauth' | 'header'; bearer?: string }) {
  await rest('POST', at('/api/mcp/servers', { profile }), {
    name: s.name, ...(s.url ? { url: s.url } : {}), ...(s.command ? { command: s.command } : {}), args: s.args ?? [], env: s.env ?? {},
    ...(s.auth && s.auth !== 'none' ? { auth: s.auth } : {}), ...(s.auth === 'header' && s.bearer ? { bearer_token: s.bearer } : {}),
  })
  await reload()
}
/** Adds a catalog server with the keys it declares (nothing else is sent). True when Hermes is still setting it up in the background. */
export async function installCatalogServer(profile: string, entry: McpEntry, env: Record<string, string>): Promise<{ background: boolean; action?: string }> {
  const declared = new Set(envFields(entry.required_env).map((f) => f.name))
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (declared.has(k) && v.trim()) clean[k] = v.trim()
  const o = await rest<any>('POST', at('/api/mcp/catalog/install', { profile }), { name: entry.name, env: clean, enable: true })
  const background = o?.background === true
  if (!background) await reload()
  return { background, action: o?.action }
}
/** A key for a server you already added: saved in this profile's keys, referenced from the server. */
export const setServerKey = (profile: string, name: string, value: string) => rpc('mcp.servers.set_api_key', { name, value, profile })

export interface McpSignIn { flowId?: string; status: string; url?: string; error?: string; tools?: { name: string; description: string }[] }
const parseFlow = (o: any): McpSignIn => ({ flowId: o?.flow_id || undefined, status: String(o?.status ?? 'error'), url: httpUrl(o?.authorization_url), error: o?.error || undefined, tools: Array.isArray(o?.tools) ? o.tools : undefined })
export const signInDone = (s: McpSignIn) => s.status === 'approved'
export const signInFailed = (s: McpSignIn) => ['error', 'failed', 'cancelled', 'expired'].includes(s.status)
export const serverSignIn = async (profile: string, name: string) => parseFlow(await rest('POST', at(`/api/mcp/servers/${enc(name)}/auth`, { profile })))
export const signInStatus = async (flowId: string) => parseFlow(await get(`/api/mcp/oauth/flows/${enc(flowId)}`))
export const cancelSignIn = (flowId: string) => rest('DELETE', `/api/mcp/oauth/flows/${enc(flowId)}`).catch(() => undefined)

/** This profile's raw `mcp_servers` map (what mcp.json holds), for per-tool switches and editing by hand. */
export async function serverConfigs(profile: string): Promise<Record<string, Record<string, any>>> {
  const c = await get<any>(at('/api/config', { include_defaults: 'false', profile }))
  const m = c?.mcp_servers
  return m && typeof m === 'object' && !Array.isArray(m) ? m : {}
}
/** Replaces the whole map (deletes and re-enables persist), then reloads. */
export async function saveServerConfigs(profile: string, servers: Record<string, Record<string, any>>) {
  await rest('PUT', at('/api/mcp/servers', { profile }), { servers })
  await reload()
}
/** A server's tool filter: an `include` list wins (even empty), else an `exclude` list, else every tool. */
export function serverToolOn(cfg: Record<string, any> | undefined, tool: string): boolean {
  const t = cfg?.tools
  if (t && Array.isArray(t.include)) return t.include.includes(tool)
  return !(t && Array.isArray(t.exclude) && t.exclude.includes(tool))
}
/** `cfg` with `tool` switched, keeping the filter's mode; an emptied exclude list is dropped. */
export function toggleServerTool(cfg: Record<string, any>, tool: string): Record<string, any> {
  const t = { ...(cfg.tools && typeof cfg.tools === 'object' ? cfg.tools : {}) }
  const mode = Array.isArray(t.include) ? 'include' : 'exclude'
  const cur: string[] = Array.isArray(t[mode]) ? t[mode] : []
  const next = cur.includes(tool) ? cur.filter((x) => x !== tool) : [...cur, tool]
  if (mode === 'include' || next.length) t[mode] = next
  else delete t.exclude
  const out = { ...cfg }
  if (Object.keys(t).length) out.tools = t
  else delete out.tools
  return out
}
/** A server's own log lines: its stdio section of the MCP log, or agent log lines that mention it. */
export async function serverLogs(profile: string, name: string, source: 'stdio' | 'agent'): Promise<string[]> {
  const r = await get<any>(at('/api/logs', source === 'stdio' ? { file: 'mcp', lines: 500, profile } : { file: 'agent', lines: 300, search: name, profile }))
  const lines: string[] = Array.isArray(r?.lines) ? r.lines : []
  if (source !== 'stdio') return lines
  const marker = /^(?:\d{4}-\d{2}-\d{2} [\d:,]+ )?===== (?:\[.*\] )?starting MCP server '(.+)' =====$/
  const out: string[] = []
  let inside = false
  for (const l of lines) { const m = marker.exec(l.trim()); if (m) inside = m[1] === name; if (inside) out.push(l) }
  return out
}

/** A credential an install needs: asked with its prompt, never shown back. */
export interface EnvField { name: string; prompt?: string; required: boolean }
export function envFields(list: McpEntry['required_env'] | undefined): EnvField[] {
  return (list ?? []).map((e) => (typeof e === 'string' ? { name: e, required: true } : { name: e.name, prompt: e.prompt || undefined, required: e.required !== false })).filter((f) => !!f.name)
}

// ---------- the Connectors page's joined view ----------

export type AppKind = 'managed' | 'mac' | 'plugin'
export interface AppEntry {
  key: string; kind: AppKind; name: string; logo?: string; description: string; category: string
  hostedSlug?: string; status?: HostedStatus; accounts: Account[]
  server?: McpServer; runtime?: McpRuntime; catalog?: McpEntry
  connected: boolean; enabled: boolean; orgLocked: boolean; toolsOff: number
}
export interface Trouble { status: string; since?: string }
export const appAccount = (e: AppEntry) => e.accounts[0]
export const appPending = (e: AppEntry) => e.kind === 'managed' && (appAccount(e)?.status ?? e.status?.connection_status) === 'pending'
export function appTrouble(e: AppEntry): Trouble | null {
  if (e.kind === 'managed') {
    const s = appAccount(e)?.status ?? e.status?.connection_status ?? ''
    return e.connected && ['expired', 'failed', 'revoked', 'inactive'].includes(s) && !e.accounts.some((a) => a.status === 'active') ? { status: s, since: (appAccount(e) as any)?.updated_at } : null
  }
  return e.enabled && e.runtime?.status === 'failed' ? { status: e.server?.auth === 'oauth' ? 'needs_sign_in' : 'failed' } : null
}
export function usagePrefix(e: AppEntry): string | undefined {
  if (e.kind === 'managed' && e.hostedSlug) return `connectors__${e.hostedSlug}__`
  if (e.server) return `mcp__${e.server.name.replace(/[^A-Za-z0-9_]/g, '_')}__`
  return undefined
}
export const serverTarget = (s: McpServer) => s.url || [s.command, (s.args ?? []).join(' ')].filter(Boolean).join(' ')

export interface ConnectorsSnapshot {
  /** A sentence when managed apps can't be read (signed out, not offered here, an old Hermes). */
  hostedNotice: string | null
  /** Hermes' reason code behind the notice (NEEDS_NOUS_AUTH when you only need to sign in). */
  hostedReason?: string
  connected: AppEntry[]
  /** Everything you could add, A to Z: managed apps and catalog servers. */
  available: AppEntry[]
  policy: Policy | null
  /** Why the servers on this Mac couldn't be read, if they couldn't. */
  localError: string | null
  catalog: McpEntry[]
  hosted: HostedApp[]
}
const settle = async <T,>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false; e: any }> => { try { return { ok: true, v: await p } } catch (e) { return { ok: false, e } } }

/** Everything the Connectors page shows, read side by side; a part that fails leaves a note instead. */
export async function loadConnectors(profile: string): Promise<ConnectorsSnapshot> {
  const [list, apps, accts, pol, srv, live, cat] = await Promise.all([
    settle(hostedList()), settle(hostedCatalog()), settle(listAccounts()), settle(policy()), settle(mcpServers(profile)), mcpRuntimeMap(profile), settle(mcpCatalog(profile)),
  ])
  const failure = !list.ok ? list.e : !apps.ok && closesManaged(apps.e) ? apps.e : null
  const hostedNotice = failure ? plain(failure) : list.ok && list.v === null ? 'Managed apps are not available for this account yet.' : null
  const statuses = list.ok ? list.v ?? [] : []
  const hosted = !hostedNotice && apps.ok ? apps.v : []
  const accounts = (accts.ok ? accts.v : []).filter((a) => !a.disabled)
  const pp = pol.ok ? pol.v : null
  const servers = srv.ok ? srv.v : []
  const entries = cat.ok ? cat.v : []

  const connected: AppEntry[] = []
  const available: AppEntry[] = []
  if (!hostedNotice) {
    const slugs = new Set<string>([...hosted.map((a) => a.slug), ...statuses.map((s) => s.connector), ...accounts.map((a) => a.connector)])
    for (const slug of slugs) {
      const app = hosted.find((a) => a.slug === slug)
      const row = statuses.find((s) => s.connector === slug)
      const mine = accounts.filter((a) => a.connector === slug).sort((a, b) => (a.active === b.active ? String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) : a.active ? -1 : 1))
      const off = pp ? memberDisabled(pp, slug) : ((row as any)?.gateway_disabled_tools ?? [])
      const entry: AppEntry = {
        key: `hosted:${slug}`, kind: 'managed', name: app?.name || brandTitle(slug), logo: app?.logo_url || brandLogo(slug), description: app?.description ?? '', category: app?.category ?? '',
        hostedSlug: slug, status: row, accounts: mine, connected: mine.length > 0 || row?.connected === true,
        enabled: memberEnables(pp, slug) && row?.enabled !== false, orgLocked: orgLocks(pp, slug), toolsOff: off.length,
      }
      if (entry.connected) connected.push(entry)
      else if (app) available.push(entry)
    }
  }
  const slugLogo = (slug?: string | null) => (slug ? hosted.find((a) => a.slug === slug)?.logo_url || brandLogo(slug) : undefined)
  for (const s of servers) {
    const c = entries.find((e) => e.name === s.name)
    const bare = s.name.includes('__') ? s.name.slice(s.name.indexOf('__') + 2) : s.name
    connected.push({
      key: `mcp:${s.name}`, kind: s.source === 'plugin' ? 'plugin' : 'mac', name: brandTitle(bare), logo: c ? slugLogo(c.connector_slug) ?? brandLogo(brandKey(c.name)) : undefined,
      description: c?.description ?? serverTarget(s), category: '', accounts: [], server: s, runtime: live[s.name], catalog: c, connected: true, enabled: s.enabled !== false, orgLocked: false, toolsOff: 0,
    })
  }
  // An app offered both ways shows once, as the managed one: its twin on this Mac would be a second row.
  const configured = new Set(servers.map((s) => s.name))
  const hostedSlugs = new Set([...connected, ...available].map((e) => e.hostedSlug).filter(Boolean) as string[])
  const hostedNames = new Set([...connected, ...available].filter((e) => e.kind === 'managed').map((e) => e.name.toLowerCase()))
  for (const e of entries) {
    if (configured.has(e.name) || (e.connector_slug && hostedSlugs.has(e.connector_slug)) || hostedNames.has(brandTitle(e.name).toLowerCase())) continue
    available.push({ key: `cat:${e.name}`, kind: 'mac', name: brandTitle(e.name), logo: slugLogo(e.connector_slug) ?? brandLogo(brandKey(e.name)), description: e.description, category: '', accounts: [], catalog: e, connected: false, enabled: true, orgLocked: false, toolsOff: 0 })
  }
  const byName = (a: AppEntry, b: AppEntry) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  return {
    hostedNotice,
    hostedReason: failure ? reasonOf(failure) : undefined,
    connected: connected.sort((a, b) => (appTrouble(a) ? 0 : 1) - (appTrouble(b) ? 0 : 1) || byName(a, b)),
    available: available.sort(byName),
    policy: pp,
    localError: srv.ok ? null : srv.e?.message ?? String(srv.e),
    catalog: entries,
    hosted,
  }
}

/** Tool calls per tool name over a week and today (`/api/analytics/usage`), summed for an app by its prefix. */
export interface UsageCounts { week: Record<string, number>; today: Record<string, number> }
export async function usageCounts(): Promise<UsageCounts | null> {
  const counts = (o: any) => { const m: Record<string, number> = {}; for (const t of o?.tools ?? []) if (t?.tool) m[t.tool] = Number(t.count ?? 0) || 0; return m }
  const [w, t] = await Promise.all([get(at('/api/analytics/usage', { days: 7 })).catch(() => null), get(at('/api/analytics/usage', { days: 1 })).catch(() => null)])
  return w ? { week: counts(w), today: counts(t) } : null
}
export const usageSum = (m: Record<string, number> | undefined, prefix?: string) => (m && prefix ? Object.entries(m).reduce((n, [k, v]) => (k.startsWith(prefix) ? n + v : n), 0) : undefined)

/**
 * Apps worth connecting, from what you ask Chief: the ones your recent messages mention by name or by
 * their catalog keywords. Empty when nothing you said points at one.
 */
export function suggestions(available: AppEntry[], texts: string[], limit = 4): AppEntry[] {
  const text = texts.slice(-200).join('\n').toLowerCase()
  if (!text.trim()) return []
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const scored = available.map((e) => {
    const words = [...new Set([e.name.toLowerCase(), e.hostedSlug ?? '', ...((e.catalog as any)?.suggest?.keywords ?? []).map((k: string) => String(k).toLowerCase())].filter((w) => w.length >= 3))]
    const n = words.reduce((s, w) => s + (text.match(new RegExp(`\\b${esc(w)}\\b`, 'g'))?.length ?? 0), 0)
    return { e, n }
  }).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || (a.e.kind === 'managed' ? 0 : 1) - (b.e.kind === 'managed' ? 0 : 1))
  const seen = new Set<string>()
  const out: AppEntry[] = []
  for (const { e } of scored) { const k = brandKey(e.hostedSlug ?? e.name); if (seen.has(k)) continue; seen.add(k); out.push(e); if (out.length === limit) break }
  return out
}

// ---------- keys (per profile) ----------

/** Names of the keys already saved for `profile` (values are never read). */
export async function keysSet(profile: string): Promise<Set<string>> {
  const r = await get<any>(at('/api/env', { profile }))
  const out = new Set<string>()
  if (Array.isArray(r)) { for (const k of r) if (k?.is_set) out.add(k.key) } else for (const [k, v] of Object.entries(r ?? {})) if ((v as any)?.is_set) out.add(k)
  return out
}
export const saveKey = (profile: string, key: string, value: string) => rest('PUT', at('/api/env', { profile }), { key, value })

// ---------- background actions (skills hub installs, catalog servers that build) ----------

export interface ActionStatus { running: boolean; exitCode: number | null; lines: string[] }
export async function actionStatus(name: string): Promise<ActionStatus> {
  const s = await get<any>(at(`/api/actions/${enc(name)}/status`, { lines: 200 }))
  return { running: s?.running === true, exitCode: typeof s?.exit_code === 'number' ? s.exit_code : null, lines: Array.isArray(s?.lines) ? s.lines : [] }
}

// ---------- the Marketplace: plugins ----------

/** Who stands behind a plugin, as the store labels it: Nous, a partner Nous checked, or anyone. */
export type Tier = 'official' | 'verified' | 'community'
export const TIERS: { key: Tier; label: string }[] = [{ key: 'official', label: 'Official' }, { key: 'verified', label: 'Verified' }, { key: 'community', label: 'Community' }]
export const tierOf = (s?: string | null): Tier => (s?.toLowerCase() === 'official' ? 'official' : ['verified', 'certified'].includes(s?.toLowerCase() ?? '') ? 'verified' : 'community')
const TIER_ORDER: Record<Tier, number> = { official: 0, verified: 1, community: 2 }
export const tierOrder = (t: Tier) => TIER_ORDER[t]

/** Whether a plugin can run on the Mac: yes, not on its OS, or not on its Hermes. */
export type Fit = 'works' | 'other-os' | 'needs-newer'
/** How a line of a plugin's disclosure reads: data leaving, money spent, kept on this Mac, or other. */
export type Reach = 'sends' | 'spends' | 'local' | 'other'

export interface MarketHost { os: string | null; version: string | null; name: string | null }
export const osLabel = (os?: string | null) => (os === 'macos' ? 'macOS' : os === 'linux' ? 'Linux' : os === 'windows' ? 'Windows' : null)

export interface MarketPlugin {
  name: string; title: string; about: string; disclosure: string[]; repo: string; sha: string; shaShort: string; tier: Tier; category: string; maintainer: string
  version?: string; image?: string; screenshots: string[]; docsUrl?: string; platforms: string[]; requiresHermes?: string; tools: string[]; hooks: number; keys: string[]
  knownIssues: string[]; stars?: number; featured?: number; installed: boolean; updateAvailable: boolean; runtimeStatus?: string | null; summary: string; raw: CatalogPlugin
}
export interface MarketSnapshot { plugins: MarketPlugin[]; host: MarketHost; fromHost: boolean; generatedAt?: string }

const ACRONYMS: Record<string, string> = { mcp: 'MCP', ai: 'AI', api: 'API', cli: 'CLI', tts: 'TTS', stt: 'STT', rss: 'RSS', ui: 'UI', llm: 'LLM', sdk: 'SDK', vpn: 'VPN', pdf: 'PDF', '3d': '3D' }
const FILLER = new Set(['hermes', 'plugin', 'agent', 'directsdk'])
/** The catalog's title, or one made from the name: "hermes-memory-wiki" → "Memory Wiki". */
export function pluginTitle(name: string, title?: string | null): string {
  if (title?.trim()) return title.trim()
  const words = name.split(/[-_]/).filter(Boolean)
  const kept = words.filter((w) => !FILLER.has(w.toLowerCase()))
  return (kept.length ? kept : words).map((w) => ACRONYMS[w.toLowerCase()] ?? w[0].toUpperCase() + w.slice(1)).join(' ')
}
/** Sentences, also split at semicolons, each ending in a full stop. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z(])|;\s+/).map((s) => s.trim().replace(/[;,]+$/, '')).filter((s) => s.length > 2)
    .map((s) => { const u = s[0].toUpperCase() + s.slice(1); return /[.!?)]$/.test(u) ? u : `${u}.` })
}
/** A description's first part, and its disclosure ("Disclosure — …") as separate sentences. */
export function splitDisclosure(d: string): { about: string; disclosure: string[] } {
  const m = /\s*\bDisclosure\s*(?:[—–:-]+|\b)\s*/.exec(d)
  if (!m) return { about: d.trim(), disclosure: [] }
  return { about: d.slice(0, m.index).trim(), disclosure: sentences(d.slice(m.index + m[0].length)) }
}
/** A card's line: the first sentence, cut at about `max` characters. */
export function summaryOf(about: string, max = 120): string {
  const first = (about.split(/(?<=[.!?])\s+/)[0] ?? '').trim().replace(/\.$/, '')
  if (first.length <= max) return first
  const cut = first.slice(0, max)
  return cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : max).replace(/[,;:]$/, '') + '…'
}
/** Tool names as words, without the prefix they share: [elevenlabs_music_compose, …_stems] → [Compose, Stems]. */
export function toolLabels(tools: string[]): string[] {
  const split = tools.map((t) => t.split(/[_-]/).filter(Boolean))
  let shared = 0
  if (split.length > 1) while (split.every((p) => p.length > shared + 1) && new Set(split.map((p) => p[shared])).size === 1) shared++
  return [...new Set(split.map((p) => { const s = p.slice(shared).map((w) => ACRONYMS[w.toLowerCase()] ?? w.toLowerCase()).join(' '); return s ? s[0].toUpperCase() + s.slice(1) : s }))]
}
/** "0.22.7" against ">=0.22.0": negative, zero or positive, numerically per part. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.trim().replace(/^[>=^~v\s]+/, '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0)
  const x = parts(a), y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d }
  return 0
}
export function fitOf(p: MarketPlugin, host: MarketHost): Fit {
  if (host.os && p.platforms.length && !p.platforms.includes(host.os)) return 'other-os'
  if (host.version && p.requiresHermes && compareVersions(host.version, p.requiresHermes) < 0) return 'needs-newer'
  return 'works'
}
/** "Windows only", "macOS and Linux". */
export function platformsText(platforms: string[]): string {
  const names = [...new Set(platforms.map(osLabel).filter(Boolean) as string[])]
  if (!names.length) return 'Any computer'
  if (names.length === 1) return `${names[0]} only`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
export const needsVersion = (r?: string) => r?.replace(/^[>=\s]+/, '')
/** What a disclosure line is mostly about, from its words. */
export function reachOf(line: string): Reach {
  const l = line.toLowerCase()
  if (['bill', 'billed', 'spend', 'spends', 'pay ', 'payment', 'credit', 'cost', 'charge', 'paid'].some((w) => l.includes(w))) return 'spends'
  if (['sent to', 'sends', 'send ', 'uploads', 'goes to', 'go to', 'hosted', 'third-party', 'third party', 'connects to', 'publishes', 'publicly'].some((w) => l.includes(w))) return 'sends'
  if (['locally', 'on your machine', 'never leave', 'no network', 'written to', 'writes ', 'stored', 'saved', 'kept', 'cache'].some((w) => l.includes(w))) return 'local'
  return 'other'
}
export const REACH_LABEL: Record<Reach, string> = { sends: 'Sends data out', spends: 'Can cost money', local: 'Stays on this Mac', other: 'Note' }
/** 5114 → "5.1k", 592 → "592". */
export const starsText = (n: number) => (n >= 10_000 ? `${Math.floor(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n))
/** The store's categories in the order the Browse grid shows them, with plain names. */
export const CATEGORIES: { key: string; label: string; icon: string }[] = [
  { key: 'tools', label: 'Tools', icon: 'tool' }, { key: 'models', label: 'Models', icon: 'spark' }, { key: 'memory', label: 'Memory', icon: 'brain' },
  { key: 'general', label: 'General', icon: 'grid' }, { key: 'automation', label: 'Automation', icon: 'refresh' }, { key: 'web', label: 'Web', icon: 'globe' },
  { key: 'platform', label: 'Talk anywhere', icon: 'chat' }, { key: 'voice', label: 'Voice', icon: 'mic' },
]
export const categoryName = (c: string) => CATEGORIES.find((x) => x.key === c)?.label ?? (c === 'desktop' ? 'Desktop app' : c ? c[0].toUpperCase() + c.slice(1) : 'General')
/** The most-starred plugins that run here, at most `perCategory` from any one category so the list mixes. */
export function mostLoved(plugins: MarketPlugin[], host: MarketHost, count = 6, perCategory = 2): MarketPlugin[] {
  const out: MarketPlugin[] = []
  const per: Record<string, number> = {}
  for (const p of plugins.filter((x) => x.category !== 'desktop' && x.stars != null && fitOf(x, host) === 'works').sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))) {
    if (out.length === count) break
    const n = per[p.category] ?? 0
    if (n < perCategory) { out.push(p); per[p.category] = n + 1 }
  }
  return out
}
/** The name a catalog plugin goes by among those installed ("hermes-plugin-x" installs as "x"); the catalog name when nothing matches. */
export function installedKey(catalogName: string, installed: string[]): string {
  const bare = (n: string) => n.toLowerCase().replace(/_/g, '-').replace(/^hermes-/, '').replace(/^plugin-/, '').replace(/-plugin$/, '')
  return installed.find((n) => n === catalogName) ?? installed.find((n) => bare(n) === bare(catalogName)) ?? catalogName
}
/** Hermes' refusal of an install or update in plain words where it's one an update can hit; otherwise as Hermes said it. */
export function refusal(error: string | undefined | null, title: string): string | null {
  if (!error?.trim()) return null
  const pinned = /is pinned to ([0-9a-f]{7,})/.exec(error)
  if (pinned) return `Hermes kept ${title} at ${pinned[1].slice(0, 7)} because it couldn’t find its catalog record. That happens when Hermes starts through a linked folder; restart it from its real folder and try again.`
  if (error.includes('is not a git checkout')) return `${title} was copied in by hand, not installed from the catalog, so Hermes can’t update it from here.`
  return error
}

function toPlugin(e: any, store?: any): MarketPlugin {
  const s = (snake: string, camel = snake) => { const v = e?.[snake] ?? e?.[camel]; return typeof v === 'string' && v.trim() ? v : undefined }
  const caps = e?.capabilities ?? {}
  const capList = (snake: string, camel: string) => { const a = strs(caps[snake]); return a.length ? a : strs(caps[camel]) }
  const name = String(e?.name ?? '')
  const { about, disclosure } = splitDisclosure(String(e?.description ?? ''))
  const sha = String(e?.sha ?? '')
  const image = (s('image') ?? store?.image) as string | undefined
  return {
    name, title: pluginTitle(name, e?.title), about, disclosure, repo: String(e?.repo ?? ''), sha, shaShort: String(e?.sha_short ?? sha.slice(0, 7)), tier: tierOf(e?.tier),
    category: String(e?.category ?? 'general') || 'general', maintainer: String(e?.maintainer ?? ''), version: s('version'), image: image?.startsWith('https://') ? image : undefined,
    screenshots: strs(e?.screenshots).filter((u) => u.startsWith('https://')), docsUrl: s('docs_url', 'docsUrl'), platforms: strs(e?.platforms), requiresHermes: s('requires_hermes', 'requiresHermes'),
    tools: capList('provides_tools', 'providesTools'), hooks: capList('provides_hooks', 'providesHooks').length, keys: capList('requires_env', 'requiresEnv'), knownIssues: strs(e?.known_issues ?? e?.knownIssues),
    stars: typeof store?.stars === 'number' ? store.stars : typeof e?.stars === 'number' ? e.stars : undefined,
    featured: typeof store?.featured === 'number' ? store.featured : typeof e?.featured === 'number' ? e.featured : undefined,
    installed: e?.installed === true, updateAvailable: e?.update_available === true, runtimeStatus: e?.runtime_status ?? null, summary: summaryOf(about), raw: e,
  }
}

// The store's public listing adds what only the website has: GitHub stars and Nous's featured order.
// The renderer can't reach the internet (CSP), so it's read through the main process when that offers
// `fetchPublic`; without it the page still works from the Mac's own catalog.
const STORE_LISTING = 'https://hermes-agent.nousresearch.com/docs/api/plugins.json'
const STORE_META = 'https://hermes-agent.nousresearch.com/docs/api/plugins-meta.json'
export const STORE_PAGE = 'https://hermes-agent.nousresearch.com/marketplace'
let listing: { at: number; byName: Record<string, any>; generatedAt?: string } | null = null
async function storeListing(): Promise<{ byName: Record<string, any>; generatedAt?: string }> {
  if (listing && Date.now() - listing.at < 3_600_000) return listing
  const fetchPublic = (window.hermesNative as any)?.fetchPublic as undefined | ((url: string) => Promise<string | null>)
  if (typeof fetchPublic !== 'function') return { byName: {} }
  try {
    const [l, m] = await Promise.all([fetchPublic(STORE_LISTING), fetchPublic(STORE_META).catch(() => null)])
    const arr = l ? JSON.parse(l) : null
    const byName: Record<string, any> = {}
    if (Array.isArray(arr)) for (const x of arr) if (x?.name) byName[x.name] = x
    let generatedAt: string | undefined
    try { generatedAt = m ? JSON.parse(m)?.generatedAt : undefined } catch { /* no meta */ }
    listing = { at: Date.now(), byName, generatedAt }
    return listing
  } catch { return listing ?? { byName: {} } }
}

let lastMarket: MarketSnapshot | null = null
export const lastMarketSnapshot = () => lastMarket
export async function loadMarket(profile: string): Promise<MarketSnapshot> {
  const [store, stats, cat] = await Promise.all([storeListing(), get<any>('/api/system/stats').catch(() => null), settle(get<{ entries: CatalogPlugin[]; generated_at?: string }>(at('/api/dashboard/plugins/catalog', { profile })))])
  const sys = String(stats?.os ?? '').toLowerCase()
  const host: MarketHost = { os: sys === 'darwin' || sys === 'macos' ? 'macos' : sys === 'linux' ? 'linux' : sys === 'windows' ? 'windows' : null, version: stats?.hermes_version ?? null, name: stats?.hostname ?? null }
  const entries = cat.ok ? cat.v?.entries ?? [] : null
  if (!entries && !Object.keys(store.byName).length) throw cat.ok ? new Error('The plugin catalog couldn’t be read.') : cat.e
  const plugins = (entries ?? Object.values(store.byName)).filter((e: any) => e?.name).map((e: any) => toPlugin(e, store.byName[e.name]))
  lastMarket = { plugins, host, fromHost: !!entries, generatedAt: store.generatedAt ?? (cat.ok ? cat.v?.generated_at : undefined) }
  return lastMarket
}

/** An install's or update's answer, read the way Hermes Remote reads it. */
export interface RunResult {
  outcome: 'done' | 'consent' | 'blocked' | 'failed'
  message?: string; missing: string[]; restart: boolean; unchanged?: boolean; deltaLines: string[]; findings: any[]; verdict?: string; warnings: string[]; name?: string
}
function readRun(r: any, title: string): RunResult {
  const base = { missing: strs(r?.missing_env), restart: r?.restart_required === true, deltaLines: strs(r?.delta_lines), findings: Array.isArray(r?.scan_findings) ? r.scan_findings : [], verdict: r?.scan_verdict, warnings: strs(r?.warnings), name: r?.plugin_name ?? r?.name, unchanged: r?.unchanged === true }
  if (r?.consent_required) return { ...base, outcome: 'consent', message: r.message ?? r.error ?? 'This version asks for more than the one installed. Look at what changed before you agree.' }
  if (r?.scan_blocked) return { ...base, outcome: 'blocked', message: refusal(r.error, title) ?? 'Hermes’ security check stopped it.' }
  if (r?.ok === false) return { ...base, outcome: 'failed', message: refusal(r.error, title) ?? 'Hermes refused it.' }
  return { ...base, outcome: 'done' }
}
export async function runInstall(profile: string, p: MarketPlugin): Promise<RunResult> {
  try { return readRun(await rest<any>('POST', at('/api/dashboard/agent-plugins/install', { profile }), { identifier: p.repo || p.name, catalog_name: p.name, enable: true }), p.title) } catch (e: any) {
    return readRun(e?.body && typeof e.body === 'object' && ('scan_blocked' in e.body || 'consent_required' in e.body) ? e.body : { ok: false, error: e?.message ?? String(e) }, p.title)
  }
}
export async function runUpdate(profile: string, key: string, title: string, opts: { accept?: boolean; force?: boolean } = {}): Promise<RunResult> {
  const body = { ...(opts.accept ? { accept_capabilities: true } : {}), ...(opts.force ? { force: true } : {}) }
  try { return readRun(await rest<any>('POST', at(`/api/dashboard/agent-plugins/${enc(key)}/update`, { profile }), Object.keys(body).length ? body : undefined), title) } catch (e: any) {
    return readRun({ ok: false, error: e?.message ?? String(e) }, title)
  }
}
export const removePluginFor = (profile: string, key: string) => rest('DELETE', at(`/api/dashboard/agent-plugins/${enc(key)}`, { profile }))
/** Updates every plugin that has one, unattended; a widened or flagged one comes back to look at first. */
export async function updateAllPlugins(profile: string): Promise<{ updated: string[]; review: string[]; failed: string[]; current: number }> {
  const o = await rest<any>('POST', at('/api/dashboard/agent-plugins/update-all', { profile }))
  const rs: any[] = Array.isArray(o?.results) ? o.results : []
  return { updated: rs.filter((r) => r.status === 'updated').map((r) => r.name), review: rs.filter((r) => r.status === 'needs_review').map((r) => r.name), failed: rs.filter((r) => !['updated', 'needs_review', 'unchanged', 'current'].includes(r.status)).map((r) => r.name), current: Number(o?.current ?? 0) || 0 }
}
export const autoUpdateState = async (profile: string) => (await get<any>(at('/api/dashboard/plugins/auto-update', { profile })))?.auto_apply === true
export const setAutoUpdate = async (profile: string, enabled: boolean) => (await rest<any>('PUT', at('/api/dashboard/plugins/auto-update', { profile }), { enabled }))?.auto_apply === true

// ---------- the Marketplace: skills hub ----------

export interface HubSkill { name: string; description: string; source: string; identifier: string; trust: string; repo?: string; tags: string[] }
export const toSkill = (o: any): HubSkill => ({ name: String(o?.name ?? ''), description: String(o?.description ?? ''), source: String(o?.source ?? ''), identifier: String(o?.identifier ?? o?.name ?? ''), trust: String(o?.trust_level ?? 'community'), repo: o?.repo || undefined, tags: strs(o?.tags) })
export interface HubSources { sources: { id: string; label: string; searchable: boolean; available?: boolean; rateLimited?: boolean }[]; featured: HubSkill[]; installed: Record<string, { name: string; trust_level?: string; scan_verdict?: string }>; indexAvailable: boolean }
export async function hubSources(profile: string): Promise<HubSources> {
  const r = await get<any>(at('/api/skills/hub/sources', { profile }))
  return {
    sources: (r?.sources ?? []).map((s: any) => ({ id: String(s.id), label: String(s.label ?? s.id), searchable: s.searchable !== false, available: s.available, rateLimited: s.rate_limited === true })),
    featured: (r?.featured ?? []).map(toSkill), installed: r?.installed ?? {}, indexAvailable: r?.index_available === true,
  }
}
export async function hubSearch(profile: string, q: string, source = 'all'): Promise<{ results: HubSkill[]; timedOut: string[]; installed: HubSources['installed'] }> {
  const r = await get<any>(at('/api/skills/hub/search', { q, source: source === 'all' ? undefined : source, limit: 50, profile }))
  return { results: (r?.results ?? []).map(toSkill), timedOut: strs(r?.timed_out), installed: r?.installed ?? {} }
}
/** The lock entry for a hub skill if it's installed (a ClawHub hit is listed by its bare slug, installed under clawhub/<slug>). */
export function installedSkill(installed: HubSources['installed'], s: HubSkill) {
  return installed[s.identifier] ?? (s.source.toLowerCase() === 'clawhub' ? installed[`clawhub/${s.identifier}`] : undefined)
}
export interface HubScan { verdict?: string; summary?: string; policy: 'allow' | 'ask' | 'block'; policyReason?: string; findings: { severity: string; category?: string; file?: string; line?: number; description: string }[]; counts: Record<string, number>; tier1?: { passed: boolean; findings: { severity: string; message: string; file?: string; line?: number }[] } | null }
export async function hubScan(profile: string, identifier: string): Promise<HubScan> {
  const r = await get<any>(at('/api/skills/hub/scan', { identifier, profile }))
  return { verdict: r?.verdict, summary: r?.summary, policy: r?.policy === 'allow' ? 'allow' : r?.policy === 'ask' ? 'ask' : 'block', policyReason: r?.policy_reason, findings: Array.isArray(r?.findings) ? r.findings : [], counts: r?.severity_counts ?? {}, tier1: r?.tier1 ?? null }
}
export async function hubPreview(profile: string, identifier: string): Promise<{ skillMd: string; files: string[] } & Partial<HubSkill>> {
  const r = await get<any>(at('/api/skills/hub/preview', { identifier, profile }))
  return { ...toSkill(r), skillMd: String(r?.skill_md ?? r?.content ?? ''), files: strs(r?.files) }
}
export const hubInstall = async (profile: string, identifier: string) => (await rest<any>('POST', at('/api/skills/hub/install', { profile }), { identifier }))?.name as string | undefined
export const hubUninstall = async (profile: string, name: string) => (await rest<any>('POST', at('/api/skills/hub/uninstall', { profile }), { name }))?.name as string | undefined
export const hubUpdateAll = async (profile: string) => (await rest<any>('POST', at('/api/skills/hub/update', { profile }), {}))?.name as string | undefined

// ---------- small words ----------

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
/** "3 hours ago", "yesterday", from an ISO time; null when it can't be read. */
export function agoText(iso?: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`
  if (s < 86400) { const h = Math.round(s / 3600); return h === 1 ? 'an hour ago' : `${h} hours ago` }
  const d = Math.round(s / 86400)
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d} days ago`
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined })
}
export function dayText(iso?: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? `on ${new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : null
}
