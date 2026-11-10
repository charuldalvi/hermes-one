// Custom endpoints: any OpenAI-compatible server (a vLLM or Ollama box, a company proxy, LM Studio on
// another computer). Add one, test it to find its models, save it, and make it this bot's model
// for new chats. Same fields as `hermes model`'s custom-provider setup.
import { useState } from 'react'
import {
  activateCustomEndpoint, customEndpoints, deleteCustomEndpoint, saveCustomEndpoint, testCustomEndpoint,
  type ApiMode, type CustomEndpoint, type CustomEndpointUpdate, type EndpointModelDetail,
} from '../../../lib/api-config'
import { toast } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { Badge, confirm, Empty, ErrorLine, Select, Spinner, Switch, useAsync } from '../../ui'
import { errText, SkeletonCard } from './keys-shared'

const MODES: { value: ApiMode; label: string; hint: string }[] = [
  { value: '', label: 'Auto-detect', hint: 'Hermes works it out from the address' },
  { value: 'chat_completions', label: 'Chat Completions', hint: 'Most OpenAI-compatible servers' },
  { value: 'codex_responses', label: 'Responses API', hint: 'OpenAI’s newer API' },
  { value: 'anthropic_messages', label: 'Anthropic Messages', hint: 'Claude-style servers' },
]
const modeLabel = (m?: string) => MODES.find((x) => x.value === (m ?? ''))?.label ?? m ?? ''

interface Form { id: string; name: string; baseUrl: string; apiKey: string; apiMode: ApiMode; contextLength: string; model: string; discover: boolean; makeDefault: boolean; hasKey: boolean }
const EMPTY: Form = { id: '', name: '', baseUrl: '', apiKey: '', apiMode: '', contextLength: '', model: '', discover: true, makeDefault: true, hasKey: false }
const fromEndpoint = (e: CustomEndpoint): Form => ({
  id: e.id, name: e.name, baseUrl: e.base_url, apiKey: '', apiMode: e.api_mode ?? '', contextLength: e.context_length ? String(e.context_length) : '',
  model: e.model, discover: e.discover_models, makeDefault: !!e.is_current, hasKey: e.has_api_key,
})
function payload(f: Form, models?: string[], details?: EndpointModelDetail[]): CustomEndpointUpdate {
  const ctx = Number.parseInt(f.contextLength, 10)
  return {
    id: f.id.trim() || undefined, name: f.name.trim(), base_url: f.baseUrl.trim(), model: f.model.trim(),
    api_key: f.apiKey.trim() || undefined, api_mode: f.apiMode, context_length: Number.isFinite(ctx) && ctx > 0 ? ctx : undefined,
    discover_models: f.discover, make_default: f.makeDefault, models: models?.length ? models : undefined, model_details: details?.length ? details : undefined,
  }
}

