// Development only (snapshot runs): mockups of the side panel's Browser and Terminal, drawn over the real
// window (real sidebar, real agent faces, a made-up chat) so the user can pick one before it is built.
// Nothing here talks to Hermes; the page and the terminal output are invented.
import { useLayoutEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BotFace } from '../components/BotFace'
import { Spinner } from '../components/ui'
import { openChat } from '../lib/hermes'
import { Icon } from '../lib/icons'
import { getState, setState, updateChat, type Bot } from '../lib/store'

type Kind = 'browser-a' | 'browser-b' | 'browser-c' | 'terminal-a' | 'terminal-b'

const CSS = `
.pm { position: absolute; inset: 0; z-index: 4; background: var(--bg-app); display: flex; flex-direction: column; }
.pm .hdr { gap: 10px; }
.pm-seg { display: inline-flex; padding: 3px; border-radius: 9px; background: var(--bg-raised); box-shadow: inset 0 0 0 1px var(--gray-850); gap: 2px; }
.pm-seg span { display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 11px; border-radius: 7px; color: var(--text-secondary); font-size: var(--text-sm); }
.pm-seg span.on { background: var(--bg-selected); color: var(--text-primary); }
.pm-seg em { font-style: normal; font-size: 11px; min-width: 17px; height: 17px; border-radius: 9px; display: inline-grid; place-items: center; background: var(--gray-800); color: var(--text-primary); padding: 0 5px; }
.pm-who { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 10px 0 6px; border-radius: 8px; box-shadow: inset 0 0 0 1px var(--gray-850); color: var(--text-primary); font-size: var(--text-sm); }
.pm-x { color: var(--text-icon); display: grid; place-items: center; width: 30px; height: 30px; }
.pm-bar { flex: none; display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
.pm-bar .sp { flex: 1; }
.pm-chip { display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 10px; border-radius: 13px; background: var(--bg-raised); box-shadow: inset 0 0 0 1px var(--gray-850); font-size: var(--text-sm); color: var(--text-secondary); white-space: nowrap; }
.pm-chip i { width: 7px; height: 7px; border-radius: 50%; background: var(--status-success, #22c55e); }
.pm-btn { height: 30px; padding: 0 12px; border-radius: 8px; font-size: var(--text-sm); display: inline-flex; align-items: center; gap: 7px; color: var(--text-primary); background: var(--bg-selected); white-space: nowrap; }
.pm-btn.text { background: none; color: var(--text-secondary); }
.pm-btn.white { background: var(--gray-100); color: var(--gray-925); font-weight: 500; }
.pm-stage { flex: 1; min-height: 0; margin: 0 16px 16px; border-radius: 12px; overflow: hidden; background: var(--bg-raised); box-shadow: inset 0 0 0 1px var(--gray-850); display: flex; flex-direction: column; position: relative; }
.pm-url { flex: none; display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; font-size: var(--text-sm); color: var(--text-secondary); box-shadow: inset 0 -1px 0 var(--gray-850); white-space: nowrap; overflow: hidden; }
.pm-url b { font-weight: 400; color: var(--text-primary); }
.pm-url .dim { color: var(--text-icon); overflow: hidden; text-overflow: ellipsis; }
.pm-view { flex: 1; min-height: 0; overflow: hidden; position: relative; background: #fff; }
.pm-tabs { flex: none; display: flex; align-items: flex-end; gap: 2px; padding: 8px 10px 0; box-shadow: inset 0 -1px 0 var(--gray-850); }
.pm-tab { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; border-radius: 8px 8px 0 0; font-size: var(--text-sm); color: var(--text-secondary); max-width: 220px; white-space: nowrap; overflow: hidden; }
.pm-tab.on { background: var(--bg-selected); color: var(--text-primary); }
.pm-tab .fav { width: 14px; height: 14px; border-radius: 4px; flex: none; }
.pm-tab .t { overflow: hidden; text-overflow: ellipsis; }
.pm-tab .more { color: var(--text-icon); }
.pm-nav { flex: none; display: flex; align-items: center; gap: 6px; padding: 8px 10px; background: var(--bg-selected); }
.pm-nav .ic { width: 28px; height: 28px; display: grid; place-items: center; color: var(--gray-600); }
.pm-field { flex: 1; min-width: 0; height: 30px; border-radius: 8px; background: var(--bg-app); display: flex; align-items: center; gap: 8px; padding: 0 10px; font-size: var(--text-sm); color: var(--text-secondary); white-space: nowrap; overflow: hidden; }
.pm-field b { font-weight: 400; color: var(--text-primary); }
.pm-pointer { position: absolute; z-index: 3; pointer-events: none; }
.pm-ring { position: absolute; left: -18px; top: -18px; width: 36px; height: 36px; border-radius: 50%; box-shadow: 0 0 0 2px rgb(59 130 246 / .9), 0 0 0 8px rgb(59 130 246 / .18); }
.pm-tag { position: absolute; left: 22px; top: 8px; background: #111; color: #f2f2f2; font-size: 12.5px; padding: 6px 10px 6px 6px; border-radius: 9px; display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; box-shadow: 0 6px 20px rgb(0 0 0 / .35); }
.pm-trail { flex: none; margin: 0 16px 16px; border-radius: 12px; background: var(--bg-raised); box-shadow: inset 0 0 0 1px var(--gray-850); padding: 6px 0; }
.pm-trail div { display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 14px; font-size: var(--text-sm); color: var(--text-secondary); white-space: nowrap; }
.pm-trail div .tm { margin-left: auto; color: var(--text-icon); font-variant-numeric: tabular-nums; font-size: 12px; }
.pm-trail div.now { color: var(--text-primary); }
.pm-trail .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--gray-600); flex: none; margin: 0 4px; }
.pm-term { flex: 1; min-height: 0; overflow: hidden; background: #111111; padding: 14px 16px; font: 12.5px/1.65 var(--font-mono); color: #d6d6d6; white-space: pre-wrap; }
.pm-term .g { color: #5fd38d; } .pm-term .d { color: #7d7d7d; } .pm-term .b { color: #7fb2ff; } .pm-term .y { color: #e8c468; } .pm-term .w { color: #f2f2f2; }
.pm-cursor { display: inline-block; width: 8px; height: 15px; background: #d6d6d6; vertical-align: -2px; }
.pm-ttab { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; border-radius: 8px 8px 0 0; font: 12.5px var(--font-mono); color: var(--text-secondary); white-space: nowrap; max-width: 260px; overflow: hidden; }
.pm-ttab.on { background: #111111; color: #ececec; }
.pm-ttab .s { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.pm-foot { flex: none; display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 8px 0 14px; font-size: var(--text-sm); color: var(--text-secondary); box-shadow: inset 0 1px 0 var(--gray-850); white-space: nowrap; }
.pm-foot .sp { flex: 1; }
.pm-cards { flex: 1; min-height: 0; overflow: hidden; padding: 0 16px 16px; display: flex; flex-direction: column; gap: 10px; }
.pm-card { border-radius: 12px; background: var(--bg-raised); box-shadow: inset 0 0 0 1px var(--gray-850); overflow: hidden; flex: none; }
.pm-card.grow { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.pm-ch { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 14px; font-size: var(--text-sm); color: var(--text-secondary); white-space: nowrap; }
.pm-ch code { font: 12.5px var(--font-mono); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.pm-ch .tm { margin-left: auto; font-variant-numeric: tabular-nums; flex: none; }
.pm-ch .ok { color: var(--status-success, #22c55e); flex: none; }
.pm-card .pm-term { border-radius: 0 0 12px 12px; }
.pm-lab { font-size: 12px; color: var(--text-icon); padding: 4px 2px 0; }
/* the made-up page */
.wp { width: 1280px; transform-origin: 0 0; font-family: Inter, system-ui, sans-serif; color: #161616; background: #fff; }
.wp-nav { height: 64px; display: flex; align-items: center; gap: 28px; padding: 0 48px; border-bottom: 1px solid #ececec; font-size: 15px; color: #555; }
.wp-logo { font-weight: 700; color: #111; font-size: 18px; letter-spacing: -.01em; margin-right: auto; display: flex; align-items: center; gap: 10px; }
.wp-logo i { width: 22px; height: 22px; border-radius: 6px; background: #1f6f5c; }
.wp-hero { padding: 44px 48px 26px; }
.wp-kick { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #1f6f5c; font-weight: 600; }
.wp-h1 { font-size: 40px; line-height: 1.12; letter-spacing: -.02em; font-weight: 700; margin: 12px 0 12px; max-width: 900px; }
.wp-by { font-size: 15px; color: #6b6b6b; }
.wp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; padding: 6px 48px 40px; }
.wp-card { border: 1px solid #e8e8e8; border-radius: 14px; overflow: hidden; }
.wp-img { height: 210px; background: #f3f3f1; display: grid; place-items: center; position: relative; }
.wp-mic { width: 64px; height: 120px; border-radius: 32px; background: #2b2b2b; position: relative; box-shadow: inset -8px 0 0 rgb(255 255 255 / .06); }
.wp-mic::after { content: ''; position: absolute; left: 50%; bottom: -46px; width: 10px; height: 46px; margin-left: -5px; background: #3a3a3a; }
.wp-badge { position: absolute; left: 14px; top: 14px; background: #1f6f5c; color: #fff; font-size: 12px; font-weight: 600; padding: 5px 9px; border-radius: 6px; }
.wp-body { padding: 18px 20px 20px; }
.wp-name { font-size: 19px; font-weight: 650; }
.wp-meta { font-size: 14px; color: #6b6b6b; margin: 6px 0 14px; }
.wp-row { display: flex; align-items: center; justify-content: space-between; }
.wp-price { font-size: 22px; font-weight: 700; }
.wp-cta { background: #111; color: #fff; font-size: 14px; font-weight: 600; padding: 10px 16px; border-radius: 9px; }
.wp-cta.alt { background: #fff; color: #111; box-shadow: inset 0 0 0 1px #d6d6d6; }
.wp-sec { padding: 8px 48px 40px; display: grid; grid-template-columns: 1.4fr 1fr; gap: 40px; }
.wp-h2 { font-size: 26px; font-weight: 700; letter-spacing: -.01em; margin: 0 0 14px; }
.wp-p { font-size: 16px; line-height: 1.6; color: #3d3d3d; margin: 0 0 14px; }
.wp-tbl { width: 100%; border-collapse: collapse; font-size: 15px; }
.wp-tbl th { text-align: left; font-weight: 600; color: #6b6b6b; font-size: 13px; padding: 10px 0; border-bottom: 1px solid #e8e8e8; }
.wp-tbl td { padding: 13px 0; border-bottom: 1px solid #f0f0f0; }
.wp-bar { height: 8px; border-radius: 4px; background: #e9efe9; position: relative; width: 120px; display: inline-block; vertical-align: middle; }
.wp-bar i { position: absolute; inset: 0 auto 0 0; border-radius: 4px; background: #1f6f5c; }
.wp-note { border-radius: 14px; background: #f5f7f4; padding: 22px 24px; }
`

