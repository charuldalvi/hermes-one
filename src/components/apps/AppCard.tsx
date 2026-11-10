// The card under a bot's reply when it published an app: the app's tile, its name, and Open, which shows
// it on the Apps page. The chat (Chat.tsx) draws one for each successful publish_app call in a turn.
import { useEffect } from 'react'
import '../../styles/apps.css'
import { openApp, refreshApps, useApps } from '../../lib/apps'
import { Spinner } from '../ui'
import { AppTile } from './Glyph'

/**
 * `appId` is publish_app's `id` argument. `state` is optional: "building" while the call runs, "failed"
 * when it returned an error (the old version, if any, stays live). `version` is the one that call
 * published, when the caller knows it; otherwise the card names the live version.
 */
export function AppCard({ appId, state, version }: { appId: string; state?: 'building' | 'failed'; version?: number }) {
  const list = useApps((s) => s.list)
  useEffect(() => { if (list === null) void refreshApps() }, [list])
  const app = list?.find((a) => a.id === appId)
  if (state === 'building') {
    return <div className="ha-pub quiet"><Spinner size={12} /><span>Building {app?.name ?? appId}…</span></div>
  }
  if (state === 'failed') {
    return <div className="ha-pub quiet"><i className="dot bad" /><span>{app ? `${app.name} didn’t update, so the old version stays live` : `${appId} didn’t publish`}</span></div>
  }
  if (!app) return null
  const v = version ?? app.version
  return (
    <button className="ha-pub" onClick={() => openApp(app.id)}>
      <AppTile app={app} size={40} />
      <span className="ha-pub-tx">
        <b>{app.name}</b>
        <span>{v > 1 ? `Updated · version ${v}` : 'New app'}{app.description ? ` · ${app.description}` : ''}</span>
      </span>
      <span className="ha-pub-open">Open</span>
    </button>
  )
}
