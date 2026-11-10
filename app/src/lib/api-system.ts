// Routes behind the Scheduled, Messaging and System pages, the same ones Hermes Desktop and Hermes
// Remote call. Everything a bot owns names its profile explicitly (`?profile=default` too): the
// gateway refuses an unnamed profile for changes while it serves several, and an unnamed cron list
// means "every profile", which a per-profile ticket may not read.
import { get, rest } from './api'

const enc = encodeURIComponent

/** A path with query values; empty ones are left out, but `profile=default` is kept. */
export function q(path: string, query: Record<string, string | number | boolean | undefined | null> = {}): string {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v))
  const t = s.toString()
  return t ? `${path}${path.includes('?') ? '&' : '?'}${t}` : path
}

// ---------------------------------------------------------------------------------------------
// Scheduled jobs (cron)

export interface CronSchedule { kind?: 'cron' | 'interval' | 'once' | string; expr?: string; minutes?: number; run_at?: string; display?: string }
export interface CronExecution { id?: string; status?: string; claimed_at?: string | null; started_at?: string | null; finished_at?: string | null; error?: string | null; delivery_outcome?: string | null }
export interface CronJob {
  id: string
  profile: string
  name?: string | null
  prompt?: string | null
  script?: string | null
  no_agent?: boolean
  skills?: string[] | null
  skill?: string | null
  model?: string | null
  provider?: string | null
  schedule?: CronSchedule | string | null
  schedule_display?: string | null
  repeat?: { times?: number | null; completed?: number | null } | null
  enabled?: boolean
  state?: string | null
  paused_at?: string | null
  paused_reason?: string | null
  created_at?: string | null
  next_run_at?: string | null
  last_run_at?: string | null
  last_status?: string | null
  last_error?: string | null
  last_delivery_error?: string | null
  failure_streak?: number | null
  deliver?: string | null
  catch_up?: boolean | null
  timezone?: string | null
  enabled_toolsets?: string[] | null
  workdir?: string | null
  latest_execution?: CronExecution | null
  live_execution?: CronExecution | null
}
export interface CronRun {
  id: string; title?: string | null; preview?: string | null; source?: string; started_at?: number; ended_at?: number | null; last_active?: number
  end_reason?: string | null; message_count?: number; tool_call_count?: number; input_tokens?: number; output_tokens?: number; model?: string | null
  is_active?: boolean; scheduler_owned?: boolean; profile?: string; estimated_cost_usd?: number | null
}
export interface DeliveryTarget { id: string; name: string; home_target_set: boolean; home_env_var?: string | null }
export interface BlueprintField { name: string; type: 'enum' | 'text' | 'time' | 'weekdays' | string; label: string; default: string | null; options: string[]; optional: boolean; strict?: boolean; help: string }
export interface Blueprint { key: string; title: string; description: string; category: string; tags: string[]; fields: BlueprintField[]; source?: string; plugin?: string | null; schedule?: string; scheduleHuman?: string }
export interface CronCreate {
  name: string; prompt: string; schedule: string; deliver: string; skills?: string[]; paused?: boolean; repeat?: number | string | null
  model?: string | null; provider?: string | null; catch_up?: boolean | null
}

const jobPath = (job: Pick<CronJob, 'id'>, tail = '') => `/api/cron/jobs/${enc(job.id)}${tail}`

