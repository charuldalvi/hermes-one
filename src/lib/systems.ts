// Systems: Hermes on this computer, or on another one (by Tailscale or an address, or by SSH), one at a time.
// The main process keeps the list and the sign-ins (electron/systems.ts); switching starts the window over.
import { useCallback, useEffect, useState } from 'react'

export interface SystemRow {
  id: string; name: string; kind: 'local' | 'address' | 'ssh'; active: boolean; detail: string; signedIn?: boolean
  url?: string; user?: string; host?: string; port?: number; key?: string; hermes?: string
}

export function useSystems() {
  const [rows, setRows] = useState<SystemRow[]>([])
  const reload = useCallback(() => { void window.hermesNative.systems?.().then((r) => setRows(r ?? [])) }, [])
  useEffect(reload, [reload])
  const active = rows.find((r) => r.active) ?? rows[0]
  return { rows, active, reload }
}

// The system this window shows, for words like "Can't reach hermes-vps" (loaded once; switching reloads the window).
let current: SystemRow | null = null
export const currentSystem = () => current
export async function loadCurrentSystem() { try { current = (await window.hermesNative.systems?.())?.find((r) => r.active) ?? null } catch { current = null } }
