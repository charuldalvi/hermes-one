// Where each of Hermes' settings lives on the All settings page, and the words it is shown with.
// The first pages follow Hermes Desktop's grouping (config-subpages.ts + SECTIONS in constants.ts,
// same fields and prefixes); the rest extend it so every schema field has a home. Matching runs in
// three passes over the whole table: exact field names, then key prefixes, then schema categories.
// Anything still unmatched lands in "Other", one sub-section per schema category.
import type { FieldSchema } from '../../../lib/api-config'

export interface SubDef { id: string; label: string; hint?: string; fields?: string[]; prefixes?: string[]; categories?: string[]; split?: number }
export interface PageDef { id: string; label: string; icon: string; subs: SubDef[] }

export const CONFIG_PAGES: PageDef[] = [
  { id: 'model', label: 'Model', icon: 'spark', subs: [
    { id: 'main', label: 'Main model', fields: ['model', 'model_context_length', 'agent.reasoning_effort', 'agent.service_tier'], prefixes: ['model.'] },
    { id: 'fallbacks', label: 'Fallback models', hint: 'Tried in order when the main model fails', fields: ['fallback_providers'], prefixes: ['fallback.', 'credential_pool_strategies'] },
    { id: 'delegation', label: 'Subagents', prefixes: ['delegation.'] },
    { id: 'moa', label: 'Mixture of agents', prefixes: ['moa.'], split: 3 },
    { id: 'providers', label: 'Provider options', prefixes: ['openrouter.', 'bedrock.', 'vertex.', 'model_catalog.', 'models_dev', 'nous.', 'prompt_caching'], categories: ['openrouter', 'bedrock', 'vertex', 'model_catalog'], split: 1 },
    { id: 'local', label: 'Models on this Mac', prefixes: ['local_runtime.'], categories: ['local_runtime'] },
  ] },
  { id: 'helpers', label: 'Helper models', icon: 'box', subs: [
    { id: 'aux', label: 'Helper models', hint: 'Side jobs like titles, compression and vision', prefixes: ['auxiliary.'], categories: ['auxiliary'], split: 2 },
  ] },
  { id: 'chat', label: 'Chat', icon: 'chat', subs: [
    { id: 'behavior', label: 'Behavior', fields: ['display.personality', 'timezone', 'display.show_reasoning'] },
    { id: 'attachments', label: 'Attachments', fields: ['agent.image_input_mode', 'attachments'], prefixes: ['attachments.'], categories: ['attachments'] },
    { id: 'images', label: 'Seeing images', prefixes: ['vision.'], categories: ['vision'] },
    { id: 'paste', label: 'Typing and pasting', prefixes: ['paste_collapse', 'human_delay.'] },
  ] },
  { id: 'display', label: 'Display', icon: 'grid', subs: [
    { id: 'display', label: 'How replies look', prefixes: ['display.'], split: 2 },
    { id: 'streaming', label: 'Streaming', prefixes: ['streaming.'], categories: ['streaming'] },
  ] },
  { id: 'sessions', label: 'Conversations', icon: 'list', subs: [
    { id: 'sessions', label: 'Conversations', fields: ['max_concurrent_sessions', 'max_live_sessions'], prefixes: ['sessions.', 'session.', 'session'], categories: ['sessions'] },
    { id: 'goals', label: 'Goals and loops', prefixes: ['goals', 'loops.'], categories: ['loops'] },
  ] },
  { id: 'workspace', label: 'Workspace', icon: 'folder', subs: [
    { id: 'projects', label: 'Projects and discovery', fields: ['terminal.cwd'], prefixes: ['desktop.repo_scan_'] },
    { id: 'shell', label: 'Shell environment', fields: ['terminal.persistent_shell', 'terminal.env_passthrough'] },
    { id: 'files', label: 'Files and execution', fields: ['code_execution.mode', 'file_read_max_chars', 'prefill_messages_file'], prefixes: ['code_execution.', 'context_file_'] },
    { id: 'worktrees', label: 'Worktrees', prefixes: ['worktrees.'], categories: ['worktrees'] },
    { id: 'lsp', label: 'Code intelligence', prefixes: ['lsp.'], categories: ['lsp'] },
  ] },
  { id: 'safety', label: 'Safety', icon: 'shield', subs: [
    { id: 'approvals', label: 'Approvals', fields: ['command_allowlist', 'hooks_auto_accept'], prefixes: ['approvals.', 'security.approval.'] },
    { id: 'privacy', label: 'Privacy and network', prefixes: ['security.', 'privacy', 'telemetry.', 'auth.', 'network.'], categories: ['security'], split: 2 },
    { id: 'checkpoints', label: 'Checkpoints', prefixes: ['checkpoints.'] },
  ] },
  { id: 'secrets', label: 'Password managers', icon: 'lock', subs: [
    { id: 'vault', label: 'Saved credentials', prefixes: ['vault.'], categories: ['vault'], split: 2 },
    { id: 'sources', label: 'Password managers', prefixes: ['secrets.'], categories: ['secrets'], split: 2 },
    { id: 'proxy', label: 'Credential proxy', prefixes: ['proxy.'], categories: ['proxy'] },
  ] },
  { id: 'browser', label: 'Browser and web', icon: 'globe', subs: [
    { id: 'profile', label: 'Browser profile', fields: ['browser.use_real_profile'] },
    { id: 'network', label: 'Local and private URLs', fields: ['browser.allow_private_urls', 'browser.auto_local_for_private_urls'] },
    { id: 'browser', label: 'More browser settings', prefixes: ['browser.'], categories: ['browser'] },
    { id: 'web', label: 'Web search', prefixes: ['web.'], categories: ['web'] },
    { id: 'x', label: 'X search', prefixes: ['x_search.'], categories: ['x_search'] },
    { id: 'computer', label: 'Computer use', prefixes: ['computer_use.'] },
  ] },
  { id: 'memory', label: 'Memory', icon: 'brain', subs: [
    { id: 'persistent', label: 'Persistent memory', prefixes: ['memory.'], categories: ['memory'] },
    { id: 'context', label: 'Context and compression', prefixes: ['context.', 'compression.'], categories: ['compression'] },
  ] },
  { id: 'voice', label: 'Voice', icon: 'mic', subs: [
    { id: 'conversation', label: 'Voice conversation', fields: ['voice.voice_chat_mode', 'voice.max_recording_seconds', 'voice.client_direct'], prefixes: ['voice.gpt_live.', 'voice.'], categories: ['voice'], split: 2 },
    { id: 'transcription', label: 'Speech to text', prefixes: ['stt.'], categories: ['stt'], split: 2 },
    { id: 'speech', label: 'Text to speech', fields: ['voice.auto_tts'], prefixes: ['tts.'], categories: ['tts'], split: 2 },
    { id: 'wake', label: 'Wake word', prefixes: ['wake_word.'], categories: ['wake_word'], split: 2 },
  ] },
  { id: 'advanced', label: 'Advanced', icon: 'sliders', subs: [
    { id: 'desktop', label: 'Desktop and startup', prefixes: ['updates.'] },
    { id: 'runtime', label: 'Agent limits', fields: ['agent.max_turns', 'agent.api_max_retries'] },
    { id: 'tools', label: 'Tool access', fields: ['toolsets', 'agent.tool_use_enforcement'] },
    { id: 'terminal', label: 'Terminal backend', prefixes: ['terminal.'], categories: ['terminal'] },
    { id: 'output', label: 'Output limits', prefixes: ['tool_output.'], categories: ['tool_output'] },
  ] },
  { id: 'agent', label: 'Agent', icon: 'bolt', subs: [
    { id: 'agent', label: 'How the agent works', prefixes: ['agent.'], split: 2 },
    { id: 'runtime', label: 'Runtime', prefixes: ['runtime.', 'onboarding.', 'bot_mode.'], categories: ['agent'] },
  ] },
  { id: 'tools', label: 'Tools and skills', icon: 'tool', subs: [
    { id: 'tools', label: 'Tools', prefixes: ['tools.'], categories: ['tools'], split: 2 },
    { id: 'guardrails', label: 'Loop guardrails', prefixes: ['tool_loop_guardrails.'], categories: ['tool_loop_guardrails'], split: 2 },
    { id: 'mcp', label: 'MCP servers', prefixes: ['mcp_', 'mcp.'] },
    { id: 'skills', label: 'Skills', prefixes: ['skills.'] },
    { id: 'curator', label: 'Skill curator', prefixes: ['curator.'], categories: ['curator'], split: 2 },
    { id: 'plugins', label: 'Plugins', prefixes: ['plugins.'], split: 2 },
  ] },
  { id: 'jobs', label: 'Scheduled jobs', icon: 'clock', subs: [
    { id: 'cron', label: 'Scheduled jobs', prefixes: ['cron.'], split: 2 },
    { id: 'kanban', label: 'Kanban', prefixes: ['kanban.'], categories: ['kanban'] },
  ] },
  { id: 'messaging', label: 'Messaging', icon: 'mail', subs: [
    { id: 'gateway', label: 'Gateway', prefixes: ['gateway.'], categories: ['gateway'], split: 2 },
    { id: 'slack', label: 'Slack', prefixes: ['slack.'], categories: ['slack'] },
    { id: 'discord', label: 'Discord', prefixes: ['discord.'], categories: ['discord'], split: 2 },
    { id: 'telegram', label: 'Telegram', prefixes: ['telegram.'], split: 2 },
    { id: 'whatsapp', label: 'WhatsApp', prefixes: ['whatsapp.'] },
    { id: 'mattermost', label: 'Mattermost', prefixes: ['mattermost.'], categories: ['mattermost'] },
    { id: 'matrix', label: 'Matrix', prefixes: ['matrix.'], categories: ['matrix'] },
    { id: 'rooms', label: 'Hosted rooms', prefixes: ['hosted_rooms.'], categories: ['hosted_rooms'], split: 2 },
    { id: 'monitoring', label: 'Monitoring', prefixes: ['monitoring.'], categories: ['monitoring'], split: 2 },
    { id: 'webapp', label: 'Web app', prefixes: ['webapp.'], categories: ['webapp'] },
  ] },
  { id: 'apps', label: 'Apps and dashboard', icon: 'desk', subs: [
    { id: 'dashboard', label: 'Web dashboard', prefixes: ['dashboard.'], split: 2 },
    { id: 'desktop', label: 'Desktop app', prefixes: ['desktop.'], categories: ['desktop'], split: 2 },
    { id: 'botdesk', label: 'Agent desktop', prefixes: ['bot_desktop.'], categories: ['bot_desktop'] },
    { id: 'logging', label: 'Logs', prefixes: ['logging.'], categories: ['logging'] },
    { id: 'database', label: 'Database', prefixes: ['database.', 'doctor'], categories: ['database'] },
  ] },
]
export const OTHER_PAGE: PageDef = { id: 'other', label: 'Other', icon: 'dots', subs: [] }

