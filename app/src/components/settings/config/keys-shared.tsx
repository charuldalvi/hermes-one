// Parts the Keys and accounts tabs share: one key row (add, replace, check, show, remove), the
// provider grouping Desktop uses for its API keys list, and small helpers. A stored value is never
// on screen unless you asked to see it, and then only for half a minute.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../../../lib/api'
import { deleteEnvVar, revealEnvVar, setEnvVar, validateCredential, type EnvInfo } from '../../../lib/api-config'
import { toast } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { useStore } from '../../../lib/store'
import { confirm, Spinner } from '../../ui'

// ---------- small helpers ----------

export async function copyText(text: string, what = 'Copied') {
  try { await navigator.clipboard.writeText(text) } catch {
    const t = document.createElement('textarea')
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'
    document.body.appendChild(t); t.select()
    try { document.execCommand('copy') } finally { t.remove() }
  }
  toast(what)
}

export const openLink = (url?: string | null) => { if (url) void window.hermesNative.openExternal(url) }

const WORDS: Record<string, string> = { api: 'API', url: 'URL', id: 'ID', ids: 'IDs', oauth: 'OAuth', ssh: 'SSH', gpu: 'GPU', tts: 'TTS', stt: 'STT', llm: 'LLM', ai: 'AI', hf: 'HF', ttl: 'TTL', aws: 'AWS', mcp: 'MCP', qq: 'QQ', sms: 'SMS', a2a: 'A2A', irc: 'IRC', glm: 'GLM', xai: 'xAI', json: 'JSON' }
/** "EXA_API_KEY" → "Exa API key". */
export function prettyKey(key: string): string {
  const w = key.toLowerCase().split('_').filter(Boolean).map((x) => WORDS[x] ?? x)
  if (!w.length) return key
  w[0] = WORDS[w[0].toLowerCase()] ?? w[0].charAt(0).toUpperCase() + w[0].slice(1)
  return w.join(' ')
}
/** "web_search" → "web search". */
export const prettyTool = (t: string) => t.replace(/_/g, ' ')

export const isKeyVar = (info: EnvInfo) => info.is_password || /(?:_API_KEY|_TOKEN|_KEY)$/.test(info.key)

/** The bot a per-bot page is about, in words: "Chief" or the bot's name. */
export function useBotName(profile: string): string {
  const bots = useStore((s) => s.bots)
  const b = bots.find((x) => x.profile === profile)
  if (profile === 'default' || b?.isChief) return 'Hermes'
  return b?.name ?? profile
}

export function errText(e: unknown): string { return (e as any)?.message ?? String(e) }

// ---------- providers (port of Desktop's PROVIDER_GROUPS) ----------

