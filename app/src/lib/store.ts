// The app's state: Chief's chat, a chat with each agent you open, the agents, and everything that needs
// you. A tiny external store (subscribe + snapshot) that React reads through useSyncExternalStore.
import { createContext, useContext, useSyncExternalStore } from 'react'

export type BotStatus = 'free' | 'working' | 'needs' | 'asleep' | 'error'

export interface ToolCall {
  id: string
  name: string
  args?: any
  preview?: string
  done?: boolean
  error?: boolean
  duration?: number
  summary?: string
}

export interface Msg {
  id: string
  role: 'user' | 'assistant' | 'notice' | 'command'
  /** For a command card: what you typed, and whether its answer is still coming. */
  command?: string
  pending?: boolean
  text: string
  at?: number
  tools?: ToolCall[]
  thinking?: string
  streaming?: boolean
  error?: boolean
  images?: string[]
  /** Bot names Chief handed work to in this turn (message_agent targets). */
  handoffs?: string[]
  /** For a notice: an answer that came back from a bot. */
  from?: string
  startedAt?: number
  endedAt?: number
}

export interface Bot {
  profile: string
  name: string
  isChief: boolean
  role?: string
  home?: string
  canonicalId?: string
  runtimeId?: string
  status: BotStatus
  since?: number
  step?: string
  preview?: string
  lastActive?: number
  model?: string
  online: boolean
  poseKey?: string
  canonicalCount?: number
  workerId?: string
  workerTitle?: string
}

export interface Need {
  key: string
  kind: 'approval' | 'clarify' | 'input'
  /** For kind 'input': what Hermes asks you to type (a sudo password, a key a skill needs, a site login or code). */
  input?: { method: string; command?: string; envVar?: string; prompt?: string; site?: string; hint?: string; origin?: string; displayName?: string }
  profile: string
  sessionId: string
  requestId?: string
  rpcId: string
  generation?: number
  title: string
  command?: string
  description?: string
  choices?: string[]
  questions?: { qid: string; question: string; choices?: string[]; multi_select?: boolean }[]
  at: number
  outcome?: { label: string; ok: boolean }
}

export interface ChatState {
  sessionId?: string
  runtimeId?: string
  messages: Msg[]
  loading: boolean
  hasOlder: boolean
  busy: boolean
  turnStartedAt?: number
  step?: string
  model?: string
  provider?: string
  /** Thinking effort for this chat (none … max) and fast mode (normal | fast). */
  effort?: string
  fast?: string
  personality?: string
  /** When you last wrote to this agent yourself: its next reply is yours, so it may notify you. */
  askedAt?: number
}

export interface PanelChat { profile: string; messages: Msg[]; loading: boolean; source?: 'chat' | 'run'; title?: string }

export interface State {
  connection: 'connecting' | 'open' | 'closed' | 'error'
  connectionError?: string
  host: string
  bots: Bot[]
  chief: ChatState
  /** Each agent's own chat ("Bot Chat"), loaded when you open it. Chief's is `chief`. */
  chats: Record<string, ChatState>
  /** Whose chat is in focus in the middle: 'default' is Chief. */
  chatWith: string
  /** The chats side by side in the middle, left to right: an agent's profile ('default' is Chief) or
   *  'group:<room id>'. The one in focus is groupOpen's group, else chatWith's chat. */
  panes: string[]
  needs: Need[]
  panel: string | null // a bot profile, 'browser:' / 'screen:' / 'term:<profile>', '__needs', or null
  /** A group chat open in the middle (instead of an agent's chat): its room id. */
  groupOpen: string | null
  lastPanel: string | null
  view: 'chat' | 'made' | 'scheduled' | 'apps' | 'settings' | 'marketplace' | 'projects'
  /** This system's Hermes has an agent screen (Linux): it can show beside the chat. */
  screenSupported?: boolean
  /** The Settings page open, and the bot the per-bot pages are about. */
  settingsPage: string
  scope: string
  /** Marketplace tab and the bot installs go to. */
  marketTab: string
  /** Bot Mode group rooms. */
  rooms: { room_id: string; name: string; members: string[] }[]
  panelChat: Record<string, PanelChat>
  models: { provider?: string; model?: string; options?: { id: string; label: string; provider?: string }[] }
  toast?: string
  tick: number
}

let state: State = {
  connection: 'connecting',
  host: 'This computer',
  bots: [],
  chief: { messages: [], loading: true, hasOlder: false, busy: false },
  chats: {},
  chatWith: 'default',
  panes: ['default'],
  needs: [],
  panel: null,
  groupOpen: null,
  lastPanel: null,
  view: 'chat',
  settingsPage: 'team',
  scope: 'default',
  marketTab: 'plugins',
  rooms: [],
  panelChat: {},
  models: {},
  tick: 0,
}

const listeners = new Set<() => void>()
export function getState() { return state }
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}
export function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state))
}

export function updateChief(patch: Partial<ChatState> | ((c: ChatState) => Partial<ChatState>)) {
  setState((s) => ({ chief: { ...s.chief, ...(typeof patch === 'function' ? patch(s.chief) : patch) } }))
}
const EMPTY_CHAT: ChatState = { messages: [], loading: true, hasOlder: false, busy: false }
/** The chat with `profile`: Chief's, or an agent's (empty until it's opened). */
export function chatOf(s: State, profile: string): ChatState { return profile === 'default' ? s.chief : s.chats[profile] ?? EMPTY_CHAT }
export function updateChat(profile: string, patch: Partial<ChatState> | ((c: ChatState) => Partial<ChatState>)) {
  if (profile === 'default') { updateChief(patch); return }
  setState((s) => { const cur = s.chats[profile] ?? EMPTY_CHAT; return { chats: { ...s.chats, [profile]: { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) } } } })
}
/** Which chat in the middle has focus: its pane key (an agent's profile, or 'group:<room id>'). */
export const focusKeyOf = (s: State) => (s.groupOpen ? `group:${s.groupOpen}` : s.chatWith)
/** Put `key` in focus: the pane already showing it, or else it takes the focused pane's place. */
export function placeFocus(s: State, key: string): Partial<State> {
  const cur = focusKeyOf(s)
  let panes = s.panes.length ? s.panes : [cur]
  if (!panes.includes(key)) {
    const i = panes.indexOf(cur)
    panes = panes.map((k, j) => (j === (i >= 0 ? i : panes.length - 1) ? key : k))
  }
  return key.startsWith('group:') ? { panes, groupOpen: key.slice(6) } : { panes, chatWith: key, groupOpen: null }
}
/** The agent whose chat a component belongs to, when chats sit side by side (unset: the chat in focus). */
export const PaneProfile = createContext<string | null>(null)
export function usePaneProfile(): string {
  const pane = useContext(PaneProfile)
  const focused = useStore((s) => s.chatWith)
  return pane ?? focused
}
/** The chat this component belongs to (its pane's, else the one in focus), and whose it is. */
export function useChat(): { profile: string; chat: ChatState } {
  const profile = usePaneProfile()
  const chat = useStore((s) => chatOf(s, profile))
  return { profile, chat }
}
export function updateBot(profile: string, patch: Partial<Bot>) {
  setState((s) => ({ bots: s.bots.map((b) => (b.profile === profile ? { ...b, ...patch } : b)) }))
}
export function botByProfile(profile: string) { return state.bots.find((b) => b.profile === profile) }
export const pendingNeeds = (s: State) => s.needs.filter((n) => !n.outcome)
