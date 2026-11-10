// The extra routes the Skills, Plugins, Tools and Memory pages use, beside the ones in api.ts. Same
// helpers (rest/get/at/rpc), same profile rule: `?profile=` on every call, left out for Chief, so the
// main process mints the ticket for the bot the page is about. Mirrors Hermes Desktop's api/skills.ts,
// api/toolsets.ts, api/system.ts and store/agent-plugins.ts.
import { at, get, rest, rpc } from './api'

const enc = encodeURIComponent
/** A plugin key like `platforms/a2a` keeps its slash (the route is `{name:path}`). */
const encPath = (name: string) => name.split('/').map(enc).join('/')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- background actions (hub installs, post-setup, permission grants) ----------

export interface ActionStarted { name: string; ok: boolean; pid?: number; already_running?: boolean }
export interface ActionStatus { name: string; running: boolean; exit_code: number | null; lines: string[] }

export const actionStatus = (profile: string, name: string, lines = 200) =>
  get<ActionStatus>(at(`/api/actions/${enc(name)}/status`, { lines, profile }))

/** Waits for a spawned action to finish, passing its log along as it grows. */
export async function followAction(profile: string, started: ActionStarted, onLines?: (lines: string[]) => void, everyMs = 1200, maxTries = 250): Promise<ActionStatus> {
  if (!started?.ok || !started.name) throw new Error('Hermes couldn’t start that.')
  let last: ActionStatus = { name: started.name, running: true, exit_code: null, lines: [] }
  for (let i = 0; i < maxTries; i++) {
    await sleep(everyMs)
    last = await actionStatus(profile, started.name, 300)
    onLines?.(last.lines ?? [])
    if (!last.running) return last
  }
  return last
}
/** The last few log lines, for a failure message. */
export const tail = (s: ActionStatus, n = 3) => (s.lines ?? []).filter((l) => l.trim()).slice(-n).join('\n').trim()

// ---------- skills ----------

export type Provenance = 'agent' | 'bundled' | 'external' | 'hub'
export const saveSkill = (profile: string, name: string, content: string) => rest('PUT', at('/api/skills/content', { profile }), { name, content })
export const createSkill = (profile: string, name: string, content: string, category?: string) =>
  rest('POST', at('/api/skills', { profile }), { name, content, ...(category?.trim() ? { category: category.trim() } : {}) })
export const lockSkill = (profile: string, name: string, locked: boolean) => rest('PUT', at('/api/skills/lock', { profile }), { name, locked })
export const hubUpdate = (profile: string) => rest<ActionStarted>('POST', at('/api/skills/hub/update', { profile }), {})
export const hubUninstallSkill = (profile: string, name: string) => rest<ActionStarted>('POST', at('/api/skills/hub/uninstall', { profile }), { name })

// ---------- learning (what Hermes has learned: memories and the skills it wrote) ----------

export interface LearnNode { id: string; label: string; kind: 'memory' | 'skill'; memorySource?: 'memory' | 'profile'; timestamp?: number | null; category: string; useCount: number; state: string; createdBy: string | null; pinned: boolean }
export interface LearnCard { source: 'memory' | 'profile'; timestamp?: number | null; title: string; body: string; fingerprint?: string }
export interface LearnGraph { nodes: LearnNode[]; edges: { source: string; target: string }[]; clusters: { category: string; count: number }[]; memory: LearnCard[]; stats: Record<string, any> }
export interface LearnDetail { ok: boolean; kind: 'memory' | 'skill'; id: string; label: string; content: string }

export const learningGraph = (profile: string) => get<LearnGraph>(at('/api/learning/graph', { profile }))
export const learningNode = (profile: string, id: string) => get<LearnDetail>(at('/api/learning/node', { id, profile }))
export async function editLearningNode(profile: string, id: string, content: string) {
  const r = await rest<{ ok: boolean; message?: string }>('PUT', at('/api/learning/node', { profile }), { id, content })
  if (r && r.ok === false) throw new Error(r.message || 'Hermes didn’t save that.')
  return r
}
/** Skills are archived (they can come back with `hermes curator restore`); memories are removed. */
export async function deleteLearningNode(profile: string, id: string) {
  const r = await rest<{ ok: boolean; message?: string }>('DELETE', at('/api/learning/node', { profile }), { id })
  if (r && r.ok === false) throw new Error(r.message || 'Hermes didn’t remove that.')
  return r
}

// ---------- plugins ----------

export interface PluginSetting { key: string; type: 'boolean' | 'enum' | 'json' | 'number' | 'secret' | 'string'; label: string; description: string; required: boolean; value?: unknown; default?: unknown; choices?: string[]; env?: string; has_value?: boolean }
export interface PluginServer { name: string; state: string; sentence: string }
/** One row of `plugins.manage list`: what the hub doesn't say (tools, settings, catalog pin). */
export interface ManagedPlugin {
  name: string; key?: string; version?: string; description?: string; source?: string; status?: 'enabled' | 'disabled' | 'not enabled'
  portable?: boolean; install_dir?: string; has_desktop_half?: boolean; settings_schema?: PluginSetting[]; servers?: PluginServer[]; tools?: string[]
  catalog_name?: string; catalog_tier?: string; installed_sha?: string; catalog_sha?: string; catalog_version?: string | null
  update_available?: boolean; update_target?: string; pinned_sha?: string
}
const scoped = (profile: string, params: Record<string, unknown>) => (profile && profile !== 'default' ? { ...params, profile } : params)

