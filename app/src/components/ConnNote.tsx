// What to say while Hermes One isn't connected to Hermes, in plain words, with "Try now".
// Quitting Hermes Desktop stops the copy of Hermes it started; Hermes One then starts it again, which
// takes about 20 seconds while every bot loads.
import { currentSystem } from '../lib/systems'
import { gateway } from '../lib/gateway'
import { useStore } from '../lib/store'
import { BotFace } from './BotFace'

/** Hermes' own reason in a few words, without Electron's and the command's wrapping. */
function plain(detail?: string) {
  if (!detail) return ''
  let d = detail.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(Error:\s*)+/, '')
  if (/hermes gateway ensure failed/.test(d)) {
    const last = d.match(/\(([^()]+)\)\s*$/)?.[1]
    d = last && !/Command failed/.test(last) ? last : 'Hermes didn’t start'
  }
  return d.length > 120 ? `${d.slice(0, 117)}…` : d
}

function words(connection: string, raw?: string) {
  const detail = raw === 'lost' || raw === 'starting' || raw === 'waiting' ? raw : plain(raw)
  // Another computer's Hermes (Settings › the footer switcher): Hermes One doesn't start that one.
  const other = currentSystem()
  if (other && other.kind !== 'local') {
    if (connection === 'connecting') return { title: `Connecting to ${other.name}…`, body: `Finding Quicksilver and the agents on ${other.name}.` }
    if (/Sign in to|sign-in .* ran out/i.test(raw ?? '')) return { title: `Sign in to ${other.name}`, body: `${plain(raw)} Open the system switcher at the bottom left and pick ${other.name}.` }
    return { title: `Can’t reach ${other.name}`, body: `${other.name} isn’t answering${detail && detail !== 'lost' ? ` (${detail})` : ''}.${other.kind === 'address' ? ' Is Tailscale on?' : ''} Hermes One tries again every few seconds.` }
  }
  if (connection === 'connecting' && detail === 'waiting') return { title: 'Still starting Hermes…', body: 'If macOS asks whether Hermes One can access files on a drive, click Allow. Hermes One can’t reach Hermes until you do.' }
  if (connection === 'connecting' && detail === 'starting') return { title: 'Starting Hermes…', body: 'Hermes isn’t running, so Hermes One is starting it. This takes about 20 seconds.' }
  if (connection === 'connecting' && detail === 'lost') return { title: 'Hermes stopped', body: 'Looking for it again. Quitting Hermes Desktop stops Hermes; Hermes One starts it again.' }
  if (connection === 'connecting') return { title: 'Connecting to Hermes…', body: 'Finding Quicksilver and the agents on this Mac.' }
  return { title: 'Can’t reach Hermes', body: `Hermes isn’t answering on this Mac${detail ? ` (${detail})` : ''}. Hermes One tries again every few seconds.` }
}

/** The big empty-chat version (no messages loaded yet). */
export function ConnCenter() {
  const connection = useStore((s) => s.connection)
  const detail = useStore((s) => s.connectionError)
  const w = words(connection, detail)
  return (
    <div className="center"><div className="box">
      <BotFace profile="default" size={160} mood={connection === 'connecting' ? 'search' : 'doze'} disc={false} />
      <h2>{w.title}</h2>
      <p>{w.body}</p>
      {connection !== 'connecting' ? <button className="btn-soft" onClick={() => gateway.retryNow()}>Try now</button> : null}
    </div></div>
  )
}

/** The slim bar above the message box when the chat is already on screen. */
export function ConnBar() {
  const connection = useStore((s) => s.connection)
  const detail = useStore((s) => s.connectionError)
  if (connection === 'open') return null
  const w = words(connection, detail)
  const busy = connection === 'connecting'
  return (
    <div className={`connbar${busy ? '' : ' bad'}`} role="status">
      <i className={`dot ${busy ? 'run' : 'bad'}`} />
      <span><b>{w.title}</b> {w.body}</span>
      {!busy ? <button className="btn-soft" onClick={() => gateway.retryNow()}>Try now</button> : null}
    </div>
  )
}