let root: Root | null = null
let host: HTMLDivElement | null = null
let staged: string | null = null

const pickBot = (re: RegExp): Bot | undefined => {
  const team = getState().bots.filter((b) => !b.isChief)
  return team.find((b) => re.test(b.name)) ?? team[0]
}

/** Open a made-up chat with an agent and draw one mockup in the side panel. */
export async function stagePanelMock(kind: Kind) {
  if (!document.getElementById('pm-css')) { const s = document.createElement('style'); s.id = 'pm-css'; s.textContent = CSS; document.head.appendChild(s) }
  const browser = kind.startsWith('browser')
  const bot = browser ? pickBot(/research/i) : pickBot(/implement|engineer|coder|developer/i)
  if (!bot) return
  // The agent of the last mockup goes back to how it was.
  if (staged && staged !== bot.profile) { const prev = staged; setState((s) => ({ bots: s.bots.map((b) => (b.profile === prev ? { ...b, status: 'free' as const, since: undefined, step: undefined } : b)) })) }
  staged = bot.profile
  if (getState().chatWith !== bot.profile) { openChat(bot.profile); await new Promise((r) => setTimeout(r, 2500)) }
  const now = Date.now()
  const started = now - (browser ? 74_000 : 102_000)
  const ask = browser
    ? 'Find the best USB mic under $200 for a small, echoey room. I record a podcast at my desk.'
    : 'Add a dark mode toggle to the website header, and make sure the tests still pass.'
  const tools = browser
    ? [{ id: 't1', name: 'web_search', args: { query: 'best USB podcast mic small room' }, done: true }, { id: 't2', name: 'browser_navigate', done: true }, { id: 't3', name: 'browser_click' }]
    : [{ id: 't1', name: 'read_file', args: { path: 'site/src/Header.tsx' }, done: true }, { id: 't2', name: 'terminal', args: { command: 'claude -p "Add a dark mode toggle…"' } }]
  updateChat(bot.profile, {
    loading: false, hasOlder: false, busy: true, turnStartedAt: started, sessionId: 'mock', step: browser ? 'Using the browser' : 'Running a command',
    messages: [
      { id: 'mu', role: 'user', text: ask, at: started - 2000 },
      { id: 'ma', role: 'assistant', text: '', at: started, startedAt: started, streaming: true, tools },
    ],
  })
  setState((s) => ({ bots: s.bots.map((b) => (b.profile === bot.profile ? { ...b, status: 'working' as const, since: started, step: browser ? 'Using the browser' : 'Running a command' } : b)) }))
  // The panel opens at the screen's width; the mockup covers what's in it.
  window.dispatchEvent(new CustomEvent('hermes:open-panel', { detail: { profile: `screen:${bot.profile}` } }))
  await new Promise((r) => setTimeout(r, 700))
  const rp = document.querySelector<HTMLElement>('.rp')
  if (!rp) return
  if (!host || !rp.contains(host)) { root?.unmount(); host = document.createElement('div'); host.className = 'pm'; rp.appendChild(host); root = createRoot(host) }
  root!.render(<Mock kind={kind} bot={bot} />)
}

