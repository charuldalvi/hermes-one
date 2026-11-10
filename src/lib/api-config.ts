// The routes behind three Settings pages: Models, Keys and accounts, and All settings. Same REST
// routes Hermes Desktop uses (apps/desktop/src/api/{config,models,local-models,delegation}.ts);
// every profile-scoped one takes `?profile=<name>`, which also tells the main process which
// profile's ticket to mint. Nothing here ever returns or logs a secret's value except
// `revealEnvVar`, which runs only on an explicit click.
import { at, get, rest } from './api'

const enc = encodeURIComponent

// ---------- config ----------

export type FieldType = 'string' | 'number' | 'boolean' | 'list' | 'select' | 'text'
export interface FieldSchema { type?: FieldType; description?: string; category?: string; options?: unknown[]; searchable?: boolean; clearable?: boolean }
export interface ConfigSchema { fields: Record<string, FieldSchema>; category_order: string[] }
export type ConfigRecord = Record<string, any>

export async function configSchema(profile: string): Promise<ConfigSchema> {
  const r = await get<any>(at('/api/config/schema', { profile }))
  const raw = r?.fields ?? {}
  const fields: Record<string, FieldSchema> = Array.isArray(raw) ? Object.fromEntries(raw) : raw
  return { fields, category_order: Array.isArray(r?.category_order) ? r.category_order : [] }
}
/** Saved values merged over Hermes' defaults (what Desktop reads). */
export const configValues = (profile: string) => get<ConfigRecord>(at('/api/config', { profile }))
/** Hermes' own defaults, shaped like `configValues` (the model as a string, context length 0). */
export async function configDefaults(): Promise<ConfigRecord> {
  const d = { ...(await get<ConfigRecord>('/api/config/defaults')) }
  if (d.model && typeof d.model === 'object') { const m = d.model; d.model = m.default ?? m.name ?? ''; d.model_context_length = typeof m.context_length === 'number' ? m.context_length : 0 }
  else if (d.model_context_length === undefined) d.model_context_length = 0
  return d
}
/** Hermes deep-merges what it gets, so send only the nested key that changed. */
export const saveConfig = (profile: string, patch: ConfigRecord) => rest<{ ok: boolean }>('PUT', at('/api/config', { profile }), { config: patch })
export const saveField = (profile: string, key: string, value: unknown) => saveConfig(profile, setNested({}, key, value))
export const rawConfig = (profile: string) => get<{ yaml: string; path: string }>(at('/api/config/raw', { profile }))
export const saveRawConfig = (profile: string, yaml: string) => rest<{ ok: boolean }>('PUT', at('/api/config/raw', { profile }), { yaml_text: yaml })

const UNSAFE = new Set(['__proto__', 'constructor', 'prototype'])
const parts = (path: string) => { const p = path.split('.'); if (p.some((x) => !x || UNSAFE.has(x))) throw new Error(`Unsafe setting name: ${path}`); return p }
export function getNested(obj: unknown, path: string): unknown {
  let cur: any = obj
  for (const k of parts(path)) { if (cur == null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, k)) return undefined; cur = cur[k] }
  return cur
}
/** A copy of `obj` with `path` set; parents are created as needed. */
export function setNested<T extends ConfigRecord>(obj: T, path: string, value: unknown): T {
  const p = parts(path)
  const root: any = structuredClone(obj ?? {})
  let cur = root
  for (let i = 0; i < p.length - 1; i++) {
    const nxt = Object.prototype.hasOwnProperty.call(cur, p[i]) ? cur[p[i]] : undefined
    if (nxt == null || typeof nxt !== 'object' || Array.isArray(nxt)) cur[p[i]] = {}
    cur = cur[p[i]]
  }
  cur[p[p.length - 1]] = value
  return root
}
/** A setting whose value is a password, key or token: shown only as "set" / "not set". */
export function isSecretKey(key: string): boolean {
  const last = key.split('.').pop() ?? key
  if (/_env$|_tokens$|^max_|_seconds$|_chars$|_ttl/.test(last)) return false
  return /(^|_)(api_key|apikey|password|password_hash|secret|secret_key|client_secret|token|access_token|refresh_token|private_key|bearer)$/i.test(last)
}
export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// ---------- models ----------

