import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import './styles/app.css'
import './styles/pages.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { QuickEntry } from './components/QuickEntry'
import { liveSession, sendTo, sendToChief, start, toMsgs } from './lib/hermes'
import { startAutoArrange } from './lib/arrange'
import { recordTalk, startFeed } from './lib/feed'
import { updateChief } from './lib/store'
import { gateway } from './lib/gateway'
import { applyPrefs, setPref } from './lib/prefs'
import { loadBackdrop } from './lib/backdrop'
import { startLocalWords } from './lib/platform'
import { startScreenWatch } from './lib/screen'
import { startTerminals } from './lib/terminals'
import { startWorkAutoOpen } from './components/Work'
import { loadCurrentSystem } from './lib/systems'

applyPrefs()
startLocalWords() // Windows: this PC, Ctrl, File Explorer (a no-op on a Mac)

const quick = new URLSearchParams(location.search).get('quick') === '1'
if (quick) {
  document.documentElement.classList.add('quick')
  createRoot(document.getElementById('root')!).render(<QuickEntry />)
} else {
  createRoot(document.getElementById('root')!).render(<App />)
  startScreenWatch()
  startTerminals() // the agents' commands, for the side panel's Terminal
  startWorkAutoOpen() // the browser or terminal opens beside the chat when the agent starts using it
  void loadCurrentSystem()
  void loadBackdrop() // the window's frost, zoom and the chat picture (Settings › This app)
  window.hermesNative.onScale?.((v) => setPref('scale', v)) // View › Zoom (⌘+ ⌘− ⌘0)
  void start()
  if (!window.hermesNative.snapshot) startAutoArrange() // test copies never ask Chief anything
  startFeed() // the agents feed for apps with the "agents" ability
  // Quick entry hands its message to this window, which holds the connection to Hermes.
  window.hermesNative.onQuickSend?.((text) => { if (text.trim()) void sendToChief(text) })
}

// Development only: end-to-end tests drive the real send path in the scratch test chat.
// Off-screen test runs can also drop the connection, to check how the app comes back (sends nothing).
if (window.hermesNative.testChiefSession) (window as any).__hermesOneTest = { sendToChief, show: (raw: any[]) => updateChief({ messages: toMsgs(raw) }) }
if (window.hermesNative.snapshot) (window as any).__hermesOneTest = { ...(window as any).__hermesOneTest, dropConnection: () => (gateway as any).ws?.close(4001, 'test drop'), talk: (t: Parameters<typeof recordTalk>[0]) => recordTalk(t), setPref, emit: (ev: any) => (gateway as any).eventListeners.forEach((l: any) => l(ev)), liveSession, sendTo, request: (m: string, p: any, t?: number) => gateway.request(m, p, t), demo: (scene: 'chat' | 'browser' | 'terminal') => import('./dev/Demo').then((m) => m.startDemo(scene)), beadSheet: () => import('./dev/BeadSheet').then((m) => m.showBeadSheet()), panelMock: (k: string) => import('./dev/PanelMocks').then((m) => m.stagePanelMock(k as any)) }
