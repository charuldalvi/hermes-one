// The Marketplace's Plugins tab, as Hermes Remote lays it out: featured picks from Nous, what's waiting to
// update, the most loved by GitHub stars, a Browse grid by what plugins do, then every plugin. Search and
// filters show only what fits this Mac unless you ask. A plugin opens its page; installing asks first.
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../lib/icons'
import { toast } from '../../lib/hermes'
import { setState } from '../../lib/store'
import { pluginHub } from '../../lib/api'
import {
  CATEGORIES, TIERS, categoryName, fitOf, installedKey, mostLoved, removePluginFor, tierOrder, type MarketPlugin, type MarketSnapshot, type Tier,
} from '../../lib/api-market'
import { Empty, ErrorLine, Search, Select, confirm } from '../ui'
import { Banner, Chip, Note, PluginThumb, Section, Skeleton, TierBadge } from './parts'
import { InstallDialog, InstalledDialog, PluginAction, PluginDialog, RunDialog, hostLabel, metaLine, type Run } from './PluginDetail'

const PAGE = 48

export function PluginsTab({ snap, error, profile, botName, onReload, onSearchSkills, installedOpen, setInstalledOpen }: {
  snap: MarketSnapshot | undefined; error?: string; profile: string; botName: string; onReload: () => void; onSearchSkills: (q: string) => void
  installedOpen: boolean; setInstalledOpen: (v: boolean) => void
}) {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [tiers, setTiers] = useState<Set<Tier>>(new Set())
  const [fitsOnly, setFitsOnly] = useState(true)
  const [shown, setShown] = useState(PAGE)
  const [openName, setOpenName] = useState<string | null>(null)
  const [asking, setAsking] = useState<MarketPlugin | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [names, setNames] = useState<string[]>([])
  const [note, setNote] = useState<string>()

  const loadNames = () => pluginHub(profile).then((h) => setNames(h.plugins.map((x) => x.name))).catch(() => undefined)
  useEffect(() => { void loadNames() }, [profile])
  useEffect(() => { setShown(PAGE) }, [q, category, tiers, fitsOnly])

  const host = snap?.host ?? { os: null, version: null, name: null }
  const plugins = snap?.plugins ?? []
  const keyFor = (p: MarketPlugin) => installedKey(p.name, names)
  const act = (p: MarketPlugin) => {
    if (p.updateAvailable) setRun({ p, keys: {}, updateKey: keyFor(p), attempt: 0 })
    else if (p.installed) setOpenName(p.name)
    else setAsking(p)
  }
  const remove = async (p: MarketPlugin) => {
    if (!(await confirm({ title: `Remove ${p.title}?`, body: `Its code is deleted from this Mac and ${botName} stops using it.`, action: 'Remove', danger: true }))) return
    try { await removePluginFor(profile, keyFor(p)); toast(`Removed ${p.title}.`); setOpenName(null); onReload(); void loadNames() } catch (e: any) { setNote(e?.message ?? 'That didn’t finish.') }
  }

  const t = q.trim().toLowerCase()
  const matches = (p: MarketPlugin) => !t || `${p.title} ${p.name} ${p.about} ${p.maintainer} ${categoryName(p.category)}`.toLowerCase().includes(t)
  const browsing = !!t || category !== null || tiers.size > 0
  const counts = useMemo(() => plugins.reduce<Record<string, number>>((m, p) => { m[p.category] = (m[p.category] ?? 0) + 1; return m }, {}), [plugins])
  const sorter = (a: MarketPlugin, b: MarketPlugin) => tierOrder(a.tier) - tierOrder(b.tier) || (b.stars ?? -1) - (a.stars ?? -1) || Number(!!b.image) - Number(!!a.image) || a.title.toLowerCase().localeCompare(b.title.toLowerCase())

  const pool = plugins.filter((p) => matches(p) && (category === null || p.category === category) && (category === 'desktop' || p.category !== 'desktop'))
  const tiered = pool.filter((p) => !tiers.size || tiers.has(p.tier))
  const results = tiered.filter((p) => !fitsOnly || fitOf(p, host) === 'works').sort(sorter)
  const otherOs = tiered.length - results.length
  const desktopHidden = category === null ? plugins.filter((p) => p.category === 'desktop' && matches(p)).length : 0
  const updates = plugins.filter((p) => p.updateAvailable)
  const featured = useMemo(() => {
    const f = plugins.filter((p) => p.featured != null).sort((a, b) => (a.featured ?? 0) - (b.featured ?? 0))
    return (f.length ? f : plugins.filter((p) => p.tier === 'official' && p.image && p.category !== 'desktop')).slice(0, 8)
  }, [plugins])
  const loved = useMemo(() => mostLoved(plugins, host), [plugins, host])
  const all = plugins.filter((p) => p.category !== 'desktop' && (!fitsOnly || fitOf(p, host) === 'works')).sort(sorter)
  const open = openName ? plugins.find((p) => p.name === openName) : undefined

  const catOptions = [{ value: '', label: 'Every kind' }, ...CATEGORIES.map((c) => ({ value: c.key, label: c.label, hint: String(counts[c.key] ?? 0) })), { value: 'desktop', label: 'Desktop app add-ons', hint: String(counts.desktop ?? 0) }]

  return (
    <>
      <div className="stools">
        <Search value={q} onChange={setQ} placeholder={`Search ${plugins.length ? plugins.length.toLocaleString() : ''} plugins`} />
        <Select value={category ?? ''} options={catOptions} onChange={(v) => setCategory(v || null)} width={260} align="end" />
      </div>
      <div className="mk-chips">
        <Chip on={fitsOnly} onClick={() => setFitsOnly(!fitsOnly)}>Works on {hostLabel(host)}</Chip>
        {TIERS.map((x) => <Chip key={x.key} on={tiers.has(x.key)} onClick={() => setTiers((s) => { const n = new Set(s); n.has(x.key) ? n.delete(x.key) : n.add(x.key); return n })}>{x.label}</Chip>)}
        {category ? <Chip on close onClick={() => setCategory(null)}>{categoryName(category)}</Chip> : null}
      </div>
      {note ? <Note tone="bad" onDismiss={() => setNote(undefined)}>{note}</Note> : null}
      {snap && !snap.fromHost ? <Note tone="need">This Mac didn’t answer with its catalog, so what’s installed isn’t shown. Installing still goes through Hermes here.</Note> : null}

      {!snap ? (error ? <ErrorLine text={error} onRetry={onReload} /> : <Skeleton rows={6} tiles />) : browsing ? (
        <>
          <div className="mk-count"><b>{results.length.toLocaleString()} {results.length === 1 ? 'result' : 'results'}</b>
            <span>{[otherOs > 0 && fitsOnly ? `${otherOs} not for ${hostLabel(host)}` : null, desktopHidden ? `${desktopHidden} for Hermes Desktop` : null].filter(Boolean).join(' · ')}</span></div>
          {results.length ? <PluginGrid list={results.slice(0, shown)} host={host} onOpen={(p) => setOpenName(p.name)} onAct={act} />
            : <Empty title="Nothing matches" body={fitsOnly && otherOs ? `Some plugins match but don’t run on ${hostLabel(host)}.` : 'Try fewer words, or another filter.'} />}
          {results.length > shown ? <div className="mk-more"><button className="b-soft" onClick={() => setShown((n) => n + PAGE)}>Show more</button><span>Showing {shown} of {results.length.toLocaleString()}</span></div> : null}
          {t.length >= 2 ? <LinkRow icon="book" title={`Search skills for “${q.trim()}”`} sub="Skills from the hub, scanned before they’re added" onClick={() => onSearchSkills(q.trim())} /> : null}
          {desktopHidden > 0 ? <LinkRow icon="desk" title={`${desktopHidden} add-ons for Hermes Desktop`} sub="They add to the desktop app, not to Hermes itself" onClick={() => setCategory('desktop')} /> : null}
        </>
      ) : (
        <>
          {featured.length ? (
            <>
              <Section title="Featured" note={featured.some((p) => p.featured != null) ? 'Picked by Nous Research' : 'From Nous Research'} />
              <div className="mk-feat">
                {featured.map((p) => (
                  <div key={p.name} className="mk-fcard" onClick={() => setOpenName(p.name)}>
                    <Banner p={p} />
                    <div className="mk-fbody">
                      <div className="th"><span className="tt">{p.title}</span><TierBadge tier={p.tier} /></div>
                      <div className="td">{p.summary}</div>
                      <div className="tf"><span className="ts">{[categoryName(p.category), p.version].filter(Boolean).join(' · ')}</span><span className="sp" /><PluginAction p={p} host={host} onAct={() => act(p)} /></div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {updates.length ? (
            <button className="card mk-updates" onClick={() => setInstalledOpen(true)}>
              <span className="mk-stack-th">{updates.slice(0, 3).map((p) => <PluginThumb key={p.name} p={p} size={34} />)}</span>
              <span className="tx"><b>{updates.length === 1 ? '1 update ready' : `${updates.length} updates ready`}</b><span>{updates.slice(0, 3).map((p) => p.title).join(', ')}{updates.length > 3 ? ` and ${updates.length - 3} more` : ''}</span></span>
              <span className="b-soft mk-fake">Update</span>
            </button>
          ) : null}
          {loved.length ? (
            <>
              <Section title="Most loved" note="By GitHub stars" />
              <PluginGrid list={loved} host={host} onOpen={(p) => setOpenName(p.name)} onAct={act} />
            </>
          ) : null}
          <Section title="Browse" note="By what they do" />
          <div className="mk-cats">
            {CATEGORIES.map((c) => (
              <button key={c.key} className="mk-cat" onClick={() => setCategory(c.key)}>
                <span className="mk-ico"><Icon name={c.icon as any} size={16} /></span>
                <span className="tx"><b>{c.label}</b><span>{(counts[c.key] ?? 0).toLocaleString()}</span></span>
              </button>
            ))}
          </div>
          <LinkRow icon="chat" title="Talk to Hermes anywhere" sub="Telegram, WhatsApp, Discord, Signal, Matrix and Slack: set up once in Settings" onClick={() => setState({ view: 'settings', settingsPage: 'messaging' })} />
          {counts.desktop ? <LinkRow icon="desk" title="For Hermes Desktop" sub={`${counts.desktop} add-ons for the desktop app on your Mac`} onClick={() => setCategory('desktop')} /> : null}
          <Section title="Every plugin" note={`${all.length.toLocaleString()}${fitsOnly ? ` that work on ${hostLabel(host)}` : ''}`} />
          <PluginGrid list={all.slice(0, shown)} host={host} onOpen={(p) => setOpenName(p.name)} onAct={act} />
          {all.length > shown ? <div className="mk-more"><button className="b-soft" onClick={() => setShown((n) => n + PAGE)}>Show more</button><span>Showing {shown} of {all.length.toLocaleString()}</span></div> : null}
          <p className="mk-foot"><Icon name="shield" size={14} /> Official means Nous Research looks after it. Verified means a partner Nous checked. Anyone can publish a Community plugin, so read what each one can reach before you install it.</p>
        </>
      )}

      {open ? <PluginDialog key={open.name} p={open} host={host} botName={botName} onClose={() => setOpenName(null)} onAct={() => act(open)} onRemove={() => void remove(open)} /> : null}
      {asking ? <InstallDialog p={asking} host={host} profile={profile} botName={botName} onClose={() => setAsking(null)} onInstall={(keys) => { const p = asking; setAsking(null); setRun({ p, keys, attempt: 0 }) }} /> : null}
      {run ? <RunDialog key={`${run.p.name}:${run.attempt}`} run={run} profile={profile} botName={botName} onRetry={setRun} onClose={(changed) => { setRun(null); if (changed) { onReload(); void loadNames() } }} /> : null}
      {installedOpen ? <InstalledDialog snap={snap} profile={profile} botName={botName} onClose={() => setInstalledOpen(false)} onOpen={(p) => setOpenName(p.name)}
        onUpdate={(p, key) => setRun({ p, keys: {}, updateKey: key, attempt: 0 })} onChanged={onReload} /> : null}
    </>
  )
}

function PluginGrid({ list, host, onOpen, onAct }: { list: MarketPlugin[]; host: MarketSnapshot['host']; onOpen: (p: MarketPlugin) => void; onAct: (p: MarketPlugin) => void }) {
  return (
    <div className="tiles flow">
      {list.map((p) => (
        <div key={p.name} className="tile-c" onClick={() => onOpen(p)}>
          <div className="th"><PluginThumb p={p} size={38} /><div className="tx"><div className="tt">{p.title}</div><div className="ts">{metaLine(p)}</div></div></div>
          <div className="td">{p.summary || p.about}</div>
          <div className="tf"><TierBadge tier={p.tier} />{p.keys.length ? <span className="mk-kind">{p.keys.length === 1 ? 'Needs a key' : `Needs ${p.keys.length} keys`}</span> : null}<span className="sp" /><PluginAction p={p} host={host} onAct={() => onAct(p)} /></div>
        </div>
      ))}
    </div>
  )
}

function LinkRow({ icon, title, sub, onClick }: { icon: string; title: string; sub: string; onClick: () => void }) {
  return (
    <button className="card mk-addown" onClick={onClick}>
      <span className="mk-ico"><Icon name={icon as any} size={17} /></span>
      <span className="tx"><b>{title}</b><span>{sub}</span></span>
      <Icon name="chevR" size={15} />
    </button>
  )
}
