// Web access: open Hermes on this Mac from your phone or another computer, signed in with your Nous
// account, on your own network or through an HTTPS address you already run. It's for the whole Mac,
// not one bot. Starting it can build the web app first, which takes a few minutes.
import { useEffect, useRef, useState } from 'react'
import { restartWebAccess, startWebAccess, stopWebAccess, webAccess, type WebAccess, type WebAccessChange } from '../../../lib/api-system'
import { toast } from '../../../lib/hermes'
import { setState } from '../../../lib/store'
import { Badge, confirm, ErrorLine, Spinner, Tabs, useAsync } from '../../ui'
import { CopyValue, duration, errText, Field, isTimeout, open, usePoll, Warn } from './parts'

type Phase = 'off' | 'pendingOn' | 'pendingOff' | 'serving' | 'unavailable'
function servesConfig(s: WebAccess) {
  if (!s.enabled || s.gateway.state !== 'serving' || !s.gateway.url) return false
  try { return new URL(s.gateway.url).port === String(s.port) } catch { return false }
}
function phaseOf(s: WebAccess): Phase {
  if (!s.enabled) return s.gateway.state === 'serving' ? 'pendingOff' : 'off'
  if (servesConfig(s)) return 'serving'
  return s.gateway.state === 'unavailable' ? 'unavailable' : 'pendingOn'
}
const STEPS: Record<string, string> = {
  preparing: 'Getting the web app ready. Building it can take a few minutes.',
  building: 'Building the web app. This can take a few minutes.',
  registering: 'Setting up Nous sign-in for this address.',
  restarting: 'Restarting messaging so it serves the web app.',
}