// ---------- assignment ----------

export interface Placed { page: string; sub: string; group: string | null }

/** Find a field's page, sub-section and (for split sub-sections) its group key. */
export function placeAll(fields: Record<string, FieldSchema>): Map<string, Placed> {
  const out = new Map<string, Placed>()
  const all = CONFIG_PAGES.flatMap((p) => p.subs.map((s) => ({ p, s })))
  const put = (key: string, p: PageDef, s: SubDef) => out.set(key, { page: p.id, sub: s.id, group: groupKey(key, s.split) })
  const keys = Object.keys(fields)
  for (const key of keys) { const hit = all.find(({ s }) => s.fields?.includes(key)); if (hit) put(key, hit.p, hit.s) }
  for (const key of keys) {
    if (out.has(key)) continue
    const hit = all.find(({ s }) => s.prefixes?.some((pre) => key === pre.replace(/\.$/, '') || key.startsWith(pre)))
    if (hit) put(key, hit.p, hit.s)
  }
  for (const key of keys) {
    if (out.has(key)) continue
    const cat = fields[key]?.category ?? ''
    const hit = all.find(({ s }) => s.categories?.includes(cat))
    if (hit) put(key, hit.p, hit.s)
    else out.set(key, { page: 'other', sub: cat || 'general', group: null })
  }
  return out
}
function groupKey(key: string, depth?: number): string | null {
  if (!depth) return null
  const seg = key.split('.')
  return seg.length > depth ? seg.slice(0, depth).join('.') : null
}

