// Messaging apps (Telegram, Discord, Slack, WhatsApp, Matrix, Email …): which are on, connected or
// need attention, and each one's setup: its keys and allow-lists, a connection test, quick setups
// that finish on your phone, Team Gateway links, and who is waiting to be let in.
import { useEffect, useMemo, useState } from 'react'
import { testPlatform, updatePlatform, type PairingUser, type Platform, type PlatformField, type RestartOutcome } from '../../../lib/api-system'
import { toast } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { Badge, Dialog, Logo, Search, Switch, Tabs } from '../../ui'
import { ago, errText, Fold, open, Warn } from './parts'
import { RelayLink, TelegramSetup, WhatsAppSetup } from './PhoneSetup'

export type Tone = 'ok' | 'need' | 'bad' | 'off'
const STATE: Record<string, string> = {
  connected: 'Connected', connecting: 'Connecting', disabled: 'Off', fatal: 'Error', gateway_stopped: 'Messaging stopped',
  not_configured: 'Needs setup', pending_restart: 'Restart needed', retrying: 'Retrying', startup_failed: 'Couldn’t start',
}
export function platformTone(p: Platform): Tone {
  if (!p.enabled) return 'off'
  if (p.state === 'connected') return 'ok'
  if (p.state === 'fatal' || p.state === 'startup_failed') return 'bad'
  return 'need'
}
/** Required keys still missing: turning it on would only fail, so its setup opens instead. */
export const needsKeys = (p: Platform) => !p.relay_exclusive && p.env_vars.some((f) => f.required && !f.is_set)
export const stateLabel = (p: Platform) => (!p.enabled ? 'Off' : STATE[p.state ?? ''] ?? (p.state ? p.state.replace(/_/g, ' ') : 'Unknown'))
export function PlatformBadge({ p, quietOff }: { p: Platform; quietOff?: boolean }) {
  const t = platformTone(p)
  if (p.relay_exclusive) return <Badge tone="ok">Nous’ shared gateway</Badge>
  if (quietOff && t === 'off') return p.configured ? null : <span className="sy-dim" style={{ fontSize: 12 }}>Not set up</span>
  return <Badge tone={t === 'off' ? 'quiet' : t}>{t === 'ok' ? <i className="dot ok" /> : null}{stateLabel(p)}</Badge>
}

const INTRO: Record<string, string> = {
  telegram: 'In Telegram, talk to @BotFather, send /newbot, and copy the token it gives you. Then get your numeric user ID from @userinfobot.',
  discord: 'In the Discord Developer Portal, make an application, add a Bot, and copy its token. Invite the bot to your server.',
  slack: 'Make a Slack app, turn on Socket Mode, install it to your workspace, then copy the bot token and the app-level token.',
  mattermost: 'On your Mattermost server, make a bot account or a personal access token, then paste the server address and the token.',
  matrix: 'Sign in to your homeserver with the agent’s account, then copy the access token, user ID and homeserver address.',
  signal: 'Run a signal-cli REST bridge somewhere Hermes can reach, then give Hermes its address and the registered phone number.',
  whatsapp: 'Link WhatsApp with the code above, or fill in the details below by hand.',
  bluebubbles: 'Run BlueBubbles Server on a Mac with iMessage, then give Hermes its address and the server password.',
  homeassistant: 'In Home Assistant, open your profile and make a long-lived access token. Paste it with your Home Assistant address.',
  email: 'Use a mailbox just for the agent. For Gmail, make an app password and use imap.gmail.com and smtp.gmail.com.',
  sms: 'Get your Twilio Account SID and Auth Token from the Twilio console, and a phone number that can send texts.',
  api_server: 'Lets other apps talk to Hermes like an OpenAI-style API. Set a key, then point the app at the address.',
  webhook: 'Lets other services start an agent by calling a web address. Set webhooks up in the Webhooks tab.',
}

/** What to change: typed values, plus allow-lists emptied on purpose (a clear, not "untouched"). */
function changes(p: Platform, edits: Record<string, string>) {
  const env: Record<string, string> = {}
  const clear: string[] = []
  for (const f of p.env_vars) {
    if (!(f.key in edits)) continue
    const v = edits[f.key].trim()
    if (f.is_list) { if (v === (f.value ?? '').trim()) continue; if (!v) { if (f.is_set) clear.push(f.key) } else env[f.key] = v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean).join(',') }
    else if (v) env[f.key] = v
  }
  return { env, clear_env: clear }
}

