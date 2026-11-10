// Chat settings, from the chat header (Hermes Remote's ⋮ › Chat settings): how Hermes asks before acting,
// YOLO for this chat, what a new message does while the agent is working, and its personality. It's about the
// chat in the middle (Chief's or an agent's). YOLO is for this chat; the rest applies to every chat on that profile.
import { useEffect, useRef, useState } from 'react'
import { gateway } from '../lib/gateway'
import { completeSlash, runCommand, toast } from '../lib/hermes'
import { Icon } from '../lib/icons'
import { chatOf, getState, usePaneProfile, useStore } from '../lib/store'
import { confirm, Popover, Select, Spinner, Switch, Tabs } from './ui'

const APPROVAL_HINT: Record<string, string> = {
  manual: 'Asks before every action that needs approval.',
  smart: 'Hermes decides which actions need your approval.',
  off: 'Never asks: Hermes runs commands without checking with you.',
}
const BUSY_HINT: Record<string, string> = {
  queue: 'A new message waits until the current turn finishes.',
  steer: 'A new message steers the turn that’s running.',
  interrupt: 'A new message stops the current turn and starts yours.',
}

// This chat's settings: Chief's, or the agent's whose chat it is.
async function get(key: string, profile: string): Promise<string | undefined> {
  const sid = chatOf(getState(), profile).sessionId
  if (!sid) return undefined
  try { return (await gateway.request<any>('config.get', { key, session_id: sid, profile }, 30_000))?.value } catch { return undefined }
}
async function set(key: string, value: string, profile: string) {
  const sid = chatOf(getState(), profile).sessionId
  if (!sid) throw new Error('Not connected')
  return gateway.request<any>('config.set', { key, value, session_id: sid, profile }, 30_000)
}

export function ChatSettingsButton() {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={btn} className={`hbtn nodrag${open ? ' on' : ''}`} title="Chat settings" onClick={() => setOpen(!open)}><Icon name="sliders" /></button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} width={380} align="end" className="chatset">
        <ChatSettingsBody onClose={() => setOpen(false)} />
      </Popover>
    </>
  )
}

function ChatSettingsBody({ onClose }: { onClose: () => void }) {
  const profile = usePaneProfile()
  const personality = useStore((s) => chatOf(s, profile).personality)
  const who = useStore((s) => (profile === 'default' ? 'Hermes' : s.bots.find((b) => b.profile === profile)?.name ?? 'this agent'))
  const [mode, setMode] = useState<string>()
  const [yolo, setYolo] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [persons, setPersons] = useState<{ text: string; meta?: string }[] | null>(null)
  const [person, setPerson] = useState<string | undefined>(personality)
  useEffect(() => {
    void get('approval_mode', profile).then((v) => setMode(v ?? 'smart'))
    void get('yolo', profile).then((v) => setYolo(v ?? '0'))
    void get('busy', profile).then((v) => setBusy(v ?? 'interrupt'))
    completeSlash('/personality ', profile).then((items) => setPersons(items)).catch(() => setPersons([]))
  }, [])
  useEffect(() => { if (personality) setPerson(personality) }, [personality])

  const change = async (key: string, value: string, apply: (v: string) => void, before?: string) => {
    apply(value)
    try { const r = await set(key, value, profile); if (typeof r?.value === 'string') apply(r.value) } catch (e: any) { if (before !== undefined) apply(before); toast(`Couldn’t change that: ${e?.message ?? e}`) }
  }
  return (
    <div className="cs">
      <div className="cs-t">Chat settings<em>YOLO is for this chat; the rest is for every chat with {who}.</em></div>

      <div className="cs-sec"><span>Approvals</span>
        {mode === undefined ? <Spinner size={12} /> : <Tabs items={[{ key: 'manual', label: 'Always ask' }, { key: 'smart', label: 'Smart' }, { key: 'off', label: 'Never ask' }]} value={mode as any}
          onChange={async (v) => {
            if (v === 'off' && !(await confirm({ title: 'Turn off approvals?', body: `Hermes will run commands on your Mac without asking, in every chat with ${who}.`, action: 'Turn off', danger: true }))) return
            void change('approval_mode', v, setMode, mode)
          }} />}
        <p className={mode === 'off' ? 'warn' : ''}>{APPROVAL_HINT[mode ?? 'smart']}</p>
      </div>

      <div className="cs-row">
        <div><b>YOLO in this chat</b><p>Skips approval prompts in this chat only, until you turn it off.</p></div>
        <Switch on={yolo === '1'} disabled={yolo === undefined} label="YOLO in this chat" onChange={async (on) => {
          if (on && !(await confirm({ title: 'Turn on YOLO?', body: 'Hermes will run commands in this chat without asking you first.', action: 'Turn on', danger: true }))) return
          void change('yolo', on ? '1' : '0', setYolo, yolo)
        }} />
      </div>

      <div className="cs-sec"><span>When you send while {who} is working</span>
        {busy === undefined ? <Spinner size={12} /> : <Tabs items={[{ key: 'queue', label: 'Wait' }, { key: 'steer', label: 'Steer' }, { key: 'interrupt', label: 'Stop and switch' }]} value={busy as any} onChange={(v) => void change('busy', v, setBusy, busy)} />}
        <p>{BUSY_HINT[busy ?? 'interrupt']}</p>
      </div>

      <div className="cs-sec"><span>Personality</span>
        {persons === null ? <Spinner size={12} /> : (
          <Select value={person ?? 'none'} width={340} align="end"
            options={persons.map((p) => ({ value: p.text, label: p.text === 'none' ? `None (${who}’s own)` : p.text[0].toUpperCase() + p.text.slice(1), hint: p.text === 'none' ? undefined : p.meta }))}
            onChange={(v) => void change('personality', v, (x) => setPerson(x), person)} />
        )}
      </div>

      <div className="cs-foot">
        <button className="b-text sm" onClick={() => { onClose(); void runCommand('/usage', profile) }}><Icon name="chart" size={14} />Usage</button>
        <button className="b-text sm" onClick={() => { onClose(); void runCommand('/status', profile) }}><Icon name="info" size={14} />Status</button>
        <span className="sp" />
        <button className="b-text sm" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('hermes:send', { detail: '/new' })) }}><Icon name="refresh" size={14} />Tidy up the chat</button>
      </div>
    </div>
  )
}