export async function cronJobs(profile: string): Promise<CronJob[]> {
  const list = await get<CronJob[]>(q('/api/cron/jobs', { profile }))
  return (Array.isArray(list) ? list : []).map((j) => ({ ...j, profile: (j as any).profile_name ?? j.profile ?? profile }))
}
/** Every bot's jobs; a bot whose list fails is named in `failed` instead of hiding the rest. */
export async function allCronJobs(profiles: string[]): Promise<{ jobs: CronJob[]; failed: string[] }> {
  const out = await Promise.allSettled(profiles.map((p) => cronJobs(p).then((jobs) => jobs.map((j) => ({ ...j, profile: p })))))
  const jobs: CronJob[] = []
  const failed: string[] = []
  out.forEach((r, i) => (r.status === 'fulfilled' ? jobs.push(...r.value) : failed.push(profiles[i])))
  return { jobs, failed }
}
export const cronRuns = async (job: CronJob, limit = 30) => ((await get<{ runs: CronRun[] }>(q(jobPath(job, '/runs'), { profile: job.profile, limit }))).runs ?? [])
export const createCron = (profile: string, body: CronCreate) => rest<CronJob>('POST', q('/api/cron/jobs', { profile }), body)
export const updateCron = (job: CronJob, updates: Record<string, unknown>) => rest<CronJob>('PUT', q(jobPath(job), { profile: job.profile }), { updates })
export const cronAction = (job: CronJob, action: 'pause' | 'resume' | 'trigger' | 'cancel') => rest<any>('POST', q(jobPath(job, `/${action}`), { profile: job.profile }))
export const deleteCron = (job: CronJob) => rest('DELETE', q(jobPath(job), { profile: job.profile }))
export const deliveryTargets = async (profile: string) => ((await get<{ targets: DeliveryTarget[] }>(q('/api/cron/delivery-targets', { profile }))).targets ?? [])
export const blueprints = async (profile: string) => ((await get<{ blueprints: Blueprint[] }>(q('/api/cron/blueprints', { profile }))).blueprints ?? [])
export const instantiateBlueprint = (profile: string, blueprint: string, values: Record<string, string>) =>
  rest<CronJob>('POST', q('/api/cron/blueprints/instantiate', { profile }), { blueprint, values })
/** The newest messages of a run, to show what the job said. */
export const runMessages = async (runId: string, profile: string) =>
  ((await get<{ messages: { role: string; content?: any; display_content?: any; text?: string }[] }>(q(`/api/sessions/${enc(runId)}/messages`, { profile, order: 'latest', limit: 40 }))).messages ?? [])

// ---------------------------------------------------------------------------------------------
// Messaging

export interface PlatformField {
  key: string; required: boolean; is_set: boolean; redacted_value?: string | null; description?: string; prompt?: string; help?: string
  url?: string | null; is_password?: boolean; is_list?: boolean; advanced?: boolean; value?: string | null
}
export interface Platform {
  id: string; name: string; description: string; docs_url?: string; enabled: boolean; configured: boolean; gateway_running: boolean
  state?: string | null; error_code?: string | null; error_message?: string | null; updated_at?: string | null
  home_channel?: { chat_id: string; name: string; platform: string; thread_id?: string } | null
  env_vars: PlatformField[]; disabled_by_relay?: boolean; relay_fronted?: boolean; relay_exclusive?: boolean; ingress_url?: string | null
}
export interface PlatformUpdate { enabled?: boolean; env?: Record<string, string>; clear_env?: string[] }
export interface PairingUser { platform: string; user_id: string; user_name?: string; request_id?: string; age_minutes?: number; approved_at?: string }
export interface RelayAccount { platformUserId: string; displayName?: string; handle?: string }
export interface RelayInfo { managed_by?: string; portal_url?: string; platforms: { platform: string; bot_url: string | null; accounts: RelayAccount[] }[] }
export interface RelayCode { code: string; command: string; bot_url: string | null; expires_at: string | null; platform: string }
export interface TelegramStart { pairing_id: string; deep_link: string; qr_payload: string; expires_at: string; suggested_username?: string }
export interface Webhook { name: string; description: string; events: string[]; prompt: string; deliver: string; deliver_only: boolean; enabled: boolean; skills: string[]; url: string; secret_set: boolean; created_at: string | null }
export interface WebhookCreate { name: string; description?: string; events?: string[]; prompt?: string; deliver?: string; deliver_only?: boolean; skills?: string[] }
export interface RestartOutcome { ok?: boolean; needs_restart?: boolean; restart_started?: boolean; restart_error?: string; restart_pid?: number | null; bot_username?: string | null }

export const platforms = async (profile: string) => (await get<{ platforms: Platform[]; env_path?: string; gateway_start_command?: string }>(q('/api/messaging/platforms', { profile })))
export const updatePlatform = (profile: string, id: string, body: PlatformUpdate) => rest<{ ok: boolean; hot_served?: boolean }>('PUT', q(`/api/messaging/platforms/${enc(id)}`, { profile }), body)
export const testPlatform = (profile: string, id: string) => rest<{ ok: boolean; message: string; state?: string | null }>('POST', q(`/api/messaging/platforms/${enc(id)}/test`, { profile }))