// ---------- words ----------

const WORDS: Record<string, string> = {
  api: 'API', apis: 'APIs', url: 'URL', urls: 'URLs', id: 'ID', ids: 'IDs', tts: 'TTS', stt: 'STT', mcp: 'MCP', llm: 'LLM', ttl: 'TTL', ssh: 'SSH',
  gpu: 'GPU', cpu: 'CPU', moa: 'MoA', ui: 'UI', http: 'HTTP', https: 'HTTPS', json: 'JSON', yaml: 'YAML', oauth: 'OAuth', sdk: 'SDK', ip: 'IP', dm: 'DM',
  dms: 'DMs', vad: 'VAD', lsp: 'LSP', hf: 'HF', gpt: 'GPT', ram: 'RAM', vram: 'VRAM', os: 'OS', pr: 'PR', prs: 'PRs', cli: 'CLI', tui: 'TUI', xai: 'xAI',
  openai: 'OpenAI', elevenlabs: 'ElevenLabs', openrouter: 'OpenRouter', deepinfra: 'DeepInfra', minimax: 'MiniMax', neutts: 'NeuTTS', kittentts: 'KittenTTS',
  onepassword: '1Password', bitwarden: 'Bitwarden', mtp: 'MTP', ws: 'WS', smtp: 'SMTP', sso: 'SSO', aws: 'AWS', gguf: 'GGUF', cwd: 'Working folder', pid: 'PID',
  pcm: 'PCM', cdp: 'CDP', fx: 'FX', iana: 'IANA', tz: 'time zone', github: 'GitHub', gitlab: 'GitLab', nous: 'Nous', mp3: 'MP3', db: 'DB', sqlite: 'SQLite', csv: 'CSV', md: 'Markdown', s: 's', ms: 'ms', kb: 'KB', mb: 'MB',
}
/** "max_line_length" → "Max line length"; "api_key" → "API key". */
export function pretty(seg: string, first = true): string {
  const words = seg.replace(/[-_]+/g, ' ').trim().split(/\s+/).map((w) => WORDS[w.toLowerCase()] ?? w.toLowerCase())
  if (first && words[0] && words[0] === words[0].toLowerCase()) words[0] = words[0][0].toUpperCase() + words[0].slice(1)
  return words.join(' ')
}
/** A group key like "tts.openai" → "OpenAI"; "auxiliary.title_generation" → "Titles · naming chats". */
export function groupLabel(group: string): string {
  const last = group.split('.').pop() ?? group
  if (group.startsWith('auxiliary.') && AUX_LABELS[last]) return AUX_LABELS[last]
  if (group.startsWith('moa.presets.')) return `Preset “${last}”`
  return pretty(last)
}
const AUX_LABELS: Record<string, string> = {
  vision: 'Vision · image analysis', compression: 'Compression · shortening long chats', approval: 'Approval · smart auto-approve', mcp: 'MCP · tool routing',
  title_generation: 'Titles · naming chats', review: 'Review · the /review reviewer', voice_chat: 'Voice chat · spoken replies', triage_specifier: 'Triage · fleshing out kanban cards',
  kanban_decomposer: 'Kanban · breaking work down', profile_describer: 'Agent descriptions', curator: 'Curator · skill-usage review', memory_query_rewrite: 'Memory search · rewriting queries',
  tts_audio_tags: 'Speech tags · expressive voice', goal_judge: 'Goal judge', group_router: 'Group router', monitor: 'Monitor', background_review: 'Background review',
  moa_reference: 'Mixture · reference models', moa_aggregator: 'Mixture · aggregator',
}

