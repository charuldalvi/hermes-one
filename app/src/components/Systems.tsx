// Systems in the sidebar footer: which computer's Hermes Hermes One shows (one at a time), switching to
// another, adding one (by Tailscale or an address, signed in like Hermes Remote, or by SSH), signing in again
// when a sign-in runs out, and removing one. Picking a system starts the window over on it.
import { useRef, useState } from 'react'
import { Icon } from '../lib/icons'
import { localWords } from '../lib/platform'
import { setState, useStore } from '../lib/store'
import { useSystems, type SystemRow } from '../lib/systems'
import { confirm, Dialog, Popover, Spinner, Tabs } from './ui'

const iconOf = (s?: SystemRow) => (!s || s.kind === 'local' ? 'desk' : 'server')

export function SystemButton({ onSettings, settingsOn }: { onSettings: () => void; settingsOn: boolean }) {
  const connection = useStore((s) => s.connection)
  const { rows, active, reload } = useSystems()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [signIn, setSignIn] = useState<SystemRow | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const pick = async (s: SystemRow) => {
    setOpen(false)
    if (s.kind === 'address' && s.signedIn === false) { setSignIn(s); return }
    if (!s.active) await window.hermesNative.switchSystem?.(s.id)
  }
  const remove = async (s: SystemRow) => {
    setOpen(false)
    if (!(await confirm({ title: `Remove ${s.name}?`, body: `Hermes One forgets this computer and its sign-in. Hermes there keeps running, with everything on it.`, action: 'Remove' }))) return
    await window.hermesNative.removeSystem?.(s.id)
    reload()
  }
  const name = active ? localWords(active.name) : localWords('This Mac')
  return (
    <>
      <button ref={btn} className={`conn${settingsOn || open ? ' on' : ''}`} title="Switch systems" onClick={() => { reload(); setOpen((o) => !o) }}>
        <span className="tile"><Icon name={iconOf(active)} size={14} /></span><span className="sysname">{name}</span>
        <span className="st"><i className={`dot ${connection === 'open' ? 'ok' : connection === 'connecting' ? 'run' : 'bad'}`} />{connection === 'open' ? 'Connected' : connection === 'connecting' ? 'Connecting' : 'Offline'}</span>
        <Icon name="selector" size={15} className="gear" />
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} side="above" width={300}>
        <div className="mh">Systems</div>
        <div className="pop-list sys-list">
          {rows.map((s) => (
            <div key={s.id} className={`sys-row${s.active ? ' on' : ''}`}>
              <button className="mi" onClick={() => void pick(s)}>
                <span className="sys-tile"><Icon name={iconOf(s)} size={15} /></span>
                <span className="sys-tx"><span>{localWords(s.name)}</span><small>{s.kind === 'address' && s.signedIn === false ? 'Signed out · click to sign in' : localWords(s.detail)}</small></span>
                {s.active ? <Icon name="check" size={15} /> : null}
              </button>
              {s.kind !== 'local' ? <button className="hbtn sys-x" title={`Remove ${s.name}`} onClick={() => void remove(s)}><Icon name="trash" size={14} /></button> : null}
            </div>
          ))}
        </div>
        <div className="pop-list sys-acts">
          <button className="mi" onClick={() => { setOpen(false); setAdding(true) }}><Icon name="plus" size={15} /><span className="ml">Add a system…</span></button>
          <button className="mi" onClick={() => { setOpen(false); onSettings() }}><Icon name="settings" size={15} /><span className="ml">Settings</span></button>
        </div>
      </Popover>
      <AddSystem open={adding} onClose={() => { setAdding(false); reload() }} />
      <SignIn system={signIn} onClose={() => { setSignIn(null); reload() }} />
    </>
  )
}