export const relay = (profile: string) => get<RelayInfo>(q('/api/messaging/relay', { profile }))
export const relayLink = (profile: string, platform: string) => rest<RelayCode>('POST', q(`/api/messaging/relay/${enc(platform)}/link`, { profile }))
export const relayLinkState = (profile: string, code: string) => get<{ state: 'inactive' | 'pending' | 'refused'; reason?: string | null }>(q(`/api/messaging/relay/link/${enc(code)}`, { profile }))
export const relayUnlink = (profile: string, platform: string, userId: string) => rest('DELETE', q(`/api/messaging/relay/${enc(platform)}/accounts/${enc(userId)}`, { profile }))

export const telegramStart = (profile: string) => rest<TelegramStart>('POST', q('/api/messaging/telegram/onboarding/start', { profile }), {})
export const telegramStatus = (profile: string, id: string) => get<{ status: 'waiting' | 'ready'; bot_username?: string | null; owner_user_id?: string | null; expires_at: string }>(q(`/api/messaging/telegram/onboarding/${enc(id)}`, { profile }))
export const telegramApply = (profile: string, id: string, allowed: string[]) => rest<RestartOutcome>('POST', q(`/api/messaging/telegram/onboarding/${enc(id)}/apply`, { profile }), { allowed_user_ids: allowed, profile })
export const telegramCancel = (profile: string, id: string) => rest('DELETE', q(`/api/messaging/telegram/onboarding/${enc(id)}`, { profile }))

// WhatsApp: Hermes starts its WhatsApp bridge, which shows a code to scan in WhatsApp › Linked devices.
export interface WhatsAppSession { pairing_id: string; status: 'installing' | 'starting' | 'waiting' | 'connected' | 'error' | 'expired' | 'cancelled' | string; qr_payload?: string | null; expires_at?: string; mode?: string; allowed_users?: string; account_id?: string | null; account_name?: string | null; account_phone?: string | null; error?: string | null }
export const whatsappStart = (profile: string, mode: 'bot' | 'self-chat', allowedUsers: string, reset = false) =>
  rest<WhatsAppSession>('POST', q('/api/messaging/whatsapp/onboarding/start', { profile }), { mode, allowed_users: allowedUsers, profile, reset_session: reset })
export const whatsappStatus = (profile: string, id: string) => get<WhatsAppSession>(q(`/api/messaging/whatsapp/onboarding/${enc(id)}`, { profile }))
export const whatsappApply = (profile: string, id: string, mode: 'bot' | 'self-chat', allowedUsers: string) =>
  rest<RestartOutcome>('POST', q(`/api/messaging/whatsapp/onboarding/${enc(id)}/apply`, { profile }), { mode, allowed_users: allowedUsers, profile })
export const whatsappCancel = (profile: string, id: string) => rest('DELETE', q(`/api/messaging/whatsapp/onboarding/${enc(id)}`, { profile }))

// Approvals name the row's request, never the code (the code is the requester's proof, never returned).
export const pairing = (profile: string) => get<{ pending: PairingUser[]; approved: PairingUser[] }>(q('/api/pairing', { profile }))
export const approvePairing = (profile: string, u: PairingUser) => rest('POST', q('/api/pairing/approve', { profile }), { platform: u.platform, request_id: u.request_id ?? '', profile })
export const revokePairing = (profile: string, u: PairingUser) => rest('POST', q('/api/pairing/revoke', { profile }), { platform: u.platform, user_id: u.user_id, profile })
export const clearPendingPairing = (profile: string) => rest<{ ok: boolean; cleared: number }>('POST', q('/api/pairing/clear-pending', { profile }))

export const webhooks = (profile: string) => get<{ enabled: boolean; base_url: string; subscriptions: Webhook[] }>(q('/api/webhooks', { profile }))
export const enableWebhooks = (profile: string) => rest<RestartOutcome>('POST', q('/api/webhooks/enable', { profile }))
export const createWebhook = (profile: string, body: WebhookCreate) => rest<Webhook & { secret: string }>('POST', q('/api/webhooks', { profile }), body)
export const deleteWebhook = (profile: string, name: string) => rest('DELETE', q(`/api/webhooks/${enc(name)}`, { profile }))
export const setWebhookEnabled = (profile: string, name: string, enabled: boolean) => rest('PUT', q(`/api/webhooks/${enc(name)}/enabled`, { profile }), { enabled })