/** Label for a field: Desktop's words when it has them, else the key's own words after its group. */
export function fieldLabel(key: string, group: string | null): string {
  if (LABELS[key]) return LABELS[key]
  const seg = key.split('.')
  const drop = group ? group.split('.').length : seg.length > 1 ? 1 : 0
  const rest = seg.slice(drop)
  return (rest.length ? rest : seg.slice(-1)).map((s, i) => pretty(s, i === 0)).join(' · ')
}
const squash = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
/** A description worth showing: Desktop's, else the schema's unless it only repeats the name. */
export function fieldDescription(key: string, label: string, schema?: FieldSchema): string | undefined {
  if (DESCRIPTIONS[key]) return DESCRIPTIONS[key]
  const d = (schema?.description ?? '').trim()
  if (!d || d.includes('→')) return undefined
  const n = squash(d)
  return n === squash(label) || n === squash(key) || n === squash(key.split('.').pop() ?? '') ? undefined : d
}

// Desktop's FIELD_LABELS (constants.ts), in sentence case, keyed by the schema's own names.
const LABELS: Record<string, string> = {
  model: 'Default model', model_context_length: 'Main model context window (override)', fallback_providers: 'Fallback models', toolsets: 'Enabled toolsets', timezone: 'Timezone',
  'display.personality': 'Personality', 'display.show_reasoning': 'Reasoning blocks',
  'desktop.repo_scan_enabled': 'Automatic repository discovery', 'desktop.repo_scan_roots': 'Repository discovery roots', 'desktop.repo_scan_exclude_paths': 'Excluded repository paths',
  'agent.max_turns': 'Max agent steps', 'agent.image_input_mode': 'Image attachments', 'agent.api_max_retries': 'API retries', 'agent.service_tier': 'Service tier', 'agent.tool_use_enforcement': 'Tool-use enforcement', 'agent.reasoning_effort': 'Reasoning effort',
  'terminal.cwd': 'Working directory', 'terminal.backend': 'Execution backend', 'terminal.timeout': 'Command timeout', 'terminal.persistent_shell': 'Persistent shell', 'terminal.env_passthrough': 'Environment passthrough',
  'terminal.docker_image': 'Docker image', 'terminal.singularity_image': 'Singularity image', 'terminal.modal_image': 'Modal image', 'terminal.daytona_image': 'Daytona image',
  file_read_max_chars: 'File read limit', 'tool_output.max_bytes': 'Terminal output limit', 'tool_output.max_lines': 'File page limit', 'tool_output.max_line_length': 'Line length limit',
  'code_execution.mode': 'Code execution mode', 'approvals.mode': 'Approval mode', 'approvals.timeout': 'Approval timeout', 'approvals.mcp_reload_confirm': 'Confirm MCP reloads', command_allowlist: 'Command allowlist',
  'security.redact_secrets': 'Redact secrets', 'security.allow_private_urls': 'Allow private URLs', 'browser.allow_private_urls': 'Browser private URLs', 'browser.auto_local_for_private_urls': 'Local browser for private URLs',
  'browser.use_real_profile': 'Use my real browser profile', 'checkpoints.enabled': 'File checkpoints', 'checkpoints.max_snapshots': 'Checkpoint limit',
  'voice.max_recording_seconds': 'Max recording length', 'voice.auto_tts': 'Read responses aloud', 'voice.voice_chat_mode': 'Voice chat mode', 'voice.gpt_live.voice': 'GPT-Live voice', 'voice.gpt_live.instructions': 'GPT-Live persona',
  'stt.enabled': 'Speech to text', 'stt.echo_transcripts': 'Echo transcripts', 'stt.provider': 'Speech-to-text provider', 'stt.streaming': 'Live transcription', 'stt.local.model': 'Local transcription model', 'stt.local.language': 'Transcription language',
  'stt.openai.model': 'OpenAI STT model', 'stt.openai.streaming_model': 'OpenAI live transcription model', 'stt.groq.model': 'Groq STT model', 'stt.mistral.model': 'Mistral STT model', 'stt.xai.model': 'xAI STT model', 'stt.deepinfra.model': 'DeepInfra STT model',
  'stt.elevenlabs.model_id': 'ElevenLabs STT model', 'stt.elevenlabs.language_code': 'ElevenLabs language', 'stt.elevenlabs.tag_audio_events': 'Tag audio events', 'stt.elevenlabs.diarize': 'Speaker diarization',
  'tts.provider': 'Text-to-speech provider', 'tts.edge.voice': 'Edge voice', 'tts.openai.model': 'OpenAI TTS model', 'tts.openai.voice': 'OpenAI voice', 'tts.elevenlabs.voice_id': 'ElevenLabs voice', 'tts.elevenlabs.model_id': 'ElevenLabs model',
  'tts.xai.voice_id': 'xAI (Grok) voice', 'tts.xai.language': 'xAI language', 'tts.xai.speed': 'xAI playback speed', 'tts.xai.auto_speech_tags': 'xAI auto speech tags', 'tts.xai.optimize_streaming_latency': 'xAI streaming latency optimization',
  'tts.xai.sample_rate': 'xAI sample rate', 'tts.xai.bit_rate': 'xAI bit rate', 'tts.minimax.model': 'MiniMax TTS model', 'tts.minimax.voice_id': 'MiniMax voice', 'tts.mistral.model': 'Mistral TTS model', 'tts.mistral.voice_id': 'Mistral voice',
  'tts.gemini.model': 'Gemini TTS model', 'tts.gemini.voice': 'Gemini voice', 'tts.neutts.model': 'NeuTTS model', 'tts.neutts.device': 'NeuTTS device', 'tts.kittentts.model': 'KittenTTS model', 'tts.kittentts.voice': 'KittenTTS voice',
  'tts.piper.voice': 'Piper voice', 'tts.deepinfra.model': 'DeepInfra TTS model', 'tts.deepinfra.voice': 'DeepInfra voice',
  'memory.memory_enabled': 'Persistent memory', 'memory.user_profile_enabled': 'User profile', 'memory.memory_char_limit': 'Memory budget', 'memory.user_char_limit': 'Profile budget', 'memory.provider': 'Memory provider',
  'context.engine': 'Context engine', 'compression.enabled': 'Auto-compression', 'compression.threshold': 'Compression threshold', 'compression.codex_gpt55_autoraise': 'Codex compression auto-raise', 'compression.target_ratio': 'Compression target',
  'compression.protect_last_n': 'Protected recent messages', 'auxiliary.compression.timeout': 'Compression model timeout (s)',
  'delegation.model': 'Subagent model', 'delegation.provider': 'Subagent provider', 'delegation.max_iterations': 'Subagent turn limit', 'delegation.max_concurrent_children': 'Parallel subagents', 'delegation.child_timeout_seconds': 'Subagent timeout', 'delegation.reasoning_effort': 'Subagent reasoning effort',
  'updates.non_interactive_local_changes': 'In-app update local changes',
}

