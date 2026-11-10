// The "Hermes ⌄" menu at the top of the sidebar: where you are (this Mac, Hermes' version, the gateway),
// and the places you reach less often: Settings, the Marketplace, System, shortcuts.
import { useRef, useState } from 'react'
import * as api from '../lib/api'
import { Icon } from '../lib/icons'
import { setState, useStore } from '../lib/store'
import { Dialog, Popover, useAsync } from './ui'

const SHORTCUTS: [string, string][] = [
  ['⌥Space', 'Write to Hermes from any app (quick entry)'],
  ['⌘K', 'Quick actions: jump to an agent, a page or a setting'],
  ['⌘N', 'Write to Hermes'],
  ['⌘F', 'Search your chat with Hermes'],
  ['⌘,', 'Settings'],
  ['/', 'Commands and skills (in the message box)'],
  ['Enter', 'Send · Shift Enter for a new line'],
  ['Esc', 'Close the panel or a dialog'],
  ['↑ ↓', 'Move through suggestions and lists'],
]

export function HermesMenu() {
  const [open, setOpen] = useState(false)
  const [keys, setKeys] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const connection = useStore((s) => s.connection)
  const status = useAsync(() => (open ? api.status() : Promise.resolve(null)), [open])
  const go = (patch: Parameters<typeof setState>[0]) => { setOpen(false); window.dispatchEvent(new CustomEvent('hermes:close-panel')); setState(patch) }
  return (
    <>
      <button ref={btn} className="nm nodrag wsbtn" onClick={() => setOpen(!open)}>Hermes <Icon name="chevD" size={14} /></button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} width={280}>
        <div className="hm-top">
          <b>This Mac</b>
          <span><i className={`dot ${connection === 'open' ? 'ok' : connection === 'connecting' ? 'run' : 'bad'}`} />{connection === 'open' ? 'Connected' : connection === 'connecting' ? 'Connecting…' : 'Offline'}</span>
          {status.data ? <em>Hermes {status.data.version}{status.data.gateway_platforms ? ` · ${Object.keys(status.data.gateway_platforms).length} platforms` : ''}</em> : null}
        </div>
        <button className="mi" onClick={() => go({ view: 'settings', settingsPage: 'team' })}><Icon name="settings" size={15} /><span className="ml">Settings</span><span className="mhint">⌘,</span></button>
        <button className="mi" onClick={() => go({ view: 'marketplace' })}><Icon name="store" size={15} /><span className="ml">Marketplace</span></button>
        <button className="mi" onClick={() => go({ view: 'settings', settingsPage: 'system' })}><Icon name="desk" size={15} /><span className="ml">System and updates</span></button>
        <button className="mi" onClick={() => { setOpen(false); setKeys(true) }}><Icon name="cmd" size={15} /><span className="ml">Keyboard shortcuts</span></button>
        <button className="mi" onClick={() => { setOpen(false); void window.hermesNative.openExternal('https://hermes-agent.nousresearch.com/docs/') }}><Icon name="book" size={15} /><span className="ml">Hermes guide</span><Icon name="external" size={13} /></button>
      </Popover>
      <Dialog open={keys} onClose={() => setKeys(false)} title="Keyboard shortcuts" width={480}>
        <div className="keys">{SHORTCUTS.map(([k, d]) => <div key={k}><kbd>{k}</kbd><span>{d}</span></div>)}</div>
      </Dialog>
    </>
  )
}