// Web access serves this Mac (not one bot): open Hermes from a phone or another computer.
export interface WebAccess {
  enabled: boolean; mode: 'lan' | 'public' | 'local' | null; port: number; lan_address: string | null; public_url: string; nous_signed_in: boolean
  gateway: { state: 'off' | 'serving' | 'starting' | 'stopped' | 'unavailable'; url: string | null; reason: string | null }
  restart_failure?: { exit_code: number; pid: number; reason: string } | null
  start_progress?: { started_at: number; step: 'building' | 'preparing' | 'registering' | 'restarting' } | null
}
export type WebAccessChange = WebAccess & { restart_started?: boolean; restart_busy?: boolean; restart_error?: string; restart_pid?: number }
export const webAccess = () => get<WebAccess>('/api/webapp-access/status')
export const startWebAccess = (mode: 'lan' | 'public', publicUrl?: string) => rest<WebAccessChange>('POST', '/api/webapp-access/start', { mode, public_url: publicUrl })
export const stopWebAccess = () => rest<WebAccessChange>('POST', '/api/webapp-access/stop')
export const restartWebAccess = () => rest<WebAccessChange>('POST', '/api/webapp-access/restart')

// ---------------------------------------------------------------------------------------------
// System

export interface PlatformState { state?: string; error_code?: string | null; error_message?: string | null; needs_attention?: boolean; retrying_since?: string | null; updated_at?: string }
export interface Status {
  version?: string; release_date?: string; config_version?: number; latest_config_version?: number; can_update_hermes?: boolean
  gateway_running?: boolean; gateway_state?: string; gateway_platforms?: Record<string, PlatformState>; gateway_exit_reason?: string | null
  gateway_updated_at?: string; gateway_shared_with?: string[]; active_agents?: number; gateway_busy?: boolean; active_sessions?: number
  gateway_mode?: string; overall?: string; profiles?: string[]; nous_session_valid?: string
  components?: Record<string, { status?: string; state?: string; configured?: number; connected?: number; recent_unhandled_errors?: number }>
  memory?: { pressure?: string; last_boot_unclean?: boolean; last_boot_suspected_oom?: boolean }
  disk?: { pressure?: string; total_mb?: number; free_mb?: number; used_percent?: number }
}
export interface UpdateCheck { install_method?: string; current_version?: string; behind?: number | null; update_available?: boolean; can_apply?: boolean; update_command?: string | null; message?: string | null; channel?: string; commits?: { sha: string; summary: string; author: string; at: number }[] }
export interface ActionStatus { name: string; running: boolean; exit_code: number | null; pid: number | null; lines: string[]; receipt?: any }
export interface Stats {
  os?: string; os_release?: string; platform?: string; arch?: string; hostname?: string; python_version?: string; python_impl?: string; hermes_version?: string; cpu_count?: number
  memory?: { total: number; available: number; used: number; percent: number }; disk?: { total: number; used: number; free: number; percent: number }
  cpu_percent?: number; load_avg?: number[]; uptime_seconds?: number; process?: { pid: number; rss: number; create_time: number; num_threads: number }
}
export interface Hook { event: string; matcher: string | null; command: string; timeout?: number | null; allowed: boolean; approved_at?: string | null; executable: boolean }
export interface Curator { enabled: boolean; paused: boolean; interval_hours: number | null; last_run_at: string | null; min_idle_hours: number | null; stale_after_days: number | null; archive_after_days: number | null }