export function EndpointsTab({ profile, botName, onCount }: { profile: string; botName: string; onCount: (n: number) => void }) {
  const { data, error, loading, reload, setData } = useAsync(async () => { const r = await customEndpoints(profile); onCount(r.endpoints.length); return r }, [profile])
  const [form, setForm] = useState<Form | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [details, setDetails] = useState<EndpointModelDetail[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null)
  const list = data?.endpoints ?? []

  const edit = (f: Form, found: string[] = []) => { setForm(f); setModels(found); setDetails([]); setNote(null) }
  const patch = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f))

  const use = async (e: CustomEndpoint) => {
    setBusy(`use:${e.id}`)
    try {
      const r = await activateCustomEndpoint(profile, e.id)
      toast(`New chats for ${botName} use ${r.model || e.model} on ${e.name}.`)
      await reload(true)
    } catch (err) { toast(`Couldn’t switch to ${e.name}: ${errText(err)}`) } finally { setBusy(null) }
  }
  const remove = async (e: CustomEndpoint) => {
    const ok = await confirm({ title: `Delete ${e.name}?`, body: e.is_current ? `${botName} uses it for new chats now; pick another model on the Models page afterwards.` : 'Hermes forgets this endpoint and its key.', action: 'Delete', danger: true })
    if (!ok) return
    setBusy(`del:${e.id}`)
    try {
      const r = await deleteCustomEndpoint(profile, e.id)
      setData(r); onCount(r.endpoints.length)
      if (form?.id === e.id) setForm(null)
      toast(`Deleted ${e.name}.`)
    } catch (err) { toast(`Couldn’t delete ${e.name}: ${errText(err)}`) } finally { setBusy(null) }
  }
  const test = async () => {
    if (!form) return
    setBusy('test'); setNote(null)
    try {
      const r = await testCustomEndpoint(profile, payload(form))
      setModels(r.models ?? []); setDetails(r.model_details ?? [])
      if (r.ok) {
        const resolved = r.resolved_base_url?.trim()
        const next: Partial<Form> = {}
        if (!form.model && r.models?.[0]) next.model = r.models[0]
        if (resolved && resolved !== form.baseUrl.trim().replace(/\/+$/, '')) next.baseUrl = resolved
        if (Object.keys(next).length) patch(next)
        const via = r.transport_checked ? ` through ${modeLabel(r.transport_checked)}` : ''
        setNote({ tone: 'ok', text: `It answers${via}.${r.models?.length ? ` Found ${r.models.length} model${r.models.length === 1 ? '' : 's'}.` : ''}${next.baseUrl ? ` Hermes will use ${next.baseUrl}.` : ''}` })
      } else setNote({ tone: r.reachable ? 'warn' : 'bad', text: r.message || 'The endpoint didn’t answer the way Hermes expects.' })
    } catch (err) { setNote({ tone: 'bad', text: errText(err) }) } finally { setBusy(null) }
  }
  const save = async () => {
    if (!form) return
    setBusy('save'); setNote(null)
    try {
      const r = await saveCustomEndpoint(profile, payload(form, models, details))
      setData(r); onCount(r.endpoints.length)
      const saved = r.endpoints.find((e) => e.id === r.id)
      toast(saved?.is_current ? `Saved ${saved.name}. New chats for ${botName} use ${saved.model}.` : `Saved ${form.name.trim()}.`)
      setForm(null)
    } catch (err) { setNote({ tone: 'bad', text: `Hermes didn’t save it: ${errText(err)}` }) } finally { setBusy(null) }
  }

  const canSave = !!form && !!form.name.trim() && !!form.baseUrl.trim() && !!form.model.trim()
  const choices = Array.from(new Set([...models, form?.model ?? ''].filter(Boolean)))
  return (
    <>
      <div className="x-note">Point {botName} at any OpenAI-compatible server: one on your network, a company proxy, or LM Studio on another computer.</div>
      {error ? <ErrorLine text={`Couldn’t read custom endpoints: ${error}`} onRetry={() => void reload()} /> : null}
      {!data && loading ? <SkeletonCard rows={2} /> : null}
      {data ? (
        <>
          <div className="ssec"><h2>Endpoints</h2><span>{list.length || ''}</span><span className="sp" />{!form ? <button className="b-soft x-btn-sm" onClick={() => edit({ ...EMPTY })}><Icon name="plus" size={14} /> Add an endpoint</button> : null}</div>
          {list.length ? (
            <div className="card flow">
              {list.map((e) => (
                <div className={`srow ky-ep${form?.id === e.id ? ' on' : ''}`} key={e.id}>
                  <Icon name="globe" size={18} />
                  <div className="tx">
                    <div className="t1"><span>{e.name}</span>{e.is_current ? <Badge tone="ok"><Icon name="check" size={12} />In use</Badge> : null}{e.source === 'direct-config' ? <Badge tone="quiet">config.yaml</Badge> : null}</div>
                    <div className="t2">{[e.model, e.has_api_key ? 'API key set' : 'No API key', e.api_mode ? modeLabel(e.api_mode) : null, e.context_length ? `${e.context_length.toLocaleString()} tokens` : null].filter(Boolean).join(' · ')}</div>
                    <div className="t3">{e.base_url}</div>
                  </div>
                  <div className="act">
                    {busy === `use:${e.id}` || busy === `del:${e.id}` ? <Spinner /> : null}
                    {!e.is_current ? <button className="b-soft x-btn-sm" disabled={!!busy} onClick={() => void use(e)}>Use for new chats</button> : null}
                    <button className="b-text x-btn-sm" disabled={!!busy} onClick={() => edit(fromEndpoint(e), e.models)}>Edit</button>
                    <button className="x-icon-btn danger" title="Delete" aria-label="Delete" disabled={!!busy} onClick={() => void remove(e)}><Icon name="trash" size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : !form ? <div className="card ky-empty"><Empty title="No custom endpoints yet" body="Add one to run models from your own server." face={false} /></div> : null}

          {form ? (
            <div className="card ky-form x-reveal">
              <div className="ky-formh">{form.id ? `Edit ${form.name || 'endpoint'}` : 'New endpoint'}</div>
              <div className="x-grid2">
                <div className="x-field"><label>Name</label><input className="answer" autoFocus placeholder="Office server" value={form.name} onChange={(e) => patch({ name: e.target.value })} /></div>
                <div className="x-field"><label>API mode</label>
                  <Select value={form.apiMode || '__auto'} width={300} options={MODES.map((m) => ({ value: m.value || '__auto', label: m.label, hint: m.hint }))} onChange={(v) => patch({ apiMode: (v === '__auto' ? '' : v) as ApiMode })} />
                </div>
              </div>
              <div className="x-field"><label>Address</label><input className="answer mono" placeholder="http://192.168.1.20:8000/v1" value={form.baseUrl} spellCheck={false} onChange={(e) => patch({ baseUrl: e.target.value })} /></div>
              <div className="x-grid2">
                <div className="x-field"><label>API key</label>
                  <input className="answer mono" type="password" autoComplete="off" placeholder={form.hasKey ? 'Leave blank to keep the current key' : 'Optional'} value={form.apiKey} onChange={(e) => patch({ apiKey: e.target.value })} />
                </div>
                <div className="x-field"><label>Context window</label><input className="answer" type="number" min={0} placeholder="Auto" value={form.contextLength} onChange={(e) => patch({ contextLength: e.target.value })} /></div>
              </div>
              <div className="x-field"><label>Model</label>
                <input className="answer mono" list="ky-ep-models" placeholder={models.length ? 'Pick one or type a name' : 'Test the endpoint to list its models, or type a name'} value={form.model} spellCheck={false} onChange={(e) => patch({ model: e.target.value })} />
                <datalist id="ky-ep-models">{choices.map((m) => <option key={m} value={m} />)}</datalist>
                {models.length ? <span className="ky-small x-quiet">{models.length} model{models.length === 1 ? '' : 's'} found on the server.</span> : null}
              </div>
              <div className="ky-switches">
                <label><Switch on={form.discover} onChange={(v) => patch({ discover: v })} label="Find models automatically" /><span>Find its models automatically</span></label>
                <label><Switch on={form.makeDefault} onChange={(v) => patch({ makeDefault: v })} label="Use for new chats" /><span>Use for {botName}’s new chats</span></label>
              </div>
              {note ? <div className={`ky-msg ${note.tone}`}>{note.text}</div> : null}
              <div className="x-row">
                <button className="b-soft" disabled={!!busy || !form.baseUrl.trim()} onClick={() => void test()}>{busy === 'test' ? <Spinner size={13} /> : <Icon name="bolt" size={14} />}Test</button>
                <span className="sp" />
                <button className="b-text" disabled={busy === 'save'} onClick={() => setForm(null)}>Cancel</button>
                <button className="b-pri" disabled={!!busy || !canSave} onClick={() => void save()}>{busy === 'save' ? <Spinner size={13} /> : null}Save</button>
              </div>
            </div>
          ) : null}
          {data.current?.provider ? <div className="ky-small x-quiet ky-current">{botName} uses {data.current.model || 'no model'} from {data.current.provider} for new chats now.</div> : null}
        </>
      ) : null}
    </>
  )
}