function FieldRow({ f, value, onChange, onClear }: { f: PlatformField; value: string | undefined; onChange: (v: string) => void; onClear: () => void }) {
  const label = f.prompt || f.key
  return (
    <div className="srow ctlrow">
      <div className="tx">
        <div className="t1"><span>{label}</span>{f.is_set ? <Badge tone="quiet">Saved</Badge> : null}</div>
        {f.description ? <div className="t2">{f.description}</div> : null}
        <div className="t3">{f.key}</div>
      </div>
      <div className="ctl" style={{ gap: 4, alignItems: 'center' }}>
        <input className="answer mono" type={f.is_password ? 'password' : 'text'} value={f.is_list ? value ?? f.value ?? '' : value ?? ''}
          placeholder={f.is_list ? 'Comma-separated' : f.is_set ? (f.redacted_value ? `Saved (${f.redacted_value.replace(/^«redacted:(.*)»$/, '$1')}). Type to replace` : 'Saved. Type to replace') : f.prompt ?? ''}
          onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} />
        {f.url ? <button className="hbtn" title="Where to get it" onClick={() => open(f.url)}><Icon name="external" size={14} /></button> : null}
        {f.is_set && !f.is_list ? <button className="hbtn" title={`Clear ${f.key}`} onClick={onClear}><Icon name="trash" size={14} /></button> : null}
      </div>
    </div>
  )
}

