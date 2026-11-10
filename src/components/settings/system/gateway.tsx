// Restarting Hermes' messaging gateway from anywhere (a saved Telegram token, webhooks turned on,
// the System page): ask first, naming every bot that blips and any chat cut off mid-answer, then
// follow the restart until the new gateway answers. This app reconnects on its own afterwards.
import { actionStatus, gatewayAction, status } from '../../../lib/api-system'
import { prettyName, toast } from '../../../lib/hermes'
import { getState } from '../../../lib/store'
import { confirm } from '../../ui'
import { errText } from './parts'

const names = (profiles: string[]) => profiles.map((p) => getState().bots.find((b) => b.profile === p)?.name ?? prettyName(p))

/** The words for "what a restart or stop interrupts", from the live status. */
export async function interruptNote(verb: 'restart' | 'stop'): Promise<{ text: string; busy: boolean }> {
  try {
    const s = await status()
    const shared = (s.gateway_shared_with ?? []).filter(Boolean)
    const busy = !!s.gateway_busy || (s.active_agents ?? 0) > 0
    const parts: string[] = []
    if (shared.length > 1) parts.push(`One gateway serves all ${shared.length} agents here (${names(shared).join(', ')}), so ${verb === 'restart' ? 'it restarts' : 'it stops'} messaging for every one of them.`)
    if (busy) parts.push(`${s.active_agents && s.active_agents > 1 ? `${s.active_agents} chats are` : 'A chat is'} in the middle of an answer right now and will be cut off.`)
    else parts.push(verb === 'restart' ? 'Telegram and the other apps drop for a few seconds; chats pick up where they were.' : 'Agents stop answering on Telegram and the other apps until you start it again.')
    return { text: parts.join(' '), busy }
  } catch {
    return { text: verb === 'restart' ? 'Messaging drops for a few seconds. A chat in the middle of an answer is cut off.' : 'Agents stop answering on Telegram and the other apps until you start it again.', busy: false }
  }
}

/** Follows a gateway action across the restart window; true when the new gateway came back clean. */
export async function followGateway(name: string, maxMs = 90_000): Promise<boolean> {
  const end = Date.now() + maxMs
  let answered = false
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 1300))
    let s
    try { s = await actionStatus(name, 50) } catch { continue }
    answered = true
    if (s.running) continue
    if (s.exit_code === null) continue
    return s.exit_code === 0
  }
  return answered
}

/** Asks, restarts, follows; resolves true when messaging is back. */
export async function restartMessaging(reason?: string): Promise<boolean> {
  const note = await interruptNote('restart')
  const ok = await confirm({ title: 'Restart messaging now?', body: `${reason ? `${reason} ` : ''}${note.text}`, action: note.busy ? 'Restart anyway' : 'Restart', danger: note.busy })
  if (!ok) return false
  toast('Restarting messaging…')
  try {
    const r = await gatewayAction('restart')
    const back = await followGateway(r?.name || 'gateway-restart')
    toast(back ? 'Messaging is back' : 'The restart didn’t finish. Check System › Logs.')
    return back
  } catch (e) { toast(`Couldn’t restart: ${errText(e)}`); return false }
}