export interface CatalogProvider {
  slug: string; name: string; models: string[]; total_models?: number; authenticated?: boolean; is_current?: boolean; is_user_defined?: boolean
  source?: string; auth_type?: string; key_env?: string; warning?: string; free_tier?: boolean; unavailable_models?: string[]
  capabilities?: Record<string, { reasoning?: boolean; fast?: boolean; ultrafast?: boolean; can_disable_reasoning?: boolean }>
  featured_models?: string[]; api_url?: string; pricing?: Record<string, any>
}
export interface Catalog { providers: CatalogProvider[]; model?: string; provider?: string }
/** Every provider Hermes knows, signed in or not, with its models (the `hermes model` universe). */
export const modelCatalog = (profile: string, refresh = false) =>
  get<Catalog>(at('/api/model/options', { profile, include_unconfigured: 1, explicit_only: 1, refresh: refresh ? 1 : undefined }))
/** A provider is usable when it is signed in or already lists models. */
export const providerReady = (p?: CatalogProvider) => !!p && (p.authenticated !== false || (p.models?.length ?? 0) > 0)

export interface ModelInfo { model: string; provider: string; auto_context_length?: number; config_context_length?: number; effective_context_length?: number; capabilities?: Record<string, any> }
export const modelInfoFor = (profile: string) => get<ModelInfo>(at('/api/model/info', { profile }))

export interface StaleAux { task: string; provider: string; model: string; base_url?: string }
export interface AssignResult { ok: boolean; provider?: string; model?: string; confirm_required?: boolean; confirm_message?: string; notice?: string; stale_aux?: StaleAux[]; reset?: boolean; tasks?: string[] }
interface AssignBody { provider: string; model: string; base_url?: string; confirm_expensive_model?: boolean; reasoning_effort?: string | null }
/** A profile's main model (Chief's or a bot's) through the same assignment route Desktop uses for any profile. */
export const assignMain = (profile: string, body: AssignBody) =>
  rest<AssignResult>('POST', at('/api/model/set', { profile }), { scope: 'main', task: '', ...body })
export const assignAux = (profile: string, task: string, body: AssignBody) =>
  rest<AssignResult>('POST', at('/api/model/set', { profile }), { scope: 'auxiliary', task, ...body })
export const recommendedModel = (profile: string, provider: string) =>
  get<{ provider: string; model: string; free_tier: boolean | null }>(at('/api/model/recommended-default', { provider, profile }))

export interface AuxTask { task: string; provider: string; model: string; base_url: string; reasoning_effort?: string | null; local_endpoint?: boolean; label?: string; hint?: string; plugin?: string; inherit_from?: string | null; effective?: { provider: string; model: string; base_url: string } }
export const auxiliary = (profile: string) => get<{ tasks: AuxTask[]; main: { provider: string; model: string } }>(at('/api/model/auxiliary', { profile }))

export interface MoaSlot { provider: string; model: string; enabled?: boolean; reasoning_effort?: string }
export interface MoaPreset { enabled: boolean; reference_models: MoaSlot[]; aggregator: MoaSlot; reference_temperature: number | null; aggregator_temperature: number | null; reference_timeout: number | null; degraded_reference_policy: 'loud' | 'silent'; fanout?: string }
export interface MoaConfig extends MoaPreset { default_preset: string; active_preset: string; presets: Record<string, MoaPreset>; privacy_filter?: string }
export const moa = (profile: string) => get<MoaConfig>(at('/api/model/moa', { profile }))
export const saveMoa = (profile: string, body: MoaConfig) => rest<MoaConfig & { ok: boolean }>('PUT', at('/api/model/moa', { profile }), body)

// ---------- subagent routing ----------

