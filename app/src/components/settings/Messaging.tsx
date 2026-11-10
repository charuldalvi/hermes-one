// Messaging: how people reach this bot outside the app. Chat apps (Telegram, Discord, Slack,
// WhatsApp …) with their state and setup, the people waiting to be let in, webhooks other services
// call, and web access to this Mac from a phone. Changes that need a restart keep a banner up until
// messaging restarts.
import { useCallback, useMemo, useState } from 'react'
import { approvePairing, clearPendingPairing, pairing, platforms, revokePairing, updatePlatform, type PairingUser, type Platform } from '../../lib/api-system'
import { prettyName, toast } from '../../lib/hermes'
import { useStore } from '../../lib/store'
import { confirm, ErrorLine, Logo, Spinner, Tabs, useAsync } from '../ui'
import { restartMessaging } from './system/gateway'
import { ago, errText, usePoll, Warn } from './system/parts'
import { PlatformDialog, PlatformList } from './system/Platforms'
import { WebAccessTab } from './system/WebAccess'
import { WebhooksTab } from './system/Webhooks'

type Tab = 'apps' | 'people' | 'webhooks' | 'web'

function PeopleTab({ list, plats, onApprove, onRevoke, onClear }: { list: { pending: PairingUser[]; approved: PairingUser[] }; plats: Platform[]; onApprove: (u: PairingUser) => void; onRevoke: (u: PairingUser) => void; onClear: () => void }) {
  const name = (id: string) => plats.find((p) => p.id === id)?.name ?? prettyName(id)
  return (
    <>
      <p className="free">When someone new messages this agent on Telegram, Discord or another app, they get a code and wait here until you let them in. People you let in are recognised from then on.</p>
      <div className="ssec"><h2>Waiting</h2><span>{list.pending.length || 'nobody'}</span><span className="sp" />
        {list.pending.length ? <button className="b-text" style={{ height: 26 }} onClick={onClear}>Turn them all away</button> : null}
      </div>
      {list.pending.length ? (
        <div className="card flow">{list.pending.map((u) => (
          <div className="srow" key={`${u.platform}:${u.user_id}`}>
            <Logo name={name(u.platform)} size={30} />
            <div className="tx"><div className="t1"><span>{u.user_name || u.user_id}</span></div><div className="t2">{name(u.platform)}{typeof u.age_minutes === 'number' ? ` · asked ${u.age_minutes < 1 ? 'just now' : ago(Date.now() - u.age_minutes * 60_000)}` : ''}</div>{u.user_name ? <div className="t3">{u.user_id}</div> : null}</div>
            <button className="b-soft" onClick={() => onApprove(u)}>Let in</button>
          </div>
        ))}</div>
      ) : <div className="card"><div className="srow"><div className="tx"><div className="t2">Nobody is waiting.</div></div></div></div>}
      <div className="ssec"><h2>Let in</h2><span>{list.approved.length || 'nobody yet'}</span></div>
      {list.approved.length ? (
        <div className="card flow">{list.approved.map((u) => (
          <div className="srow" key={`${u.platform}:${u.user_id}`}>
            <Logo name={name(u.platform)} size={30} />
            <div className="tx"><div className="t1"><span>{u.user_name || u.user_id}</span></div><div className="t2">{name(u.platform)}</div>{u.user_name ? <div className="t3">{u.user_id}</div> : null}</div>
            <button className="b-ghost-danger" onClick={() => onRevoke(u)}>Remove</button>
          </div>
        ))}</div>
      ) : <div className="card"><div className="srow"><div className="tx"><div className="t2">Nobody has been let in this way. People on an app’s allow-list don’t need to ask.</div></div></div></div>}
    </>
  )
}

