// Setups that finish on your phone: Telegram quick setup (Hermes makes the bot for you), linking
// WhatsApp (scan a code in WhatsApp › Linked devices), and Team Gateway account links (message the
// shared bot a one-time code). Each shows a QR code and a link that works on this Mac too.
import { useEffect, useRef, useState } from 'react'
import {
  relay, relayLink, relayLinkState, relayUnlink, telegramApply, telegramCancel, telegramStart, telegramStatus,
  whatsappApply, whatsappCancel, whatsappStart, whatsappStatus, type Platform, type RelayCode, type RestartOutcome, type TelegramStart, type WhatsAppSession,
} from '../../../lib/api-system'
import { toast } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { Badge, confirm, Select, Spinner, useAsync } from '../../ui'
import { copy, errText, open, Warn } from './parts'
import { QrCode } from './qr'

function useCountdown(expiresAt?: string | null) {
  const [, tick] = useState(0)
  useEffect(() => { if (!expiresAt) return; const id = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(id) }, [expiresAt])
  const left = expiresAt ? Date.parse(expiresAt) - Date.now() : NaN
  if (!Number.isFinite(left)) return ''
  if (left <= 0) return 'expired'
  const s = Math.ceil(left / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const Box = ({ children }: { children: React.ReactNode }) => <div className="card" style={{ padding: 14, display: 'grid', gap: 12 }}>{children}</div>

// ---------- Telegram ----------

export function TelegramSetup({ profile, platform, onApplied }: { profile: string; platform: Platform; onApplied: (r: RestartOutcome) => void }) {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'waiting' | 'ready' | 'applying'>('idle')
  const [setup, setSetup] = useState<TelegramStart | null>(null)
  const [bot, setBot] = useState<string | null>(null)
  const [ids, setIds] = useState<string[]>([])
  const [owner, setOwner] = useState<string | null>(null)
  const [add, setAdd] = useState('')
  const [error, setError] = useState('')
  const left = useCountdown(setup?.expires_at)
  const live = useRef(true)
  const pending = useRef<string | null>(null)
  pending.current = setup && phase !== 'applying' ? setup.pairing_id : null
  // Closing the page mid-setup gives the pairing back instead of leaving it to expire.
  useEffect(() => () => { live.current = false; if (pending.current) void telegramCancel(profile, pending.current).catch(() => undefined) }, [profile])

  useEffect(() => {
    if (!setup || phase !== 'waiting') return
    let stop = false, timer = 0
    const poll = async () => {
      try {
        const s = await telegramStatus(profile, setup.pairing_id)
        if (stop) return
        if (s.status === 'ready') {
          setPhase('ready'); setBot(s.bot_username ?? null); setError('')
          if (s.owner_user_id && /^\d{3,20}$/.test(s.owner_user_id)) { setOwner(s.owner_user_id); setIds([s.owner_user_id]) }
          return
        }
      } catch (e) {
        if (stop) return
        if (/\b410\b|expired|claimed|gone/i.test(errText(e)) || Date.parse(setup.expires_at) <= Date.now()) { setSetup(null); setPhase('idle'); setError('That code expired. Make a new one.'); return }
      }
      timer = window.setTimeout(() => void poll(), 2000)
    }
    timer = window.setTimeout(() => void poll(), 1200)
    return () => { stop = true; window.clearTimeout(timer) }
  }, [setup, phase, profile])

  const start = async () => {
    setPhase('starting'); setError(''); setBot(null); setIds([]); setOwner(null)
    try { const r = await telegramStart(profile); if (!r?.pairing_id) throw new Error('Hermes didn’t start a setup. Try again.'); if (live.current) { setSetup(r); setPhase('waiting') } } catch (e) { setPhase('idle'); setError(errText(e)) }
  }
  const cancel = async () => { if (setup) await telegramCancel(profile, setup.pairing_id).catch(() => undefined); setSetup(null); setPhase('idle'); setError('') }
  const addId = () => { const t = add.trim(); if (!/^\d{3,20}$/.test(t)) { setError('A Telegram user ID is only digits, like 123456789.'); return } setError(''); setIds((x) => (x.includes(t) ? x : [...x, t])); setAdd('') }
  const apply = async () => {
    if (!setup) return
    if (!ids.length) { setError('Add at least one Telegram user ID, or nobody can reach your agent there.'); return }
    setPhase('applying'); setError('')
    try { const r = await telegramApply(profile, setup.pairing_id, ids); setSetup(null); setPhase('idle'); onApplied({ ...r, bot_username: r.bot_username ?? bot }) } catch (e) { setPhase('ready'); setError(errText(e)) }
  }

  return (
    <Box>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sy-inline" style={{ color: 'var(--text-primary)' }}><b style={{ fontWeight: 500 }}>Quick setup</b><Badge tone="ok">Easiest</Badge></div>
          <div className="sy-note" style={{ margin: '4px 0 0' }}>Hermes makes your agent’s Telegram account for you. Scan a code with your phone (or open the link here), confirm in Telegram, and it finds your user ID by itself.</div>
          {platform.configured && phase === 'idle' ? <div className="sy-note" style={{ margin: '6px 0 0' }}>Telegram is already set up; a new account replaces the current one when you save.</div> : null}
        </div>
        {phase === 'idle' || phase === 'starting' ? <button className="b-soft" onClick={() => void start()} disabled={phase === 'starting'}>{phase === 'starting' ? 'Starting…' : 'Set it up with a QR code'}</button> : null}
      </div>
      {error ? <div className="sy-err">{error}</div> : null}
      {setup ? (
        <div className="sy-reveal" style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <QrCode text={setup.qr_payload || setup.deep_link} label="QR code for Telegram setup" />
          <div style={{ flex: 1, minWidth: 220, display: 'grid', gap: 10, alignContent: 'start' }}>
            {phase === 'waiting' ? <>
              <div className="sy-inline"><Spinner size={12} /><span>Waiting for Telegram…</span>{left ? <span className="sy-dim">· {left === 'expired' ? 'expired' : `expires in ${left}`}</span> : null}</div>
              <div className="sy-step"><span>1. Scan the code with your phone’s camera, or open the link on this Mac.</span><span>2. In Telegram, tap Start and confirm.</span></div>
              <div className="sy-inline"><button className="b-soft" onClick={() => open(setup.deep_link)}><Icon name="external" size={14} /> Open Telegram</button><button className="b-text" onClick={() => void cancel()}>Cancel</button></div>
            </> : <>
              <div className="sy-inline"><Badge tone="ok">Account made</Badge>{bot ? <span className="sy-mono">@{bot}</span> : null}</div>
              <div className="sy-f"><span className="lb">Who may talk to it{owner && ids.includes(owner) ? <Badge tone="quiet">You were found</Badge> : null}</span>
                <div className="sy-chips">{ids.map((id) => <button key={id} className="sy-chip on mono" onClick={() => setIds(ids.filter((x) => x !== id))} title="Remove"><span>{id}</span><Icon name="x" size={12} /></button>)}</div>
                <div className="sy-inline"><input className="answer mono" style={{ width: 200 }} value={add} placeholder="Telegram user ID" onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addId() }} /><button className="b-text" onClick={addId}>Add</button></div>
              </div>
              <div className="sy-inline"><button className="b-pri" onClick={() => void apply()} disabled={phase === 'applying'}>{phase === 'applying' ? 'Saving…' : 'Save and connect'}</button><button className="b-text" onClick={() => void cancel()}>Cancel</button></div>
            </>}
          </div>
        </div>
      ) : null}
    </Box>
  )
}

