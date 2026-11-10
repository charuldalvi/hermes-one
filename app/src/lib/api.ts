// Everything Hermes can be set up to do, through the same routes Hermes Desktop uses: REST on the local
// gateway (the main process mints a ticket for the profile each route names) and a few socket methods
// (connectors, groups, per-chat settings). Profile-scoped routes take `?profile=<name>`.
import { gateway } from './gateway'

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: any) { super(message) }
}

/** Hermes' own words for a failure: `detail`, `error` or `message`, else the status. */
function reason(status: number, json: any, text?: string): string {
  const d = json?.detail ?? json?.error ?? json?.message
  if (typeof d === 'string' && d) return d
  if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg)
  if (d && typeof d === 'object' && typeof d.message === 'string') return d.message
  if (status === 404) return 'This Hermes doesn’t have that yet.'
  return text?.trim().slice(0, 200) || `Hermes answered ${status}.`
}

export async function rest<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await window.hermesNative.rest(method, path, body)
  if (!r.ok) throw new ApiError(reason(r.status, r.json, r.text), r.status, r.json)
  return (r.json ?? r.text) as T
}
export const get = <T = any>(path: string) => rest<T>('GET', path)

/** A path with query values; empty ones are left out. The profile is always named, Chief's too: while Hermes
 *  serves several profiles it reads an unnamed one as "all" (or refuses a write). */
export function at(path: string, query: Record<string, string | number | boolean | undefined | null> = {}): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `${path}${path.includes('?') ? '&' : '?'}${s}` : path
}
const enc = encodeURIComponent

export async function rpc<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 45_000): Promise<T> {
  return gateway.request(method, params, timeoutMs) as Promise<T>
}

// ---------- team (profiles) ----------

export interface Profile {
  name: string; path: string; is_default: boolean; model?: string; provider?: string; description?: string
  description_auto?: boolean; display_name?: string; bot_title?: string; skill_count?: number; has_env?: boolean; gateway_running?: boolean
}
export const profiles = async () => (await get<{ profiles: Profile[] }>('/api/profiles')).profiles ?? []
export const createProfile = (name: string) => rest('POST', '/api/profiles', { name, clone_from: 'default' })
export const renameProfile = (name: string, newName: string) => rest('PATCH', `/api/profiles/${enc(name)}`, { new_name: newName })
export const deleteProfile = (name: string) => rest('DELETE', `/api/profiles/${enc(name)}`)
export const soul = async (name: string) => { const r = await get<any>(`/api/profiles/${enc(name)}/soul`); return String(r?.content ?? r?.soul ?? '') }
export const setSoul = (name: string, content: string) => rest('PUT', `/api/profiles/${enc(name)}/soul`, { content })
export const setDescription = (name: string, description: string) => rest('PUT', `/api/profiles/${enc(name)}/description`, { description })
export const describeAuto = (name: string) => rest<{ ok: boolean; reason?: string; description?: string }>('POST', `/api/profiles/${enc(name)}/describe-auto`, { overwrite: true })

// ---------- models ----------

export interface Provider {
  slug: string; name: string; is_current?: boolean; models: string[]; total_models?: number; authenticated?: boolean
  free_tier?: boolean; unavailable_models?: string[]; capabilities?: Record<string, any>; featured_models?: string[]; source?: string
}
export interface ModelOptions { providers: Provider[]; model?: string; provider?: string }
export const modelOptions = (refresh = false) => get<ModelOptions>(at('/api/model/options', { refresh: refresh || undefined }))
export const modelInfo = () => get<{ model: string; provider: string; effective_context_length?: number; capabilities?: Record<string, any> }>('/api/model/info')
/** A bot's main model, in its own config, through Hermes' own route (which runs its "costs more" check;
 *  an answer with confirm_required is retried with confirmExpensive). Chief (default) is Hermes' main model. */
export async function setProfileModel(profile: string, provider: string, model: string, confirmExpensive = false) {
  return rest('POST', at('/api/model/set', { profile }), { scope: 'main', provider, model, task: '', ...(confirmExpensive ? { confirm_expensive_model: true } : {}) })
}

// ---------- keys ----------

