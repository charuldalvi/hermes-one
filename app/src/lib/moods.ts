// A bot's live state → its Quicksilver mood (Hermes Remote's rules): small faces call out in amber when
// they need you, big ones raise a hand or knock; working thinks or writes; offline dozes.
import type { Mood } from '../components/BotFace'
import type { Bot, ChatState, Need } from './store'

export function botMood(bot: Bot | undefined, size: number, needs: Need[]): Mood {
  if (!bot) return 'idle'
  if (!bot.online) return 'doze'
  const waiting = needs.find((n) => !n.outcome && n.profile === bot.profile)
  if (waiting || bot.status === 'needs') return size >= 40 ? (waiting?.kind === 'clarify' ? 'knock' : 'hand') : 'callout'
  if (bot.status === 'working') return bot.step?.startsWith('Writing') ? 'writing' : 'thinking'
  if (bot.status === 'asleep') return 'doze'
  if (bot.status === 'free' && bot.since && Date.now() - bot.since < 2200) return 'hop'
  return 'idle'
}

export function chiefMood(chief: ChatState, size: number, needs: Need[]): Mood { return chatMood('default', chief, size, needs) }
/** The face of whoever a chat is with, from that chat: asking you, thinking, writing or idle. */
export function chatMood(profile: string, chief: ChatState, size: number, needs: Need[]): Mood {
  const waiting = needs.find((n) => !n.outcome && n.profile === profile)
  if (waiting) return size >= 40 ? (waiting.kind === 'clarify' ? 'knock' : 'hand') : 'callout'
  if (chief.busy) return chief.step === 'Writing' ? 'writing' : 'thinking'
  return 'idle'
}
