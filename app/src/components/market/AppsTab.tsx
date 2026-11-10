// The Marketplace's Apps tab: Hermes' managed apps (one sign-in each, from your Nous account) and the
// catalog of servers that run on this Mac, in one grid. Connecting and installing reuse the Connectors
// page's flows, so an app behaves the same wherever you meet it.
import { useMemo, useState } from 'react'
import { Icon } from '../../lib/icons'
import { setState } from '../../lib/store'
import { appTrouble, type AppEntry } from '../../lib/api-market'
import { Badge, Empty, ErrorLine, Logo, Search, Select, Tabs } from '../ui'
import { Note, RowButton, Skeleton } from './parts'
import { availableMeta, kindLabel, metaFor, useConnectors } from './useConnectors'

type Seg = 'all' | 'managed' | 'mac' | 'connected'

export function AppsTab({ profile }: { profile: string }) {
  const m = useConnectors(profile)
  const [q, setQ] = useState('')
  const [seg, setSeg] = useState<Seg>('all')
  const [cat, setCat] = useState('')
  const snap = m.snap

  const all = useMemo(() => [...(snap?.connected ?? []), ...(snap?.available ?? [])], [snap])
  const cats = useMemo(() => [...new Set(all.map((e) => e.category).filter(Boolean))].sort(), [all])
  const t = q.trim().toLowerCase()
  const list = all.filter((e) =>
    (seg === 'all' || (seg === 'managed' ? e.kind === 'managed' : seg === 'mac' ? e.kind !== 'managed' : e.connected)) &&
    (!cat || e.category === cat) &&
    (!t || `${e.name} ${e.description} ${e.category}`.toLowerCase().includes(t)),
  ).sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  const counts = { managed: all.filter((e) => e.kind === 'managed').length, mac: all.filter((e) => e.kind !== 'managed').length, connected: all.filter((e) => e.connected).length }

  return (
    <>
      <div className="stools">
        <Search value={q} onChange={setQ} placeholder="Search apps" />
        <Select value={cat} options={[{ value: '', label: 'Every kind' }, ...cats.map((c) => ({ value: c, label: c }))]} onChange={setCat} width={240} align="end" />
      </div>
      <div className="mk-chips">
        <Tabs<Seg> items={[{ key: 'all', label: 'All', count: all.length || undefined }, { key: 'managed', label: 'Managed', count: counts.managed || undefined }, { key: 'mac', label: 'On this Mac', count: counts.mac || undefined }, { key: 'connected', label: 'Connected', count: counts.connected || undefined }]} value={seg} onChange={setSeg} />
        <span className="sp" />
        <button className="b-text mk-sm" onClick={m.addOwn}><Icon name="plus" size={14} />Add your own server</button>
      </div>
      {snap?.hostedNotice && seg !== 'mac' ? <Note tone="need">{snap.hostedNotice}</Note> : null}
      {m.note ? <Note tone="ok" onDismiss={() => m.setNote(undefined)}>{m.note}</Note> : null}
      {!snap ? (m.error ? <ErrorLine text={m.error} onRetry={() => void m.reload()} /> : <Skeleton rows={9} tiles />) : !list.length ? (
        <Empty title="Nothing matches" body="Add your own server if Hermes doesn’t list it." />
      ) : (
        <div className="tiles flow">
          {list.map((e) => <AppTile key={e.key} e={e} m={m} />)}
        </div>
      )}
      <p className="mk-foot">Managed apps follow your Nous account, so every agent shares them. Servers on this Mac install for {m.botName}. <button className="mk-link" onClick={() => setState({ view: 'settings', settingsPage: 'connectors', scope: profile })}>Open Connectors</button></p>
      {m.dialogs}
    </>
  )
}

function AppTile({ e, m }: { e: AppEntry; m: ReturnType<typeof useConnectors> }) {
  const on = m.isOn(e)
  const trouble = e.connected ? appTrouble(e) : null
  return (
    <div className="tile-c" onClick={() => (e.connected ? m.openApp(e) : m.connect(e))}>
      <div className="th"><Logo src={e.logo} name={e.name} size={38} /><div className="tx"><div className="tt">{e.name}</div><div className="ts">{e.connected ? `${kindLabel(e)} · ${metaFor(e, on, m.usage, m.toolCounts)}` : availableMeta(e)}</div></div></div>
      <div className="td">{e.description || availableMeta(e)}</div>
      <div className="tf">
        {e.connected ? (trouble ? <Badge tone="need">Needs you</Badge> : on ? <Badge tone="ok">Connected</Badge> : <Badge tone="quiet">Off</Badge>) : <span className="mk-kind">{e.kind === 'managed' ? 'Managed' : 'On this Mac'}</span>}
        <span className="sp" />
        {e.connected ? (trouble ? <RowButton onClick={() => void m.reconnect(e)} busy={m.busy === e.key}>Reconnect</RowButton> : <RowButton kind="text" onClick={() => m.openApp(e)}>Open</RowButton>)
          : <RowButton onClick={() => m.connect(e)}>{e.kind === 'managed' ? 'Connect' : 'Install'}</RowButton>}
      </div>
    </div>
  )
}
