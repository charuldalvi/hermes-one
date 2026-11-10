// One plugin's page, asking before an install, the install (or update) itself, and what's installed
// (Hermes Remote's MarketplacePage.kt: PluginPage, InstallSheet, InstallScreen, InstalledPage).
import { askChief } from '../../lib/hermes'
import { useEffect, useState } from 'react'
import { Icon } from '../../lib/icons'
import { toast } from '../../lib/hermes'
import { setState } from '../../lib/store'
import { pluginHub, restartGateway, setPlugin, type InstalledPlugin } from '../../lib/api'
import {
  REACH_LABEL, autoUpdateState, categoryName, fitOf, installedKey, keysSet, needsVersion, osLabel, platformsText, plural, reachOf, runInstall, runUpdate,
  saveKey, setAutoUpdate, starsText, summaryOf, toolLabels, updateAllPlugins, type MarketHost, type MarketPlugin, type MarketSnapshot, type Reach, type RunResult,
} from '../../lib/api-market'
import { Badge, Dialog, Empty, ErrorLine, Spinner, Switch, confirm, useAsync } from '../ui'
import { Banner, Bridge, DotLine, Note, PluginThumb, RowButton, Steps, TierBadge, openLink, useFlips } from './parts'

const REACH_TONE: Record<Reach, 'need' | 'ok' | 'run' | 'off'> = { spends: 'need', sends: 'off', local: 'ok', other: 'off' }
export const hostLabel = (host: MarketHost) => osLabel(host.os) ?? 'this Mac'

/** What a plugin's button says here: Get, Update, Installed, or why it can't. */
export function PluginAction({ p, host, onAct, primary }: { p: MarketPlugin; host: MarketHost; onAct: () => void; primary?: boolean }) {
  const fit = fitOf(p, host)
  if (p.updateAvailable) return <RowButton onClick={onAct}>Update</RowButton>
  if (p.installed) return <Badge tone="ok">Installed</Badge>
  if (fit === 'other-os') return <span className="mk-muted mk-sm">Not for {hostLabel(host)}</span>
  if (fit === 'needs-newer') return <span className="mk-muted mk-sm">Needs newer Hermes</span>
  return <RowButton kind={primary ? 'pri' : 'soft'} onClick={onAct}>Get</RowButton>
}

/** "★ 5.1k · Tools · rlaope". */
export const metaLine = (p: MarketPlugin) => [p.stars ? `★ ${starsText(p.stars)}` : null, categoryName(p.category), p.maintainer || null].filter(Boolean).join(' · ')

// ---------- a plugin's page ----------

