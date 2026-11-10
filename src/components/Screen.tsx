// The agent screen, a tab of the side panel's work view beside the chat (Work.tsx): the Linux desktop an agent
// drives on this system's Hermes, live, while you talk to the agent on the left (as Hermes' own desktop app
// opens it in a pane beside the chat). You watch; "Take over" gives you the mouse and keys (Hermes' lease), "Hand back" returns them,
// and the screen can be started or stopped. The picture is VNC (RFB) over Hermes' /api/display/ws, drawn by
// noVNC, as Hermes' desktop app does it (apps/desktop/src/plugins/hermes-bots/screen-pane.tsx).
import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../lib/gateway'
import { Icon } from '../lib/icons'
import { displayStatus, viewerHash, type DisplayStatus } from '../lib/screen'
import { Spinner } from './ui'

type Conn = 'idle' | 'connecting' | 'live' | 'lost'

export function ScreenView({ profile }: { profile: string }) {
  const [st, setSt] = useState<DisplayStatus | null>(null)
  const [conn, setConn] = useState<Conn>('idle')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mine, setMine] = useState<{ id: string; hash: string } | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const rfb = useRef<any>(null)
  const ws = useRef<WebSocket | null>(null)
  const generation = useRef(0)
  const stKey = useRef<string | undefined>(undefined)
  stKey.current = st?.profile_key

  const refresh = useCallback(async () => {
    try { setSt(await displayStatus(profile)); setError('') } catch (e: any) { setError(String(e?.message ?? e)) }
  }, [profile])

  const detach = () => {
    generation.current++
    try { rfb.current?.disconnect() } catch { /* already gone */ }
    rfb.current = null
    try { ws.current?.close() } catch { /* already gone */ }
    ws.current = null
  }

  // Watch it: a single-use ticket from display.observe opens the picture stream.
  const attach = useCallback(async () => {
    detach()
    const gen = generation.current
    setConn('connecting')
    try {
      const observe = await gateway.request<any>('display.observe', { profile, ...(mine ? { viewer_id: mine.id } : {}) }, 20_000)
      if (gen !== generation.current || !host.current) return
      const me = { id: String(observe.viewer_id), hash: await viewerHash(String(observe.viewer_id)) }
      setMine(me)
      setSt((old) => ({ ...(old ?? {} as DisplayStatus), ...observe }))
      const url = new URL(observe.path || '/api/display/ws', gateway.origin.replace(/^http/, 'ws'))
      url.searchParams.set('display_ticket', String(observe.ticket))
      const socket = new WebSocket(url.toString())
      socket.binaryType = 'arraybuffer'
      ws.current = socket
      const { default: RFB } = await import('@novnc/novnc')
      if (gen !== generation.current || !host.current) { socket.close(); return }
      const client = new RFB(host.current, socket, { shared: true })
      client.scaleViewport = true
      client.resizeSession = false
      client.focusOnClick = true
      client.background = 'transparent'
      client.qualityLevel = 7
      client.viewOnly = !(observe.lease?.holder === 'human' && observe.lease?.viewer_hash === me.hash)
      client.addEventListener('connect', () => { if (gen === generation.current) setConn('live') })
      client.addEventListener('disconnect', () => { if (gen === generation.current) setConn('lost') })
      rfb.current = client
    } catch (e: any) {
      if (gen === generation.current) { setConn('lost'); setError(String(e?.message ?? e).split('\n')[0]) }
    }
  }, [profile, mine])

  // Another agent's screen: start over on it (the pane stays, only what it shows changes).
  useEffect(() => { setSt(null); setConn('idle'); setMine(null); setError(''); void refresh(); return detach }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (st?.running && conn === 'idle') void attach() }, [st?.running, conn]) // eslint-disable-line react-hooks/exhaustive-deps
  // Hermes says when the screen or who holds it changes (another window, the phone, the agent).
  useEffect(() => {
    const off = gateway.onEvent((ev: any) => {
      // Events name the screen by profile_key (from display.status); another agent's screen isn't this one.
      const key = ev?.payload?.profile_key
      if (key && stKey.current && key !== stKey.current) return
      if (ev?.type === 'display.lease' && ev.payload?.lease) setSt((old) => (old ? { ...old, lease: ev.payload.lease } : old))
      else if (ev?.type === 'display.status') void refresh()
    })
    return () => { off() }
  }, [refresh, profile])
  const iHold = !!(st?.lease?.holder === 'human' && mine && st.lease.viewer_hash === mine.hash)
  useEffect(() => { if (rfb.current) rfb.current.viewOnly = !iHold }, [iHold])

  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn() } catch (e: any) { setError(String(e?.message ?? e).split('\n')[0]) } finally { setBusy(false); void refresh() } }
  const start = () => act(async () => { await gateway.request('display.start', { profile }, 120_000); setConn('idle') })
  const stop = () => act(async () => { detach(); setConn('idle'); await gateway.request('display.stop', { profile, ...(mine ? { viewer_id: mine.id } : {}) }, 60_000) })
  const take = () => act(async () => { if (mine) await gateway.request('display.lease.acquire', { profile, viewer_id: mine.id, reason: 'Hermes One' }, 15_000) })
  const give = () => act(async () => { if (mine) await gateway.request('display.lease.release', { profile, viewer_id: mine.id }, 15_000) })

  const who = st?.lease?.holder === 'human' ? (iHold ? 'You have the mouse and keys' : 'Someone else has it') : 'The agent is using it'
  return (
    <>
      {st?.running ? (
        <div className="scr-bar">
          <span className="scr-chip"><i className={conn === 'live' ? 'ok' : conn === 'lost' ? 'bad' : 'run'} />{conn === 'live' ? who : conn === 'lost' ? 'Not showing' : 'Opening…'}</span>
          <span className="sp" />
          {conn === 'lost' ? <button className="b-soft sm" onClick={() => void attach()}>Show again</button>
            : iHold ? <button className="b-soft sm" disabled={busy} onClick={() => void give()}>Hand back</button>
            : <button className="b-soft sm" disabled={busy || conn !== 'live'} onClick={() => void take()}>Take over</button>}
          <button className="b-text sm" disabled={busy} onClick={() => void stop()}>Stop the screen</button>
        </div>
      ) : null}
      <div className="scr-stage">
        {st?.running ? <div className="scr-host" ref={host} /> : (
          <div className="scr-empty">
            <Icon name="screen" size={28} />
            {!st ? (error ? <p>{error}</p> : <Spinner size={18} />)
              : !st.supported ? <p>This system’s Hermes has no agent screen. Hermes shows one on Linux computers, like a VPS.</p>
              : !st.installed ? <><p>The screen isn’t set up on this system yet{st.missing?.length ? ` (it needs ${st.missing.join(', ')})` : ''}.</p>{st.install_command ? <code className="scr-cmd">{st.install_command}</code> : null}<p className="scr-quiet">Run that on the system itself; Hermes asks for the administrator password there.</p></>
              : <><p>The screen is off.{st.blocker ? ` ${st.blocker}` : ''}</p><button className="b-pri" disabled={busy || !!st.blocker} onClick={() => void start()}>{busy ? <><Spinner size={13} /> Starting…</> : 'Start the screen'}</button></>}
          </div>
        )}
        {error && st?.running ? <p className="scr-err">{error}</p> : null}
      </div>
    </>
  )
}