export interface EnvKey { key: string; is_set: boolean; description?: string; provider?: string; category?: string; url?: string; is_password?: boolean; advanced?: boolean; redacted_value?: string | null }
export async function envKeys(): Promise<EnvKey[]> {
  const r = await get<any>('/api/env')
  if (Array.isArray(r)) return r
  return Object.entries(r ?? {}).map(([key, v]: [string, any]) => ({ key, ...(typeof v === 'object' ? v : { is_set: !!v }) }))
}
export const setEnv = (key: string, value: string) => rest('PUT', '/api/env', { key, value })
export const deleteEnv = (key: string) => rest('DELETE', '/api/env', { key })
export const oauthProviders = async () => (await get<any>('/api/providers/oauth'))?.providers ?? []

// ---------- skills ----------

export interface Skill { name: string; description: string; category?: string | null; locked?: boolean; enabled: boolean; usage?: number; provenance?: string }
export const skills = (profile: string) => get<Skill[]>(at('/api/skills', { profile }))
export const setSkill = (profile: string, name: string, enabled: boolean) => rest('PUT', at('/api/skills/toggle', { profile }), { name, enabled })
export const skillContent = async (profile: string, name: string) => String((await get<any>(at('/api/skills/content', { name, profile })))?.content ?? '')
export const hubSources = (profile: string) => get<any>(at('/api/skills/hub/sources', { profile }))
export const hubSearch = (profile: string, q: string, source?: string) => get<any>(at('/api/skills/hub/search', { q, source, profile }))
export const hubPreview = (profile: string, identifier: string) => get<any>(at('/api/skills/hub/preview', { identifier, profile }))
export const hubScan = (profile: string, identifier: string) => get<any>(at('/api/skills/hub/scan', { identifier, profile }))
export const hubInstall = (profile: string, identifier: string) => rest('POST', at('/api/skills/hub/install', { profile }), { identifier })
export const hubUninstall = (profile: string, name: string) => rest('POST', at('/api/skills/hub/uninstall', { profile }), { name })

// ---------- plugins ----------

export interface InstalledPlugin {
  name: string; version?: string; description?: string; source?: string; runtime_status?: string; path?: string
  can_remove?: boolean; can_update_git?: boolean; auth_required?: boolean; auth_command?: string; user_hidden?: boolean
}
export interface PluginHub { plugins: InstalledPlugin[]; providers?: { memory_provider?: string; memory_options?: { name: string; label?: string; description?: string }[]; context_engine?: string; context_options?: { name: string; label?: string }[] } }
export const pluginHub = (profile: string) => get<PluginHub>(at('/api/dashboard/plugins/hub', { profile }))
// Plugins are addressed by their key ("platforms/a2a"), slash kept: several names repeat across kinds.
const pkey = (key: string) => key.split('/').map(enc).join('/')
export const setPlugin = (profile: string, key: string, on: boolean) => rest('POST', at(`/api/dashboard/agent-plugins/${pkey(key)}/${on ? 'enable' : 'disable'}`, { profile }))
export const updatePlugin = (profile: string, key: string, opts: { accept?: boolean; force?: boolean } | boolean = {}) => {
  const o = typeof opts === 'boolean' ? { accept: opts } : opts
  return rest('POST', at(`/api/dashboard/agent-plugins/${pkey(key)}/update`, { profile }), o.accept || o.force ? { ...(o.accept ? { accept_capabilities: true } : {}), ...(o.force ? { force: true } : {}) } : undefined)
}
export const removePlugin = (profile: string, key: string) => rest('DELETE', at(`/api/dashboard/agent-plugins/${pkey(key)}`, { profile }))
/** memory: a provider name, or '' for Hermes' built-in memory; undefined leaves it as it is. */
export const setPluginProviders = (profile: string, memory?: string, context?: string) =>
  rest('PUT', at('/api/dashboard/plugin-providers', { profile }), { ...(memory !== undefined ? { memory_provider: memory } : {}), ...(context !== undefined ? { context_engine: context } : {}) })

export interface CatalogPlugin {
  name: string; title?: string; repo: string; sha?: string; sha_short?: string; description: string; maintainer?: string; tier?: string; category?: string
  requires_hermes?: string; docs_url?: string; version?: string; image?: string; platforms?: string[]; capability_summary?: string
  capabilities?: Record<string, any>; known_issues?: string[]; installed?: boolean; update_available?: boolean; runtime_status?: string | null; onboarding?: boolean
}
export const pluginCatalog = (profile: string) => get<{ entries: CatalogPlugin[]; generated_at?: string }>(at('/api/dashboard/plugins/catalog', { profile }))
export const installPlugin = (profile: string, p: CatalogPlugin) =>
  rest<any>('POST', at('/api/dashboard/agent-plugins/install', { profile }), { identifier: p.repo || p.name, catalog_name: p.name, enable: true })

