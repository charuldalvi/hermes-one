// Settings › Plugins: the add-ons a bot runs. The ones you added (on/off, update, sign-in, remove,
// their tools and settings), the ones that come with Hermes (folded, by kind), the memory provider
// and context engine plugins can supply, and keeping plugins up to date. Parity with Hermes
// Desktop's Plugins tab and Hermes Remote's PluginsPage, through the same routes.
import { useMemo, useState } from 'react'
import { pluginHub } from '../../lib/api'
import {
  managedPlugins, pluginAutoUpdate, rescanPlugins, setContextEngine, setPluginAutoUpdate, setPluginMemory, setPluginOn, updateAllPlugins, type ManagedPlugin,
} from '../../lib/api-capabilities'
import { toast } from '../../lib/hermes'
import { Icon } from '../../lib/icons'
import { setState } from '../../lib/store'
import { Badge, confirm, Empty, ErrorLine, Search, Select, Switch, useAsync } from '../ui'
import { clickable, errText, JobLine, MEMORY_STATUS, memoryName, MoreMenu, Note, norm, plural, pretty, Section, SkeletonCard, useBotName } from './cap-parts'
import { failed, PluginDialog, runPluginUpdate, updatable, updateLabel, type PluginRow } from './PluginDialog'

type Job = { text: string; lines: string[]; done?: boolean; ok?: boolean }

/** What a built-in plugin is for, from the folder Hermes keeps it in. */
const KINDS: Record<string, string> = {
  platforms: 'Messaging apps', image_gen: 'Image generation', video_gen: 'Video generation', web: 'Web search and reading', browser: 'Browsers',
  dashboard_auth: 'Signing in to the web dashboard', cron_providers: 'Scheduling', delegation: 'Handing work to other agents', 'model-providers': 'Model providers',
  memory: 'Memory', context_engine: 'Context', tts: 'Voice', stt: 'Voice', observability: 'Monitoring',
}
const kindOf = (r: PluginRow) => { const k = r.m?.key ?? ''; return k.includes('/') ? KINDS[k.split('/')[0]] ?? pretty(k.split('/')[0]) : 'Other' }
const trimPath = (p?: string) => (p ?? '').replace(/\/+$/, '')

