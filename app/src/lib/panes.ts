// Several chats side by side in the middle (up to four, as many as fit): agents' chats and group chats alike.
// One has focus: it's the chat you type to, the side panel follows its agent, and the sidebar selects it.
// A click in the sidebar shows that chat in the focused pane (or focuses it where it already is); ⌘-click, or
// dragging its row onto the chats, opens it beside them.
import type { DragEvent, MouseEvent } from 'react'
import { openChat } from './hermes'
import { openGroup } from './groups'
import { focusKeyOf, getState, setState, subscribe } from './store'

export const MAX_PANES = 4
/** The narrowest a chat gets beside others before one has to close. */
const MIN_PANE = 400

/** How many chats fit side by side now: the window less the sidebar and the side panel. */
export function panesThatFit() {
  const side = document.querySelector('.side')?.getBoundingClientRect().width ?? 280
  const panel = document.querySelector('.rp')?.getBoundingClientRect().width ?? 0
  return Math.max(1, Math.min(MAX_PANES, Math.floor((window.innerWidth - side - panel) / MIN_PANE)))
}

// The order chats were last in focus (oldest first): when there's no room, the one used longest ago closes.
const used: string[] = []
let watching = false
function watchFocus() {
  if (watching) return
  watching = true
  let last = ''
  subscribe(() => {
    const k = focusKeyOf(getState())
    if (k === last) return
    last = k
    const i = used.indexOf(k); if (i >= 0) used.splice(i, 1)
    used.push(k)
  })
}
watchFocus()

/** Focus the chat in `key` (an agent's profile, or 'group:<room id>'). */
export function focusPane(key: string) {
  if (getState().view === 'chat' && key === focusKeyOf(getState())) return
  if (key.startsWith('group:')) openGroup(key.slice(6))
  else openChat(key)
}

/** Open a chat beside the others (at `at`, else right of the one in focus) and focus it. Already open: it moves
 *  there when dropped somewhere, else it just takes focus. */
export function openBeside(key: string, at?: number) {
  const s = getState()
  if (s.view !== 'chat') setState({ view: 'chat' })
  if (s.panes.includes(key) && at === undefined) { focusPane(key); return }
  let panes = s.panes.filter((k) => k !== key)
  const from = s.panes.indexOf(key)
  let i = at ?? panes.indexOf(focusKeyOf(s)) + 1
  if (at !== undefined && from >= 0 && from < at) i -= 1 // it left a gap before the drop point
  if (i <= 0 && at === undefined) i = panes.length
  panes.splice(Math.max(0, Math.min(i, panes.length)), 0, key)
  // No room for another: the chat used longest ago closes (it's still in the sidebar).
  while (panes.length > panesThatFit()) {
    const others = panes.filter((k) => k !== key)
    const oldest = others.slice().sort((a, b) => used.indexOf(a) - used.indexOf(b))[0]
    panes = panes.filter((k) => k !== oldest)
  }
  setState({ panes })
  focusPane(key)
}

/** Close one of the chats side by side; the focus moves to its neighbour. The last chat can't close. */
export function closePane(key: string) {
  const s = getState()
  if (s.panes.length <= 1 || !s.panes.includes(key)) return
  const i = s.panes.indexOf(key)
  const panes = s.panes.filter((k) => k !== key)
  const wasFocus = key === focusKeyOf(s)
  setState({ panes })
  if (wasFocus) focusPane(panes[Math.max(0, i - 1)])
}

/** A sidebar row being dragged carries its chat's key under this type. */
export const PANE_DRAG = 'application/x-hermes-one-chat'

/** A chat's sidebar row: a click shows it in the chat in focus, ⌘-click (or dragging the row onto the chats) opens
 *  it beside them. */
export const chatRowProps = (key: string, open: () => void) => ({
  onClick: (e: MouseEvent) => (e.metaKey || e.ctrlKey ? openBeside(key) : open()),
  draggable: true,
  onDragStart: (e: DragEvent) => { e.dataTransfer.setData(PANE_DRAG, key); e.dataTransfer.effectAllowed = 'copyMove' },
})
