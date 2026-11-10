// Settings › This app: how Hermes One itself behaves on this Mac (not Hermes): start at login,
// appearance (light, dark, system), notifications, the Dock badge, motion and text size, and the window and
// background (frosted, a picture behind the workspace). Saved on this Mac only.
import { useEffect, useState } from 'react'
import { choosePicture, pictureUrl, removePicture, setFrosted, setScale } from '../../lib/backdrop'
import { Icon } from '../../lib/icons'
import { ACCENTS, getPrefs, SCALES, setPref, TINTS, type Prefs } from '../../lib/prefs'
import { IS_MAC } from '../../lib/platform'
import { toast } from '../../lib/hermes'
import { Slider } from '../Slider'
import { Select, Switch, Tabs } from '../ui'
import pkg from '../../../package.json'

function Row({ title, body, children }: { title: string; body?: string; children: React.ReactNode }) {
  return <div className="srow ctlrow"><div className="tx"><div className="t1"><span>{title}</span></div>{body ? <div className="t2">{body}</div> : null}</div><div className="ctl">{children}</div></div>
}

/** A row of colour dots to pick from; the chosen one gets a ring. */
function Swatches<T extends string | number | null>({ items, value, onChange }: { items: { value: T; color: string; name: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="swatches" role="radiogroup">
      {items.map((it) => (
        <button key={String(it.value)} type="button" role="radio" aria-checked={it.value === value} aria-label={it.name} title={it.name}
          className={it.value === value ? 'on' : ''} style={{ background: it.color }} onClick={() => onChange(it.value)} />
      ))}
    </div>
  )
}
const ACCENT_NAMES: Record<string, string> = { mono: 'Black and white', '#3b82f6': 'Blue', '#8b5cf6': 'Violet', '#ec4899': 'Pink', '#ef4444': 'Red', '#f59e0b': 'Orange', '#22c55e': 'Green', '#14b8a6': 'Teal' }

export function AppPrefsPage(_: { profile: string }) {
  const [p, setP] = useState<Prefs>(getPrefs())
  const [login, setLogin] = useState<boolean | null>(null)
  const [theme, setTheme] = useState<string>('system')
  // Frosted needs macOS, or Windows 11 (22H2 or later).
  const [canFrost, setCanFrost] = useState(IS_MAC)
  useEffect(() => { void window.hermesNative.loginItem?.().then((v) => setLogin(!!v)); void window.hermesNative.theme?.().then((t) => setTheme(t || 'system')); void window.hermesNative.canFrost?.().then((v) => setCanFrost(!!v)) }, [])
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => { setPref(k, v); setP(getPrefs()) }
  const pick = async () => {
    const r = await choosePicture()
    if (typeof r === 'string') toast(r)
    setP(getPrefs())
  }
  const frostWord = (v: number) => (v < 34 ? 'Subtle' : v < 67 ? 'Medium' : 'Strong')
  // Keep the zoom choice in step with View › Zoom (⌘+ ⌘− ⌘0).
  useEffect(() => window.hermesNative.onScale?.(() => setP(getPrefs())), [])
  return (
    <>
      <div className="shead"><div className="tx"><h1>This app</h1><p>How Hermes One behaves on this Mac. Hermes itself is set up in the other pages.</p></div></div>
      <div className="ssec"><h2>Start and stay</h2></div>
      <div className="card">
        <Row title="Open at login" body="Hermes One opens when you log in to this Mac, so what needs you reaches you.">
          <Switch on={!!login} disabled={login === null} label="Open at login" onChange={(v) => { setLogin(v); void window.hermesNative.loginItem?.(v) }} />
        </Row>
      </div>
      <div className="ssec"><h2>When something needs you</h2></div>
      <div className="card">
        <Row title="Notifications" body="A Mac notification when an agent asks for your OK, has a question, or needs something typed, while you’re in another app.">
          <Switch on={p.notify} label="Notifications" onChange={(v) => set('notify', v)} />
        </Row>
        <Row title={IS_MAC ? 'Count on the Dock icon' : 'Dot on the taskbar icon'} body={IS_MAC ? 'How many things are waiting for you.' : 'Shows when something is waiting for you.'}>
          <Switch on={p.badge} label="Dock badge" onChange={(v) => { set('badge', v); if (!v) void window.hermesNative.badge(0) }} />
        </Row>
        <Row title="Notify when Hermes finishes" body="Also tell me when Hermes finishes a reply while I’m in another app.">
          <Switch on={p.notifyDone} label="Notify when Hermes finishes" onChange={(v) => set('notifyDone', v)} />
        </Row>
      </div>
      <div className="ssec"><h2>Look and feel</h2></div>
      <div className="card">
        <Row title="Appearance" body="Light or dark. System follows your Mac, and switches when it does.">
          <Tabs items={[{ key: 'system', label: 'System' }, { key: 'light', label: 'Light' }, { key: 'dark', label: 'Dark' }]} value={theme}
            onChange={(v) => { setTheme(v); void window.hermesNative.theme?.(v as 'system' | 'light' | 'dark') }} />
        </Row>
        <Row title="Motion" body="Springs, liquid highlights and flights. Calm keeps fades only.">
          <Tabs items={[{ key: 'full', label: 'Full' }, { key: 'calm', label: 'Calm' }]} value={p.motion} onChange={(v) => { set('motion', v); window.location.reload() }} />
        </Row>
        <Row title="Text size in the chat">
          <Tabs items={[{ key: 'small', label: 'Small' }, { key: 'normal', label: 'Normal' }, { key: 'large', label: 'Large' }]} value={p.textSize} onChange={(v) => set('textSize', v)} />
        </Row>
        <Row title="Send with" body="Which key sends a message; the other one makes a new line.">
          <Tabs items={[{ key: 'enter', label: 'Enter' }, { key: 'cmd-enter', label: '⌘ Enter' }]} value={p.sendKey} onChange={(v) => set('sendKey', v)} />
        </Row>
        <Row title="Accent colour" body="The send button, your own messages and what’s selected. The first keeps it black and white.">
          <Swatches items={ACCENTS.map((c) => ({ value: c, color: c === 'mono' ? 'var(--text-primary)' : c, name: ACCENT_NAMES[c] ?? c }))} value={p.accent} onChange={(v) => set('accent', v)} />
        </Row>
        <Row title="Tint" body="A hint of colour in the app’s greys. Neutral keeps them grey.">
          <Swatches items={TINTS.map((t) => ({ value: t.hue, color: t.hue === null ? 'var(--gray-500)' : `hsl(${t.hue} 38% 52%)`, name: t.name }))} value={p.tint} onChange={(v) => set('tint', v)} />
        </Row>
        {p.tint !== null ? (
          <Row title="Tint strength" body="How much of the colour goes into the greys.">
            <Slider value={p.tintStrength} from="Faint" to="Strong" label="Tint strength" usual={60} format={(v) => `${v}%`} onChange={(v) => set('tintStrength', v)} />
          </Row>
        ) : null}
        <Row title="Workspace" body="Full height, or a rounded card inside the window with a little margin around it.">
          <Tabs items={[{ key: 'full', label: 'Full height' }, { key: 'rounded', label: 'Rounded' }]} value={p.shape} onChange={(v) => set('shape', v as Prefs['shape'])} />
        </Row>
        <Row title="Interface scale" body="Zoom the whole app. ⌘+ and ⌘− work too, and ⌘0 goes back to 100%.">
          <div className="sel-compact"><Select value={String(p.scale)} width={140} align="end" options={SCALES.map((v) => ({ value: String(v), label: `${v}%` }))} onChange={(v) => { setScale(Number(v)); setP(getPrefs()) }} /></div>
        </Row>
      </div>
      {canFrost ? <>
      <div className="ssec"><h2>Window</h2></div>
      <div className="card">
        <Row title="Frosted window" body={IS_MAC ? 'Your desktop glows through the chat and the pages, blurred, like macOS’ own sidebars. The sidebar stays solid.' : 'Your desktop glows through the chat and the pages, blurred, like Windows’ own acrylic. The sidebar stays solid.'}>
          <Switch on={p.frosted} label="Frosted window" onChange={(v) => { setFrosted(v); setP(getPrefs()) }} />
        </Row>
        {p.frosted ? (
          <Row title="Frost" body="How much of your desktop shows through. Text and the message box stay solid.">
            <Slider value={p.frost} from="Subtle" to="Strong" label="Frost" usual={17} format={(v) => `${frostWord(v)} · ${v}`} onChange={(v) => set('frost', v)} />
          </Row>
        ) : null}
      </div>
      </> : null}
      <div className="ssec"><h2>Chat background</h2><span>A picture behind your chats (not Settings or the other pages). It stays on this Mac.</span></div>
      <div className="card">
        <div className="bgprev-row">
          {p.hasPicture && pictureUrl() ? (
            <div className="bgprev"><i style={{ backgroundImage: `url("${pictureUrl()}")` }} /><b /><span>An empty chat, at {p.strengthEmpty}%</span></div>
          ) : (
            <button type="button" className="bgprev none" onClick={() => void pick()}><Icon name="image" size={20} /><span>No picture yet. Choose one to put behind your chats.</span></button>
          )}
          <div className="acts">
            <button className="b-soft sm" onClick={() => void pick()}>{p.hasPicture ? 'Change…' : 'Choose…'}</button>
            {p.hasPicture ? <button className="b-text sm" onClick={() => { void removePicture().then(() => setP(getPrefs())) }}>Remove</button> : null}
          </div>
        </div>
        {p.hasPicture ? <>
          <Row title="Show on" body="Every chat, or only chats that are still empty.">
            <Tabs items={[{ key: 'empty', label: 'Empty chats' }, { key: 'every', label: 'Every chat' }]} value={p.showOn} onChange={(v) => set('showOn', v as Prefs['showOn'])} />
          </Row>
          <Row title="Empty chat strength" body="How much of the picture shows before a chat has messages.">
            <Slider value={p.strengthEmpty} from="Faint" to="Strong" label="Empty chat strength" usual={55} format={(v) => `${v}%`} onChange={(v) => set('strengthEmpty', v)} />
          </Row>
          {p.showOn === 'every' ? (
            <Row title="Chat strength" body="How much shows once you’re talking, so the words come first.">
              <Slider value={p.strengthBusy} from="Faint" to="Strong" label="Chat strength" usual={25} format={(v) => `${v}%`} onChange={(v) => set('strengthBusy', v)} />
            </Row>
          ) : null}
          <Row title="Fade" body="The picture fades to dark toward the message box (to light in light mode). Off keeps it the same all the way down.">
            <Slider value={p.fade} from="Off" to="Strong" label="Fade" usual={65} format={(v) => (v === 0 ? 'Off' : `${v}%`)} onChange={(v) => set('fade', v)} />
          </Row>
          <Row title="Blur" body="Softens the picture.">
            <Slider value={p.blur} from="Sharp" to="Soft" label="Blur" usual={30} format={(v) => (v === 0 ? 'Sharp' : `${v}%`)} onChange={(v) => set('blur', v)} />
          </Row>
        </> : null}
      </div>
      <p className="free" style={{ marginTop: 18 }}><Icon name="info" size={14} /> Hermes One {pkg.version} · connects to Hermes on this Mac only.</p>
    </>
  )
}
