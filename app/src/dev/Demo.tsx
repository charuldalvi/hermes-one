// Development only (snapshot runs): a made-up team and conversation for README screenshots, so no real chats,
// agents or files ever end up in them. It disconnects from Hermes first, so nothing real comes in.
//   __hermesOneTest.demo('chat' | 'browser' | 'terminal')
// The browser scene shows a real headless Chrome: start one under a scratch Hermes home's
// profiles/researcher folder and run with HERMES_ONE_TEST_BROWSER_ROOT pointing at that home.
import { gateway } from '../lib/gateway'
import { showDemoGroups, type Room } from '../lib/groups'
import { assignLooks } from '../lib/looks'
import { setState, updateChat, type Bot, type Msg } from '../lib/store'
import { showDemoTerm } from '../lib/terminals'

const min = 60_000
const now = () => Date.now()
const AGENTS: { profile: string; name: string; role: string }[] = [
  { profile: 'researcher', name: 'Researcher', role: 'Finds sources and checks the facts' },
  { profile: 'writer', name: 'Writer', role: 'Drafts posts, emails and scripts' },
  { profile: 'designer', name: 'Designer', role: 'Makes cover art, slides and visuals' },
  { profile: 'coder', name: 'Coder', role: 'Builds and fixes the website' },
  { profile: 'tester', name: 'Tester', role: 'Runs the tests and checks the work' },
  { profile: 'inbox', name: 'Inbox', role: 'Keeps mail and messages sorted' },
]

function team(working: Record<string, number>) {
  const bots: Bot[] = [
    { profile: 'default', name: 'Hermes', isChief: true, online: true, status: 'free', poseKey: 'hermes' },
    ...AGENTS.map((a) => ({
      profile: a.profile, name: a.name, role: a.role, isChief: false, online: true, poseKey: a.profile,
      ...(working[a.profile] ? { status: 'working' as const, since: now() - working[a.profile] } : { status: 'free' as const }),
    })),
  ]
  assignLooks(AGENTS.map((a) => a.profile))
  const member = (p: string) => ({ member_id: p, profile: p, handle: p, display_name: AGENTS.find((a) => a.profile === p)?.name ?? p })
  const rooms = [
    { room_id: 'demo-launch', name: 'Launch crew', members: ['researcher', 'writer', 'designer'].map(member) },
    { room_id: 'demo-build', name: 'Website desk', members: ['coder', 'tester'].map(member) },
  ] as unknown as Room[]
  showDemoGroups(rooms)
  return bots
}

const say = (id: string, role: Msg['role'], text: string, ago: number, extra: Partial<Msg> = {}): Msg =>
  ({ id, role, text, at: now() - ago, startedAt: now() - ago - 40_000, endedAt: now() - ago, ...extra })

