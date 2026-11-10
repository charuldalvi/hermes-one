// Apps: small live apps the team built for you (a habit tracker, a radio, a dashboard…). A grid of
// tiles; opening one shows its live screens, drawn with Hermes One's own parts (components/apps/).
// Bots build them with the Hermes plugin's publish_app tool; the runtime is electron/apps.ts.
import { useEffect } from 'react'
import '../styles/apps.css'
import { abilityWords, ago, closeApp, openApp, refreshApps, useApps, type AppSummary } from '../lib/apps'
import { useStore } from '../lib/store'
import { AppView, builderName } from './apps/AppView'
import { AppTile } from './apps/Glyph'
import { BotFace } from './BotFace'
import { PageFrame } from './Settings'
import { Badge, Empty, ErrorLine, Spinner } from './ui'

export function Apps() {
  const list = useApps((s) => s.list)
  const open = useApps((s) => s.open)
  const error = useApps((s) => s.error)
  useEffect(() => { void refreshApps() }, [])
  const app = open ? list?.find((a) => a.id === open) : undefined
  // The open app was removed (here or by a bot): back to the grid.
  useEffect(() => { if (open && list && !app) closeApp() }, [open, list, app])
  if (app) return <AppView key={app.id} app={app} />
  return (
    <PageFrame icon="grid" title="Apps" wide>
      <div className="shead">
        <div className="tx">
          <h1>Apps</h1>
          <p>Small live apps your agents made for you. Ask Hermes for one, like “a habit tracker” or “a radio for focus music”.</p>
        </div>
      </div>
      {error ? <ErrorLine text={`Couldn’t load the apps: ${error}`} onRetry={() => void refreshApps()} /> : null}
      {list === null ? <div className="ha-loading"><Spinner size={18} /></div>
        : list.length === 0 ? <Empty title="No apps yet" body="Tell Hermes what you’d like, for example “make me an app that tracks my habits”. It shows up here, and as an Open card in the chat." />
        : <div className="tiles flow">{list.map((a) => <AppTileCard key={a.id} app={a} />)}</div>}
    </PageFrame>
  )
}

function AppTileCard({ app }: { app: AppSummary }) {
  const bots = useStore((s) => s.bots)
  const bot = app.bot ? bots.find((b) => b.profile === app.bot) : undefined
  const words = abilityWords(app)
  return (
    <button className="tile-c ha-tilecard" onClick={() => openApp(app.id)}>
      <div className="th">
        <AppTile app={app} size={40} />
        <div className="tx">
          <div className="tt">{app.name}</div>
          <div className="ts">Version {app.version}{app.publishedAt ? ` · ${ago(app.publishedAt)}` : ''}</div>
        </div>
      </div>
      <div className="td">{app.description || 'No description yet.'}</div>
      <div className="tf">
        {app.bot ? <span className="ha-by"><BotFace profile={app.bot} size={18} poseKey={bot?.poseKey} watch={false} />Made by {builderName(app.bot, bots)}</span> : null}
        {words.slice(0, 2).map((w) => <Badge key={w} tone="quiet">{w}</Badge>)}
      </div>
    </button>
  )
}