// Desktop's FIELD_DESCRIPTIONS (constants.ts), keyed by the schema's own names.
const DESCRIPTIONS: Record<string, string> = {
  model: 'Used for new chats unless you pick a different model in the composer.',
  model_context_length: "Overrides the detected context window of the main chat model only (tokens). Leave at 0 to use the selected model's detected value. Does not affect helper or mixture models.",
  fallback_providers: 'Backup provider and model pairs to try if the default model fails.',
  'display.personality': 'Default assistant style for new conversations.',
  'display.show_reasoning': 'Show reasoning sections when the model provides them.',
  'desktop.repo_scan_enabled': 'Scan local folders for Git repositories to show in Projects.',
  'desktop.repo_scan_roots': 'Folders to scan. Leave empty to scan your home folder.',
  'desktop.repo_scan_exclude_paths': 'Folders (and everything inside them) to skip during repository discovery.',
  timezone: 'Your time zone. Blank uses the system time zone.',
  'browser.use_real_profile': "Local browsing uses your real logins. Hermes copies your default browser's profile (cookies, logins, preferences) into a managed copy and drives it with its own Chromium; your live profile is never opened directly. Only Chromium browsers (Chrome, Edge, Brave, Chromium) are supported. Off by default.",
  'agent.image_input_mode': 'How image attachments are sent to the model.',
  'agent.max_turns': 'Upper bound for tool-calling turns before Hermes stops a run.',
  'terminal.cwd': 'Default project folder for tool and terminal work.',
  'terminal.persistent_shell': 'SSH backend: keep exported variables between commands. Off starts each command from the login environment; the working folder always carries over.',
  'terminal.env_passthrough': 'Environment variables to pass into tool execution.',
  'terminal.docker_image': 'Container image used when the execution backend is Docker.',
  'terminal.singularity_image': 'Image used when the execution backend is Singularity.',
  'terminal.modal_image': 'Image used when the execution backend is Modal.',
  'terminal.daytona_image': 'Image used when the execution backend is Daytona.',
  'code_execution.mode': 'How strictly code execution is kept to the current project.',
  file_read_max_chars: 'Maximum characters Hermes can read from one file request.',
  'approvals.mode': 'How Hermes handles commands that need your OK.',
  'approvals.timeout': 'How long approval prompts wait before timing out.',
  'security.redact_secrets': 'Hide detected secrets from what the model sees, when possible.',
  'checkpoints.enabled': 'Take a rollback snapshot before file edits.',
  'memory.memory_enabled': 'Save lasting memories that can help future conversations.',
  'memory.user_profile_enabled': 'Keep a short profile of your preferences.',
  'context.engine': 'How long conversations are managed near the context limit.',
  'compression.enabled': 'Summarize older messages when conversations get large.',
  'compression.codex_gpt55_autoraise': 'Raise compression to 85% for supported ChatGPT Codex sign-in models.',
  'auxiliary.compression.timeout': 'Seconds to wait for the compression helper model per call (default 120). Raise for slow local models.',
  'voice.auto_tts': 'Speak replies aloud automatically.',
  'voice.voice_chat_mode': 'chained: speech-to-text → Hermes → text-to-speech with the providers below. gpt-live: one OpenAI voice model listens and talks, and hands every real request to Hermes. Needs an OpenAI API key; the voice layer bills $0.05 per minute.',
  'voice.gpt_live.voice': 'Voice for GPT-Live mode. Custom voice IDs are accepted.',
  'voice.gpt_live.instructions': 'Extra sentences for the live voice persona (tone, pace, language). Hermes keeps its own system prompt.',
  'tts.xai.voice_id': 'xAI voice ID (for example eve) or a custom voice ID.',
  'tts.xai.language': 'Spoken language code (for example en, pt-BR) or "auto" to detect it.',
  'tts.xai.speed': 'Playback speed. 0.7 = slower, 1.0 = normal, 1.5 = faster.',
  'tts.xai.auto_speech_tags': 'Let a model add expressive audio tags ([laughing], [sighs]) to the script before it is spoken.',
  'tts.xai.optimize_streaming_latency': 'Speed against quality. 0 = best quality, 2 = lowest delay.',
  'tts.xai.sample_rate': 'Audio sample rate in Hz. Higher = better quality, larger files.',
  'tts.xai.bit_rate': 'MP3 bitrate in bps. Only applies when the codec is MP3.',
  'tts.neutts.device': 'Where NeuTTS runs on this machine.',
  'stt.enabled': 'Turn on speech transcription, on this Mac or through a provider.',
  'stt.echo_transcripts': 'Post the raw transcript of voice messages back to the chat.',
  'stt.streaming': 'Show text while you speak (OpenAI, xAI, ElevenLabs). Falls back to the recording on any failure.',
  'stt.elevenlabs.language_code': 'Optional ISO-639-3 language code. Blank lets ElevenLabs detect it.',
  'updates.non_interactive_local_changes': 'When Hermes updates itself from the app (no terminal prompt), keep local source edits (stash) or throw them away (discard). Terminal updates always ask.',
}