export function PlatformDialog({ profile, platform, open: isOpen, onClose, pending, approved, onApprove, onRevoke, onChanged, needRestart }: {
  profile: string; platform: Platform | null; open: boolean; onClose: () => void
  pending: PairingUser[]; approved: PairingUser[]; onApprove: (u: PairingUser) => void; onRevoke: (u: PairingUser) => void
  onChanged: (p: Partial<Platform> | null) => void; needRestart: (why?: string) => void
}) {
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [last, setLast] = useState<Platform | null>(platform)
  useEffect(() => { if (platform) setLast(platform) }, [platform])
  useEffect(() => { setEdits({}); setTest(null) }, [platform?.id, isOpen])
  const p = platform ?? last
  if (!p) return null
  const ch = changes(p, edits)
  const dirty = Object.keys(ch.env).length + ch.clear_env.length > 0
  const required = p.env_vars.filter((f) => f.required)
  const optional = p.env_vars.filter((f) => !f.required && !f.advanced)
  const advanced = p.env_vars.filter((f) => !f.required && f.advanced)

  const settle = (hot?: boolean, what = 'Saved') => {
    if (hot) { toast(`${what}. Connecting now…`); window.setTimeout(() => onChanged(null), 4000) }
    else { toast(`${what}. Restart messaging to use it.`); needRestart(`${p.name} changed.`) }
  }
  const save = async () => {
    setSaving(true)
    try { const r = await updatePlatform(profile, p.id, ch); setEdits({}); onChanged(null); settle(r.hot_served, `${p.name} saved`) } catch (e) { toast(`Couldn’t save ${p.name}: ${errText(e)}`) } finally { setSaving(false) }
  }
  const clear = async (key: string) => {
    try { const r = await updatePlatform(profile, p.id, { clear_env: [key] }); onChanged(null); settle(r.hot_served, `${key} cleared`) } catch (e) { toast(`Couldn’t clear ${key}: ${errText(e)}`) }
  }
  const toggle = async (on: boolean) => {
    onChanged({ enabled: on })
    try { const r = await updatePlatform(profile, p.id, { enabled: on }); settle(r.hot_served, `${p.name} ${on ? 'on' : 'off'}`) } catch (e) { onChanged({ enabled: !on }); toast(`Couldn’t turn ${p.name} ${on ? 'on' : 'off'}: ${errText(e)}`) }
  }
  const runTest = async () => {
    setTesting(true); setTest(null)
    try { const r = await testPlatform(profile, p.id); setTest({ ok: r.ok, message: r.message }) } catch (e) { setTest({ ok: false, message: errText(e) }) } finally { setTesting(false) }
  }
  const applied = (r: RestartOutcome) => {
    onChanged(null)
    if (r.restart_started) toast(`${p.name} is set up${r.bot_username ? ` as @${r.bot_username}` : ''}. Messaging is restarting…`)
    else { toast(`${p.name} is set up. Restart messaging to connect.`); needRestart(r.restart_error ? `The automatic restart didn’t work (${r.restart_error}).` : undefined) }
    window.setTimeout(() => onChanged(null), 5000)
  }
  const relayOnly = !!p.relay_exclusive
  return (
    <Dialog open={isOpen} onClose={() => { if (!saving) onClose() }} width={720}
      title={<><Logo name={p.name} size={26} /><span>{p.name}</span><PlatformBadge p={p} /></>}
      footer={<>
        {!relayOnly ? <><Switch on={p.enabled} onChange={(v) => void toggle(v)} disabled={p.disabled_by_relay} label={p.enabled ? `Turn ${p.name} off` : `Turn ${p.name} on`} /><span className="sy-dim" style={{ fontSize: 13 }}>{p.disabled_by_relay ? 'Managed by Nous’ shared gateway' : p.enabled ? 'On' : 'Off'}</span></> : null}
        <span className="sp" />
        {!relayOnly && p.configured ? <button className="b-text" onClick={() => void runTest()} disabled={testing}>{testing ? 'Testing…' : 'Test connection'}</button> : null}
        {!relayOnly ? <button className="b-pri" onClick={() => void save()} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</button> : <button className="b-text" onClick={onClose}>Done</button>}
      </>}>
      <p className="free" style={{ marginTop: 2 }}>{p.description}</p>
      {p.error_message ? <Warn bad><b>{stateLabel(p)}.</b> {p.error_message}</Warn> : null}
      {p.enabled && p.state === 'pending_restart' ? <Warn>Saved, but messaging needs a restart to use it.</Warn> : null}
      {p.enabled && !p.gateway_running && p.state !== 'connected' ? <Warn>Messaging is stopped, so {p.name} can’t connect. Start it in System.</Warn> : null}
      {p.ingress_url ? <div className="sy-note" style={{ marginBottom: 12 }}>Served on the shared listener at <span className="sy-mono">{p.ingress_url}</span></div> : null}
      {test ? <div className="sy-reveal" style={{ marginBottom: 12 }}>{test.ok ? <div className="sy-inline"><i className="dot ok" /><span>It works. {test.message}</span></div> : <Warn bad><b>The test didn’t pass.</b> {test.message}</Warn>}</div> : null}
      {p.home_channel ? <div className="sy-note" style={{ marginBottom: 12 }}>Home chat: <b style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{p.home_channel.name || p.home_channel.chat_id}</b>. Scheduled jobs that send here go to it.</div> : null}

      <div style={{ display: 'grid', gap: 12 }}>
        {p.id === 'telegram' && !relayOnly ? <TelegramSetup profile={profile} platform={p} onApplied={applied} /> : null}
        {p.id === 'whatsapp' && !relayOnly ? <WhatsAppSetup profile={profile} onApplied={applied} /> : null}
        {p.relay_fronted ? <RelayLink profile={profile} platform={p} /> : null}
        {p.disabled_by_relay && !relayOnly ? <div className="sy-note">Nous’ shared gateway carries {p.name} here, so the direct connection is turned off each time messaging starts.</div> : null}
      </div>

      {pending.length || approved.length ? (
        <>
          <div className="ssec" style={{ marginTop: 22 }}><h2>People</h2><span>{pending.length ? `${pending.length} waiting` : `${approved.length} let in`}</span></div>
          <div className="card">
            {pending.map((u) => (
              <div className="srow" key={`p:${u.user_id}`}>
                <i className="dot need" />
                <div className="tx"><div className="t1"><span>{u.user_name || u.user_id}</span></div><div className="t2">Wants to talk to the agent{typeof u.age_minutes === 'number' ? ` · asked ${u.age_minutes < 1 ? 'just now' : ago(Date.now() - u.age_minutes * 60_000)}` : ''}</div></div>
                <button className="b-soft" onClick={() => onApprove(u)}>Let in</button>
              </div>
            ))}
            {approved.map((u) => (
              <div className="srow" key={`a:${u.user_id}`}>
                <i className="dot ok" />
                <div className="tx"><div className="t1"><span>{u.user_name || u.user_id}</span></div>{u.user_name ? <div className="t3">{u.user_id}</div> : null}</div>
                <button className="b-ghost-danger" onClick={() => onRevoke(u)}>Remove</button>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {!relayOnly ? (
        <>
          <div className="ssec" style={{ marginTop: 22 }}><h2>Set it up by hand</h2><span className="sp" />
            {p.docs_url ? <button className="b-text" style={{ height: 26 }} onClick={() => open(p.docs_url)}><Icon name="external" size={13} /> Setup guide</button> : null}
          </div>
          <p className="sy-note" style={{ margin: '0 2px 10px' }}>{INTRO[p.id] ?? 'Get the details from the app’s developer settings, then paste them here.'}</p>
          {!p.env_vars.length ? <p className="sy-note">{p.name} doesn’t need a key here. Follow the setup guide, then turn it on.</p> : null}
          {required.length ? <div className="card">{required.map((f) => <FieldRow key={f.key} f={f} value={edits[f.key]} onChange={(v) => setEdits((e) => ({ ...e, [f.key]: v }))} onClear={() => void clear(f.key)} />)}</div> : null}
          {optional.length ? <><div className="ssec" style={{ marginTop: 16 }}><h2 style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>Also useful</h2></div>
            <div className="card">{optional.map((f) => <FieldRow key={f.key} f={f} value={edits[f.key]} onChange={(v) => setEdits((e) => ({ ...e, [f.key]: v }))} onClear={() => void clear(f.key)} />)}</div></> : null}
          {advanced.length ? <div style={{ marginTop: 14 }}><Fold label={`Advanced (${advanced.length})`}>
            <div className="card">{advanced.map((f) => <FieldRow key={f.key} f={f} value={edits[f.key]} onChange={(v) => setEdits((e) => ({ ...e, [f.key]: v }))} onClear={() => void clear(f.key)} />)}</div>
          </Fold></div> : null}
          {dirty ? <div className="sy-note">You have changes that aren’t saved yet.</div> : null}
        </>
      ) : null}
    </Dialog>
  )
}

type ToneFilter = 'all' | Tone
export function PlatformList({ list, pendingBy, onOpen, onToggle }: { list: Platform[]; pendingBy: Record<string, number>; onOpen: (p: Platform) => void; onToggle: (p: Platform, on: boolean) => void }) {
  const [q, setQ] = useState('')
  const [tone, setTone] = useState<ToneFilter>('all')
  const counts = useMemo(() => {
    const c: Record<Tone, number> = { ok: 0, need: 0, bad: 0, off: 0 }
    for (const p of list) c[platformTone(p)]++
    return c
  }, [list])
  const t = q.trim().toLowerCase()
  const shown = list.filter((p) => (tone === 'all' || platformTone(p) === tone) && (!t || `${p.id} ${p.name} ${p.description} ${p.state ?? ''}`.toLowerCase().includes(t)))
  const mine = shown.filter((p) => p.enabled || p.configured || p.relay_fronted)
  const rest = shown.filter((p) => !(p.enabled || p.configured || p.relay_fronted))
  const effTone = tone !== 'all' && !counts[tone] ? 'all' : tone
  const row = (p: Platform) => (
    <div className="srow click" key={p.id} onClick={() => onOpen(p)}>
      <Logo name={p.name} size={32} />
      <div className="tx">
        <div className="t1"><span>{p.name}</span>{pendingBy[p.id] ? <Badge tone="need">{pendingBy[p.id]} waiting</Badge> : null}</div>
        <div className="t2">{p.error_message ? <span className="sy-err">{p.error_message}</span> : p.description}</div>
      </div>
      <div className="act" onClick={(e) => e.stopPropagation()}>
        <PlatformBadge p={p} quietOff />
        {!p.relay_exclusive ? <Switch on={p.enabled} onChange={(v) => (v && needsKeys(p) ? onOpen(p) : onToggle(p, v))} disabled={p.disabled_by_relay} label={`${p.enabled ? 'Turn off' : 'Turn on'} ${p.name}`} /> : null}
      </div>
    </div>
  )
  return (
    <>
      <div className="stools">
        <Search value={q} onChange={setQ} placeholder="Search apps" />
        <Tabs<ToneFilter> value={effTone} onChange={setTone} items={[
          { key: 'all', label: 'All', count: list.length },
          ...(counts.bad ? [{ key: 'bad' as ToneFilter, label: 'Errors', count: counts.bad }] : []),
          ...(counts.need ? [{ key: 'need' as ToneFilter, label: 'Needs attention', count: counts.need }] : []),
          ...(counts.ok ? [{ key: 'ok' as ToneFilter, label: 'Connected', count: counts.ok }] : []),
        ]} />
      </div>
      {!shown.length ? <div className="empty"><b>Nothing matches</b></div> : null}
      {mine.length ? <><div className="ssec"><h2>Set up</h2><span>{mine.length}</span></div><div className="card flow">{mine.map(row)}</div></> : null}
      {rest.length ? <><div className="ssec"><h2>{mine.length ? 'More apps' : 'Apps'}</h2><span>{rest.length}</span></div><div className="card flow">{rest.map(row)}</div></> : null}
    </>
  )
}