interface ProviderMeta { prefix: string; name: string; description?: string; docsUrl?: string; priority: number }
export const PROVIDER_GROUPS: ProviderMeta[] = [
  { prefix: 'NOUS_', name: 'Nous Portal', description: 'Hosted Hermes and Nous-trained models', docsUrl: 'https://portal.nousresearch.com', priority: 0 },
  { prefix: 'FIREWORKS_', name: 'Fireworks AI', description: 'OpenAI-compatible direct model API', docsUrl: 'https://app.fireworks.ai/settings/users/api-keys', priority: 1 },
  { prefix: 'OPENROUTER_', name: 'OpenRouter', description: 'One key for hundreds of models', docsUrl: 'https://openrouter.ai/keys', priority: 1 },
  { prefix: 'ANTHROPIC_', name: 'Anthropic', description: 'Claude models (Sonnet, Opus, Haiku)', docsUrl: 'https://console.anthropic.com/settings/keys', priority: 2 },
  { prefix: 'XAI_', name: 'xAI', description: 'Grok models (sign in on Accounts for SuperGrok or Premium+)', docsUrl: 'https://console.x.ai/', priority: 3 },
  { prefix: 'GOOGLE_', name: 'Gemini', description: 'Google AI Studio', docsUrl: 'https://aistudio.google.com/app/apikey', priority: 4 },
  { prefix: 'GEMINI_', name: 'Gemini', priority: 4 },
  { prefix: 'DEEPSEEK_', name: 'DeepSeek', description: 'The DeepSeek API directly', docsUrl: 'https://platform.deepseek.com/api_keys', priority: 5 },
  { prefix: 'DASHSCOPE_', name: 'DashScope (Qwen)', description: 'Alibaba Cloud DashScope: Qwen and other models', docsUrl: 'https://modelstudio.console.alibabacloud.com/', priority: 6 },
  { prefix: 'HERMES_QWEN_', name: 'DashScope (Qwen)', priority: 6 },
  { prefix: 'GLM_', name: 'GLM / Z.AI', description: 'Zhipu GLM and Z.AI hosted models', docsUrl: 'https://z.ai/', priority: 7 },
  { prefix: 'ZAI_', name: 'GLM / Z.AI', priority: 7 },
  { prefix: 'Z_AI_', name: 'GLM / Z.AI', priority: 7 },
  { prefix: 'KIMI_', name: 'Kimi / Moonshot', description: 'Moonshot Kimi and its coding plan', docsUrl: 'https://platform.moonshot.cn/', priority: 8 },
  { prefix: 'KIMI_CN_', name: 'Kimi (China)', description: 'Moonshot China', docsUrl: 'https://platform.moonshot.cn/', priority: 9 },
  { prefix: 'MINIMAX_', name: 'MiniMax', description: 'MiniMax international', docsUrl: 'https://www.minimax.io/', priority: 10 },
  { prefix: 'MINIMAX_CN_', name: 'MiniMax (China)', description: 'MiniMax mainland China', docsUrl: 'https://www.minimaxi.com/', priority: 11 },
  { prefix: 'HF_', name: 'Hugging Face', description: 'Open models through Hugging Face Inference Providers', docsUrl: 'https://huggingface.co/settings/tokens', priority: 12 },
  { prefix: 'OPENCODE_ZEN_', name: 'OpenCode Zen', description: 'Pay as you go for curated coding models', docsUrl: 'https://opencode.ai/auth', priority: 13 },
  { prefix: 'OPENCODE_GO_', name: 'OpenCode Go', description: 'A monthly plan for open coding models', docsUrl: 'https://opencode.ai/auth', priority: 14 },
  { prefix: 'NVIDIA_', name: 'NVIDIA NIM', description: 'build.nvidia.com or your own NIM server', docsUrl: 'https://build.nvidia.com/', priority: 15 },
  { prefix: 'OLLAMA_', name: 'Ollama Cloud', description: 'Open models hosted by ollama.com', docsUrl: 'https://ollama.com/settings', priority: 16 },
  { prefix: 'LM_', name: 'LM Studio', description: 'LM Studio running on a computer', docsUrl: 'https://lmstudio.ai/docs/local-server', priority: 17 },
  { prefix: 'STEPFUN_', name: 'StepFun', description: 'StepFun Step Plan coding models', docsUrl: 'https://platform.stepfun.com/', priority: 18 },
  { prefix: 'XIAOMI_', name: 'Xiaomi MiMo', description: 'MiMo and other Xiaomi models', docsUrl: 'https://platform.xiaomimimo.com', priority: 19 },
  { prefix: 'ARCEEAI_', name: 'Arcee AI', description: 'Arcee small and medium models', docsUrl: 'https://chat.arcee.ai/', priority: 20 },
  { prefix: 'ARCEE_', name: 'Arcee AI', priority: 20 },
  { prefix: 'GMI_', name: 'GMI Cloud', description: 'GMI Cloud GPUs and model serving', docsUrl: 'https://www.gmicloud.ai/', priority: 21 },
  { prefix: 'AZURE_FOUNDRY_', name: 'Azure Foundry', description: 'Your Azure AI Foundry endpoints', docsUrl: 'https://ai.azure.com/', priority: 22 },
  { prefix: 'AWS_', name: 'AWS Bedrock', description: 'Signs in with an AWS profile and region', docsUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-regions.html', priority: 23 },
]
/** Longest matching prefix wins, so MINIMAX_CN_ beats MINIMAX_. */
function prefixGroup(key: string): string {
  let best: ProviderMeta | undefined
  for (const g of PROVIDER_GROUPS) if (key.startsWith(g.prefix) && (!best || g.prefix.length > best.prefix.length)) best = g
  return best?.name ?? 'Other'
}
const metaFor = (name: string) => PROVIDER_GROUPS.find((g) => g.name === name && (g.description || g.docsUrl)) ?? PROVIDER_GROUPS.find((g) => g.name === name)

export interface ProviderGroup { name: string; primary: EnvInfo; advanced: EnvInfo[]; description?: string; docsUrl?: string; hasAnySet: boolean; priority: number; keys: string[] }

/** Provider keys folded into one card per provider: Hermes' own provider identity first, a prefix guess second. */
export function providerGroups(vars: EnvInfo[]): ProviderGroup[] {
  const buckets = new Map<string, EnvInfo[]>()
  for (const info of vars) {
    if (info.category !== 'provider') continue
    const scoped: EnvInfo[] = info.provider_profiles?.length
      ? info.provider_profiles.map((p) => ({ ...info, description: p.description || info.description, provider: p.provider, provider_label: p.provider_label, provider_primary: p.primary, url: p.url ?? info.url }))
      : [info]
    for (const s of scoped) {
      const name = s.provider_label?.trim() || s.provider?.trim() || prefixGroup(s.key)
      if (name === 'Other') continue
      buckets.set(name, [...(buckets.get(name) ?? []), s])
    }
  }
  const out: ProviderGroup[] = []
  for (const [name, entries] of buckets) {
    const primary = entries.find((i) => i.provider_primary && isKeyVar(i)) ?? entries.find((i) => !i.advanced && isKeyVar(i)) ?? entries.find(isKeyVar)
    if (!primary) continue
    const meta = metaFor(name)
    out.push({
      name, primary,
      // Alias keys (ANTHROPIC_TOKEN next to ANTHROPIC_API_KEY) stay hidden unless one is set, so it can be cleared.
      advanced: entries.filter((i) => i.key !== primary.key && (!isKeyVar(i) || i.is_set)).sort((a, b) => a.key.localeCompare(b.key)),
      description: meta?.description ?? primary.description,
      docsUrl: meta?.docsUrl ?? primary.url ?? undefined,
      hasAnySet: entries.some((i) => i.is_set),
      priority: meta?.priority ?? 99,
      keys: entries.map((i) => i.key),
    })
  }
  return out.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
}

// ---------- one key ----------

type Msg = { tone: 'ok' | 'warn' | 'bad'; text: string; anyway?: boolean }

/**
 * One key: whether it's set, and add / replace / show / remove. Values go in through a password
 * field and are never displayed back, except after an explicit "Show" (Hermes allows a few a minute
 * and logs each), and then only for 30 seconds.
 */
export function KeyRow({ profile, info, label, sub, extra, docs, check, flash, onChange, children }: {
  profile: string; info: EnvInfo; label: string; sub?: ReactNode; extra?: ReactNode; docs?: string | null
  /** Ask the provider whether the key works before saving it. */
  check?: boolean; flash?: boolean
  onChange: (key: string, patch: Partial<EnvInfo> | null) => void
  children?: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<'save' | 'check' | 'remove' | 'reveal' | null>(null)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [shown, setShown] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => { clearTimeout(hideTimer.current); clearTimeout(savedTimer.current) }, [])
  // A value shown for another bot must not linger when the page moves on.
  useEffect(() => { setShown(null); setEditing(false); setDraft(''); setMsg(null) }, [profile])

  const doCheck = check && info.is_password
  const cancel = () => { setEditing(false); setDraft(''); setMsg(null) }
  const flashSaved = () => { setSaved(true); clearTimeout(savedTimer.current); savedTimer.current = setTimeout(() => setSaved(false), 1800) }

  const write = async (value: string, note?: string) => {
    setBusy('save')
    try {
      await setEnvVar(profile, info.key, value, info.category === 'provider')
      onChange(info.key, { is_set: true })
      setEditing(false); setDraft(''); setMsg(null); setShown(null)
      flashSaved()
      toast(note ?? `Saved ${label}.`)
    } catch (e) {
      setMsg({ tone: 'bad', text: `Hermes didn’t save it: ${errText(e)}` })
      toast(`Couldn’t save ${label}.`)
    } finally { setBusy(null) }
  }

  const save = async (skipCheck = false) => {
    const value = draft.trim()
    if (!value) { setMsg({ tone: 'warn', text: 'Paste a value first.' }); return }
    if (!doCheck || skipCheck) return write(value)
    setBusy('check'); setMsg(null)
    try {
      const r = await validateCredential(profile, info.key, value)
      setBusy(null)
      if (r.ok) return write(value, r.reachable ? `${label} works and is saved.` : undefined)
      if (r.reachable) { setMsg({ tone: 'bad', text: r.message || 'The provider turned this key down.', anyway: true }); return }
      return write(value, `Saved. Hermes couldn’t reach the provider to check ${label}.`)
    } catch {
      setBusy(null)
      return write(value, `Saved. Hermes couldn’t check ${label} first.`)
    }
  }

  const remove = async () => {
    const ok = await confirm({
      title: `Remove ${label}?`,
      body: <>Hermes stops using <span className="x-mono">{info.key}</span>. Anything that needs it stops working until you add it again.</>,
      action: 'Remove', danger: true,
    })
    if (!ok) return
    setBusy('remove')
    try {
      await deleteEnvVar(profile, info.key)
      setShown(null)
      onChange(info.key, info.custom ? null : { is_set: false })
      toast(`Removed ${label}.`)
    } catch (e) { toast(`Couldn’t remove ${label}: ${errText(e)}`) } finally { setBusy(null) }
  }

  const reveal = async () => {
    if (shown !== null) { setShown(null); clearTimeout(hideTimer.current); return }
    const ok = await confirm({
      title: `Show ${info.key}?`,
      body: 'The value appears on screen for 30 seconds. Hermes allows only a few of these a minute and writes each one to its log.',
      action: 'Show',
    })
    if (!ok) return
    setBusy('reveal')
    try {
      const r = await revealEnvVar(profile, info.key)
      setShown(r?.value ?? '')
      clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setShown(null), 30_000)
    } catch (e) {
      toast(e instanceof ApiError && e.status === 429 ? 'Hermes is limiting reveals. Wait half a minute and try again.' : `Couldn’t show it: ${errText(e)}`)
    } finally { setBusy(null) }
  }

  const placeholder = info.is_password ? `Paste ${label.replace(/ (API key|key|token)$/i, '')} key` : /URL$/i.test(info.key) ? 'https://…' : 'New value'
  return (
    <div className={`ky-key${flash ? ' ky-flash' : ''}`} id={`ky-key-${info.key}`}>
      <div className="srow">
        <i className={`dot ${info.is_set ? 'ok' : 'off'}`} title={info.is_set ? 'Set' : 'Not set'} />
        <div className="tx">
          <div className="t1"><span>{label}</span>{info.is_set ? null : <span className="ky-unset">Not set</span>}</div>
          {sub ? <div className="t2">{sub}</div> : null}
          {extra}
          <div className="t3">{info.key}</div>
        </div>
        <div className="act">
          {saved ? <span className="x-state saved">Saved</span> : null}
          {busy === 'remove' || busy === 'reveal' ? <Spinner /> : null}
          {!editing && docs && !info.is_set ? <button className="b-text x-btn-sm" onClick={() => openLink(docs)}>Get a key <Icon name="external" size={13} /></button> : null}
          {!editing && info.is_set ? (
            <>
              <button className="x-icon-btn" title={shown !== null ? 'Hide' : 'Show the value'} aria-label={shown !== null ? 'Hide' : 'Show the value'} disabled={!!busy} onClick={() => void reveal()}><Icon name="eye" size={15} /></button>
              <button className="x-icon-btn danger" title="Remove" aria-label="Remove" disabled={!!busy} onClick={() => void remove()}><Icon name="trash" size={15} /></button>
            </>
          ) : null}
          {!editing ? <button className={`${info.is_set ? 'b-text' : 'b-soft'} x-btn-sm`} disabled={!!busy} onClick={() => { setEditing(true); setMsg(null) }}>{info.is_set ? 'Replace' : 'Add'}</button> : null}
        </div>
      </div>
      {editing ? (
        <div className="ky-edit x-reveal">
          <div className="ky-editrow">
            <input className="answer mono" autoFocus type={info.is_password ? 'password' : 'text'} value={draft} placeholder={placeholder}
              autoComplete="off" spellCheck={false} disabled={!!busy}
              onChange={(e) => { setDraft(e.target.value); if (msg) setMsg(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save() } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel() } }} />
            <button className="b-soft" disabled={!!busy || !draft.trim()} onClick={() => void save()}>
              {busy === 'save' || busy === 'check' ? <Spinner size={13} /> : null}{busy === 'check' ? 'Checking…' : doCheck ? 'Check and save' : 'Save'}
            </button>
            <button className="b-text" disabled={!!busy} onClick={cancel}>Cancel</button>
          </div>
          {msg ? (
            <div className={`ky-msg ${msg.tone}`}>
              <span>{msg.text}</span>
              {msg.anyway ? <button className="b-text x-btn-sm" disabled={!!busy} onClick={() => void save(true)}>Save anyway</button> : null}
            </div>
          ) : (
            <div className="ky-msg">{info.is_set ? 'The new value replaces the old one.' : 'Saved to this agent’s .env file on your Mac.'}</div>
          )}
        </div>
      ) : null}
      {shown !== null ? (
        <div className="ky-edit x-reveal">
          <div className="ky-editrow">
            <div className="x-code ky-shown">{shown || '(empty)'}</div>
            <button className="x-icon-btn" title="Copy" aria-label="Copy" onClick={() => void copyText(shown, `Copied ${info.key}.`)}><Icon name="copy" size={15} /></button>
            <button className="b-text x-btn-sm" onClick={() => { setShown(null); clearTimeout(hideTimer.current) }}>Hide</button>
          </div>
          <div className="ky-msg">Hides itself in 30 seconds.</div>
        </div>
      ) : null}
      {children}
    </div>
  )
}

/** Gray placeholder rows while a list loads. */
export function SkeletonCard({ rows = 4 }: { rows?: number }) {
  return <div className="card">{Array.from({ length: rows }, (_, i) => <div key={i} className="x-skel" />)}</div>
}