// ---------- choices ----------

/** Desktop ENUM_OPTIONS for settings the schema types as plain text. A select's own options win. */
export const ENUM_OPTIONS: Record<string, string[]> = {
  'agent.image_input_mode': ['auto', 'native', 'text'],
  'approvals.mode': ['manual', 'smart', 'off'],
  'code_execution.mode': ['project', 'strict'],
  'context.engine': ['compressor', 'default', 'custom'],
  'delegation.reasoning_effort': ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  'terminal.backend': ['local', 'docker', 'singularity', 'modal', 'daytona', 'ssh'],
  'stt.elevenlabs.model_id': ['scribe_v2', 'scribe_v1'],
  'stt.local.model': ['tiny', 'base', 'small', 'medium', 'large-v3', 'turbo'],
  'stt.provider': ['local', 'groq', 'openai', 'mistral', 'xai', 'elevenlabs', 'deepinfra'],
  'voice.voice_chat_mode': ['chained', 'gpt-live'],
  'voice.gpt_live.voice': ['marin', 'cedar', 'quartz', 'ripple', 'vesper', 'willow', 'stone', 'gleam', 'meridian', 'bossa', 'tempo', 'beacon', 'delta', 'cinder'],
  'tts.openai.voice': ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse'],
  'tts.edge.voice': ['en-US-AriaNeural', 'en-US-JennyNeural', 'en-US-AndrewNeural', 'en-US-BrianNeural', 'en-US-GuyNeural', 'en-GB-SoniaNeural'],
  'tts.gemini.model': ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'],
  'tts.gemini.voice': ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'],
  'tts.xai.voice_id': ['eve'],
  'tts.minimax.model': ['speech-02-hd', 'speech-02-turbo'],
  'tts.mistral.model': ['voxtral-mini-tts-2603'],
  'tts.kittentts.model': ['KittenML/kitten-tts-nano-0.8-int8', 'KittenML/kitten-tts-micro-0.8-int8', 'KittenML/kitten-tts-mini-0.8-int8'],
  'tts.kittentts.voice': ['Jasper'],
  'tts.piper.voice': ['en_US-lessac-medium', 'en_US-amy-medium', 'en_US-ryan-high', 'en_GB-alan-medium'],
  'tts.neutts.model': ['neuphonic/neutts-air-q4-gguf', 'neuphonic/neutts-air-q8-gguf', 'neuphonic/neutts-air'],
  'tts.provider': ['edge', 'elevenlabs', 'openai', 'xai', 'minimax', 'mistral', 'gemini', 'neutts', 'kittentts', 'piper'],
  'stt.openai.model': ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'gpt-transcribe'],
  'stt.openai.streaming_model': ['gpt-live-transcribe', 'gpt-transcribe', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'],
  'stt.groq.model': ['whisper-large-v3-turbo', 'whisper-large-v3'],
  'stt.mistral.model': ['voxtral-mini-latest', 'voxtral-mini-2602'],
  'stt.xai.model': ['grok-voice-transcribe-2.0', 'grok-voice-transcribe-1.0'],
  'tts.openai.model': ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
  'tts.elevenlabs.model_id': ['eleven_v3', 'eleven_ttv_v3', 'eleven_multilingual_v2', 'eleven_turbo_v2', 'eleven_turbo_v2_5', 'eleven_flash_v2', 'eleven_flash_v2_5'],
  'tts.neutts.device': ['cpu', 'cuda', 'mps'],
  'updates.non_interactive_local_changes': ['stash', 'discard'],
}
/** Voice and model names take any value; the known ones are suggestions (Desktop FREE_INPUT_KEYS). */
export const FREE_INPUT_KEYS = new Set([
  'tts.edge.voice', 'voice.gpt_live.voice', 'tts.openai.model', 'tts.openai.voice', 'tts.elevenlabs.voice_id', 'tts.elevenlabs.model_id', 'stt.openai.model', 'stt.groq.model',
  'stt.mistral.model', 'stt.xai.model', 'stt.deepinfra.model', 'tts.gemini.model', 'tts.gemini.voice', 'tts.xai.voice_id', 'tts.minimax.model', 'tts.minimax.voice_id', 'tts.mistral.model',
  'tts.mistral.voice_id', 'tts.neutts.model', 'tts.kittentts.model', 'tts.kittentts.voice', 'tts.piper.voice', 'tts.deepinfra.model', 'tts.deepinfra.voice',
])
const BUILTIN_PERSONALITIES = ['helpful', 'concise', 'technical', 'creative', 'teacher', 'kawaii', 'catgirl', 'pirate', 'shakespeare', 'surfer', 'noir', 'uwu', 'philosopher', 'hype']
const NEUTRAL = new Set(['', 'none', 'default', 'neutral'])
const BUILTIN_TTS = new Set(['edge', 'elevenlabs', 'openai', 'minimax', 'xai', 'mistral', 'gemini', 'neutts', 'kittentts', 'piper', 'deepinfra'])
const BUILTIN_STT = new Set(['local', 'local_command', 'groq', 'openai', 'mistral', 'xai', 'elevenlabs', 'deepinfra'])
const TTS1_VOICES = new Set(['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'])

