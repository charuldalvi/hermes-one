// The agent screen ("Bot Screen"): a Linux desktop an agent drives on the system Hermes runs on, streamed as
// VNC (RFB) over Hermes' own connection (display.* RPCs, /api/display/ws). Only some systems have one: Hermes
// shows it on Linux (like a VPS), not on a Mac running Hermes itself.
import { gateway } from './gateway'
import { setState } from './store'

export interface DisplayLease { holder: 'agent' | 'human'; viewer_hash: string | null; since: number; reason: string; epoch: number }
export interface DisplayStatus {
  profile: string; supported: boolean; installed: boolean; missing: string[]; running: boolean; geometry: string
  install_command?: string | null; blocker?: string | null; lease?: DisplayLease; profile_key?: string
}

export const displayStatus = (profile: string) => gateway.request<DisplayStatus>('display.status', { profile }, 15_000)

/** After each connection: does this system's Hermes have a screen? (The Screen page shows only if so.) */
export function startScreenWatch() {
  gateway.onReady(() => {
    setState({ screenSupported: false })
    void displayStatus('default').then((s) => setState({ screenSupported: !!s?.supported }), () => {})
  })
}

/** The lease's short hash for a viewer id, to know whether this window holds the screen. */
export async function viewerHash(id: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12)
}