export const managedPlugins = async (profile: string) => ((await rpc<{ plugins?: ManagedPlugin[] }>('plugins.manage', scoped(profile, { action: 'list' }), 30_000))?.plugins ?? [])
export async function savePluginSettings(profile: string, key: string, values: Record<string, unknown>, secrets: Record<string, string>) {
  for (const [env, value] of Object.entries(secrets)) if (value) await rest('PUT', at('/api/env', { profile }), { key: env, value })
  if (!Object.keys(values).length && !Object.values(secrets).some(Boolean)) return
  const r = await rpc<{ ok?: boolean; error?: string }>('plugins.manage', scoped(profile, { action: 'settings', key, values }), 30_000)
  if (r && r.ok === false) throw new Error(r.error || 'Hermes didn’t save those settings.')
}
export const setPluginOn = (profile: string, name: string, on: boolean) =>
  rest<{ ok: boolean; restart_required?: boolean; unchanged?: boolean }>('POST', at(`/api/dashboard/agent-plugins/${encPath(name)}/${on ? 'enable' : 'disable'}`, { profile }))

export interface ScanFinding { severity: string; category: string; file: string; line: number; description: string }
export interface PluginUpdateAnswer { ok?: boolean; unchanged?: boolean; consent_required?: boolean; sha?: string; delta_lines?: string[]; scan_blocked?: boolean; scan_verdict?: string; scan_findings?: ScanFinding[]; error?: string }
export const updatePluginTo = (profile: string, name: string, opts: { accept?: boolean; force?: boolean } = {}) =>
  rest<PluginUpdateAnswer>('POST', at(`/api/dashboard/agent-plugins/${encPath(name)}/update`, { profile }),
    opts.accept || opts.force ? { ...(opts.accept ? { accept_capabilities: true } : {}), ...(opts.force ? { force: true } : {}) } : undefined)
export const removePluginNamed = (profile: string, name: string) => rest('DELETE', at(`/api/dashboard/agent-plugins/${encPath(name)}`, { profile }))
export interface UpdateAllRow { name: string; status: 'updated' | 'current' | 'needs_review' | 'failed' | string; detail?: string }
export const updateAllPlugins = (profile: string) => rest<{ results?: UpdateAllRow[] }>('POST', at('/api/dashboard/agent-plugins/update-all', { profile }))
export const pluginAutoUpdate = (profile: string) => get<{ auto_apply?: boolean; check_hours?: number }>(at('/api/dashboard/plugins/auto-update', { profile }))
export const setPluginAutoUpdate = (profile: string, enabled: boolean) => rest<{ auto_apply?: boolean; check_hours?: number }>('PUT', at('/api/dashboard/plugins/auto-update', { profile }), { enabled })
export const rescanPlugins = (profile: string) => get(at('/api/dashboard/plugins/rescan', { profile }))
export const setContextEngine = (profile: string, engine: string) => rest('PUT', at('/api/dashboard/plugin-providers', { profile }), { context_engine: engine })
/** `''` is built-in memory (api.ts' setPluginProviders can't send that one). */
export const setPluginMemory = (profile: string, provider: string) => rest('PUT', at('/api/dashboard/plugin-providers', { profile }), { memory_provider: provider })

// ---------- tools ----------

export type ProviderStatus = 'ready' | 'needs_setup' | 'needs_auth' | 'needs_keys'
export interface ToolEnvVar { key: string; prompt: string; url: string | null; default: string | null; is_set: boolean }
export interface ToolProvider {
  name: string; badge: string; tag: string; env_vars: ToolEnvVar[]; post_setup: string | null; requires_nous_auth: boolean; is_active: boolean
  status?: ProviderStatus; web_backend?: string; tts_provider?: string; capabilities?: ('search' | 'extract')[]; managed_nous_feature?: string | null
}
export interface ToolsetConfig {
  name: string; has_category: boolean; providers: ToolProvider[]; active_provider: string | null
  active_search_backend?: string | null; active_extract_backend?: string | null; search_via_nous?: boolean; extract_via_nous?: boolean
}
export interface ToolsetModel { id: string; display: string; speed: string; strengths: string; price: string }
export interface ToolsetModels { name: string; has_models: boolean; provider?: string | null; models: ToolsetModel[]; current: string | null; default: string | null }

export const toolsetConfig = (profile: string, name: string) => get<ToolsetConfig>(at(`/api/tools/toolsets/${enc(name)}/config`, { profile }))
export const toolsetModels = (profile: string, name: string, provider?: string) => get<ToolsetModels>(at(`/api/tools/toolsets/${enc(name)}/models`, { provider, profile }))
export const setToolsetModel = (profile: string, name: string, model: string, provider?: string) => rest('PUT', at(`/api/tools/toolsets/${enc(name)}/model`, { profile }), { model, ...(provider ? { provider } : {}) })
export const setToolsetProvider = (profile: string, name: string, provider: string, capability?: 'search' | 'extract') =>
  rest<{ ok: boolean; needs_nous_auth?: boolean; feature?: string }>('PUT', at(`/api/tools/toolsets/${enc(name)}/provider`, { profile }), capability ? { provider, capability } : { provider })