// ---------- tools ----------

export interface Toolset { name: string; label?: string; description?: string; enabled: boolean; available?: boolean; configured?: boolean; tools?: string[] }
export const toolsets = (profile: string) => get<Toolset[]>(at('/api/tools/toolsets', { profile }))
export const setToolset = (profile: string, name: string, enabled: boolean) => rest('PUT', at(`/api/tools/toolsets/${enc(name)}`, { profile }), { enabled })

// ---------- connectors: managed apps (your Nous account) ----------

export interface HostedApp { slug: string; name: string; description: string; category: string; logo_url?: string }
export interface HostedStatus { connector: string; enabled: boolean; connected: boolean; connection_status?: string | null; status_reason?: string | null }
export interface Account { connection_id: string; connector: string; status: string; status_reason?: string | null; label?: string; alias?: string; active?: boolean; disabled?: boolean; created_at?: string }
export interface ConnectTarget { name: string; kind?: string; action?: string; state: string; connect_url?: string; connection_id?: string; detail?: string; instructions?: string; required_env?: any[] }
export interface ConnectOp { op_id: string; seq?: number; settled?: boolean; settled_at?: number; targets: ConnectTarget[] }
const ACCOUNT = { type: 'account' }
export const hostedCatalog = async () => (await rpc<{ connectors: HostedApp[] }>('connectors.catalog')).connectors ?? []
export const hostedList = async () => { const r = await rpc<{ available?: boolean; connectors?: HostedStatus[] }>('connectors.list', { owner: ACCOUNT }); return r.available === false ? null : r.connectors ?? [] }
export const accounts = async () => (await rpc<{ accounts: Account[] }>('connectors.accounts')).accounts ?? []
export const connect = (slug: string, reconnect = false, connectionId?: string) =>
  rpc<ConnectOp>('connectors.connect', { owner: ACCOUNT, connectors: [slug], reconnect, ...(reconnect && connectionId ? { connection_id: connectionId } : {}) })
export const connectStatus = (opId: string) => rpc<ConnectOp>('connectors.operation.status', { owner: ACCOUNT, op_id: opId })
export const connectWake = (opId: string) => rpc('connectors.operation.wake', { owner: ACCOUNT, op_id: opId }, 15_000).catch(() => undefined)
export const connectGiveUp = (opId: string) => rpc('connection.respond', { owner: ACCOUNT, op_id: opId, result: { settled_by: 'continue' } }).catch(() => undefined)
export const removeAccount = (connectionId: string) => rpc('connectors.accounts.remove', { connection_id: connectionId })
export async function setHostedEnabled(slug: string, enabled: boolean) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const policy = await rpc<any>('connectors.policy.get')
    const revision = policy?.effective?.revision ?? policy?.revision
    try { return await rpc('connectors.policy.set', { change: { type: 'connector', connector: slug, enabled }, expected_revision: revision }) } catch (e: any) {
      if (attempt === 1 || !/conflict/i.test(String(e?.message))) throw e
    }
  }
}

// ---------- connectors: servers on this Mac (MCP, per profile) ----------

export interface McpServer { name: string; transport?: string; url?: string | null; command?: string | null; args?: string[]; auth?: string | null; enabled: boolean; source?: string; plugin?: string | null }
export interface McpEntry { name: string; description: string; connector_slug?: string; transport?: string; auth_type?: string; required_env?: ({ name: string; prompt?: string; required?: boolean } | string)[]; url?: string; needs_install?: boolean; installed?: boolean; enabled?: boolean; source?: string }
export const mcpServers = async (profile: string) => (await get<{ servers: McpServer[] }>(at('/api/mcp/servers', { profile }))).servers ?? []
export const mcpCatalog = async (profile: string) => (await get<{ entries: McpEntry[] }>(at('/api/mcp/catalog', { profile }))).entries ?? []
export const mcpRuntime = async (profile: string) => {
  try { return ((await rpc<any>('mcp.servers.status', { profile }, 20_000)).servers ?? []) as { name: string; tools?: number; status?: string }[] } catch { return [] }
}
export const mcpInstall = (profile: string, name: string, env: Record<string, string>) => rest<any>('POST', at('/api/mcp/catalog/install', { profile }), { name, env, enable: true })
export const mcpAdd = (profile: string, s: { name: string; url?: string; command?: string; args?: string[]; env?: Record<string, string> }) =>
  rest<any>('POST', at('/api/mcp/servers', { profile }), { name: s.name, ...(s.url ? { url: s.url } : {}), ...(s.command ? { command: s.command } : {}), args: s.args ?? [], env: s.env ?? {} })
