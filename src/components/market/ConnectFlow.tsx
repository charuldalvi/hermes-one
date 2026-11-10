// Following a connect started from the Connectors page or the Marketplace (Hermes Remote's
// ConnectorsConnecting.kt): it opens the sign-in page in the browser, follows Hermes' operation (polling,
// `connection.update` frames, and a wake when you come back to the app), then checks the app's tools.
import { useEffect, useRef, useState } from 'react'
import {
  cancelSignIn, connectManaged, connectorTools, giveUp, mcpTest, mergeOp, onAccountUpdate, opStatus, plain, plural,
  serverSignIn, signInDone, signInFailed, signInStatus, targetConnected, targetDead, wakeOp, type ConnectionOp,
} from '../../lib/api-market'
import { Dialog } from '../ui'
import { Bridge, BridgeLogo, openLink, Steps, type Mark, type Stage } from './parts'

/** A connect the flow follows: a managed app (new, a named account, or a repair) or a server's OAuth sign-in. */
export type ConnectRequest =
  | { kind: 'hosted'; name: string; logo?: string; slug: string; reconnect?: boolean; alias?: string; connectionId?: string }
  | { kind: 'server'; name: string; logo?: string; server: string; profile: string }

function marks(stage: Stage): Mark[] {
  switch (stage) {
    case 'opening': return ['current', 'pending', 'pending']
    case 'waiting': return ['done', 'current', 'pending']
    case 'checking': return ['done', 'done', 'current']
    case 'done': return ['done', 'done', 'done']
    case 'failed': return ['done', 'failed', 'pending']
  }
}

