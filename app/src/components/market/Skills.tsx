// The Marketplace's Skills tab: the hub's featured skills, search across every hub source, what you
// installed from the hub, and one skill's page with its SKILL.md and Hermes' security scan before it's
// added (Hermes Remote's HubSkillSheet, Hermes Desktop's skill catalog and Update skills).
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../lib/icons'
import { toast } from '../../lib/hermes'
import {
  actionStatus, hubInstall, hubPreview, hubScan, hubSearch, hubSources, hubUninstall, hubUpdateAll, installedSkill, plural,
  type ActionStatus, type HubScan, type HubSkill, type HubSources,
} from '../../lib/api-market'
import { Badge, Dialog, Empty, ErrorLine, Search, Select, Spinner, confirm, useAsync } from '../ui'
import { Note, RowButton, Section, Skeleton, TierBadge } from './parts'

const official = (s: HubSkill) => ['builtin', 'official'].includes(s.trust.toLowerCase()) || s.source === 'official'
const trustWord = (t: string) => (t === 'builtin' ? 'Built by Nous' : t === 'trusted' ? 'Trusted source' : t === 'community' ? 'Community' : t)

export function SkillsTab({ profile, botName, query, setQuery }: { profile: string; botName: string; query: string; setQuery: (q: string) => void }) {
  const src = useAsync(() => hubSources(profile), [profile])
  const [source, setSource] = useState('all')
  const [results, setResults] = useState<{ q: string; list: HubSkill[]; timedOut: string[]; installed: HubSources['installed'] } | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string>()
  const [open, setOpen] = useState<HubSkill | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)

  const q = query.trim()
  useEffect(() => {
    if (q.length < 2) { setResults(null); setSearching(false); return }
    let stop = false
    setSearching(true)
    const t = setTimeout(async () => {
      try { const r = await hubSearch(profile, q, source); if (!stop) { setResults({ q, list: r.results, timedOut: r.timedOut, installed: r.installed }); setSearchError(undefined) } } catch (e: any) { if (!stop) setSearchError(e?.message ?? String(e)) } finally { if (!stop) setSearching(false) }
    }, 450)
    return () => { stop = true; clearTimeout(t) }
  }, [q, source, profile])

  const installed = results?.installed ?? src.data?.installed ?? {}
  const isInstalled = (s: HubSkill) => !!installedSkill(installed, s)
  const sources = src.data?.sources ?? []
  const options = [{ value: 'all', label: 'Every source' }, ...sources.filter((s) => s.searchable).map((s) => ({ value: s.id, label: s.label, hint: s.rateLimited ? 'busy' : s.available === false ? 'offline' : undefined }))]
  const mine = Object.entries(src.data?.installed ?? {}).map(([identifier, v]) => ({ identifier, ...v })).sort((a, b) => a.name.localeCompare(b.name))
  const updateAll = async () => {
    try { const name = await hubUpdateAll(profile); if (name) setUpdating(name); else toast('Asked Hermes to update your skills.') } catch (e: any) { toast(e?.message ?? 'That didn’t start.') }
  }

  return (
    <>
      <div className="stools">
        <Search value={query} onChange={setQuery} placeholder="Search skills from every hub" />
        <Select value={source} options={options} onChange={setSource} width={240} align="end" />
        <RowButton onClick={updateAll} disabled={!!updating}><Icon name="refresh" size={14} />Update skills</RowButton>
      </div>
      {updating ? <ActionProgress name={updating} label="Updating skills from the hub" onDone={(ok) => { toast(ok ? 'Skills are up to date.' : 'Updating skills ended with an error.'); setUpdating(null); void src.reload(true) }} /> : null}
      {src.data && !src.data.indexAvailable ? <Note tone="need">The Hermes Index isn’t answering, so search asks each source one by one. It’s slower.</Note> : null}

      {q.length >= 2 ? (
        <>
          <div className="mk-count"><b>{searching && !results ? 'Searching…' : results ? plural(results.list.length, 'skill') : ''}</b>{searching && results ? <Spinner size={12} /> : null}
            <span>{results?.timedOut.length ? `${results.timedOut.join(', ')} didn’t answer in time` : ''}</span></div>
          {searchError ? <ErrorLine text={searchError} /> : null}
          {!results && searching ? <Skeleton rows={6} tiles /> : results && !results.list.length ? <Empty title="No skills match" body="Try other words, or another source." /> : results ? <SkillGrid list={results.list} isInstalled={isInstalled} onOpen={setOpen} /> : null}
        </>
      ) : (
        <>
          <Section title="Featured" note="From the Hermes Index" />
          {src.error && !src.data ? <ErrorLine text={src.error} onRetry={() => void src.reload()} />
            : !src.data ? <Skeleton rows={6} tiles />
            : src.data.featured.length ? <SkillGrid list={src.data.featured} isInstalled={isInstalled} onOpen={setOpen} />
            : <Empty title="No featured skills right now" body="Search to find one." face={false} />}
          {mine.length ? (
            <>
              <Section title="Installed from the hub" note={`For ${botName}`} />
              <div className="card">
                {mine.map((s) => (
                  <div key={s.identifier} className="srow click" onClick={() => setOpen({ name: s.name, identifier: s.identifier, description: '', source: s.identifier.split('/')[0], trust: s.trust_level ?? 'community', tags: [] })}>
                    <span className="mk-ico big"><Icon name="book" size={16} /></span>
                    <div className="tx"><div className="t1"><span>{s.name}</span>{s.trust_level === 'builtin' ? <TierBadge tier="official" /> : null}</div><div className="t3">{s.identifier}{s.scan_verdict && s.scan_verdict !== 'backfilled' ? ` · scan: ${s.scan_verdict}` : ''}</div></div>
                    <Icon name="chevR" size={15} />
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
      <p className="mk-foot"><Icon name="shield" size={14} /> Hermes scans every skill before it’s added: what it runs, what it reads and where it sends things. To turn installed skills on or off, use Settings › Skills.</p>
      {open ? <SkillDialog key={open.identifier} s={open} profile={profile} botName={botName} installed={isInstalled(open) || !!src.data?.installed[open.identifier]}
        installedName={installedSkill(installed, open)?.name ?? src.data?.installed[open.identifier]?.name} onClose={() => setOpen(null)} onChanged={() => void src.reload(true)} /> : null}
    </>
  )
}

function SkillGrid({ list, isInstalled, onOpen }: { list: HubSkill[]; isInstalled: (s: HubSkill) => boolean; onOpen: (s: HubSkill) => void }) {
  return (
    <div className="tiles flow">
      {list.map((s) => (
        <div key={s.identifier} className="tile-c" onClick={() => onOpen(s)}>
          <div className="th"><span className="mk-ico big"><Icon name="book" size={17} /></span><div className="tx"><div className="tt">{s.name}</div><div className="ts">{[s.source, s.repo].filter(Boolean).join(' · ')}</div></div></div>
          <div className="td">{s.description || 'No description.'}</div>
          <div className="tf">{official(s) ? <TierBadge tier="official" /> : <span className="mk-kind">{trustWord(s.trust)}</span>}<span className="sp" />{isInstalled(s) ? <Badge tone="ok">Added</Badge> : <RowButton onClick={() => onOpen(s)}>Add</RowButton>}</div>
        </div>
      ))}
    </div>
  )
}

/** A background job on the Mac (an install from the hub): its live lines until it ends. */
export function ActionProgress({ name, label, onDone }: { name: string; label: string; onDone: (ok: boolean) => void }) {
  const [s, setS] = useState<ActionStatus | null>(null)
  const [err, setErr] = useState<string>()
  const done = useRef(false)
  useEffect(() => {
    let stop = false
    let t: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const r = await actionStatus(name)
        if (stop) return
        setS(r); setErr(undefined)
        if (!r.running && !done.current) { done.current = true; onDone(r.exitCode === 0 || r.exitCode === null); return }
      } catch (e: any) { if (!stop) setErr(e?.message ?? String(e)) }
      if (!stop) t = setTimeout(tick, 2000)
    }
    t = setTimeout(tick, 800)
    return () => { stop = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])
  const running = !s || s.running
  return (
    <div className="mk-action">
      <div className="mk-status">{running ? <Spinner size={12} /> : <i className={`dot ${s?.exitCode ? 'bad' : 'ok'}`} />}{running ? `${label}…` : s?.exitCode ? `Ended with an error (exit ${s.exitCode})` : 'Finished'}</div>
      {err ? <p className="mk-muted mk-err">{err}</p> : null}
      {s?.lines.length ? <pre className="mk-pre">{s.lines.slice(-40).join('\n')}</pre> : null}
    </div>
  )
}

function ScanView({ scan }: { scan: HubScan }) {
  const tone = scan.policy === 'block' || scan.verdict === 'dangerous' ? 'bad' : scan.policy === 'ask' || scan.verdict === 'caution' ? 'need' : 'ok'
  const counts = Object.entries(scan.counts).filter(([, n]) => n > 0)
  return (
    <div className="card mk-scan">
      <div className="mk-status"><i className={`dot ${tone}`} />{scan.verdict ? scan.verdict[0].toUpperCase() + scan.verdict.slice(1) : 'Scanned'} · {scan.policy === 'allow' ? 'Hermes allows the install' : scan.policy === 'ask' ? 'install only if you trust it' : 'Hermes blocks the install'}</div>
      {scan.summary ? <p className="mk-muted">{scan.summary}</p> : null}
      {scan.policyReason && scan.policy !== 'allow' ? <p className="mk-muted">{scan.policyReason}</p> : null}
      {counts.length ? <div className="mk-tchips">{counts.map(([k, n]) => <span key={k}>{n} {k}</span>)}</div> : null}
      {scan.findings.slice(0, 20).map((f, i) => (
        <div key={i} className={`mk-finding ${['critical', 'high'].includes(f.severity) ? 'bad' : ''}`}><b>{f.severity.toUpperCase()}</b> {f.description}{f.file ? <span> · {f.file}{f.line ? `:${f.line}` : ''}</span> : null}</div>
      ))}
      {scan.tier1 ? <p className="mk-muted">Second opinion: {scan.tier1.passed ? 'passed' : `${plural(scan.tier1.findings.length, 'finding')}`}</p> : null}
      {scan.tier1?.findings.slice(0, 10).map((f, i) => <div key={`t${i}`} className="mk-finding"><b>{f.severity.toUpperCase()}</b> {f.message}{f.file ? <span> · {f.file}{f.line ? `:${f.line}` : ''}</span> : null}</div>)}
    </div>
  )
}

function SkillDialog({ s, profile, botName, installed, installedName, onClose, onChanged }: { s: HubSkill; profile: string; botName: string; installed: boolean; installedName?: string; onClose: () => void; onChanged: () => void }) {
  const [open, setOpen] = useState(true)
  const preview = useAsync(() => hubPreview(profile, s.identifier), [profile, s.identifier])
  const [scan, setScan] = useState<HubScan | null>(null)
  const [scanning, setScanning] = useState(false)
  const [note, setNote] = useState<string>()
  const [action, setAction] = useState<{ name: string; label: string; kind: 'install' | 'uninstall' } | null>(null)
  const [isIn, setIsIn] = useState(installed)
  const close = () => { setOpen(false); setTimeout(onClose, 170) }
  const info = { ...s, ...(preview.data ? { description: preview.data.description || s.description, repo: preview.data.repo ?? s.repo, tags: preview.data.tags?.length ? preview.data.tags : s.tags, trust: preview.data.trust || s.trust, source: preview.data.source || s.source } : {}) } as HubSkill

  const runScan = async () => {
    setScanning(true); setNote(undefined)
    try { setScan(await hubScan(profile, s.identifier)) } catch (e: any) { setNote(e?.message ?? String(e)) } finally { setScanning(false) }
  }
  const install = async () => {
    if (scan?.policy === 'ask' && !(await confirm({ title: `Install ${s.name} anyway?`, body: `The scan says ${scan.verdict ?? 'caution'}. Only install it if you trust where it comes from.`, action: 'Install anyway', danger: true }))) return
    try {
      const name = await hubInstall(profile, s.identifier)
      if (name) setAction({ name, label: `Installing ${s.name}`, kind: 'install' })
      else { toast(`Asked Hermes to install ${s.name}.`); onChanged() }
    } catch (e: any) { setNote(e?.message ?? String(e)) }
  }
  const uninstall = async () => {
    if (!(await confirm({ title: `Uninstall ${s.name}?`, body: `${botName} stops using it and its files are removed from this Mac.`, action: 'Uninstall', danger: true }))) return
    try {
      const name = await hubUninstall(profile, installedName ?? s.name)
      if (name) setAction({ name, label: `Removing ${s.name}`, kind: 'uninstall' })
      else { toast(`Asked Hermes to uninstall ${s.name}.`); onChanged() }
    } catch (e: any) { setNote(e?.message ?? String(e)) }
  }
  const md = preview.data?.skillMd
  return (
    <Dialog open={open} onClose={close} wide title={<><span className="mk-ico"><Icon name="book" size={15} /></span><span>{s.name}</span>{official(info) ? <TierBadge tier="official" /> : null}</>}
      footer={<>
        {isIn ? <button className="b-ghost-danger" disabled={!!action} onClick={uninstall}>Uninstall</button> : null}
        <span className="sp" />
        <button className="b-text" onClick={close}>Close</button>
        {!isIn ? (scan ? <button className="b-pri" disabled={scan.policy === 'block' || !!action} onClick={install}>Install</button>
          : <button className="b-pri" disabled={scanning} onClick={runScan}>{scanning ? <Spinner size={12} /> : null}Scan it</button>) : null}
      </>}>
      <div className="mk-meta">{[info.source, trustWord(info.trust), info.repo].filter(Boolean).join(' · ')}</div>
      {info.description ? <p className="mk-about">{info.description}</p> : null}
      {info.tags.length ? <div className="mk-tchips">{info.tags.slice(0, 16).map((t) => <span key={t}>{t}</span>)}</div> : null}
      <div className="mk-lab">Security scan</div>
      {scanning ? <div className="mk-status"><Spinner size={12} />Hermes is scanning it in quarantine…</div>
        : scan ? <ScanView scan={scan} />
        : <p className="mk-muted">{isIn ? 'It’s installed. Hermes scanned it when it was added.' : 'Hermes scans every skill before it’s installed: what it runs, what it reads and where it sends things. Scan it to see the verdict, then install.'}</p>}
      {isIn && !scan && !scanning ? <button className="b-text mk-left" onClick={runScan}><Icon name="shield" size={14} />Scan it again</button> : null}
      {action ? <ActionProgress name={action.name} label={action.label} onDone={(ok) => {
        if (ok) { setIsIn(action.kind === 'install'); toast(action.kind === 'install' ? `Installed ${s.name} for ${botName}.` : `Uninstalled ${s.name}.`) }
        setAction(null); onChanged()
      }} /> : null}
      {note ? <Note tone="bad" onDismiss={() => setNote(undefined)}>{note}</Note> : null}
      <div className="mk-lab"><span>SKILL.md</span><span className="sp" />{preview.data?.files.length ? <span>{plural(preview.data.files.length, 'file')}</span> : null}</div>
      {preview.loading && !preview.data ? <div className="mk-center"><Spinner /></div> : preview.error ? <p className="mk-muted">{preview.error}</p> : <pre className="mk-pre tall">{md?.trim() || 'No preview.'}</pre>}
      {preview.data?.files.length && preview.data.files.length > 1 ? <div className="mk-files">{preview.data.files.slice(0, 40).map((f) => <code key={f}>{f}</code>)}</div> : null}
    </Dialog>
  )
}