export async function startDemo(scene: 'chat' | 'browser' | 'terminal') {
  gateway.close() // nothing real comes in from here on
  window.dispatchEvent(new CustomEvent('hermes:close-panel'))
  if (scene === 'chat') {
    setState({ connection: 'open', view: 'chat', chatWith: 'default', groupOpen: null, needs: [], bots: team({ researcher: 72_000, writer: 41_000 }) })
    setState((s) => ({ chief: { ...s.chief, loading: false, busy: true, turnStartedAt: now() - 12_000, step: 'Asking Writer', messages: [
      say('u1', 'user', 'Plan the launch of our new podcast: a landing page, three social posts and a short trailer script. Keep it friendly.', 9 * min),
      say('a1', 'assistant', "On it. I've split it up so it happens at once:\n\n- **Researcher** is checking what similar shows did for their launch.\n- **Writer** is drafting the three posts and the trailer script.\n- **Designer** makes the cover art once the posts are in.\n\nI'll bring it all back here as one plan.", 8 * min,
        { tools: [{ id: 't1', name: 'message_agent', args: { target: 'researcher' }, done: true }, { id: 't2', name: 'message_agent', args: { target: 'writer' }, done: true }, { id: 't3', name: 'message_agent', args: { target: 'designer' }, done: true }], handoffs: ['researcher', 'writer', 'designer'] }),
      say('a2', 'assistant', "Researcher looked at three comparable launches. What brought the most sign-ups:\n\n| What | Why it worked |\n|---|---|\n| A 60-second trailer | Easy to share, sets the tone |\n| A guest teaser | Borrowed the guest's audience |\n| A launch-day live stream | People subscribed while listening |\n\nWriter is leading with the trailer, and the landing page goes up with the first episode.", 3 * min,
        { tools: [{ id: 't4', name: 'web_search', args: { query: 'podcast launch what worked' }, done: true }] }),
      say('u2', 'user', 'Love it. Can the trailer mention our first guest?', 0.3 * min),
      { id: 'a3', role: 'assistant', text: '', at: now() - 12_000, startedAt: now() - 12_000, streaming: true, tools: [{ id: 't5', name: 'message_agent', args: { target: 'writer' } }], handoffs: ['writer'] },
    ] } }))
    return
  }
  if (scene === 'browser') {
    setState({ connection: 'open', view: 'chat', chatWith: 'researcher', groupOpen: null, needs: [], bots: team({ researcher: 64_000 }) })
    updateChat('researcher', { loading: false, busy: true, turnStartedAt: now() - 64_000, step: 'Using the browser', sessionId: 'demo', messages: [
      say('r1', 'user', 'What makes a podcast launch go well? Look at a few sources and give me the three things that matter most.', 2 * min),
      say('r2', 'assistant', "Starting with the basics of how podcasts reach listeners, then comparable launches. I'll mark anything I couldn't confirm.", 1.1 * min),
      { id: 'r3', role: 'assistant', text: '', at: now() - 64_000, startedAt: now() - 64_000, streaming: true, tools: [{ id: 'b1', name: 'browser_navigate', done: true }, { id: 'b2', name: 'browser_scroll' }] },
    ] })
    window.dispatchEvent(new CustomEvent('hermes:open-panel', { detail: { profile: 'browser:researcher' } }))
    return
  }
  // terminal
  setState({ connection: 'open', view: 'chat', chatWith: 'coder', groupOpen: null, needs: [], bots: team({ coder: 104_000 }) })
  updateChat('coder', { loading: false, busy: true, turnStartedAt: now() - 104_000, step: 'Running a command', sessionId: 'demo', messages: [
    say('c1', 'user', 'Add a dark mode toggle to the landing page header, and make sure the tests still pass.', 2.5 * min),
    say('c2', 'assistant', "I'll hand the change to Claude Code in the site's folder and run the tests after. You can watch it on the right.", 1.9 * min),
    { id: 'c3', role: 'assistant', text: '', at: now() - 104_000, startedAt: now() - 104_000, streaming: true, tools: [{ id: 'x1', name: 'read_file', args: { path: 'site/src/Header.tsx' }, done: true }, { id: 'x2', name: 'terminal', args: { command: 'claude -p "Add a dark mode toggle…"' } }] },
  ] })
  const t0 = now()
  showDemoTerm({ id: 'demo:status', profile: 'coder', command: 'git status', cwd: '~/projects/podcast-site', status: 'done', exit: 0, startedAt: t0 - 140_000, endedAt: t0 - 139_000 },
    'On branch main\r\nnothing to commit, working tree clean\r\n')
  showDemoTerm({ id: 'demo:test', profile: 'coder', command: 'npm test', cwd: '~/projects/podcast-site', status: 'done', exit: 0, startedAt: t0 - 130_000, endedAt: t0 - 124_000 },
    '\x1b[32m PASS \x1b[0m src/Header.test.tsx\r\n\x1b[32m PASS \x1b[0m src/Episode.test.tsx\r\n\r\nTests: \x1b[32m18 passed\x1b[0m, 18 total\r\n')
  showDemoTerm({ id: 'demo:claude', profile: 'coder', command: 'claude -p "Add a dark mode toggle to the header, keep tests passing" --max-turns 12', cwd: '~/projects/podcast-site', status: 'running', startedAt: t0 - 102_000, processId: 'demo' },
    [
      '\x1b[34m●\x1b[0m Reading src/components/Header.tsx', '\x1b[34m●\x1b[0m Reading src/styles/theme.css', '\x1b[34m●\x1b[0m Reading src/components/Header.test.tsx',
      '\x1b[33m●\x1b[0m Editing src/components/Header.tsx \x1b[32m+18\x1b[0m \x1b[31m−2\x1b[0m', '\x1b[33m●\x1b[0m Editing src/styles/theme.css \x1b[32m+24\x1b[0m',
      '\x1b[33m●\x1b[0m Creating src/hooks/useTheme.ts \x1b[32m+31\x1b[0m', '\x1b[34m●\x1b[0m Running npm test',
      '\x1b[2m  PASS  src/components/Header.test.tsx\x1b[0m', '\x1b[2m  PASS  src/hooks/useTheme.test.ts\x1b[0m', '\x1b[32m  Tests: 20 passed, 20 total\x1b[0m',
      '\x1b[34m●\x1b[0m Checking the toggle remembers the choice after a reload',
    ].join('\r\n') + '\r\n')
  window.dispatchEvent(new CustomEvent('hermes:open-panel', { detail: { profile: 'term:coder' } }))
}