function Header({ bot, tab }: { bot: Bot; tab: 'browser' | 'terminal' }) {
  return (
    <div className="hdr drag">
      <span className="pm-seg">
        <span className={tab === 'browser' ? 'on' : ''}><Icon name="globe" size={15} />Browser</span>
        <span className={tab === 'terminal' ? 'on' : ''}><Icon name="terminal" size={15} />Terminal<em>{tab === 'terminal' ? 3 : 1}</em></span>
      </span>
      <span className="sp" />
      <span className="pm-who"><BotFace profile={bot.profile} size={20} poseKey={bot.poseKey} watch={false} />{bot.name}<Icon name="chevD" size={14} /></span>
      <span className="pm-x"><Icon name="x" size={16} /></span>
    </div>
  )
}

function Mock({ kind, bot }: { kind: Kind; bot: Bot }) {
  if (kind === 'browser-a') return (
    <>
      <Header bot={bot} tab="browser" />
      <div className="pm-bar">
        <span className="pm-chip"><i />{bot.name} is browsing</span>
        <span className="sp" />
        <span className="pm-btn">Take over</span>
        <span className="pm-btn text"><Icon name="external" size={14} />Open in Chrome</span>
      </div>
      <div className="pm-stage">
        <div className="pm-url"><Icon name="lock" size={13} /><b>quietroom.example</b><span className="dim">/reviews/best-usb-mics-under-200</span></div>
        <Page />
      </div>
    </>
  )
  if (kind === 'browser-b') return (
    <>
      <Header bot={bot} tab="browser" />
      <div className="pm-stage" style={{ marginTop: 4 }}>
        <div className="pm-tabs">
          <span className="pm-tab on"><span className="fav" style={{ background: '#1f6f5c' }} /><span className="t">Best USB mics under $200</span><BotFace profile={bot.profile} size={16} poseKey={bot.poseKey} watch={false} /></span>
          <span className="pm-tab"><span className="fav" style={{ background: '#c2410c' }} /><span className="t">PodMic USB review · Sound…</span></span>
          <span className="pm-tab"><span className="fav" style={{ background: '#4b5563' }} /><span className="t">Small room acoustics, a gui…</span></span>
          <span className="pm-tab"><span className="more">+2</span></span>
        </div>
        <div className="pm-nav">
          <span className="ic"><Icon name="chevR" size={16} style={{ transform: 'scaleX(-1)' }} /></span>
          <span className="ic"><Icon name="chevR" size={16} /></span>
          <span className="ic"><Icon name="refresh" size={15} /></span>
          <span className="pm-field"><Icon name="lock" size={13} /><b>quietroom.example</b>/reviews/best-usb-mics-under-200</span>
          <span className="pm-btn white">Take over</span>
        </div>
        <Page />
      </div>
    </>
  )
  if (kind === 'browser-c') return (
    <>
      <Header bot={bot} tab="browser" />
      <div className="pm-bar">
        <span className="pm-chip"><i />{bot.name} is browsing</span>
        <span className="pm-url" style={{ boxShadow: 'none', height: 26, padding: 0 }}><Icon name="lock" size={13} /><b>quietroom.example</b><span className="dim">/reviews/best-usb-mics-under-200</span></span>
        <span className="sp" />
        <span className="pm-btn">Take over</span>
      </div>
      <div className="pm-stage">
        <Page pointer={{ x: 670, y: 600, bot, label: 'Clicking “Compare”' }} />
      </div>
      <div className="pm-trail">
        <div><span className="dot" />Searched the web for “best USB podcast mic small room”<span className="tm">1:12</span></div>
        <div><span className="dot" />Opened quietroom.example</div>
        <div><span className="dot" />Scrolled to the picks for small rooms<span className="tm">0:20</span></div>
        <div className="now"><Spinner size={12} />Clicking “Compare” on the Samson Q9U<span className="tm">now</span></div>
      </div>
    </>
  )
  if (kind === 'terminal-a') return (
    <>
      <Header bot={bot} tab="terminal" />
      <div className="pm-stage" style={{ marginTop: 4 }}>
        <div className="pm-tabs" style={{ paddingBottom: 0 }}>
          <span className="pm-ttab on"><span className="s" style={{ background: '#3b82f6' }} />claude -p "Add a dark mode…</span>
          <span className="pm-ttab"><span className="s" style={{ background: 'var(--status-success, #22c55e)' }} />npm test</span>
          <span className="pm-ttab"><span className="s" style={{ background: 'var(--status-success, #22c55e)' }} />git status</span>
        </div>
        <ClaudeOutput />
        <div className="pm-foot"><Spinner size={12} />Running · 1:42<span style={{ color: 'var(--text-icon)' }}>in ~/projects/site</span><span className="sp" /><span className="pm-btn text"><Icon name="copy" size={14} />Copy</span><span className="pm-btn">Stop</span></div>
      </div>
    </>
  )
  return (
    <>
      <Header bot={bot} tab="terminal" />
      <div className="pm-cards" style={{ paddingTop: 4 }}>
        <div className="pm-card grow">
          <div className="pm-ch"><Spinner size={12} /><code>claude -p "Add a dark mode toggle to the header…" --max-turns 12</code><span className="tm">1:42</span><span className="pm-btn" style={{ marginLeft: 6 }}>Stop</span></div>
          <ClaudeOutput />
        </div>
        <div className="pm-lab">Earlier in this chat</div>
        <div className="pm-card"><div className="pm-ch"><span className="ok"><Icon name="check" size={15} /></span><code>npm test</code><span className="tm">42 passed · 6s</span><Icon name="chevR" size={14} /></div></div>
        <div className="pm-card"><div className="pm-ch"><span className="ok"><Icon name="check" size={15} /></span><code>git status</code><span className="tm">clean · 0s</span><Icon name="chevR" size={14} /></div></div>
      </div>
    </>
  )
}