export function WebAccessTab() {
  const { data, error, loading, reload, setData } = useAsync(() => webAccess(), [])
  const [busy, setBusy] = useState<'start' | 'stop' | 'restart' | null>(null)
  const [since, setSince] = useState(0)
  const [mode, setMode] = useState<'lan' | 'public'>('lan')
  const [publicUrl, setPublicUrl] = useState('')
  const [, tick] = useState(0)
  const seeded = useRef(false)
  useEffect(() => { if (data && !seeded.current) { seeded.current = true; setMode(data.mode === 'public' ? 'public' : 'lan'); setPublicUrl(data.public_url ?? '') } }, [data])
  const following = !!busy || !!data?.start_progress
  usePoll(() => void reload(true), following ? 2000 : 15_000)
  useEffect(() => { if (!following) return; const id = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(id) }, [following])

  /** Waits until the restarted gateway serves what was saved (or says why it can't). */
  const settle = async (r: WebAccessChange | null, what: string) => {
    if (r) setData(r)
    if (r && r.restart_started === false) {
      toast(r.restart_busy ? 'Saved. A chat is running, so messaging didn’t restart. Choose Restart once it ends.' : 'Saved, but messaging couldn’t restart. Choose Restart to try again.')
      return
    }
    for (const end = Date.now() + 120_000; Date.now() < end;) {
      await new Promise((res) => setTimeout(res, 2000))
      const s = await webAccess().catch(() => null)
      if (!s) continue
      setData(s)
      if (r?.restart_pid && s.restart_failure?.pid === r.restart_pid) { toast(`Messaging couldn’t restart: ${s.restart_failure.reason}`); return }
      const ph = phaseOf(s)
      if (ph !== 'pendingOn' && ph !== 'pendingOff' && !s.start_progress) { toast(ph === 'serving' ? 'Web access is on' : ph === 'off' ? 'Web access is off' : `${what} didn’t finish`); return }
    }
    toast(`${what} is taking longer than expected. It keeps going; check back in a minute.`)
  }
  const run = async (kind: 'start' | 'stop' | 'restart', fn: () => Promise<WebAccessChange>, what: string) => {
    setBusy(kind); setSince(Date.now())
    try { await settle(await fn(), what) } catch (e) {
      if (isTimeout(e)) await settle(null, what)
      else toast(`Couldn’t change web access: ${errText(e)}`)
    } finally { setBusy(null); void reload(true) }
  }
  const start = async () => {
    if (!(await confirm({ title: 'Turn on web access?', body: 'Whoever signs in with your Nous account can use Hermes on this Mac, including running commands on it. Messaging restarts to do it.', action: 'Turn on' }))) return
    void run('start', () => startWebAccess(mode, mode === 'public' ? publicUrl.trim() : undefined), 'Starting web access')
  }
  const stop = async () => {
    if (!(await confirm({ title: 'Turn off web access?', body: 'Phones and other computers can’t open Hermes on this Mac until you turn it on again. Messaging restarts to do it.', action: 'Turn off' }))) return
    void run('stop', () => stopWebAccess(), 'Stopping web access')
  }

  if (loading && !data) return <div className="empty"><Spinner size={18} /><span>Checking web access…</span></div>
  if (error && !data) return <ErrorLine text={`Couldn’t check web access: ${error}`} onRetry={() => void reload()} />
  if (!data) return null
  const phase = phaseOf(data)
  const lanUrl = data.lan_address ? `http://${data.lan_address}:${data.port}` : null
  const url = data.mode === 'public' ? data.public_url : data.mode === 'local' ? `http://127.0.0.1:${data.port}` : data.gateway.url || lanUrl || ''
  const ready = data.nous_signed_in && (mode === 'lan' ? !!lanUrl : publicUrl.trim().startsWith('https://'))
  const step = data.start_progress?.step ?? (busy === 'start' ? 'preparing' : null)
  const startedAt = data.start_progress?.started_at ? data.start_progress.started_at * 1000 : since
  const pill = busy === 'start' || data.start_progress ? <Badge tone="run"><i className="dot run" />Starting</Badge> : busy === 'stop' ? <Badge tone="run">Stopping</Badge>
    : phase === 'serving' ? <Badge tone="ok"><i className="dot ok" />On</Badge> : phase === 'off' ? <Badge tone="quiet">Off</Badge> : phase === 'unavailable' ? <Badge tone="bad">Unavailable</Badge> : <Badge tone="need">Restart needed</Badge>
  return (
    <>
      <p className="free">Open Hermes on this Mac from your phone or another computer, signed in with your Nous account. This is for the whole Mac, not just one agent.</p>
      <div className="card">
        <div className="srow">
          <div className="tx">
            <div className="t1"><span>Web access</span>{pill}</div>
            <div className="t2">{phase === 'serving' ? (data.mode === 'public' ? 'Served through your own address.' : data.mode === 'local' ? 'Only this Mac can open it. Turn it off and on again to open it from other devices.' : 'Open this address on a device on the same Wi-Fi.')
              : phase === 'off' ? (data.nous_signed_in ? 'Turn it on to open Hermes from another device.' : 'Sign in to your Nous account first, in Keys and accounts.')
              : phase === 'pendingOn' ? 'Saved. Messaging serves the web app once it restarts.' : phase === 'pendingOff' ? 'Turned off, but it keeps being served until messaging restarts.'
              : `Hermes couldn’t serve the web app${data.gateway.reason ? `: ${data.gateway.reason}` : '.'}`}</div>
          </div>
          <div className="act">
            {phase === 'off' ? null : phase === 'serving' || phase === 'unavailable' ? <button className="b-soft" onClick={() => void stop()} disabled={!!busy}>Turn off</button>
              : <button className="b-soft" onClick={() => void run('restart', () => restartWebAccess(), 'Restarting')} disabled={!!busy}>Restart messaging</button>}
          </div>
        </div>
        {step ? <div className="srow"><Spinner size={13} /><div className="tx"><div className="t2">{STEPS[step] ?? 'Working…'}</div><div className="t3" style={{ fontFamily: 'inherit' }}>{duration((Date.now() - startedAt) / 1000)} so far</div></div></div> : null}
        {phase === 'serving' && url ? <div style={{ padding: '0 16px 14px', display: 'flex', gap: 8, alignItems: 'center' }}><div style={{ flex: 1, minWidth: 0 }}><CopyValue value={url} what="Copied the address" /></div><button className="b-text" onClick={() => open(url)}>Open</button></div> : null}
        {data.restart_failure ? <div style={{ padding: '0 16px 14px' }}><Warn bad><b>The last restart failed.</b> {data.restart_failure.reason}</Warn></div> : null}
      </div>

      {phase === 'off' && !busy && !data.start_progress ? (
        <>
          <div className="ssec"><h2>Where to open it</h2></div>
          <div className="card" style={{ padding: 16 }}>
            <div className="sy-form" style={{ paddingTop: 0 }}>
              <Tabs<'lan' | 'public'> value={mode} onChange={setMode} items={[{ key: 'lan', label: 'This network' }, { key: 'public', label: 'My own address' }]} />
              {mode === 'lan' ? (
                lanUrl ? <div className="sy-note" style={{ margin: 0 }}>Devices on your Wi-Fi open <span className="sy-mono" style={{ color: 'var(--text-primary)' }}>{lanUrl}</span>. Use it only on a network you trust: the connection isn’t encrypted, so others on it could read what you send.</div>
                  : <div className="sy-note" style={{ margin: 0 }}>This Mac has no network address other devices can reach.</div>
              ) : (
                <Field label="Your HTTPS address" hint={`One you already run, like Tailscale Serve or a tunnel, forwarding to http://127.0.0.1:${data.port}.`}>
                  <input className="answer mono" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="https://mac-mini.tailnet.ts.net" />
                </Field>
              )}
              {!data.nous_signed_in ? <Warn action={<button className="b-text" onClick={() => setState({ settingsPage: 'keys' })}>Keys and accounts</button>}>Sign in to your Nous account first. People sign in with it to open Hermes.</Warn> : null}
              <div><button className="b-pri" onClick={() => void start()} disabled={!ready}>Turn on web access</button></div>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}
