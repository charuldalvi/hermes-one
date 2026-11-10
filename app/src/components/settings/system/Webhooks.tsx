// Webhooks: web addresses other services (GitHub, Stripe, your own scripts) call to start this bot.
// Turn the receiver on, add a webhook with what the bot should do and where the result goes, copy
// its address and its secret (shown once), switch one off, delete one.
import { useEffect, useMemo, useState } from 'react'
import { createWebhook, deleteWebhook, enableWebhooks, setWebhookEnabled, webhooks, type Webhook } from '../../../lib/api-system'
import { toast } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { Badge, confirm, Dialog, ErrorLine, Search, Select, Spinner, Switch, useAsync } from '../../ui'
import { CopyValue, errText, Field, usePoll, Warn, when } from './parts'
import { SkillPicker } from './SkillPicker'

const DELIVER = [
  { value: 'log', label: 'Nowhere, just keep a record' }, { value: 'telegram', label: 'Telegram' }, { value: 'discord', label: 'Discord' },
  { value: 'slack', label: 'Slack' }, { value: 'email', label: 'Email' }, { value: 'github_comment', label: 'A GitHub comment' },
]
const deliverLabel = (d: string) => DELIVER.find((x) => x.value === d)?.label ?? d

function NewWebhook({ profile, open, onClose, onCreated }: { profile: string; open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [events, setEvents] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [deliver, setDeliver] = useState('log')
  const [only, setOnly] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState<{ url: string; secret: string } | null>(null)
  useEffect(() => { if (open) { setName(''); setDescription(''); setPrompt(''); setEvents(''); setSkills([]); setDeliver('log'); setOnly(false); setError(''); setMade(null); setSaving(false) } }, [open])
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  const create = async () => {
    if (!slug) { setError('Give it a short name, like github-push.'); return }
    setSaving(true); setError('')
    try {
      const evs = events.split(',').map((x) => x.trim()).filter(Boolean)
      const r = await createWebhook(profile, { name: slug, description: description.trim() || undefined, prompt: prompt.trim() || undefined, events: evs.length ? evs : undefined, skills: skills.length ? skills : undefined, deliver, deliver_only: only })
      setMade({ url: r.url, secret: r.secret })
      onCreated()
    } catch (e) { setError(errText(e)) } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onClose={() => { if (!saving) onClose() }} width={580} title={made ? 'Webhook made' : 'New webhook'}
      footer={made ? <><span className="sp" /><button className="b-pri" onClick={onClose}>Done</button></> : <>
        {error ? <span className="sy-err" style={{ flex: 1, minWidth: 0 }}>{error}</span> : <span className="sp" />}
        <button className="b-text" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="b-pri" onClick={() => void create()} disabled={saving}>{saving ? 'Making…' : 'Make webhook'}</button>
      </>}>
      {made ? (
        <div className="sy-form">
          <Warn>Copy the secret now. Hermes won’t show it again; the calling service uses it to sign each call.</Warn>
          <Field label="Its address"><CopyValue value={made.url} what="Copied the address" /></Field>
          <Field label="Its secret"><CopyValue value={made.secret} what="Copied the secret" /></Field>
        </div>
      ) : (
        <div className="sy-form">
          <div className="sy-row2">
            <Field label="Name" hint={slug && slug !== name.trim() ? `Saved as ${slug}` : 'Short, no spaces. It’s part of the address.'}><input className="answer mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="github-push" /></Field>
            <Field label="What it’s for" optional><input className="answer" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Reviews pushed commits" /></Field>
          </div>
          {!only ? <Field label="What should the agent do when it’s called?" optional hint="The data that comes in is handed to the agent with this."><textarea className="answer" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Review the pushed commits and tell me about anything risky." /></Field> : null}
          <Field label="Only these events" optional hint="Comma-separated, as the service names them. Leave empty for all."><input className="answer mono" value={events} onChange={(e) => setEvents(e.target.value)} placeholder="push, pull_request" /></Field>
          {!only ? <Field label="Skills to load first" optional><SkillPicker profile={profile} value={skills} onChange={setSkills} /></Field> : null}
          <Field label="Send the result to"><Select value={deliver} options={DELIVER} onChange={setDeliver} width={320} /></Field>
          <label className="sy-inline" style={{ cursor: 'pointer' }}><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />Pass the incoming data straight on, without the agent</label>
        </div>
      )}
    </Dialog>
  )
}

function WebhookDialog({ hook, open, onClose, onDelete }: { hook: Webhook | null; open: boolean; onClose: () => void; onDelete: (h: Webhook) => void }) {
  const [last, setLast] = useState<Webhook | null>(hook)
  useEffect(() => { if (hook) setLast(hook) }, [hook])
  const h = hook ?? last
  if (!h) return null
  return (
    <Dialog open={open} onClose={onClose} width={600} title={<><Icon name="webhook" size={18} /><span className="sy-mono">{h.name}</span>{h.enabled ? null : <Badge tone="quiet">Off</Badge>}{h.deliver_only ? <Badge tone="quiet">Passes data on</Badge> : null}</>}
      footer={<><button className="b-ghost-danger" onClick={() => onDelete(h)}>Delete</button><span className="sp" /><button className="b-text" onClick={onClose}>Close</button></>}>
      <div className="sy-form">
        {h.description ? <p className="free" style={{ margin: 0 }}>{h.description}</p> : null}
        <Field label="Its address" hint={h.secret_set ? 'Calls must be signed with the secret you copied when you made it.' : 'This webhook has no secret, so anyone with the address can call it.'}><CopyValue value={h.url} what="Copied the address" /></Field>
        <div className="card"><dl className="sy-kv">
          <dt>Events</dt><dd>{h.events.length ? <span className="sy-mono">{h.events.join(', ')}</span> : 'All of them'}</dd>
          <dt>Sends the result to</dt><dd>{deliverLabel(h.deliver)}</dd>
          {h.skills.length ? <><dt>Skills</dt><dd className="sy-mono">{h.skills.join(', ')}</dd></> : null}
          {h.created_at ? <><dt>Made</dt><dd>{when(h.created_at)}</dd></> : null}
        </dl></div>
        {h.prompt ? <Field label="What the agent is asked to do"><div className="sy-text">{h.prompt}</div></Field> : null}
      </div>
    </Dialog>
  )
}

export function WebhooksTab({ profile, needRestart }: { profile: string; needRestart: (why?: string) => void }) {
  const { data, error, loading, reload, setData } = useAsync(() => webhooks(profile), [profile])
  usePoll(() => void reload(true), 15_000)
  const [q, setQ] = useState('')
  const [enabling, setEnabling] = useState(false)
  const [making, setMaking] = useState(false)
  const [openName, setOpenName] = useState<string | null>(null)
  const subs = data?.subscriptions ?? []
  const t = q.trim().toLowerCase()
  const shown = useMemo(() => subs.filter((s) => !t || [s.name, s.description, s.deliver, ...s.events].join(' ').toLowerCase().includes(t)), [subs, t])

  const turnOn = async () => {
    setEnabling(true)
    try {
      const r = await enableWebhooks(profile)
      await reload(true)
      if (r.restart_started) { toast('Webhooks are on. Messaging is restarting…'); window.setTimeout(() => void reload(true), 4000) }
      else { toast('Webhooks are on. Restart messaging to start receiving calls.'); needRestart(r.restart_error ? `The automatic restart didn’t work (${r.restart_error}).` : 'Webhooks were turned on.') }
    } catch (e) { toast(`Couldn’t turn webhooks on: ${errText(e)}`) } finally { setEnabling(false) }
  }
  const toggle = async (h: Webhook, on: boolean) => {
    const set = (v: boolean) => setData((d) => (d ? { ...d, subscriptions: d.subscriptions.map((s) => (s.name === h.name ? { ...s, enabled: v } : s)) } : d))
    set(on)
    try { await setWebhookEnabled(profile, h.name, on); toast(on ? `${h.name} is on` : `${h.name} is off: calls to it are turned away`) } catch (e) { set(!on); toast(`Couldn’t turn ${h.name} ${on ? 'on' : 'off'}: ${errText(e)}`) }
  }
  const remove = async (h: Webhook) => {
    if (!(await confirm({ title: `Delete ${h.name}?`, body: 'Calls to its address stop working right away. This can’t be undone.', action: 'Delete', danger: true }))) return
    setOpenName(null)
    setData((d) => (d ? { ...d, subscriptions: d.subscriptions.filter((s) => s.name !== h.name) } : d))
    try { await deleteWebhook(profile, h.name); toast(`Deleted ${h.name}`) } catch (e) { toast(`Couldn’t delete it: ${errText(e)}`); void reload(true) }
  }

  if (loading && !data) return <div className="empty"><Spinner size={18} /><span>Loading webhooks…</span></div>
  if (error && !data) return <ErrorLine text={`Couldn’t load webhooks: ${error}`} onRetry={() => void reload()} />
  const openHook = openName ? subs.find((s) => s.name === openName) ?? null : null
  return (
    <>
      {!data?.enabled ? (
        <div className="card" style={{ padding: 18, display: 'grid', gap: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 500 }}>Webhooks are off</div>
          <div className="sy-note" style={{ margin: 0 }}>Turn them on so other services can start this agent by calling a web address, like GitHub when you push code. Messaging restarts to do it. Chat apps are only needed if a webhook sends its result to one.</div>
          <div><button className="b-pri" onClick={() => void turnOn()} disabled={enabling}>{enabling ? 'Turning on…' : 'Turn on webhooks'}</button></div>
        </div>
      ) : (
        <div className="sy-inline" style={{ marginBottom: 14 }}><i className="dot ok" /><span>Webhooks are on. Addresses start with</span><span className="sy-mono" style={{ color: 'var(--text-primary)' }}>{data.base_url}</span></div>
      )}
      <div className="stools">
        <Search value={q} onChange={setQ} placeholder="Search webhooks" />
        <button className="b-soft" onClick={() => setMaking(true)}><Icon name="plus" size={14} /> New webhook</button>
      </div>
      {!subs.length ? <div className="empty"><b>No webhooks yet</b><span>Make one to let another service start this agent. Changes take effect straight away once the receiver is running.</span></div>
        : !shown.length ? <div className="empty"><b>Nothing matches</b></div>
        : <div className="card flow">{shown.map((h) => (
          <div className="srow click" key={h.name} onClick={() => setOpenName(h.name)}>
            <Icon name="webhook" size={18} />
            <div className="tx">
              <div className="t1"><span className="sy-mono">{h.name}</span>{h.deliver_only ? <Badge tone="quiet">Passes data on</Badge> : null}</div>
              <div className="t2">{h.description || h.prompt || 'No description'}</div>
              <div className="t3">{h.events.length ? h.events.join(', ') : 'all events'} · to {deliverLabel(h.deliver).toLowerCase()}</div>
            </div>
            <div className="act" onClick={(e) => e.stopPropagation()}><Switch on={h.enabled} onChange={(v) => void toggle(h, v)} label={h.enabled ? `Turn ${h.name} off` : `Turn ${h.name} on`} /></div>
          </div>
        ))}</div>}
      <NewWebhook profile={profile} open={making} onClose={() => setMaking(false)} onCreated={() => void reload(true)} />
      <WebhookDialog hook={openHook} open={!!openHook} onClose={() => setOpenName(null)} onDelete={(h) => void remove(h)} />
    </>
  )
}