export function PluginDialog({ p, host, botName, onClose, onAct, onRemove }: { p: MarketPlugin; host: MarketHost; botName: string; onClose: () => void; onAct: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(true)
  const [allReach, setAllReach] = useState(false)
  const close = () => { setOpen(false); setTimeout(onClose, 170) }
  const fit = fitOf(p, host)
  const labels = toolLabels(p.tools)
  const gains = p.tools.length ? { v: String(p.tools.length), l: 'tools for Hermes' } : p.hooks ? { v: String(p.hooks), l: 'ways it hooks in' } : { v: categoryName(p.category), l: 'kind' }
  const repo = p.repo.replace(/^https:\/\//, '').replace(/^github\.com\//, '').replace(/\.git$/, '')
  return (
    <Dialog open={open} onClose={close} wide title={<><PluginThumb p={p} size={28} /><span>{p.title}</span><TierBadge tier={p.tier} /></>}
      footer={<>
        {p.docsUrl?.startsWith('https://') ? <button className="b-text" onClick={() => openLink(p.docsUrl)}><Icon name="book" size={14} />Docs</button> : null}
        <span className="sp" />
        {p.installed && !p.updateAvailable ? <button className="b-ghost-danger" onClick={onRemove}>Remove</button> : null}
        {p.updateAvailable ? <button className="b-pri" onClick={() => { close(); onAct() }}>Update</button>
          : p.installed ? <Badge tone="ok">Installed for {botName}</Badge>
          : fit === 'works' ? <button className="b-pri" onClick={() => { close(); onAct() }}>Get</button>
          : <button className="b-soft" disabled>{fit === 'other-os' ? `Not for ${hostLabel(host)}` : 'Needs newer Hermes'}</button>}
      </>}>
      <Banner p={p} className="mk-dbanner" />
      <div className="mk-phead">
        <PluginThumb p={p} size={52} />
        <div className="tx"><b>{p.title}</b><span>{p.maintainer || 'Unknown maker'}{p.stars ? ` · ★ ${starsText(p.stars)}` : ''} · {categoryName(p.category)}</span></div>
      </div>
      {p.about ? <p className="mk-about">{p.about}</p> : null}
      {p.category === 'desktop' ? <Note tone="need">This one adds to the Hermes Desktop app rather than to Hermes itself, so Hermes One won’t show its screens. Any tools it brings still work in your chats.</Note> : null}
      <div className="mk-facts">
        <div><b>{gains.v}</b><span>{gains.l}</span></div>
        <div><b>{p.keys.length ? p.keys.length : 'None'}</b><span>{p.keys.length === 1 ? 'key it needs' : 'keys it needs'}</span></div>
        <div><b>{p.version ?? p.shaShort}</b><span>version</span></div>
      </div>
      <div className="card mk-gap"><div className="srow">
        <i className={`dot ${fit === 'works' ? 'ok' : 'bad'}`} />
        <div className="tx">
          <div className="t1"><span>{fit === 'works' ? `Works on ${hostLabel(host)}` : fit === 'other-os' ? `Not for ${hostLabel(host)}: ${platformsText(p.platforms)}` : `Needs a newer Hermes on ${hostLabel(host)}`}</span></div>
          <div className="t2">{[host.version ? `Hermes ${host.version}` : null, p.requiresHermes ? `it needs ${needsVersion(p.requiresHermes)} or newer` : null, p.platforms.length && fit === 'works' ? platformsText(p.platforms) : null].filter(Boolean).join(' · ') || 'Any computer Hermes runs on'}</div>
        </div>
      </div></div>
      {labels.length ? <><div className="mk-lab">What Hermes gains</div><div className="mk-tchips">{labels.slice(0, 24).map((l) => <span key={l}>{l}</span>)}{labels.length > 24 ? <span>+{labels.length - 24}</span> : null}</div></> : null}
      <div className="mk-lab">What it can reach</div>
      <div className="card mk-lines">
        {p.disclosure.length ? (allReach ? p.disclosure : p.disclosure.slice(0, 12)).map((l, i) => { const r = reachOf(l); return <DotLine key={i} tone={REACH_TONE[r]} label={r === 'other' ? undefined : REACH_LABEL[r]}>{l}</DotLine> })
          : <DotLine tone="off">The publisher doesn’t say. Read its source before you install it.</DotLine>}
        {p.disclosure.length > 12 && !allReach ? <button className="b-text mk-more-l" onClick={() => setAllReach(true)}>Show all {p.disclosure.length}</button> : null}
      </div>
      {p.keys.length ? <><div className="mk-lab">Keys it uses</div><div className="card mk-lines">{p.keys.map((k) => <DotLine key={k}><code>{k}</code></DotLine>)}</div></> : null}
      {p.knownIssues.length ? <><div className="mk-lab">Known issues</div><div className="card mk-lines">{p.knownIssues.map((k, i) => <DotLine key={i} tone="need">{k}</DotLine>)}</div></> : null}
      {p.screenshots.length ? <><div className="mk-lab">Pictures</div><div className="mk-shots">{p.screenshots.slice(0, 8).map((s) => <button key={s} onClick={() => openLink(s)}><img src={s} alt="" loading="lazy" referrerPolicy="no-referrer" /></button>)}</div></> : null}
      {p.repo ? (
        <button className="card mk-source" onClick={() => openLink(p.repo)}>
          <span className="mk-ico"><Icon name="globe" size={16} /></span>
          <span className="tx"><b className="mono">{repo}</b><span>Pinned at {p.shaShort}{p.tier !== 'community' ? ', the version Nous checked' : ', the version the catalog lists'}</span></span>
          <Icon name="external" size={14} />
        </button>
      ) : null}
    </Dialog>
  )
}

// ---------- asking first ----------

/** Install asks first: where, that its code runs inside Hermes, the exact version, what it may cost, and the keys it needs. */
export function InstallDialog({ p, host, profile, botName, onClose, onInstall }: { p: MarketPlugin; host: MarketHost; profile: string; botName: string; onClose: () => void; onInstall: (keys: Record<string, string>) => void }) {
  const [open, setOpen] = useState(true)
  const [found, setFound] = useState<Set<string> | null>(p.keys.length ? null : new Set())
  const [typed, setTyped] = useState<Record<string, string>>({})
  const close = () => { setOpen(false); setTimeout(onClose, 170) }
  useEffect(() => { if (p.keys.length) keysSet(profile).then(setFound).catch(() => setFound(new Set())) }, [p.name, profile])
  const fit = fitOf(p, host)
  const spend = p.disclosure.find((l) => reachOf(l) === 'spends') ?? p.disclosure.find((l) => reachOf(l) === 'sends')
  const go = () => { const k: Record<string, string> = {}; for (const [n, v] of Object.entries(typed)) if (v.trim()) k[n] = v.trim(); setOpen(false); setTimeout(() => onInstall(k), 170) }
  return (
    <Dialog open={open} onClose={close} width={540} title={<><PluginThumb p={p} size={28} /><span>Install {p.title}?</span><TierBadge tier={p.tier} /></>}
      footer={<><span className="mk-muted">For {botName}</span><span className="sp" /><button className="b-text" onClick={close}>Not now</button><button className="b-pri" disabled={fit !== 'works' || found === null} onClick={go}>Install</button></>}>
      <div className="mk-lines plain">
        <DotLine tone="need">Its code runs inside Hermes on this Mac, with everything Hermes can reach.</DotLine>
        <DotLine tone="ok">It installs {p.version ? `${p.version} (${p.shaShort})` : p.shaShort}, {p.tier !== 'community' ? 'the exact version Nous checked.' : 'the exact version the catalog lists.'}</DotLine>
        {spend ? <DotLine tone={reachOf(spend) === 'spends' ? 'need' : 'off'}>{spend}</DotLine> : null}
        {fit !== 'works' ? <DotLine tone="bad">{fit === 'other-os' ? `It’s made for ${platformsText(p.platforms)}, not ${hostLabel(host)}.` : `It needs Hermes ${needsVersion(p.requiresHermes)} or newer; this Mac has ${host.version}.`}</DotLine> : null}
        {p.knownIssues.length ? <DotLine tone="need">{plural(p.knownIssues.length, 'known issue')}: {p.knownIssues[0]}</DotLine> : null}
      </div>
      {p.keys.length ? (
        <>
          <div className="mk-lab">Keys</div>
          {found === null ? <Spinner /> : p.keys.map((k) => found.has(k) ? (
            <div className="card mk-gap" key={k}><div className="srow"><span className="mk-ico"><Icon name="key" size={15} /></span><div className="tx"><div className="t1"><code>{k}</code></div><div className="t2 mk-okt">Already saved for {botName}</div></div></div></div>
          ) : (
            <label className="mk-field" key={k}><span><code>{k}</code></span><input className="answer mono" type="password" autoComplete="off" placeholder="Paste it, or add it later in Keys" value={typed[k] ?? ''} onChange={(e) => setTyped((m) => ({ ...m, [k]: e.target.value }))} /></label>
          ))}
          <p className="mk-muted">Keys you paste are saved in {botName}’s keys on this Mac and never shown again.</p>
        </>
      ) : null}
    </Dialog>
  )
}

// ---------- installing or updating ----------

export interface Run { p: MarketPlugin; keys: Record<string, string>; updateKey?: string; accept?: boolean; force?: boolean; attempt: number }

export function RunDialog({ run, profile, botName, onClose, onRetry }: { run: Run; profile: string; botName: string; onClose: (changed: boolean) => void; onRetry: (r: Run) => void }) {
  const [open, setOpen] = useState(true)
  const [res, setRes] = useState<RunResult | null>(null)
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [savedKeys, setSavedKeys] = useState<string[]>([])
  const [savingKeys, setSavingKeys] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const p = run.p
  const updating = !!run.updateKey
  useEffect(() => {
    let stop = false
    setRes(null)
    void (async () => {
      for (const [k, v] of Object.entries(run.keys)) await saveKey(profile, k, v).catch(() => undefined)
      const r = updating ? await runUpdate(profile, run.updateKey!, p.title, { accept: run.accept, force: run.force }) : await runInstall(profile, p)
      if (!stop) setRes(r)
    })()
    return () => { stop = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])
  const done = res?.outcome === 'done'
  const close = () => { setOpen(false); setTimeout(() => onClose(done || savedKeys.length > 0), 170) }
  const missing = (res?.missing ?? []).filter((k) => !savedKeys.includes(k))
  const stage = !res ? 'working' : done ? 'done' : 'failed'
  const title = !res ? (updating ? `Updating ${p.title}` : `Installing ${p.title}`) : done ? (res.unchanged ? `${p.title} is up to date` : `${p.title} is on`) : res.outcome === 'consent' ? 'This update asks for more' : res.outcome === 'blocked' ? 'Hermes’ security check stopped it' : 'That didn’t finish'
  const body = !res ? `For ${botName}. You can close this; it carries on.` : done ? (res.restart ? 'It turns on when Hermes restarts.' : `Hermes can use it in new chats with ${botName}.`) : res.message ?? 'Hermes didn’t install it.'
  const canForce = updating && res?.outcome === 'blocked' && res.verdict !== 'dangerous'
  const saveMissing = async () => {
    setSavingKeys(true)
    const ok: string[] = []
    for (const k of missing) { const v = keys[k]?.trim(); if (!v) continue; try { await saveKey(profile, k, v); ok.push(k) } catch (e: any) { toast(e?.message ?? `Couldn’t save ${k}.`) } }
    setSavedKeys((s) => [...s, ...ok]); setSavingKeys(false)
    if (ok.length) toast(`Saved ${plural(ok.length, 'key')}.`)
  }
  const restart = async () => {
    if (!(await confirm({ title: 'Restart Hermes now?', body: 'Chats that are working stop and pick up again after the restart.', action: 'Restart' }))) return
    setRestarting(true)
    try { await restartGateway(); toast('Hermes is restarting.') } catch (e: any) { toast(e?.message ?? 'Hermes didn’t restart.') } finally { setRestarting(false) }
  }
  return (
    <Dialog open={open} onClose={close} width={520}
      footer={<>
        <span className="sp" />
        {!res ? <button className="b-text" onClick={close}>Keep browsing</button> : <button className="b-text" onClick={close}>{done ? 'Done' : 'Close'}</button>}
        {res?.outcome === 'consent' && updating ? <button className="b-pri" onClick={() => onRetry({ ...run, accept: true, attempt: run.attempt + 1 })}>Agree and update</button> : null}
        {canForce ? <button className="b-pri" onClick={() => onRetry({ ...run, force: true, attempt: run.attempt + 1 })}>Update anyway</button> : null}
        {res && !done && res.outcome !== 'consent' && !canForce ? <button className="b-pri" onClick={() => onRetry({ ...run, attempt: run.attempt + 1 })}>Try again</button> : null}
        {done && !updating ? <button className="b-pri" onClick={() => { close(); askChief(`Use ${p.title} to `) }}>Try it with Quicksilver</button> : null}
      </>}>
      <div className="mk-flow">
        <Bridge stage={stage} logo={<PluginThumb p={p} size={60} />} />
        <div className="mk-flow-t">{title}</div>
        <div className="mk-flow-b">{body}</div>
        {!done || missing.length ? (
          <Steps items={[
            { text: `Fetching ${p.version ?? p.shaShort}, pinned by the catalog`, mark: done ? 'done' : res ? 'failed' : 'current' },
            { text: 'Checking it and turning it on', mark: done ? 'done' : 'pending' },
            missing.length ? { text: `Needs ${missing.join(', ')}`, mark: 'failed' } : { text: 'Ready for new chats', mark: done ? 'done' : 'pending' },
          ]} />
        ) : null}
      </div>
      {res?.deltaLines.length ? <><div className="mk-lab">What changed</div><div className="card mk-lines">{res.deltaLines.map((l, i) => <DotLine key={i} tone="need">{l}</DotLine>)}</div></> : null}
      {res?.findings.length ? (
        <><div className="mk-lab">What the check found{res.verdict ? ` · ${res.verdict}` : ''}</div>
          <div className="card mk-lines">{res.findings.slice(0, 20).map((f, i) => <DotLine key={i} tone={['critical', 'high'].includes(f.severity) ? 'bad' : 'need'}><b className="mk-sev">{String(f.severity ?? '').toUpperCase()}</b> {f.description}{f.file ? <span className="mk-muted"> · {f.file}{f.line ? `:${f.line}` : ''}</span> : null}</DotLine>)}</div></>
      ) : null}
      {done && missing.length ? (
        <>
          <div className="mk-lab">Keys it still needs</div>
          {missing.map((k) => <label className="mk-field" key={k}><span><code>{k}</code></span><input className="answer mono" type="password" autoComplete="off" placeholder="Paste it" value={keys[k] ?? ''} onChange={(e) => setKeys((m) => ({ ...m, [k]: e.target.value }))} /></label>)}
          <div className="mk-inline-r end"><button className="b-text" onClick={() => setState({ view: 'settings', settingsPage: 'keys' })}>Open Keys</button><RowButton onClick={saveMissing} busy={savingKeys} disabled={!missing.some((k) => keys[k]?.trim())}>Save keys</RowButton></div>
        </>
      ) : null}
      {done && res?.restart ? <div className="mk-inline-r end"><RowButton onClick={restart} busy={restarting}>Restart Hermes now</RowButton></div> : null}
      {res?.warnings.length ? <Note>{res.warnings.join(' ')}</Note> : null}
    </Dialog>
  )
}

// ---------- installed ----------

/**
 * Installed: what's waiting to update, then every plugin this bot has with its switch, the catalog's
 * picture where it knows it, and its page a click away. More options stay on the Plugins page.
 */
export function InstalledDialog({ snap, profile, botName, onClose, onOpen, onUpdate, onChanged }: {
  snap: MarketSnapshot | undefined; profile: string; botName: string; onClose: () => void; onOpen: (p: MarketPlugin) => void; onUpdate: (p: MarketPlugin, key: string) => void; onChanged: () => void
}) {
  const [open, setOpen] = useState(true)
  const close = () => { setOpen(false); setTimeout(onClose, 170) }
  const hub = useAsync(() => pluginHub(profile), [profile])
  const auto = useAsync(() => autoUpdateState(profile), [profile])
  const flips = useFlips()
  const [updatingAll, setUpdatingAll] = useState(false)
  const catalog = snap?.plugins ?? []
  const updates = catalog.filter((p) => p.updateAvailable)
  const names = (hub.data?.plugins ?? []).map((x) => x.name)
  const entryFor = (name: string) => catalog.find((p) => p.name === name) ?? catalog.find((p) => p.installed && installedKey(p.name, [name]) === name)
  const rows = [...(hub.data?.plugins ?? [])].filter((x) => !x.user_hidden).sort((a, b) => Number(a.source === 'bundled') - Number(b.source === 'bundled') || a.name.localeCompare(b.name))
  const isOn = (x: InstalledPlugin) => ['enabled', 'active', 'loaded'].includes(x.runtime_status ?? '')
  const updateAll = async () => {
    setUpdatingAll(true)
    try {
      const r = await updateAllPlugins(profile)
      toast([r.updated.length ? `Updated ${plural(r.updated.length, 'plugin')}.` : 'Nothing to update.', r.review.length ? `${r.review.join(', ')} need you to look first.` : '', r.failed.length ? `${r.failed.join(', ')} didn’t update.` : ''].filter(Boolean).join(' '))
      onChanged(); void hub.reload(true)
    } catch (e: any) { toast(e?.message ?? 'That didn’t finish.') } finally { setUpdatingAll(false) }
  }
  return (
    <Dialog open={open} onClose={close} width={640} title={`Installed for ${botName}`}
      footer={<><button className="b-text" onClick={() => { close(); setState({ view: 'settings', settingsPage: 'plugins' }) }}><Icon name="sliders" size={14} />More plugin options</button><span className="sp" /><button className="b-text" onClick={close}>Close</button></>}>
      <div className="card mk-gap"><div className="srow">
        <div className="tx"><div className="t1"><span>Update plugins on their own</span></div><div className="t2">Hermes checks every day and updates the ones that don’t ask for more.</div></div>
        <Switch on={flips.value('auto', !!auto.data)} disabled={auto.data === undefined} label="Update plugins on their own"
          onChange={(v) => void flips.flip('auto', v, () => setAutoUpdate(profile, v), { done: v ? 'Plugins update on their own now.' : 'Plugins wait for you to update them.', reload: () => auto.reload(true) })} />
      </div></div>
      {updates.length ? (
        <>
          <div className="mk-lab"><span>Updates</span><span className="sp" /><RowButton kind="text" onClick={updateAll} busy={updatingAll}>Update all</RowButton></div>
          <div className="card">
            {updates.map((p) => (
              <div className="srow click" key={p.name} onClick={() => onOpen(p)}>
                <PluginThumb p={p} size={36} />
                <div className="tx"><div className="t1"><span>{p.title}</span></div><div className="t3">Now {p.version ?? p.shaShort} in the catalog</div></div>
                <div className="act"><RowButton onClick={() => onUpdate(p, installedKey(p.name, names))}>Update</RowButton></div>
              </div>
            ))}
          </div>
        </>
      ) : null}
      <div className="mk-lab"><span>On this Mac</span><span className="sp" /><span>Off keeps it installed</span></div>
      {hub.error && !hub.data ? <ErrorLine text={hub.error} onRetry={() => void hub.reload()} />
        : !hub.data ? <div className="mk-center"><Spinner /></div>
        : !rows.length ? <Empty title="Nothing installed yet" body="Get one from the Marketplace." face={false} />
        : (
          <div className="card">
            {rows.map((x) => {
              const e = entryFor(x.name)
              const on = flips.value(x.name, isOn(x))
              return (
                <div className={`srow${e ? ' click' : ''}`} key={x.name} onClick={() => e && onOpen(e)}>
                  {e ? <PluginThumb p={e} size={36} /> : <span className="mk-ico big"><Icon name="plug" size={16} /></span>}
                  <div className="tx">
                    <div className="t1"><span className={on ? '' : 'mk-dim'}>{e?.title ?? x.name}</span>{x.source === 'bundled' ? <Badge tone="quiet">Built in</Badge> : null}</div>
                    <div className={`t2${x.auth_required ? ' mk-warn' : ''}`}>{x.auth_required ? `Needs a sign-in on this Mac${x.auth_command ? `: ${x.auth_command}` : ''}` : [e ? categoryName(e.category) : null, x.version || null, x.description ? summaryOf(x.description, 70) : null].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="act"><Switch on={on} label={x.name} onChange={(v) => void flips.flip(x.name, v, () => setPlugin(profile, x.name, v), { done: v ? `${e?.title ?? x.name} is on.` : `${e?.title ?? x.name} is off.`, reload: () => { onChanged(); return hub.reload(true) } })} /></div>
                </div>
              )
            })}
          </div>
        )}
    </Dialog>
  )
}