const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const at = (cfg: Record<string, any>, path: string) => path.split('.').reduce<any>((a, k) => (obj(a) ? a[k] : undefined), cfg)

/** The choices a setting offers (Desktop enumOptionsFor), or undefined for free text. */
export function choicesFor(key: string, schema: FieldSchema, value: unknown, cfg: Record<string, any>): string[] | undefined {
  let opts: string[] | undefined
  if (key === 'display.personality') {
    const custom: string[] = []
    for (const p of ['personalities', 'agent.personalities']) { const b = at(cfg, p); if (obj(b)) for (const n of Object.keys(b)) { const f = n.trim().toLowerCase(); if (!NEUTRAL.has(f)) custom.push(f) } }
    opts = [...new Set(['', ...BUILTIN_PERSONALITIES, ...custom])]
  } else if (schema.type === 'select' && Array.isArray(schema.options)) opts = schema.options.map((o) => String(o ?? ''))
  else if (ENUM_OPTIONS[key]) opts = ENUM_OPTIONS[key]
  if (!opts) return undefined
  if (key === 'tts.provider' || key === 'stt.provider') {
    const sec = key.slice(0, 3), builtins = sec === 'tts' ? BUILTIN_TTS : BUILTIN_STT
    for (const path of [`${sec}.providers`, sec]) {
      const b = at(cfg, path)
      if (obj(b)) for (const [n, v] of Object.entries(b)) if (obj(v) && typeof v.command === 'string' && v.command.trim() && (!v.type || String(v.type).trim().toLowerCase() === 'command') && !builtins.has(n.toLowerCase()) && !opts.includes(n)) opts = [...opts, n]
    }
  }
  if (key === 'tts.openai.voice') { const m = String(at(cfg, 'tts.openai.model') ?? ''); if (m === 'tts-1' || m === 'tts-1-hd') opts = opts.filter((v) => TTS1_VOICES.has(v)) }
  const cur = value == null ? '' : String(value)
  return cur && !opts.includes(cur) ? [...opts, cur] : opts
}
/** Words for a choice: "" by context, snake_case words prettified, anything else as written. */
export function choiceLabel(key: string, v: string, schema: FieldSchema): string {
  if (v === '') return key === 'memory.provider' ? 'Built-in only' : schema.clearable || key === 'timezone' ? 'System default' : key === 'display.personality' ? 'None' : key.endsWith('reasoning_effort') ? 'Same as the main agent' : 'None'
  return /^[a-z][a-z0-9_]*$/.test(v) && !/\d/.test(v) ? pretty(v) : v
}