export function MessagingPage({ profile }: { profile: string }) {
  const bots = useStore((s) => s.bots)
  const bot = bots.find((b) => b.profile === profile)
  const who = bot ? (bot.isChief ? 'Quicksilver' : bot.name) : prettyName(profile)
  const [tab, setTab] = useState<Tab>('apps')
  const plat = useAsync(() => platforms(profile), [profile])
  const pair = useAsync(() => pairing(profile).catch(() => ({ pending: [], approved: [] })), [profile])
  usePoll(() => { void plat.reload(true); void pair.reload(true) }, 6000, tab === 'apps' || tab === 'people')
  const [restart, setRestart] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const list = plat.data?.platforms ?? []
  const people = pair.data ?? { pending: [], approved: [] }
  const pendingBy = useMemo(() => { const m: Record<string, number> = {}; for (const u of people.pending) m[u.platform] = (m[u.platform] ?? 0) + 1; return m }, [people.pending])
  const needRestart = useCallback((why?: string) => setRestart(why ?? ''), [])
  const patchPlatform = (id: string, p: Partial<Platform>) => plat.setData((d) => (d ? { ...d, platforms: d.platforms.map((x) => (x.id === id ? { ...x, ...p } : x)) } : d))

  const toggle = async (p: Platform, on: boolean) => {
    patchPlatform(p.id, { enabled: on })
    try {
      const r = await updatePlatform(profile, p.id, { enabled: on })
      if (r.hot_served) { toast(`${p.name} ${on ? 'on. Connecting…' : 'off'}`); window.setTimeout(() => void plat.reload(true), 4000) }
      else { toast(`${p.name} ${on ? 'on' : 'off'}. Restart messaging to apply it.`); needRestart(`${p.name} was turned ${on ? 'on' : 'off'}.`) }
    } catch (e) { patchPlatform(p.id, { enabled: !on }); toast(`Couldn’t turn ${p.name} ${on ? 'on' : 'off'}: ${errText(e)}`) }
  }
  const approve = async (u: PairingUser) => {
    pair.setData((d) => (d ? { pending: d.pending.filter((x) => !(x.platform === u.platform && x.user_id === u.user_id)), approved: [...d.approved, u] } : d))
    try { await approvePairing(profile, u); toast(`${u.user_name || u.user_id} can talk to ${who} now`) } catch (e) {
      toast(/locked out|429/i.test(errText(e)) ? 'Too many failed tries on this app. Wait a while, then try again.' : `Couldn’t let them in: ${errText(e)}`)
    } finally { void pair.reload(true) }
  }
  const revoke = async (u: PairingUser) => {
    if (!(await confirm({ title: `Remove ${u.user_name || u.user_id}?`, body: `They can’t talk to ${who} any more; their next message gets a new code to ask again.`, action: 'Remove', danger: true }))) return
    pair.setData((d) => (d ? { ...d, approved: d.approved.filter((x) => !(x.platform === u.platform && x.user_id === u.user_id)) } : d))
    try { await revokePairing(profile, u); toast(`Removed ${u.user_name || u.user_id}`) } catch (e) { toast(`Couldn’t remove them: ${errText(e)}`) } finally { void pair.reload(true) }
  }
  const clearAll = async () => {
    if (!(await confirm({ title: 'Turn everyone waiting away?', body: 'Their requests are cleared. If they message again they get a new code.', action: 'Turn away', danger: true }))) return
    try { const r = await clearPendingPairing(profile); toast(`Cleared ${r?.cleared ?? 'all'} ${r?.cleared === 1 ? 'request' : 'requests'}`) } catch (e) { toast(`Couldn’t clear them: ${errText(e)}`) } finally { void pair.reload(true) }
  }
  const doRestart = async () => {
    setRestarting(true)
    const ok = await restartMessaging(restart || undefined)
    setRestarting(false)
    if (ok) { setRestart(null); window.setTimeout(() => void plat.reload(true), 3000) }
  }

  const connected = list.filter((p) => p.enabled && p.state === 'connected').length
  const trouble = list.filter((p) => p.enabled && p.state !== 'connected').length
  const openPlat = openId ? list.find((p) => p.id === openId) ?? null : null
  return (
    <>
      <div className="shead"><div className="tx">
        <h1>Messaging</h1>
        <p>{plat.data ? `How people reach ${who} outside this app. ${connected ? `${connected} connected` : 'Nothing connected yet'}${trouble ? `, ${trouble} need${trouble === 1 ? 's' : ''} attention` : ''}.` : `How people reach ${who} outside this app: chat apps, webhooks and the web.`}</p>
      </div></div>

      {restart !== null ? (
        <Warn action={<><button className="b-soft" onClick={() => void doRestart()} disabled={restarting}>{restarting ? 'Restarting…' : 'Restart now'}</button><button className="b-text" onClick={() => setRestart(null)}>Later</button></>}>
          <b>Saved. Restart messaging so it takes effect.</b> {restart}
        </Warn>
      ) : null}

      <div className="stools">
        <Tabs<Tab> value={tab} onChange={setTab} items={[
          { key: 'apps', label: 'Chat apps', count: connected || undefined },
          { key: 'people', label: 'People', count: people.pending.length || undefined },
          { key: 'webhooks', label: 'Webhooks' },
          { key: 'web', label: 'Web access' },
        ]} />
      </div>

      {tab === 'apps' ? (
        plat.loading && !plat.data ? <div className="empty"><Spinner size={18} /><span>Checking the chat apps…</span></div>
          : plat.error && !plat.data ? <ErrorLine text={`Couldn’t load the chat apps: ${plat.error}`} onRetry={() => void plat.reload()} />
          : <>
            {people.pending.length ? <Warn action={<button className="b-text" onClick={() => setTab('people')}>See who</button>}><b>{people.pending.length === 1 ? 'Someone is' : `${people.pending.length} people are`} waiting to talk to {who}.</b></Warn> : null}
            <PlatformList list={list} pendingBy={pendingBy} onOpen={(p) => setOpenId(p.id)} onToggle={(p, on) => void toggle(p, on)} />
            {plat.data?.env_path ? <p className="sy-note">Keys are saved in <span className="sy-mono">{plat.data.env_path}</span>.</p> : null}
          </>
      ) : tab === 'people' ? <PeopleTab list={people} plats={list} onApprove={(u) => void approve(u)} onRevoke={(u) => void revoke(u)} onClear={() => void clearAll()} />
        : tab === 'webhooks' ? <WebhooksTab profile={profile} needRestart={needRestart} />
        : <WebAccessTab />}

      <PlatformDialog profile={profile} platform={openPlat} open={!!openPlat} onClose={() => setOpenId(null)}
        pending={openPlat ? people.pending.filter((u) => u.platform === openPlat.id) : []} approved={openPlat ? people.approved.filter((u) => u.platform === openPlat.id) : []}
        onApprove={(u) => void approve(u)} onRevoke={(u) => void revoke(u)} needRestart={needRestart}
        onChanged={(p) => { if (p && openPlat) patchPlatform(openPlat.id, p); else void plat.reload(true) }} />
    </>
  )
}
