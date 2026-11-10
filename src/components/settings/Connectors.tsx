// Connectors: every app Hermes can use, in one place, as Hermes Remote lays it out. What needs you,
// what's connected (managed apps from your Nous account and servers on this Mac, each with its switch),
// suggestions from what you ask Chief, the rest A to Z, and adding your own server. Managed apps follow
// the account; servers on this Mac belong to the bot picked in the header.
import { useMemo, useState } from 'react'
import { Icon } from '../../lib/icons'
import { getState, setState } from '../../lib/store'
import { agoText, appTrouble, suggestions, type AppEntry } from '../../lib/api-market'
import { Empty, ErrorLine, Logo, Search, Switch, Tabs } from '../ui'
import { KindBadge, Note, Pill, RowButton, Section, Skeleton } from '../market/parts'
import { availableMeta, kindLabel, metaFor, useConnectors, type ConnectorsModel } from '../market/useConnectors'

type Seg = 'all' | 'connected' | 'managed' | 'mac'

export function ConnectorsPage({ profile }: { profile: string }) {
  const m = useConnectors(profile)
  const [q, setQ] = useState('')
  const [seg, setSeg] = useState<Seg>('all')
  const { snap } = m

  const t = q.trim().toLowerCase()
  const matches = (e: AppEntry) => !t || `${e.name} ${e.description} ${e.category} ${e.hostedSlug ?? ''}`.toLowerCase().includes(t) || (m.toolNames[e.hostedSlug ?? ''] ?? []).some((n) => n.toLowerCase().includes(t))
  const inSeg = (e: AppEntry) => seg === 'managed' ? e.kind === 'managed' : seg === 'mac' ? e.kind !== 'managed' : true
  const connected = (snap?.connected ?? []).filter((e) => inSeg(e) && matches(e))
  const needsYou = connected.filter((e) => appTrouble(e))
  const more = seg === 'connected' ? [] : (snap?.available ?? []).filter((e) => inSeg(e) && matches(e))
  const suggested = useMemo(() => {
    if (!snap) return []
    const texts = getState().chief.messages.filter((x) => x.role === 'user').map((x) => x.text)
    return suggestions(snap.available, texts)
  }, [snap])
  const totalNeeds = (snap?.connected ?? []).filter((e) => appTrouble(e)).length

  return (
    <>
      <div className="shead">
        <div className="tx"><h1>Connectors</h1><p>Apps {m.botName} can use: managed apps from your Nous account, and servers that run on this Mac.</p></div>
        <button className="b-soft mk-hbtn" onClick={m.addOwn}><Icon name="plus" size={15} />Add your own server</button>
      </div>
      {snap ? (
        <div className="mk-pills">
          <Pill tone="ok">{snap.connected.length} connected</Pill>
          {totalNeeds ? <Pill tone="need">{totalNeeds} need{totalNeeds === 1 ? 's' : ''} you</Pill> : null}
          <Pill>{snap.available.length} more to add</Pill>
        </div>
      ) : null}
      <div className="stools">
        <Search value={q} onChange={setQ} placeholder="Search apps, servers and tools" />
        <Tabs<Seg> items={[{ key: 'all', label: 'All' }, { key: 'connected', label: 'Connected' }, { key: 'managed', label: 'Managed' }, { key: 'mac', label: 'On this Mac' }]} value={seg} onChange={setSeg} />
      </div>
      {snap?.hostedNotice && seg !== 'mac' ? <Note tone="need">{snap.hostedNotice}{snap.hostedReason === 'NEEDS_NOUS_AUTH' ? <> <button className="mk-link" onClick={() => setState({ settingsPage: 'keys' })}>Open Keys and accounts</button></> : null}</Note> : null}
      {m.note ? <Note tone="ok" onDismiss={() => m.setNote(undefined)}>{m.note}</Note> : null}
      {snap?.localError && seg !== 'managed' ? <Note tone="bad">The servers on this Mac couldn’t be read: {snap.localError}</Note> : null}

      {!snap ? (m.error ? <ErrorLine text={m.error} onRetry={() => void m.reload()} /> : <Skeleton rows={5} />) : (
        <>
          {needsYou.length ? <div className="mk-stack flow">{needsYou.map((e) => <NeedsYou key={e.key} e={e} m={m} />)}</div> : null}

          <Section title="Connected" note="Hermes can use these" right={<>
            {seg !== 'managed' ? <button className="b-text mk-sm" onClick={m.editJson} title="Edit this agent’s servers as mcp.json"><Icon name="file" size={14} />Edit as mcp.json</button> : null}
            <button className="hbtn" title="Read again" onClick={() => void m.reload()}>{m.loading ? <span className="spin" style={{ width: 13, height: 13 }} /> : <Icon name="refresh" size={14} />}</button>
          </>} />
          {connected.length ? (
            <div className="card flow">
              {connected.map((e) => <ConnectedRow key={e.key} e={e} m={m} />)}
            </div>
          ) : <p className="mk-muted mk-pad">{t ? 'Nothing connected matches.' : 'Nothing connected yet. Pick an app below, or add your own server.'}</p>}

          {seg === 'all' && !t && suggested.length ? (
            <>
              <Section title="Suggested for you" note="From what you ask Quicksilver" />
              <div className="tiles flow">
                {suggested.map((e) => (
                  <div key={e.key} className="tile-c" onClick={() => m.connect(e)}>
                    <div className="th"><Logo src={e.logo} name={e.name} size={36} /><div className="tx"><div className="tt">{e.name}</div><div className="ts">{availableMeta(e)}</div></div></div>
                    <div className="td">{e.description || availableMeta(e)}</div>
                    <div className="tf"><span className="sp" /><RowButton onClick={() => m.connect(e)}>{e.kind === 'managed' ? 'Connect' : 'Install'}</RowButton></div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {seg !== 'connected' ? (
            more.length ? (
              <>
                <Section title={seg === 'mac' ? 'More servers' : seg === 'managed' ? 'More managed apps' : 'More apps'} note="A to Z" />
                <div className="card">
                  {more.map((e) => (
                    <div key={e.key} className="srow">
                      <Logo src={e.logo} name={e.name} size={34} />
                      <div className="tx"><div className="t1"><span>{e.name}</span></div><div className="t2">{e.description ? `${availableMeta(e)} · ${e.description}` : availableMeta(e)}</div></div>
                      <div className="act"><RowButton onClick={() => m.connect(e)}>{e.kind === 'managed' ? 'Connect' : 'Install'}</RowButton></div>
                    </div>
                  ))}
                </div>
              </>
            ) : t && !connected.length ? <Empty title="Nothing matches" body="Add your own server if Hermes doesn’t list it." /> : null
          ) : null}

          {seg !== 'managed' ? (
            <button className="card mk-addown" onClick={m.addOwn}>
              <span className="mk-ico"><Icon name="terminal" size={18} /></span>
              <span className="tx"><b>Add your own server</b><span>A web address, or a command on this Mac</span></span>
              <Icon name="chevR" size={15} />
            </button>
          ) : null}
          <p className="mk-foot">Managed apps follow your Nous account, so every agent shares them. Servers on this Mac belong to {m.botName}; pick another agent at the top to see theirs. <button className="mk-link" onClick={() => setState({ view: 'marketplace', marketTab: 'apps' })}>Browse apps in the Marketplace</button></p>
        </>
      )}
      {m.dialogs}
    </>
  )
}

function ConnectedRow({ e, m }: { e: AppEntry; m: ConnectorsModel }) {
  const on = m.isOn(e)
  const trouble = appTrouble(e)
  return (
    <div className="srow click" onClick={() => m.openApp(e)}>
      <Logo src={e.logo} name={e.name} size={34} />
      <div className="tx">
        <div className="t1"><span className={on ? '' : 'mk-dim'}>{e.name}</span><KindBadge>{kindLabel(e)}</KindBadge></div>
        <div className={`t2${trouble ? ' mk-warn' : ''}`}>{metaFor(e, on, m.usage, m.toolCounts)}</div>
      </div>
      <div className="act">
        <Switch on={on} onChange={(v) => m.toggle(e, v)} disabled={(e.kind === 'managed' && e.orgLocked) || e.kind === 'plugin'} label={`Hermes can use ${e.name}`} />
      </div>
    </div>
  )
}

/** An app that needs you: what went wrong in a sentence, Reconnect and Turn it off. */
function NeedsYou({ e, m }: { e: AppEntry; m: ConnectorsModel }) {
  const t = appTrouble(e)!
  const ago = agoText(t.since)
  const line = t.status === 'expired' ? `Access ran out${ago ? ` ${ago}` : ''}, so Hermes can’t use it.`
    : t.status === 'revoked' ? `Access was taken back${ago ? ` ${ago}` : ''}, so Hermes can’t use it.`
    : t.status === 'failed' && e.kind === 'managed' ? 'The last sign-in didn’t finish, so Hermes can’t use it.'
    : t.status === 'inactive' ? 'It’s paused at Nous, so Hermes can’t use it.'
    : t.status === 'needs_sign_in' ? 'Its sign-in ran out on this Mac, so Hermes can’t use it.'
    : 'It stopped answering on this Mac.'
  const action = t.status === 'failed' && e.kind !== 'managed' ? 'Try again' : t.status === 'needs_sign_in' ? 'Sign in again' : 'Reconnect'
  return (
    <div className="mk-needs">
      <Logo src={e.logo} name={e.name} size={38} />
      <div className="tx"><b>{e.name} needs you</b><span>{line}</span></div>
      <div className="act">
        <button className="b-text" onClick={() => m.toggle(e, false)} disabled={e.kind === 'plugin'}>Turn it off</button>
        <RowButton onClick={() => void m.reconnect(e)} busy={m.busy === e.key}>{action}</RowButton>
      </div>
    </div>
  )
}