function ClaudeOutput() {
  return (
    <div className="pm-term">
      <span className="d">~/projects/site $ </span><span className="w">claude -p "Add a dark mode toggle to the header, keep tests passing" --max-turns 12</span>{'\n'}
      {'\n'}
      <span className="b">●</span> Reading src/components/Header.tsx{'\n'}
      <span className="b">●</span> Reading src/styles/theme.css{'\n'}
      <span className="b">●</span> Reading src/components/Header.test.tsx{'\n'}
      <span className="y">●</span> Editing src/components/Header.tsx <span className="g">+18</span> <span style={{ color: '#ef6b6b' }}>−2</span>{'\n'}
      <span className="y">●</span> Editing src/styles/theme.css <span className="g">+24</span>{'\n'}
      <span className="y">●</span> Creating src/hooks/useTheme.ts <span className="g">+31</span>{'\n'}
      <span className="b">●</span> Running npm test{'\n'}
      <span className="d">  PASS  src/components/Header.test.tsx</span>{'\n'}
      <span className="d">  PASS  src/hooks/useTheme.test.ts</span>{'\n'}
      <span className="g">  Tests: 44 passed, 44 total</span>{'\n'}
      <span className="b">●</span> Checking the toggle remembers the choice after a reload<span className="pm-cursor" style={{ marginLeft: 4 }} />{'\n'}
    </div>
  )
}