export const mcpRemove = (profile: string, name: string) => rest('DELETE', at(`/api/mcp/servers/${enc(name)}`, { profile }))
export const mcpTest = (profile: string, name: string) => rest<any>('POST', at(`/api/mcp/servers/${enc(name)}/test`, { profile }))
export const mcpSetEnabled = (profile: string, name: string, enabled: boolean) => rest('PUT', at(`/api/mcp/servers/${enc(name)}/enabled`, { profile }), { enabled })
export const mcpAuth = (profile: string, name: string) => rest<any>('POST', at(`/api/mcp/servers/${enc(name)}/auth`, { profile }))
export const mcpAuthFlow = (flowId: string) => get<any>(`/api/mcp/oauth/flows/${enc(flowId)}`)
export const reloadMcp = () => rpc('reload.mcp', { confirm: true }, 120_000).catch(() => undefined)

// ---------- memory, system ----------

export const memory = (profile: string) => get<any>(at('/api/memory', { profile }))
export const setMemoryProvider = (profile: string, provider: string) => rest('PUT', at('/api/memory/provider', { profile }), { provider })
// Hermes refuses a reset that doesn't name its profile once it serves several, so Chief's is named too.
export const resetMemory = (profile: string, target: 'memory' | 'user' | 'all') => rest('POST', `/api/memory/reset?profile=${enc(profile || 'default')}`, { target })
export const status = () => get<any>('/api/status')
export const systemStats = () => get<any>('/api/system/stats')
export const updateCheck = () => get<any>('/api/hermes/update/check')
export const usage = (days: number) => get<any>(at('/api/analytics/usage', { days }))
export const logs = async (file: string, lines = 200) => ((await get<any>(at('/api/logs', { file, lines })))?.lines ?? []) as string[]
export const restartGateway = () => rest('POST', '/api/gateway/restart')

// ---------- groups (Bot Mode rooms) ----------

export interface Room { room_id: string; name?: string; title?: string; members?: { member_id: string; profile: string; handle?: string }[]; updated_at?: number | string; last_active?: number | string }
export const groups = async () => (await rpc<{ rooms: Room[] }>('groups.list', {})).rooms ?? []

// ---------- per-chat settings (thinking effort, fast mode) ----------

export const EFFORT_STOPS = ['none', 'low', 'medium', 'high', 'max'] as const
export const EFFORT_LABELS = ['Off', 'Low', 'Medium', 'High', 'Max']
export const EFFORT_HINTS = [
  'Answers straight away, no thinking.',
  'A quick think first.',
  'Balanced: the default for most work.',
  'Thinks longer on hard problems.',
  'As long as it needs. Slowest, and costs the most.',
]
export function effortStop(level?: string | null): number {
  switch (level) {
    case 'none': case 'off': return 0
    case 'minimal': case 'low': return 1
    case 'high': return 3
    case 'xhigh': case 'max': return 4
    default: return 2
  }
}
export const getChatSetting = async (sessionId: string, key: string, profile = 'default') =>
  (await rpc<{ value?: string }>('config.get', { key, session_id: sessionId, profile }, 30_000))?.value
export const setChatSetting = (sessionId: string, key: string, value: string, profile = 'default') =>
  rpc<any>('config.set', { session_id: sessionId, profile, key, value }, 30_000)

/** "anthropic/claude-opus-5-5" → "Claude Opus 5.5"; "deepseek/deepseek-v4.1-flash" → "Deepseek V4.1 Flash". */
export function prettyModel(id?: string | null): string {
  if (!id) return 'Model'
  const last = id.split('/').pop() ?? id
  return last
    .replace(/[-_]/g, ' ')
    .replace(/(\d) (\d)(?!\d)/g, '$1.$2')
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bGpt\b/g, 'GPT').replace(/\bAi\b/g, 'AI')
}