export interface DelegationBackend { name: string; label: string; description: string; available: boolean; reason: string; builtin: boolean }
export interface ModelRoute { name: string; description: string; provider?: string; model: string; base_url?: string; reasoning_effort?: string; service_tier?: string; api_key?: string; original_name?: string; [k: string]: unknown }
export interface ProfileRoute { name: string; description?: string }
export interface DelegationRouting {
  configured: string; blocked_reason: string | null; backends: DelegationBackend[]
  model_map: { options: ModelRoute[]; default: string | null }; profile_routes: { profiles: ProfileRoute[]; default: string | null }; profiles: string[]
}
export const delegationRouting = (profile: string) => get<DelegationRouting>(at('/api/delegation/routing', { profile }))
export const setDelegationBackend = (profile: string, backend: string) => rest('PUT', at('/api/delegation/backend', { profile }), { backend })
export const saveModelRoutes = (profile: string, body: { options: ModelRoute[]; default: string | null }) =>
  rest<{ ok: boolean; model_map: DelegationRouting['model_map'] }>('PUT', at('/api/delegation/backends/model_map', { profile }), body)
export const saveProfileRoutes = (profile: string, body: { profiles: ProfileRoute[]; default: string | null }) =>
  rest<{ ok: boolean; profile_routes: DelegationRouting['profile_routes'] }>('PUT', at('/api/delegation/backends/profile_routes', { profile }), body)

// ---------- models on this Mac (llama.cpp runtime) ----------

export interface LocalStatus {
  enabled: boolean; tag: string; configured_tag: string; update_available: boolean; runtime_installed: boolean; runtime_backend: string | null
  server_running: boolean; server_base_url: string | null; active_model_id: string | null; loaded_models: Record<string, string>
  loading?: Record<string, { percent?: number } | number>; placement?: Record<string, { spilled?: boolean } | string>
  models: { id: string; size_bytes: number; size_label: string }[]; models_dir: string
}
export interface LocalHardware { uma: boolean; vram_total_bytes: number; vram_usable_bytes: number; ram_total_bytes: number; ram_available_bytes: number; vram_label: string; gpu_name: string | null; gpu_util_percent: number | null; vram_used_bytes: number | null }
export interface LocalModel {
  id: string; display_name: string; description: string; size_bytes: number; size_label: string; native_context: number; native_context_label: string
  recommended: boolean; recommended_reason?: string | null; downloaded: boolean; downloaded_model_id?: string | null; downloaded_quant?: string | null
  mtp: boolean; vision?: boolean; fits: boolean; fit_summary: string; fit_detail?: string; needs_engine?: boolean; min_engine?: string | null
  model_id?: string; quant?: string; start_window_label?: string; spilled?: boolean
}
export interface LocalJob {
  job_id: string; kind: 'model-activate' | 'model-download' | 'quickstart' | 'runtime-install'; target: string; model_id: string | null
  status: 'done' | 'error' | 'paused' | 'running'; phase: string; detail: string; total_bytes: number | null; done_bytes: number; percent?: number
  bytes_per_sec?: number | null; eta_seconds?: number | null; error: string | null; can_pause?: boolean; can_resume?: boolean; pause_requested?: boolean
}
export interface HfHit { repo: string; downloads: number; likes: number; updated: string; gated: boolean }
export interface HfFiles { label: string; paths: string[]; total_bytes: number; fit: 'fits-gpu' | 'needs-ram' | 'too-big' | 'unknown' }
export const localStatus = () => get<LocalStatus>('/api/local-models/status')
export const localHardware = () => get<LocalHardware>('/api/local-models/hardware')
export const localCatalog = async () => (await get<{ models: LocalModel[] }>('/api/local-models/catalog')).models ?? []
export const localJobs = async () => (await get<{ jobs: LocalJob[] }>('/api/local-models/jobs')).jobs ?? []
export const localJob = (id: string) => get<LocalJob>(`/api/local-models/jobs/${enc(id)}`)
export const installRuntime = (backend?: string) => rest<{ job_id: string; backend: string; tag: string }>('POST', '/api/local-models/runtime/install', { backend: backend ?? null })
export const quickstartLocal = (modelId?: string) => rest<{ job_id: string; model_id: string; display_name: string; download_bytes: number; needs_download: boolean; needs_runtime: boolean }>('POST', '/api/local-models/quickstart', { model_id: modelId ?? null })
export const downloadLocal = (modelId: string) => rest<{ job_id: string | null; already_downloaded?: boolean }>('POST', '/api/local-models/download', { model_id: modelId })
export const pauseLocal = (jobId: string) => rest<{ ok: boolean; paused: boolean }>('POST', '/api/local-models/download/pause', { job_id: jobId })
export const resumeLocal = (jobId: string) => rest<{ ok: boolean; resumed: boolean }>('POST', '/api/local-models/download/resume', { job_id: jobId })
export const deleteLocal = (modelId: string) => rest('DELETE', `/api/local-models/models/${enc(modelId)}`)
export const activateLocal = (modelId: string) => rest<{ job_id: string }>('POST', '/api/local-models/activate', { model_id: modelId })
export const ejectLocal = (modelId: string) => rest('POST', '/api/local-models/eject', { model_id: modelId })
export const localServer = (action: 'start' | 'stop') => rest('POST', '/api/local-models/server', { action })
export const hfSearch = async (q: string, limit = 20) => (await get<{ hits: HfHit[] }>(at('/api/local-models/search', { q, limit }))).hits ?? []
export const hfFiles = async (repo: string) => (await get<{ files: HfFiles[] }>(at('/api/local-models/search/files', { repo }))).files ?? []
export const downloadBrowsed = (repo: string, paths: string[]) => rest<{ job_id: string | null; model_id: string; already_downloaded?: boolean }>('POST', '/api/local-models/download-browsed', { repo, paths })
export const sideloadLocal = (path: string) => rest<{ ok: boolean; model_id: string; already_present?: boolean }>('POST', '/api/local-models/sideload', { path })