/** Saves keys a toolset's providers ask for (the route refuses any other key). */
export const setToolsetEnv = (profile: string, name: string, env: Record<string, string>) =>
  rest<{ ok: boolean; is_set?: Record<string, boolean> }>('PUT', at(`/api/tools/toolsets/${enc(name)}/env`, { profile }), { env })
export const deleteEnvKey = (profile: string, key: string) => rest('DELETE', at('/api/env', { profile }), { key })
export const runPostSetup = (profile: string, name: string, key: string) => rest<ActionStarted & { key: string }>('POST', at(`/api/tools/toolsets/${enc(name)}/post-setup`, { profile }), { key })

export interface TerminalBackend { name: string; label: string; description: string; active: boolean; status: 'ready' | 'needs_setup' | 'unavailable'; detail: string }
export const terminalBackends = (profile: string) => get<{ active: string; backends: TerminalBackend[] }>(at('/api/tools/terminal/backends', { profile }))
export const setTerminalBackend = (profile: string, backend: string) => rest('PUT', at('/api/tools/terminal/backend', { profile }), { backend })

export interface ComputerUse {
  platform: string; platform_supported: boolean; installed: boolean; version: string | null; ready: boolean | null; can_grant: boolean
  checks: { label: string; status: string; message: string }[]; accessibility: boolean | null; screen_recording: boolean | null; error: string | null
}
export const computerUseStatus = () => get<ComputerUse>('/api/tools/computer-use/status')
export const grantComputerUse = () => rest<ActionStarted>('POST', '/api/tools/computer-use/permissions/grant')

/** Tool name → how many times it was called this year (cosmetic; empty when Hermes can't say). */
export async function toolCalls(profile: string): Promise<Record<string, number>> {
  try {
    const r = await get<{ tools?: { tool: string; count: number }[] }>(at('/api/analytics/usage', { days: 365, profile }))
    return Object.fromEntries((r?.tools ?? []).map((t) => [t.tool, t.count]))
  } catch { return {} }
}

// ---------- config (a few keys these pages own a switch for) ----------

export const configRecord = (profile: string) => get<Record<string, any>>(at('/api/config', { profile }))
/** A sparse write: the route deep-merges it over what's on disk. */
export const patchConfig = (profile: string, config: Record<string, any>) => rest('PUT', at('/api/config', { profile }), { config })

// ---------- memory ----------

export type MemoryStatus = 'ready' | 'needs_config' | 'unavailable' | 'missing'
export interface MemoryProviderSetup { pip_dependencies?: string[]; external_dependencies?: { name: string; install?: string; check?: string }[]; required_env?: string[]; dependencies_installed?: boolean }
export interface MemoryProviderRow { name: string; description: string; available: boolean; configured: boolean; status: MemoryStatus; setup?: MemoryProviderSetup }
export interface MemoryInfo { active: string; providers: MemoryProviderRow[]; builtin_files: { memory: number; user: number } }
export interface ProviderField {
  key: string; label: string; kind: 'bool' | 'json' | 'number' | 'secret' | 'select' | 'text'; description?: string; placeholder?: string; required?: boolean
  value: string; is_set?: boolean; options?: ({ value: string; label: string; description?: string } | string)[]; url?: string; when?: Record<string, unknown> | null
}
export interface ProviderConfig { name: string; label: string; fields: ProviderField[]; setup?: MemoryProviderSetup; docs_url?: string }
export interface SetupResult { kind?: string; name?: string; status: string; error?: string; command?: string; output?: string }

/** Reset is a destructive route: Hermes refuses an unnamed profile once it serves several, so this
 *  one always names it, `default` included (api.ts' resetMemory leaves Chief's out). */
export const forgetMemory = (profile: string, target: 'memory' | 'user' | 'all') =>
  rest<{ ok: boolean; deleted?: string[] }>('POST', `/api/memory/reset?profile=${enc(profile || 'default')}`, { target })
export const memoryProviderConfig = (profile: string, name: string) => get<ProviderConfig>(at(`/api/memory/providers/${enc(name)}/config`, { profile }))
/** Saves the provider's settings and makes it the one in use (Hermes checks it's ready first). */
export const saveMemoryProviderConfig = (profile: string, name: string, values: Record<string, string>) =>
  rest<{ ok: boolean; active?: string }>('PUT', at(`/api/memory/providers/${enc(name)}/config`, { profile }), { values })
export const setupMemoryProvider = (profile: string, name: string, values: Record<string, string> = {}) =>
  rest<{ ok: boolean; results: SetupResult[]; status?: MemoryProviderRow }>('POST', at(`/api/memory/providers/${enc(name)}/setup`, { profile }), { values })
