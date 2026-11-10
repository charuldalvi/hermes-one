// Accounts: providers you sign in to instead of pasting a key (Nous Portal, ChatGPT, xAI Grok,
// MiniMax…). Signed-in ones first, the rest behind "Connect another". Signing in runs the
// provider's own flow: a code you enter in the browser (device code), a code you paste back (PKCE),
// or a command for the provider's own app (external). Token previews are never shown.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../../lib/api'
import { oauthCancel, oauthDisconnect, oauthList, oauthPoll, oauthStart, oauthSubmit, type OAuthPoll, type OAuthProvider } from '../../../lib/api-config'
import { toast } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { Badge, confirm, Dialog, Empty, ErrorLine, Logo, Spinner, useAsync } from '../../ui'
import { copyText, errText, openLink, SkeletonCard } from './keys-shared'

const connected = (p: OAuthProvider) => !!p.status?.logged_in && p.status?.free_tier !== true
const FLOW_WORDS: Record<string, string> = {
  device_code: 'Sign in through your browser with a short code.',
  pkce: 'Sign in through your browser, then paste the code it gives you.',
  external: 'Signed in through its own app on this Mac.',
}

function when(v?: string | number | null): string | null {
  if (v === null || v === undefined || v === '') return null
  const d = new Date(typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : v)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function AccountsTab({ profile, botName, onCount }: { profile: string; botName: string; onCount: (n: number) => void }) {
  const { data, error, loading, reload } = useAsync(() => oauthList(profile), [profile])
  const [showAll, setShowAll] = useState(false)
  const [signing, setSigning] = useState<OAuthProvider | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { if (data) onCount(data.filter(connected).length) }, [data, onCount])

  const list = data ?? []
  const on = list.filter(connected)
  const off = list.filter((p) => !connected(p))
  const othersShown = !on.length || showAll

  const signOut = async (p: OAuthProvider) => {
    const ok = await confirm({ title: `Sign out of ${p.name}?`, body: `${botName} forgets this sign-in. Models from ${p.name} stop working until you sign in again.`, action: 'Sign out', danger: true })
    if (!ok) return
    setBusy(p.id)
    try { await oauthDisconnect(profile, p.id); toast(`Signed out of ${p.name}.`); await reload(true) } catch (e) { toast(`Couldn’t sign out: ${errText(e)}`) } finally { setBusy(null) }
  }

  const row = (p: OAuthProvider) => {
    const st = p.status ?? { logged_in: false }
    const isOn = connected(p)
    const canOut = p.disconnectable ?? p.flow !== 'external'
    const until = st.has_refresh_token ? 'Renews itself' : when(st.expires_at) ? `Until ${when(st.expires_at)}` : null
    const facts = [st.source_label, until, st.account_tier ? `${st.account_tier} plan` : null].filter(Boolean).join(' · ')
    return (
      <div className="srow ky-acct" key={p.id}>
        <Logo name={p.name} size={32} />
        <div className="tx">
          <div className="t1">
            <span>{p.name}</span>
            {isOn ? <Badge tone="ok"><Icon name="check" size={12} />Signed in</Badge> : st.free_tier ? <Badge tone="quiet">Free tier</Badge> : null}
            {st.error ? <Badge tone="bad">Problem</Badge> : null}
          </div>
          <div className="t2">{st.error ? st.error : isOn || st.free_tier ? facts || FLOW_WORDS[p.flow] : FLOW_WORDS[p.flow] ?? ''}</div>
          {isOn && !canOut && p.disconnect_hint ? <div className="ky-tools">{p.disconnect_hint}</div> : null}
        </div>
        <div className="act">
          {busy === p.id ? <Spinner /> : null}
          {p.docs_url ? <button className="x-icon-btn" title="About this provider" aria-label="About this provider" onClick={() => openLink(p.docs_url)}><Icon name="external" size={15} /></button> : null}
          {isOn && !canOut && p.disconnect_command ? <button className="b-text x-btn-sm" onClick={() => void copyText(p.disconnect_command!, 'Copied the sign-out command. Paste it in Terminal.')}><Icon name="copy" size={13} /> Sign-out command</button> : null}
          {isOn && canOut ? <button className="b-ghost-danger x-btn-sm" disabled={busy === p.id} onClick={() => void signOut(p)}>Sign out</button> : null}
          <button className={`${isOn ? 'b-text' : 'b-soft'} x-btn-sm`} disabled={busy === p.id} onClick={() => setSigning(p)}>{isOn ? 'Sign in again' : st.free_tier ? 'Sign in' : 'Connect'}</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="x-note">Sign in with an account you already pay for, so {botName} can use its models without an API key.</div>
      {error ? <ErrorLine text={`Couldn’t read sign-ins: ${error}`} onRetry={() => void reload()} /> : null}
      {!data && loading ? <SkeletonCard rows={4} /> : null}
      {data && !list.length ? <Empty title="No accounts to sign in to" body="This Hermes has no sign-in providers. Use API keys instead." face={false} /> : null}
      {on.length ? <><div className="ssec"><h2>Signed in</h2><span>{on.length}</span></div><div className="card flow">{on.map(row)}</div></> : null}
      {off.length ? (
        <>
          {on.length ? (
            <button className="ky-more ky-more-list" onClick={() => setShowAll(!showAll)}>
              <Icon name="chevR" size={13} className={`x-chev${showAll ? ' open' : ''}`} />{showAll ? 'Hide other accounts' : `Connect another account (${off.length})`}
            </button>
          ) : <div className="ssec"><h2>Accounts you can connect</h2><span>{off.length}</span></div>}
          {othersShown ? <div className="card flow x-reveal">{off.map(row)}</div> : null}
        </>
      ) : null}
      {signing ? <SignIn profile={profile} provider={signing} botName={botName} onClose={() => setSigning(null)} onDone={() => void reload(true)} /> : null}
    </>
  )
}

type Phase =
  | { k: 'starting' }
  | { k: 'device'; session: string; code: string; url: string; expires: number }
  | { k: 'pkce'; session: string; url: string }
  | { k: 'external' }
  | { k: 'done'; text: string }
  | { k: 'failed'; text: string }

const END_WORDS: Record<string, string> = {
  denied: 'The provider said no. Nothing changed.',
  expired: 'The code ran out of time. Start again to get a new one.',
  cancelled: 'Sign-in stopped.',
  error: 'The sign-in didn’t finish.',
}

/** The sign-in for one provider, from start to "Signed in". Closing it stops a pending sign-in. */
function SignIn({ profile, provider, botName, onClose, onDone }: { profile: string; provider: OAuthProvider; botName: string; onClose: () => void; onDone: () => void }) {
  const [open, setOpen] = useState(true)
  const [phase, setPhase] = useState<Phase>(provider.flow === 'external' ? { k: 'external' } : { k: 'starting' })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const run = useRef(0)
  const session = useRef<string | null>(null)

  const finish = useCallback((r: OAuthPoll | null, fallback?: string) => {
    session.current = null
    if (r?.status === 'approved') {
      const who = r.account_email ? ` as ${r.account_email}` : ''
      const model = r.model ? ` New chats use ${r.model}.` : ''
      setPhase({ k: 'done', text: `Signed in to ${provider.name}${who}.${model}` })
      toast(`Signed in to ${provider.name}.`)
      onDone()
    } else {
      setPhase({ k: 'failed', text: r?.error_message || END_WORDS[r?.status ?? 'error'] || fallback || END_WORDS.error })
    }
  }, [provider.name, onDone])

  const poll = useCallback(async (n: number, sid: string) => {
    let misses = 0
    while (run.current === n) {
      try {
        const r = await oauthPoll(profile, provider.id, sid, 20)
        if (run.current !== n) return
        misses = 0
        if (r.status !== 'pending') return finish(r)
      } catch (e) {
        if (run.current !== n) return
        if (e instanceof ApiError && e.status === 404) return finish({ session_id: sid, status: 'expired' })
        if (++misses >= 3) return finish(null, `Hermes stopped answering: ${errText(e)}`)
        await new Promise((res) => setTimeout(res, 2000))
      }
    }
  }, [profile, provider.id, finish])

  const start = useCallback(async () => {
    const n = ++run.current
    setPhase({ k: 'starting' }); setCode('')
    try {
      const r = await oauthStart(profile, provider.id)
      if (run.current !== n) { void oauthCancel(profile, r.session_id); return }
      session.current = r.session_id
      if (r.flow === 'device_code') {
        setPhase({ k: 'device', session: r.session_id, code: r.user_code, url: r.verification_url, expires: r.expires_in })
        openLink(r.verification_url)
        void poll(n, r.session_id)
      } else {
        setPhase({ k: 'pkce', session: r.session_id, url: r.auth_url })
        openLink(r.auth_url)
      }
    } catch (e) {
      if (run.current === n) setPhase({ k: 'failed', text: errText(e) })
    }
  }, [profile, provider.id, poll])

  useEffect(() => {
    if (provider.flow !== 'external') void start()
    return () => { run.current++; if (session.current) void oauthCancel(profile, session.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = () => {
    run.current++
    if (session.current) { void oauthCancel(profile, session.current); session.current = null }
    setOpen(false)
    setTimeout(onClose, 170)
  }

  const submit = async () => {
    if (phase.k !== 'pkce' || !code.trim()) return
    setBusy(true)
    try {
      const r = await oauthSubmit(profile, provider.id, phase.session, code.trim())
      if (r.ok && r.status === 'approved') finish({ session_id: phase.session, status: 'approved' })
      else setPhase({ k: 'failed', text: r.message || 'The provider didn’t accept that code.' })
    } catch (e) { setPhase({ k: 'failed', text: errText(e) }) } finally { setBusy(false) }
  }

  const checkAgain = async () => {
    setBusy(true)
    try {
      const list = await oauthList(profile)
      const now = list.find((p) => p.id === provider.id)
      if (now?.status?.logged_in) { setPhase({ k: 'done', text: `${provider.name} is signed in.` }); onDone() }
      else toast(`${provider.name} isn’t signed in yet.`)
    } catch (e) { toast(`Couldn’t check: ${errText(e)}`) } finally { setBusy(false) }
  }

  const footer = (
    <>
      <span className="sp" />
      {phase.k === 'done' ? <button className="b-pri" onClick={close}>Done</button> : (
        <>
          <button className="b-text" onClick={close}>{phase.k === 'failed' ? 'Close' : 'Cancel'}</button>
          {phase.k === 'failed' && provider.flow !== 'external' ? <button className="b-pri" onClick={() => void start()}>Try again</button> : null}
          {phase.k === 'device' ? <button className="b-pri" onClick={() => openLink(phase.url)}>Open the sign-in page</button> : null}
          {phase.k === 'pkce' ? <button className="b-pri" disabled={busy || !code.trim()} onClick={() => void submit()}>{busy ? <Spinner size={13} /> : null}Sign in</button> : null}
          {phase.k === 'external' ? <button className="b-pri" disabled={busy} onClick={() => void checkAgain()}>{busy ? <Spinner size={13} /> : null}Check again</button> : null}
        </>
      )}
    </>
  )

  return (
    <Dialog open={open} onClose={close} width={480} title={<><Logo name={provider.name} size={26} /><span>Sign in to {provider.name}</span></>} footer={footer}>
      <div className="ky-signin">
        {phase.k === 'starting' ? <div className="ky-wait"><Spinner /><span>Asking {provider.name} for a sign-in code…</span></div> : null}
        {phase.k === 'device' ? (
          <>
            <p>Your browser opened {provider.name}’s sign-in page. Enter this code there:</p>
            <div className="x-bigcode">{phase.code}</div>
            <div className="x-row"><button className="b-text x-btn-sm" onClick={() => void copyText(phase.code, 'Copied the code.')}><Icon name="copy" size={13} /> Copy code</button><span className="sp" /><span className="x-quiet ky-small">{phase.url.replace(/^https?:\/\//, '')}</span></div>
            <div className="ky-wait"><Spinner size={13} /><span>Waiting for you to finish in the browser.{phase.expires ? ` The code works for about ${Math.max(1, Math.round(phase.expires / 60))} minutes.` : ''}</span></div>
          </>
        ) : null}
        {phase.k === 'pkce' ? (
          <>
            <p>Your browser opened {provider.name}. After you approve, it shows a code. Paste it here:</p>
            <input className="answer mono" autoFocus placeholder="Paste the code" value={code} autoComplete="off" spellCheck={false}
              onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
            <button className="x-link ky-small" onClick={() => openLink(phase.url)}>Open the page again</button>
          </>
        ) : null}
        {phase.k === 'external' ? (
          <>
            <p>{provider.name} signs in through its own app, not here. Open Terminal and run:</p>
            <div className="ky-cmd"><div className="x-code">{provider.cli_command}</div>
              <button className="x-icon-btn" title="Copy" aria-label="Copy" onClick={() => void copyText(provider.cli_command, 'Copied. Paste it in Terminal.')}><Icon name="copy" size={15} /></button></div>
            <p className="x-quiet">When it says you’re signed in, come back and press Check again. {botName} picks it up straight away.</p>
            {provider.docs_url ? <button className="x-link ky-small" onClick={() => openLink(provider.docs_url)}>How {provider.name} sign-in works</button> : null}
          </>
        ) : null}
        {phase.k === 'done' ? <div className="ky-end ok"><span className="okb"><Icon name="check" size={12} /></span><span>{phase.text}</span></div> : null}
        {phase.k === 'failed' ? <div className="ky-end bad"><i className="dot bad" /><span>{phase.text}</span></div> : null}
      </div>
    </Dialog>
  )
}