/** Settings Desktop shows that some Hermes builds leave out of the schema (constants.ts SECTIONS). */
export const EXTRA_KEYS = [
  'model_context_length', 'fallback_providers', 'display.personality', 'timezone', 'display.show_reasoning', 'agent.image_input_mode', 'terminal.cwd', 'desktop.repo_scan_enabled',
  'desktop.repo_scan_roots', 'desktop.repo_scan_exclude_paths', 'code_execution.mode', 'terminal.persistent_shell', 'terminal.env_passthrough', 'file_read_max_chars', 'approvals.mode',
  'approvals.timeout', 'approvals.mcp_reload_confirm', 'command_allowlist', 'security.redact_secrets', 'security.allow_private_urls', 'checkpoints.enabled', 'browser.use_real_profile',
  'browser.allow_private_urls', 'browser.auto_local_for_private_urls', 'memory.memory_enabled', 'memory.user_profile_enabled', 'memory.memory_char_limit', 'memory.user_char_limit',
  'memory.provider', 'context.engine', 'compression.enabled', 'compression.threshold', 'compression.codex_gpt55_autoraise', 'compression.target_ratio', 'compression.protect_last_n',
  'auxiliary.compression.timeout', 'voice.voice_chat_mode', 'voice.gpt_live.voice', 'voice.gpt_live.instructions', 'tts.provider', 'stt.enabled', 'stt.echo_transcripts', 'stt.provider',
  'stt.streaming', 'voice.auto_tts', 'voice.max_recording_seconds', 'voice.client_direct', 'toolsets', 'terminal.backend', 'terminal.timeout', 'tool_output.max_bytes', 'tool_output.max_lines',
  'tool_output.max_line_length', 'checkpoints.max_snapshots', 'agent.max_turns', 'agent.api_max_retries', 'agent.service_tier', 'agent.tool_use_enforcement', 'updates.non_interactive_local_changes',
  'delegation.model', 'delegation.provider', 'delegation.max_iterations', 'delegation.max_concurrent_children', 'delegation.child_timeout_seconds', 'delegation.reasoning_effort',
]