export const status = () => get<Status>('/api/status')
export const health = () => get<{ ok: boolean; version?: string; displayVersion?: string; commit?: string }>('/api/health')
export const systemStats = () => get<Stats>('/api/system/stats')
export const updateCheck = (force = false) => get<UpdateCheck>(q('/api/hermes/update/check', { force: force || undefined }))
export const startUpdate = () => rest<{ ok: boolean; name?: string; message?: string; update_command?: string; already_running?: boolean }>('POST', '/api/hermes/update')
export const updateReceipt = () => get<{ receipt?: any; summary?: { outcome?: string; finished_at?: string; started_at?: string; user_action?: string | null; post_version?: string | null; followups?: any[] } }>('/api/hermes/update/receipt')
export const actionStatus = (name: string, lines = 200) => get<ActionStatus>(q(`/api/actions/${enc(name)}/status`, { lines }))

/** Restart always interrupts chats mid-answer (it is the "do it now" path); stop asks for it. */
export const gatewayAction = (action: 'restart' | 'start' | 'stop', interrupt = false) =>
  rest<{ ok: boolean; name: string }>('POST', q(`/api/gateway/${action}`, { interrupt: action === 'stop' && interrupt ? 'true' : undefined }))

export const usage = (profile: string, days: number) => get<any>(q('/api/analytics/usage', { days, profile }))
export const modelUsage = (profile: string, days: number) => get<any>(q('/api/analytics/models', { days, profile }))
export const logs = async (o: { file: string; lines: number; level?: string; search?: string; component?: string; profile: string }) =>
  ((await get<{ lines: string[] }>(q('/api/logs', { file: o.file, lines: o.lines, level: o.level, search: o.search, component: o.component, profile: o.profile }))).lines ?? []).map((l) => l.replace(/\s+$/, ''))

export type Op = 'doctor' | 'security-audit' | 'backup' | 'prompt-size' | 'dump' | 'config-migrate'
export const runOp = (profile: string, op: Op) => rest<{ ok: boolean; name: string; archive?: string }>('POST', q(`/api/ops/${op}`, { profile }), op === 'backup' ? {} : undefined)
export const restoreBackup = (profile: string, archive: string) => rest<{ ok: boolean; name: string }>('POST', q('/api/ops/import', { profile }), { archive, force: true })
export const checkpoints = (profile: string) => get<{ sessions: { session: string; files: number; bytes: number }[]; total_bytes: number }>(q('/api/ops/checkpoints', { profile }))
export const pruneCheckpoints = (profile: string) => rest<{ ok: boolean; name: string }>('POST', q('/api/ops/checkpoints/prune', { profile }))
export const hooks = (profile: string) => get<{ hooks: Hook[]; valid_events: string[] }>(q('/api/ops/hooks', { profile }))
export const addHook = (profile: string, h: { event: string; command: string; matcher?: string; timeout?: number }) => rest('POST', q('/api/ops/hooks', { profile }), { ...h, matcher: h.matcher || undefined, approve: true })
export const deleteHook = (profile: string, h: Pick<Hook, 'event' | 'command'>) => rest('DELETE', q('/api/ops/hooks', { profile }), { event: h.event, command: h.command })
export const curator = (profile: string) => get<Curator>(q('/api/curator', { profile }))
export const setCuratorPaused = (profile: string, paused: boolean) => rest('PUT', q('/api/curator/paused', { profile }), { paused })
export const runCurator = (profile: string) => rest<{ ok: boolean; name: string }>('POST', q('/api/curator/run', { profile }), {})
/** Uploads a redacted report and recent logs to Hermes' paste service and returns the links. */
export const debugShare = () => rest<{ ok: boolean; urls: Record<string, string>; failures: Record<string, string>; redacted: boolean; auto_delete_seconds: number | null }>('POST', '/api/ops/debug-share', { redact: true, lines: 200 })
export const exportProfile = (name: string) => rest<{ ok: boolean; archive: string }>('POST', `/api/profiles/${enc(name)}/export`, {})
export const importProfile = (archive: string, name?: string) => rest<{ ok: boolean; name: string; path: string }>('POST', '/api/profiles/import', { archive, ...(name ? { name } : {}) })
export const metricsConsent = (profile: string) => get<{ enabled: boolean; send: boolean; decided: boolean; managed?: boolean }>(q('/api/shared-metrics/consent', { profile }))
export const setMetricsConsent = (profile: string, on: boolean) => rest<{ enabled: boolean; send: boolean }>('PUT', q('/api/shared-metrics/consent', { profile }), { enabled: on, send: on })