export function PluginsPage({ profile }: { profile: string }) {
  const bot = useBotName(profile)
  const hub = useAsync(() => pluginHub(profile), [profile])
  const man = useAsync(() => managedPlugins(profile), [profile])
  const auto = useAsync(() => pluginAutoUpdate(profile).catch(() => null), [profile])
  const [over, setOver] = useState<Record<string, boolean>>({})
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const [showBuilt, setShowBuilt] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [job, setJob] = useState<Job>()
  const reloadAll = () => Promise.all([hub.reload(true), man.reload(true)])

  // The hub row (what's installed, can it be removed) joined to plugins.manage (tools, settings,
  // catalog pin) by folder: names repeat across kinds (image_gen/fal and video_gen/fal).
  const rows: PluginRow[] = useMemo(() => {
    const ms = man.data ?? []
    const byPath = new Map(ms.filter((m) => m.install_dir).map((m) => [trimPath(m.install_dir), m]))
    const byName = new Map<string, ManagedPlugin[]>()
    for (const m of ms) byName.set(m.name, [...(byName.get(m.name) ?? []), m])
    return (hub.data?.plugins ?? []).map((h, i) => {
      const m = byPath.get(trimPath(h.path)) ?? (byName.get(h.name)?.length === 1 ? byName.get(h.name)![0] : undefined)
      const id = m?.key ?? h.path ?? `${h.name}#${i}`
      const base = m ? m.status === 'enabled' : /^(enabled|active|loaded)$/.test(h.runtime_status ?? '')
      return { id, ref: m?.key ?? h.name, name: h.name, hub: h, m, on: over[id] ?? base, bundled: h.source === 'bundled' }
    })
  }, [hub.data, man.data, over])

  const toggle = async (r: PluginRow, on: boolean) => {
    setOver((o) => ({ ...o, [r.id]: on }))
    try {
      const a = await setPluginOn(profile, r.ref, on)
      toast(on ? (a?.restart_required ? `Turned on ${r.name}. Restart Hermes to finish.` : `Turned on ${r.name}. New chats can use it.`) : `Turned off ${r.name}`)
      await reloadAll()
    } catch (e) { toast(`Couldn’t turn ${r.name} ${on ? 'on' : 'off'}: ${errText(e)}`) }
    setOver((o) => { const { [r.id]: _, ...rest } = o; return rest })
  }
  const update = async (r: PluginRow) => {
    setRowBusy((b) => ({ ...b, [r.id]: true }))
    try {
      const out = await runPluginUpdate(profile, r)
      if (out === 'applied') { toast(`Updated ${r.name}`); await reloadAll() } else if (out === 'unchanged') toast(`${r.name} is already up to date`)
    } catch (e) { toast(`Couldn’t update ${r.name}: ${errText(e)}`) }
    setRowBusy((b) => ({ ...b, [r.id]: false }))
  }
  const updateAll = async () => {
    if (job && !job.done) return
    setJob({ text: 'Updating plugins…', lines: [] })
    try {
      const res = (await updateAllPlugins(profile))?.results ?? []
      const n = (s: string) => res.filter((x) => x.status === s).length
      const [up, review, bad] = [n('updated'), n('needs_review'), n('failed')]
      const text = [up && `Updated ${plural(up, 'plugin')}`, review && `${review} need${review === 1 ? 's' : ''} you to look first: open it and press Update`, bad && `${bad} couldn’t update`].filter(Boolean).join(' · ')
      setJob({ text: text || 'Every plugin is up to date.', lines: res.filter((x) => x.status !== 'current').map((x) => `${x.name}: ${x.detail || x.status.replace(/_/g, ' ')}`), done: true, ok: !bad })
      if (up) await reloadAll()
    } catch (e) { setJob({ text: `Couldn’t update plugins: ${errText(e)}`, lines: [], done: true, ok: false }) }
  }
  const setAuto = async (on: boolean) => {
    const before = auto.data
    auto.setData({ ...(before ?? {}), auto_apply: on })
    try { auto.setData(await setPluginAutoUpdate(profile, on)); toast(on ? 'Plugins will keep themselves up to date' : 'Plugins update only when you ask') } catch (e) { auto.setData(before); toast(`Couldn’t change that: ${errText(e)}`) }
  }
  const rescan = async () => { try { await rescanPlugins(profile) } catch { /* the reload below says what's there */ } await reloadAll(); toast('Looked for plugins again') }

  const providers = hub.data?.providers
  const memOptions = ((providers?.memory_options ?? []) as any[]).filter((o) => o?.name)
  const memCurrent = providers?.memory_provider ?? ''
  const pickMemory = async (name: string) => {
    const label = memoryName(name, memOptions.find((o) => o.name === name)?.description)
    if (!(await confirm({ title: `Use ${label} for memory?`, body: `${bot}’s new chats remember things through it. Built-in notes stay either way.`, action: `Use ${label}` }))) return
    try { await setPluginMemory(profile, name); toast(`Memory now uses ${label}`); await hub.reload(true) } catch (e) { toast(`Couldn’t switch memory: ${errText(e)}`) }
  }
  const pickContext = async (name: string) => {
    try { await setContextEngine(profile, name); toast(`Context engine: ${pretty(name)}`); await hub.reload(true) } catch (e) { toast(`Couldn’t switch the context engine: ${errText(e)}`) }
  }

  const t = norm(q.trim())
  const match = (r: PluginRow) => !t || [r.name, r.hub.description, r.m?.key, ...(r.m?.tools ?? [])].some((s) => norm(s).includes(t))
  const yours = rows.filter((r) => !r.bundled && match(r))
  const built = rows.filter((r) => r.bundled && match(r))
  const builtGroups = useMemo(() => {
    const by = new Map<string, PluginRow[]>()
    for (const r of built) { const k = kindOf(r); by.set(k, [...(by.get(k) ?? []), r]) }
    return [...by.entries()].sort((a, b) => (a[0] === 'Other' ? -1 : b[0] === 'Other' ? 1 : a[0].localeCompare(b[0])))
  }, [built])
  const totalYours = rows.filter((r) => !r.bundled).length
  const totalBuilt = rows.filter((r) => r.bundled).length
  const builtOpen = showBuilt || !!t
  const current = open ? rows.find((r) => r.id === open) : undefined

  const row = (r: PluginRow) => (
    <div key={r.id} className={`srow click${r.on ? '' : ' off'}`} {...clickable(() => setOpen(r.id))} aria-label={`Open ${r.name}`}>
      <div className="tx">
        <div className="t1"><span>{r.name}</span>
          {r.hub.version ? <span className="cap-use">v{r.hub.version}</span> : null}
          {r.m?.catalog_tier === 'verified' || r.m?.catalog_tier === 'official' ? <Badge tone="quiet">{r.m.catalog_tier === 'official' ? 'Official' : 'Verified'}</Badge> : null}
          {r.hub.auth_required ? <Badge tone="need">Needs sign-in</Badge> : null}
          {failed(r) ? <Badge tone="bad">Didn’t load</Badge> : null}
        </div>
        {r.hub.description ? <div className="t2">{r.hub.description.trim()}</div> : null}
        {r.m?.tools?.length ? <div className="t3">{r.m.tools.slice(0, 6).join(', ')}{r.m.tools.length > 6 ? ` +${r.m.tools.length - 6}` : ''}</div> : null}
      </div>
      <div className="act">
        {updatable(r) ? <button className="b-soft" disabled={rowBusy[r.id]} onKeyDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void update(r) }}>{rowBusy[r.id] ? 'Updating…' : updateLabel(r)}</button> : null}
        <Switch on={r.on} onChange={(v) => void toggle(r, v)} label={`${r.name} on`} disabled={r.id in over} />
      </div>
    </div>
  )

  return (
    <>
      <div className="shead">
        <div className="tx"><h1>Plugins</h1><p>Add-ons that give {bot} new tools, memory and ways to connect. Open one to see what it adds and change its settings.</p></div>
        <div className="cap-acts">
          <button className="b-pri" onClick={() => setState({ view: 'marketplace', marketTab: 'plugins' })}><span className="cap-row"><Icon name="store" size={14} />Find plugins</span></button>
          <MoreMenu items={[
            { label: 'Update all', icon: 'refresh', onClick: () => void updateAll(), disabled: !!job && !job.done },
            { label: 'Look for plugins again', icon: 'search', hint: 'After adding one by hand', onClick: () => void rescan() },
            { label: 'Reload', icon: 'refresh', onClick: () => { void reloadAll(); void auto.reload(true) } },
          ]} />
        </div>
      </div>

      {job ? <JobLine {...job} onClose={() => setJob(undefined)} /> : null}

      {hub.loading && !hub.data ? <SkeletonCard rows={5} />
        : hub.error && !hub.data ? <ErrorLine text={`Couldn’t load ${bot}’s plugins: ${hub.error}`} onRetry={() => void reloadAll()} />
        : (
          <>
            {hub.error ? <ErrorLine text={`Couldn’t refresh: ${hub.error}`} onRetry={() => void reloadAll()} /> : null}
            {man.error && !man.data ? <Note tone="need">Couldn’t ask Hermes for each plugin’s tools and settings, so only the basics show. <button className="b-text" onClick={() => void man.reload()}>Try again</button></Note> : null}

            <div className="stools"><Search value={q} onChange={setQ} placeholder={`Find a plugin${rows.length ? ` among ${rows.length}` : ''}`} /></div>

            {!t ? (
              <Section title="Chosen by plugins" sub="Where memory and context come from">
                <div className="card">
                  <div className="srow ctlrow">
                    <div className="tx"><div className="t1"><span>Memory</span></div><div className="t2">Where {bot} keeps what it learns between chats. Built-in notes are always kept too.</div></div>
                    <div className="ctl">
                      <Select value={memCurrent} onChange={(v) => void pickMemory(v)} width={320} align="end" options={[
                        { value: '', label: 'Built-in notes', hint: 'Always there' },
                        ...memOptions.map((o) => ({ value: o.name, label: memoryName(o.name, o.description), hint: MEMORY_STATUS[o.status]?.label ?? pretty(o.status) })),
                      ]} />
                    </div>
                  </div>
                  <div className="srow ctlrow">
                    <div className="tx"><div className="t1"><span>Context engine</span></div><div className="t2">How long chats are kept short enough for the model to read.</div></div>
                    <div className="ctl">
                      {providers?.context_options?.length ? (
                        <Select value={providers.context_engine ?? ''} onChange={(v) => void pickContext(v)} width={300} align="end"
                          options={[...(providers.context_options.some((o) => o.name === providers.context_engine) || !providers.context_engine ? [] : [{ value: providers.context_engine, label: pretty(providers.context_engine), hint: 'Comes with Hermes' }]),
                            ...providers.context_options.map((o) => ({ value: o.name, label: o.label || pretty(o.name) }))]} />
                      ) : <span className="cap-dim">{pretty(providers?.context_engine) || 'Built in'} · comes with Hermes</span>}
                    </div>
                  </div>
                </div>
              </Section>
            ) : null}

            {!t && auto.data ? (
              <Section title="Updates">
                <div className="card">
                  <div className="srow">
                    <div className="tx"><div className="t1"><span>Keep plugins up to date</span></div>
                      <div className="t2">Hermes checks every {auto.data.check_hours ?? 24} hours and updates plugins on its own. One that asks for anything new waits for you.</div></div>
                    <div className="act"><button className="b-soft" onClick={() => void updateAll()} disabled={!!job && !job.done}>Update all now</button><Switch on={!!auto.data.auto_apply} onChange={(v) => void setAuto(v)} label="Keep plugins up to date" /></div>
                  </div>
                </div>
              </Section>
            ) : null}

            <Section title="Added by you" sub={t ? `${yours.length} of ${totalYours}` : totalYours}>
              {yours.length ? <div className="card flow">{yours.map(row)}</div>
                : t ? <div className="cap-dim" style={{ padding: '4px 2px 8px' }}>None of yours match.</div>
                : <Empty title="No plugins added yet" body={`Plugins add tools and abilities to ${bot}. Find one in the Marketplace.`} />}
            </Section>

            <Section title="Comes with Hermes" sub={t ? `${built.length} of ${totalBuilt}` : totalBuilt}
              right={!t && totalBuilt ? <button className="b-text" onClick={() => setShowBuilt(!showBuilt)}>{showBuilt ? 'Hide' : 'Show all'}</button> : null}>
              {builtOpen ? (
                built.length ? (
                  <>
                    <div className="cap-dim" style={{ margin: '-2px 0 10px' }}>These are set up from their own pages (Tools, Messaging). Turning one off stops Hermes loading it.</div>
                    <div className="card">
                      {builtGroups.map(([kind, items]) => (
                        <div key={kind} style={{ display: 'contents' }}>
                          <div className="cap-group">{kind}</div>
                          {items.map(row)}
                        </div>
                      ))}
                    </div>
                  </>
                ) : <div className="cap-dim" style={{ padding: '4px 2px' }}>None of these match.</div>
              ) : (
                <div className="card"><button className="cap-toggle" onClick={() => setShowBuilt(true)}><Icon name="chevR" size={14} />{plural(totalBuilt, 'plugin')}: messaging apps, image and video makers, web search and more. {rows.filter((r) => r.bundled && r.on).length} on.</button></div>
              )}
            </Section>

            {!rows.length && !t ? <Empty title="No plugins" body="Hermes didn’t report any plugins for this agent." face={false} /> : null}
          </>
        )}

      {current ? (
        <PluginDialog key={current.id} profile={profile} row={current} bot={bot} managedOk={!man.error} onClose={() => setOpen(null)}
          onToggle={(v) => void toggle(current, v)} onChanged={() => void reloadAll()}
          onRemoved={() => { setOpen(null); void reloadAll() }} />
      ) : null}
    </>
  )
}