// ---------- WhatsApp ----------

export function WhatsAppSetup({ profile, onApplied }: { profile: string; onApplied: (r: RestartOutcome) => void }) {
  const [mode, setMode] = useState<'bot' | 'self-chat'>('bot')
  const [allowed, setAllowed] = useState('')
  const [s, setS] = useState<WhatsAppSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<string | null>(null)
  pending.current = s && s.status !== 'connected' && !['error', 'expired', 'cancelled'].includes(s.status) ? s.pairing_id : null
  useEffect(() => () => { if (pending.current) void whatsappCancel(profile, pending.current).catch(() => undefined) }, [profile])

  useEffect(() => {
    if (!s || !['installing', 'starting', 'waiting'].includes(s.status)) return
    const t = window.setTimeout(async () => {
      try { setS(await whatsappStatus(profile, s.pairing_id)) } catch (e) { setS((x) => (x ? { ...x, status: /410|expired/i.test(errText(e)) ? 'expired' : 'error', error: errText(e) } : x)) }
    }, 2000)
    return () => window.clearTimeout(t)
  }, [s, profile])

  const start = async (reset = false) => {
    setBusy(true); setError('')
    try { const r = await whatsappStart(profile, mode, allowed.trim(), reset); if (!r?.pairing_id) throw new Error('Hermes didn’t start WhatsApp setup. Try again.'); setS(r) } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  const cancel = async () => { if (s) await whatsappCancel(profile, s.pairing_id).catch(() => undefined); setS(null) }
  const apply = async () => {
    if (!s) return
    setBusy(true); setError('')
    try { const r = await whatsappApply(profile, s.pairing_id, mode, allowed.trim()); setS(null); onApplied(r) } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  const status = s?.status
  return (
    <Box>
      <div>
        <div className="sy-inline" style={{ color: 'var(--text-primary)' }}><b style={{ fontWeight: 500 }}>Link WhatsApp</b><Badge tone="ok">Easiest</Badge></div>
        <div className="sy-note" style={{ margin: '4px 0 0' }}>Hermes starts its WhatsApp bridge and shows a code. On your phone open WhatsApp › Settings › Linked devices › Link a device, and scan it.</div>
      </div>
      {!s ? (
        <div className="sy-form" style={{ paddingTop: 0 }}>
          <div className="sy-row2">
            <div className="sy-f"><span className="lb">How you’ll talk to it</span>
              <Select value={mode} onChange={(v) => setMode(v as 'bot' | 'self-chat')} width={300} options={[{ value: 'bot', label: 'It gets its own number', hint: 'a second phone or SIM' }, { value: 'self-chat', label: 'I message myself', hint: 'your own number' }]} />
            </div>
            <div className="sy-f"><span className="lb">Who may message it <em>optional</em></span>
              <input className="answer mono" value={allowed} onChange={(e) => setAllowed(e.target.value)} placeholder="+15551234567, +4479…" />
            </div>
          </div>
          <div className="sy-inline"><button className="b-soft" onClick={() => void start()} disabled={busy}>{busy ? 'Starting…' : 'Show the code'}</button><span className="sy-dim">Anyone else who messages it gets a code to ask you first.</span></div>
        </div>
      ) : (
        <div className="sy-reveal" style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {status === 'waiting' && s.qr_payload ? <QrCode text={s.qr_payload} label="QR code to link WhatsApp" /> : null}
          <div style={{ flex: 1, minWidth: 220, display: 'grid', gap: 10, alignContent: 'start' }}>
            {status === 'installing' || status === 'starting' ? <div className="sy-inline"><Spinner size={12} /><span>{status === 'installing' ? 'Getting WhatsApp ready. The first time takes a minute…' : 'Starting the WhatsApp bridge…'}</span></div> : null}
            {status === 'waiting' ? <div className="sy-inline"><Spinner size={12} /><span>Scan the code in WhatsApp › Linked devices. It refreshes by itself.</span></div> : null}
            {status === 'connected' ? <>
              <div className="sy-inline"><Badge tone="ok">Linked</Badge><span>{[s.account_name, s.account_phone].filter(Boolean).join(' · ') || 'WhatsApp is linked'}</span></div>
              <div className="sy-inline"><button className="b-pri" onClick={() => void apply()} disabled={busy}>{busy ? 'Saving…' : 'Save and connect'}</button><button className="b-text" onClick={() => void start(true)} disabled={busy}>Link a different phone</button></div>
            </> : null}
            {status === 'error' || status === 'expired' || status === 'cancelled' ? <>
              <div className="sy-err">{s.error || (status === 'expired' ? 'The code expired before it was scanned.' : 'WhatsApp setup stopped.')}</div>
              <div className="sy-inline"><button className="b-soft" onClick={() => void start()} disabled={busy}>Try again</button>{/in use|already|re-pair/i.test(s.error ?? '') ? <button className="b-text" onClick={() => void start(true)} disabled={busy}>Start over</button> : null}</div>
            </> : null}
            {status !== 'connected' ? <button className="b-text" style={{ justifySelf: 'start' }} onClick={() => void cancel()}>Cancel</button> : null}
          </div>
        </div>
      )}
      {error ? <div className="sy-err">{error}</div> : null}
    </Box>
  )
}

// ---------- Team Gateway (relay) ----------

export function RelayLink({ profile, platform }: { profile: string; platform: Platform }) {
  const info = useAsync(() => relay(profile), [profile])
  const row = info.data?.platforms.find((p) => p.platform === platform.id)
  const [code, setCode] = useState<RelayCode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const before = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!code) return
    let stop = false, timer = 0, fails = 0
    const poll = async () => {
      try {
        const st = await relayLinkState(profile, code.code)
        if (stop) return
        if (st.state === 'pending') { timer = window.setTimeout(() => void poll(), 3000); return }
        setCode(null)
        if (st.state === 'refused') { setError(`${platform.name} refused the link${st.reason ? `: ${st.reason}` : ''}. Get a new code and try again.`); return }
        const fresh = await relay(profile)
        info.setData(fresh)
        const now = fresh.platforms.find((p) => p.platform === platform.id)?.accounts ?? []
        if (now.some((a) => !before.current.has(a.platformUserId))) toast(`${platform.name} account linked. Message Hermes there to talk to your agent.`)
        else setError('That code is no longer active and no new account showed up. Get a new code and try again.')
      } catch { if (++fails >= 5 || (code.expires_at && Date.parse(code.expires_at) <= Date.now())) { setCode(null); setError('Lost track of the code. Get a new one and try again.') } else timer = window.setTimeout(() => void poll(), 3000) }
    }
    timer = window.setTimeout(() => void poll(), 3000)
    return () => { stop = true; window.clearTimeout(timer) }
  }, [code, profile])

  const link = async () => {
    setBusy(true); setError('')
    before.current = new Set((row?.accounts ?? []).map((a) => a.platformUserId))
    try { setCode(await relayLink(profile, platform.id)) } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  const unlink = async (id: string, label: string) => {
    if (!(await confirm({ title: `Unlink ${label}?`, body: `That ${platform.name} account stops reaching this agent through Hermes’ shared account.`, action: 'Unlink', danger: true }))) return
    try { await relayUnlink(profile, platform.id, id); toast('Unlinked'); void info.reload(true) } catch (e) { toast(`Couldn’t unlink it: ${errText(e)}`) }
  }
  const botUrl = code?.bot_url ?? row?.bot_url ?? null
  return (
    <Box>
      <div>
        <div className="sy-inline" style={{ color: 'var(--text-primary)' }}><b style={{ fontWeight: 500 }}>Nous’ shared gateway</b><Badge tone="ok">No token needed</Badge></div>
        <div className="sy-note" style={{ margin: '4px 0 0' }}>{info.data?.portal_url ? 'This agent’s accounts are linked from Nous Portal.' : `${platform.name} reaches this agent through Hermes’ shared account. Link your ${platform.name} account, then message Hermes there.`}</div>
      </div>
      {info.loading && !info.data ? <div className="sy-inline"><Spinner size={12} />Loading linked accounts…</div> : null}
      {info.error ? <div className="sy-err">Couldn’t load linked accounts: {info.error}</div> : null}
      {row?.accounts.length ? (
        <div className="card">{row.accounts.map((a) => (
          <div className="srow" key={a.platformUserId} style={{ minHeight: 44 }}>
            <div className="tx"><div className="t1"><span>{a.displayName || a.handle || a.platformUserId}</span></div>{a.handle && a.displayName ? <div className="t3">@{a.handle}</div> : null}</div>
            <button className="b-ghost-danger" onClick={() => void unlink(a.platformUserId, a.displayName || a.handle || a.platformUserId)}>Unlink</button>
          </div>
        ))}</div>
      ) : null}
      {info.data?.portal_url ? <div><button className="b-soft" onClick={() => open(info.data?.portal_url)}><Icon name="external" size={14} /> Link accounts in Nous Portal</button></div>
        : code ? (
          <div className="sy-reveal" style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {botUrl ? <QrCode text={botUrl} label={`QR code for Hermes on ${platform.name}`} /> : null}
            <div style={{ flex: 1, minWidth: 220, display: 'grid', gap: 10, alignContent: 'start' }}>
              <div className="sy-step"><span>1. Scan the code with your phone, or open Hermes in {platform.name}.</span><span>2. Send Hermes this message from the account you want to link:</span></div>
              <div className="sy-copy"><code>{code.command}</code><button className="b-text" style={{ height: 28 }} onClick={() => void copy(code.command, 'Copied the message')}>Copy</button></div>
              <div className="sy-inline">{botUrl ? <button className="b-soft" onClick={() => open(botUrl)}><Icon name="external" size={14} /> Open {platform.name}</button> : null}<Spinner size={12} /><span>Waiting for Hermes to see it. The code works once.</span></div>
            </div>
          </div>
        ) : <div><button className="b-soft" onClick={() => void link()} disabled={busy}>{busy ? 'Getting a code…' : row?.accounts.length ? `Link another ${platform.name} account` : `Link ${platform.name}`}</button></div>}
      {error ? <Warn bad>{error}</Warn> : null}
    </Box>
  )
}