// ---------- keys (.env) ----------

export interface EnvProfile { provider: string; provider_label: string; description: string; url?: string | null; primary?: boolean }
export interface EnvInfo {
  key: string; is_set: boolean; description: string; url: string | null; category: string; is_password: boolean; tools: string[]; advanced: boolean
  channel_managed?: boolean; provider?: string; provider_label?: string; provider_profiles?: EnvProfile[]; provider_primary?: boolean; custom?: boolean
}
/** Every key Hermes knows for this profile. The stored value never leaves this function (only whether it's set). */
export async function envVars(profile: string): Promise<EnvInfo[]> {
  const r = await get<Record<string, any>>(at('/api/env', { profile }))
  return Object.entries(r ?? {}).map(([key, v]) => {
    const { redacted_value: _hidden, ...rest } = (v ?? {}) as any
    void _hidden
    return { key, ...rest, is_set: !!rest.is_set, description: String(rest.description ?? ''), category: String(rest.category ?? ''), tools: rest.tools ?? [] } as EnvInfo
  })
}
export const setEnvVar = (profile: string, key: string, value: string, providerSetup = false) =>
  rest<{ ok: boolean }>('PUT', at('/api/env', { profile }), providerSetup ? { key, value, provider_setup: true } : { key, value })
export const deleteEnvVar = (profile: string, key: string) => rest('DELETE', at('/api/env', { profile }), { key })
/** The real value of one key. Only on an explicit click: Hermes allows 5 per 30 seconds and logs each. */
export const revealEnvVar = (profile: string, key: string) => rest<{ key: string; value: string }>('POST', at('/api/env/reveal', { profile }), { key })
export const validateCredential = (profile: string, key: string, value: string, apiKey = '') =>
  rest<{ ok: boolean; reachable: boolean; message: string; models?: string[]; resolved_base_url?: string }>('POST', at('/api/providers/validate', { profile }), { key, value, api_key: apiKey })

// ---------- accounts (OAuth) ----------

export interface OAuthStatus { logged_in: boolean; source?: string | null; source_label?: string | null; expires_at?: string | number | null; has_refresh_token?: boolean; last_refresh?: string | null; free_tier?: boolean; account_tier?: string | null; error?: string }
export interface OAuthProvider { id: string; name: string; flow: 'device_code' | 'external' | 'pkce'; cli_command: string; docs_url: string; disconnect_hint?: string | null; disconnect_command?: string | null; disconnectable?: boolean; status: OAuthStatus }
export type OAuthStart =
  | { flow: 'pkce'; session_id: string; auth_url: string; expires_in: number }
  | { flow: 'device_code'; session_id: string; user_code: string; verification_url: string; poll_interval: number; expires_in: number }