function AddSystem({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<'address' | 'ssh'>('address')
  const [f, setF] = useState({ name: '', url: '', user: '', password: '', pairing: '', host: '', port: '', key: '', hermes: '' })
  const [pairing, setPairing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const connect = async () => {
    setBusy(true); setError('')
    const input = kind === 'address'
      ? (pairing ? { kind, name: f.name, pairing: f.pairing } : { kind, name: f.name, url: f.url, user: f.user, password: f.password })
      : { kind, name: f.name, host: f.host, port: f.port ? Number(f.port) : undefined, key: f.key, hermes: f.hermes }
    const r = await window.hermesNative.addSystem?.(input)
    setBusy(false)
    if (r?.ok) { setF({ name: '', url: '', user: '', password: '', pairing: '', host: '', port: '', key: '', hermes: '' }); onClose() } // the window starts over on it
    else setError(r?.error ?? 'That didn’t work.')
  }
  const ready = kind === 'address' ? (pairing ? !!f.pairing.trim() : !!(f.url.trim() && f.user.trim() && f.password)) : !!f.host.trim()
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose() }} title="Add a system" width={520}
      footer={<><button className="b-text" onClick={onClose} disabled={busy}>Cancel</button><button className="b-pri" onClick={() => void connect()} disabled={!ready || busy}>{busy ? <><Spinner size={13} /> Connecting…</> : 'Connect'}</button></>}>
      <div className="sys-add">
        <Tabs items={[{ key: 'address', label: 'Tailscale or address' }, { key: 'ssh', label: 'SSH' }]} value={kind} onChange={(v) => { setKind(v); setError('') }} />
        {kind === 'address' ? <>
          <p className="sys-help">Another computer running Hermes, like your VPS. Use the same address and password as Hermes Remote on your phone.</p>
          <div className="form">
            <label><span>Name</span><input className="answer" value={f.name} onChange={set('name')} placeholder="hermes-vps" /></label>
            {pairing ? (
              <label><span>Pairing link</span><textarea className="answer" rows={3} value={f.pairing} onChange={set('pairing')} placeholder="hermesremote://pair?…" /><em>The link the pairing command prints on that computer (the one Hermes Remote scans). It works once, for a few minutes.</em></label>
            ) : <>
              <label><span>Address</span><input className="answer" value={f.url} onChange={set('url')} placeholder="https://hermes-vps.your-tailnet.ts.net" /><em>Its Tailscale name (https://…ts.net), or an address like 100.x.y.z:9129</em></label>
              <div className="sys-two"><label><span>User name</span><input className="answer" value={f.user} onChange={set('user')} autoComplete="off" /></label><label><span>Password</span><input className="answer" type="password" value={f.password} onChange={set('password')} autoComplete="off" onKeyDown={(e) => { if (e.key === 'Enter' && ready) void connect() }} /></label></div>
            </>}
          </div>
          <button className="b-text sm sys-alt" onClick={() => { setPairing(!pairing); setError('') }}><Icon name="key" size={14} />{pairing ? 'Sign in with a password instead' : 'Use a pairing link instead'}</button>
        </> : <>
          <p className="sys-help">Hermes One signs in with your SSH key, starts Hermes there and connects through the SSH tunnel. Nothing to set up on that computer beyond Hermes itself.</p>
          <div className="form">
            <label><span>Name</span><input className="answer" value={f.name} onChange={set('name')} placeholder="Studio PC" /></label>
            <div className="sys-two"><label><span>Host</span><input className="answer" value={f.host} onChange={set('host')} placeholder="user@host" /><em>user@host, or a name from ~/.ssh/config</em></label><label><span>Port</span><input className="answer" value={f.port} onChange={set('port')} placeholder="22" inputMode="numeric" /></label></div>
            <label><span>SSH key</span><input className="answer" value={f.key} onChange={set('key')} placeholder="Your usual key (from ~/.ssh)" /><em>A file like ~/.ssh/id_ed25519, only if it isn’t your usual one</em></label>
            <label><span>Hermes on that computer</span><input className="answer" value={f.hermes} onChange={set('hermes')} placeholder="hermes (found on its PATH)" /><em>Only if it isn’t on its PATH or in ~/.local/bin</em></label>
          </div>
        </>}
        {error ? <p className="sys-err">{error}</p> : null}
      </div>
    </Dialog>
  )
}

function SignIn({ system, onClose }: { system: SystemRow | null; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const go = async () => {
    if (!system) return
    setBusy(true); setError('')
    const r = await window.hermesNative.signInSystem?.(system.id, password)
    setBusy(false)
    if (!r?.ok) { setError(r?.error ?? 'That didn’t work.'); return }
    setPassword('')
    if (!system.active) await window.hermesNative.switchSystem?.(system.id)
    onClose()
  }
  return (
    <Dialog open={!!system} onClose={() => { if (!busy) onClose() }} title={system ? `Sign in to ${system.name}` : ''} width={440}
      footer={<><button className="b-text" onClick={onClose} disabled={busy}>Cancel</button><button className="b-pri" onClick={() => void go()} disabled={!password || busy}>{busy ? <><Spinner size={13} /> Signing in…</> : 'Sign in'}</button></>}>
      <div className="sys-add">
        <p className="sys-help">The sign-in to {system?.name} ran out. Type the Hermes password for {system?.user || 'it'} again.</p>
        <div className="form"><label><span>Password</span><input className="answer" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && password) void go() }} /></label></div>
        {error ? <p className="sys-err">{error}</p> : null}
      </div>
    </Dialog>
  )
}

/** Open Settings from the switcher (the footer button used to). */
export const openSettings = () => { window.dispatchEvent(new CustomEvent('hermes:close-panel')); setState({ view: 'settings' }) }