export function ConnectFlow({ request, onClose }: { request: ConnectRequest; onClose: (connected: boolean) => void }) {
  const [stage, setStageV] = useState<Stage>('opening')
  const [detail, setDetail] = useState<string | undefined>()
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState(true)
  const stageRef = useRef<Stage>('opening')
  const opRef = useRef<ConnectionOp | null>(null)
  const linkRef = useRef<string | undefined>(undefined)
  const openedRef = useRef(false)
  const flowRef = useRef<string | undefined>(undefined)
  const [, bump] = useState(0)
  const setStage = (s: Stage) => { stageRef.current = s; setStageV(s) }
  /** The stage right now (a function, so TypeScript doesn't narrow it across awaits). */
  const now = (): Stage => stageRef.current

  const closed = useRef(false)
  const close = (ok: boolean) => { if (closed.current) return; closed.current = true; setOpen(false); setTimeout(() => onClose(ok), 170) }
  const finish = () => { setStage('done'); setTimeout(() => close(true), 1600) }
  const verify = async (count: () => Promise<number | undefined>) => {
    setStage('checking')
    const n = await count().catch(() => undefined)
    setDetail(n !== undefined ? `${plural(n, 'tool')} ready for Hermes.` : undefined)
    finish()
  }

  // A managed app: start the connect, then follow its operation until it settles.
  useEffect(() => {
    if (request.kind !== 'hosted') return
    let stop = false
    const r = request
    const follow = (next: ConnectionOp, broadcast = false) => {
      const o = mergeOp(opRef.current, next, broadcast)
      opRef.current = o
      const t = o.targets.find((x) => x.name === r.slug) ?? o.targets[0]
      if (!t) return
      if (t.connectUrl) {
        linkRef.current = t.connectUrl
        // The link can come a moment after the connect starts: open it as soon as it does.
        if (!openedRef.current && stageRef.current === 'waiting') { openedRef.current = true; openLink(t.connectUrl) }
      }
      bump((n) => n + 1)
      const s = stageRef.current
      if (s === 'checking' || s === 'done' || s === 'failed') return
      if (targetConnected(t)) void verify(async () => (await connectorTools(r.slug)).tools.length)
      else if (targetDead(t)) { setStage('failed'); setDetail(t.detail ?? 'The sign-in page expired before you approved it.') }
      else if (o.settled) { setStage('failed'); setDetail('The sign-in didn’t finish.') }
    }
    const off = onAccountUpdate((op) => { if (op.opId && op.opId === opRef.current?.opId) follow(op, true) })
    void (async () => {
      setStage('opening'); setDetail(undefined); openedRef.current = false; opRef.current = null; linkRef.current = undefined
      let started: ConnectionOp
      try { started = await connectManaged(r.slug, { reconnect: r.reconnect, alias: r.alias, connectionId: r.connectionId }) } catch (e) {
        if (!stop) { setStage('failed'); setDetail(plain(e)) }
        return
      }
      if (stop) return
      follow(started)
      if (now() !== 'opening') return
      const t = started.targets.find((x) => x.name === r.slug) ?? started.targets[0]
      if (t?.connectUrl) { linkRef.current = t.connectUrl; openedRef.current = true; openLink(t.connectUrl) }
      setStage('waiting')
      while (!stop && now() === 'waiting') {
        await new Promise((res) => setTimeout(res, 1500))
        if (stop) return
        try { follow(await opStatus(started.opId)) } catch { /* the next tick tries again */ }
      }
    })()
    return () => { stop = true; off() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  // A server on this Mac that signs in with OAuth: its page opens in the browser; Hermes holds the callback.
  useEffect(() => {
    if (request.kind !== 'server') return
    let stop = false
    const r = request
    void (async () => {
      setStage('opening'); setDetail(undefined); flowRef.current = undefined
      let s
      try { s = await serverSignIn(r.profile, r.server) } catch (e: any) { if (!stop) { setStage('failed'); setDetail(e?.message ?? String(e)) } return }
      if (stop) return
      flowRef.current = s.flowId; linkRef.current = s.url
      if (signInDone(s)) { void verify(async () => (await mcpTest(r.profile, r.server)).tools.length); return }
      if (signInFailed(s) || !s.url) { setStage('failed'); setDetail(s.error ?? `Hermes didn’t get a sign-in page from ${r.name}.`); return }
      openLink(s.url)
      setStage('waiting')
      if (!s.flowId) return
      for (let i = 0; i < 150 && !stop; i++) {
        await new Promise((res) => setTimeout(res, 2000))
        if (stop) return
        const now = await signInStatus(s.flowId).catch(() => null)
        if (!now) continue
        if (signInDone(now)) { void verify(async () => now.tools?.length ?? (await mcpTest(r.profile, r.server)).tools.length); return }
        if (signInFailed(now)) { setStage('failed'); setDetail(now.error ?? 'The sign-in didn’t finish.'); return }
      }
      if (!stop) { setStage('failed'); setDetail('The sign-in took too long. Try again.') }
    })()
    return () => { stop = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  // Back from the browser: have Hermes look at the account now rather than at its next tick.
  useEffect(() => {
    const onFocus = () => { const id = opRef.current?.opId; if (id && stageRef.current === 'waiting') void wakeOp(id) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const stopWaiting = () => {
    const o = opRef.current, f = flowRef.current, s = stageRef.current
    if (s !== 'done') {
      if (o) void giveUp(o, request.kind === 'hosted' ? request.connectionId : undefined)
      else if (f) void cancelSignIn(f)
    }
    close(s === 'done')
  }
  const openAgain = () => {
    const dead = opRef.current?.targets.some(targetDead)
    if (stage === 'failed' || dead || !linkRef.current) setAttempt((n) => n + 1)
    else openLink(linkRef.current)
  }

  const name = request.name
  const title = stage === 'done' ? `${name} is connected` : stage === 'failed' ? 'That didn’t finish' : stage === 'checking' ? `Checking ${name}` : `Connecting ${name}`
  const body = stage === 'done' ? detail ?? 'Hermes can use it now.' : stage === 'failed' ? detail ?? 'Hermes didn’t get access. You can try again.'
    : stage === 'checking' ? 'Hermes is reading what it can do there.' : 'Approve Hermes in the page that opened in your browser, then come back. This updates by itself.'
  const m = marks(stage)
  return (
    <Dialog open={open} onClose={stopWaiting} width={460}
      footer={<>
        <span className="sp" />
        <button className="b-text" onClick={stopWaiting}>{stage === 'done' || stage === 'failed' ? 'Close' : 'Stop waiting'}</button>
        {stage !== 'done' && stage !== 'checking' ? <button className="b-pri" onClick={openAgain}>{stage === 'failed' ? 'Try again' : 'Open the page again'}</button> : null}
      </>}>
      <div className="mk-flow">
        <Bridge stage={stage} logo={<BridgeLogo src={request.logo} name={name} />} />
        <div className="mk-flow-t">{title}</div>
        <div className="mk-flow-b">{body}</div>
        <Steps items={[
          { text: 'Sign-in page opened', mark: m[0] },
          { text: stage === 'failed' ? 'Hermes didn’t get approval' : 'Waiting for your approval', mark: m[1] },
          { text: 'Hermes checks it works', mark: m[2] },
        ]} />
      </div>
    </Dialog>
  )
}