export interface OAuthPoll { session_id: string; status: 'pending' | 'approved' | 'denied' | 'error' | 'expired' | 'cancelled'; error_message?: string | null; account_email?: string | null; model?: string | null; reason?: string | null; retryable?: boolean | null; retry_after?: number | null }
export const oauthList = async (profile: string) => ((await get<{ providers: OAuthProvider[] }>(at('/api/providers/oauth', { profile })))?.providers ?? [])
export const oauthStart = (profile: string, id: string) => rest<OAuthStart>('POST', at(`/api/providers/oauth/${enc(id)}/start`, { profile }), {})
export const oauthSubmit = (profile: string, id: string, sessionId: string, code: string) =>
  rest<{ ok: boolean; status: 'approved' | 'error'; message?: string }>('POST', at(`/api/providers/oauth/${enc(id)}/submit`, { profile }), { session_id: sessionId, code })
/** A long-poll: answers once the sign-in leaves "pending", or after `wait` seconds (Hermes caps it at 25). */
export const oauthPoll = (profile: string, id: string, sessionId: string, wait = 20) =>
  get<OAuthPoll>(at(`/api/providers/oauth/${enc(id)}/poll/${enc(sessionId)}`, { profile, wait: wait || undefined }))
export const oauthCancel = (profile: string, sessionId: string) => rest('DELETE', at(`/api/providers/oauth/sessions/${enc(sessionId)}`, { profile })).catch(() => undefined)
export const oauthDisconnect = (profile: string, id: string) => rest('DELETE', at(`/api/providers/oauth/${enc(id)}`, { profile }))

// ---------- custom endpoints ----------

export type ApiMode = '' | 'chat_completions' | 'codex_responses' | 'anthropic_messages'
export interface CustomEndpoint { id: string; name: string; base_url: string; model: string; models: string[]; api_mode?: ApiMode; context_length?: number | null; discover_models: boolean; has_api_key: boolean; is_current?: boolean; source?: string }
export interface EndpointModelDetail { id: string; canonical_model?: string | null; reasoning_effort?: string | null }
export interface CustomEndpointUpdate { id?: string; name: string; base_url: string; model: string; api_key?: string; api_mode?: ApiMode; context_length?: number; discover_models?: boolean; make_default?: boolean; models?: string[]; model_details?: EndpointModelDetail[] }
export interface CustomEndpoints { endpoints: CustomEndpoint[]; current: { provider: string; model: string; base_url: string }; id?: string; ok?: boolean }
export const customEndpoints = (profile: string) => get<CustomEndpoints>(at('/api/providers/custom-endpoints', { profile }))
export const saveCustomEndpoint = (profile: string, body: CustomEndpointUpdate) => rest<CustomEndpoints>('POST', at('/api/providers/custom-endpoints', { profile }), body)
export const testCustomEndpoint = (profile: string, body: CustomEndpointUpdate) =>
  rest<{ ok: boolean; reachable: boolean; message: string; models: string[]; model_details?: EndpointModelDetail[]; resolved_base_url?: string; transport_checked?: ApiMode }>('POST', at('/api/providers/custom-endpoints/validate', { profile }), body)
export const activateCustomEndpoint = (profile: string, id: string) => rest<{ ok: boolean; provider: string; model: string }>('POST', at(`/api/providers/custom-endpoints/${enc(id)}/activate`, { profile }))
export const deleteCustomEndpoint = (profile: string, id: string) => rest<CustomEndpoints>('DELETE', at(`/api/providers/custom-endpoints/${enc(id)}`, { profile }))

// ---------- small shared words ----------

/** "1000000" → "1M", "262144" → "256K". */
export function tokens(n?: number | null): string {
  if (!n || n <= 0) return '—'
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`
  if (n >= 1000) return `${Math.round(n / 1024) === n / 1024 ? n / 1024 : Math.round(n / 1000)}K`
  return String(n)
}
export function bytes(n?: number | null): string {
  if (!n || n <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i >= 3 ? 1 : 0)} ${u[i]}`
}