function Page({ pointer }: { pointer?: { x: number; y: number; bot: Bot; label: string } }) {
  const box = useRef<HTMLDivElement>(null)
  const [z, setZ] = useState(0.5)
  useLayoutEffect(() => { if (box.current) setZ(box.current.clientWidth / 1280) }, [])
  return (
    <div className="pm-view" ref={box}>
      <div className="wp" style={{ transform: `scale(${z})` }}>
        <div className="wp-nav"><span className="wp-logo"><i />Quiet Room</span><span>Reviews</span><span>Guides</span><span>Rooms</span><span>Newsletter</span></div>
        <div className="wp-hero">
          <div className="wp-kick">Buying guide · Updated this week</div>
          <div className="wp-h1">The best USB mics under $200 for small, echoey rooms</div>
          <div className="wp-by">We recorded the same script in a 3 × 3 m spare room with bare walls. These three kept the room out of the voice.</div>
        </div>
        <div className="wp-grid">
          {[['Best overall', 'Rode PodMic USB', 'Dynamic · USB-C and XLR', '$199'], ['Best value', 'Samson Q9U', 'Dynamic · USB-C and XLR', '$149'], ['Easiest setup', 'Shure MV7+', 'Dynamic · USB-C and XLR', '$279']].map(([badge, name, meta, price], i) => (
            <div className="wp-card" key={name}>
              <div className="wp-img"><span className="wp-badge">{badge}</span><span className="wp-mic" style={{ transform: `rotate(${[-8, 6, -3][i]}deg)` }} /></div>
              <div className="wp-body">
                <div className="wp-name">{name}</div>
                <div className="wp-meta">{meta}</div>
                <div className="wp-row"><span className="wp-price">{price}</span><span style={{ display: 'flex', gap: 8 }}><span className="wp-cta alt">Compare</span><span className="wp-cta">See deal</span></span></div>
              </div>
            </div>
          ))}
        </div>
        <div className="wp-sec">
          <div>
            <div className="wp-h2">How they sounded in a small room</div>
            <p className="wp-p">Dynamic mics only hear what is close to them, which is why all three beat the condenser mics we tried: the bare walls barely reached the recording.</p>
            <table className="wp-tbl">
              <thead><tr><th>Mic</th><th>Room echo kept out</th><th>Desk noise</th><th>Setup</th></tr></thead>
              <tbody>
                <tr><td>Rode PodMic USB</td><td><span className="wp-bar"><i style={{ width: '88%' }} /></span></td><td>Low</td><td>App, 2 min</td></tr>
                <tr><td>Samson Q9U</td><td><span className="wp-bar"><i style={{ width: '82%' }} /></span></td><td>Low</td><td>Plug in</td></tr>
                <tr><td>Shure MV7+</td><td><span className="wp-bar"><i style={{ width: '90%' }} /></span></td><td>Very low</td><td>App, 3 min</td></tr>
              </tbody>
            </table>
          </div>
          <div className="wp-note">
            <div className="wp-h2" style={{ fontSize: 20 }}>Our pick for most desks</div>
            <p className="wp-p">The Samson Q9U sounds nearly as clean as the Rode for $50 less, and it works the moment you plug it in.</p>
            <p className="wp-p" style={{ marginBottom: 0 }}>Keep it a hand's width from your mouth and turn the gain down: in a small room, distance matters more than the mic.</p>
          </div>
        </div>
      </div>
      {pointer ? (
        <div className="pm-pointer" style={{ left: pointer.x * z, top: pointer.y * z }}>
          <span className="pm-ring" />
          <span className="pm-tag"><BotFace profile={pointer.bot.profile} size={18} poseKey={pointer.bot.poseKey} watch={false} />{pointer.label}</span>
        </div>
      ) : null}
    </div>
  )
}
