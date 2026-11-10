// On this Mac: Hermes' own llama.cpp runtime. Install or update the engine, turn the server on and
// off, see what the machine can hold, download curated models (with progress, pause and resume),
// make one the default, free its memory, delete it, search Hugging Face for more, or add a file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  activateLocal, bytes, deleteLocal, downloadBrowsed, downloadLocal, ejectLocal, hfFiles, hfSearch, installRuntime, localCatalog, localHardware,
  localJobs, localServer, localStatus, pauseLocal, quickstartLocal, resumeLocal, sideloadLocal, tokens,
  type HfFiles, type HfHit, type LocalJob, type LocalModel,
} from '../../../lib/api-config'
import { toast } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { Badge, confirm, Empty, ErrorLine, Search, Spinner, useAsync } from '../../ui'
import { duration, SkeletonRows } from './models-shared'

const live = (j: LocalJob) => j.status === 'running' || j.status === 'paused'

/** Jobs Hermes is running, polled while any of them moves; settled ones announce themselves once. */
function useJobs(onSettled: (j: LocalJob) => void) {
  const [jobs, setJobs] = useState<LocalJob[]>([])
  const seen = useRef(new Map<string, LocalJob['status']>())
  const settled = useRef(onSettled)
  settled.current = onSettled
  const poll = useCallback(async () => {
    try {
      const js = await localJobs()
      for (const j of js) {
        const before = seen.current.get(j.job_id)
        if (before && (before === 'running' || before === 'paused') && (j.status === 'done' || j.status === 'error')) settled.current(j)
        seen.current.set(j.job_id, j.status)
      }
      setJobs(js)
    } catch { /* keep the last picture */ }
  }, [])
  useEffect(() => { void poll() }, [poll])
  const moving = jobs.some(live)
  useEffect(() => {
    if (!moving) return
    const t = setInterval(() => void poll(), 1500)
    return () => clearInterval(t)
  }, [moving, poll])
  return { jobs, poll }
}

export function LocalTab() {
  const status = useAsync(localStatus, [])
  const hw = useAsync(localHardware, [])
  const cat = useAsync(localCatalog, [])
  const [busy, setBusy] = useState<string | null>(null)
  const reloadStatus = status.reload, reloadCat = cat.reload
  const refreshAll = useCallback(() => { void reloadStatus(true); void reloadCat(true) }, [reloadStatus, reloadCat])
  const nameOfModel = (id?: string | null) => cat.data?.find((m) => m.id === id || m.downloaded_model_id === id || m.model_id === id)?.display_name ?? id ?? 'The model'
  const { jobs, poll } = useJobs((j) => {
    if (j.status === 'error') toast(`${j.kind === 'runtime-install' ? 'Engine install' : nameOfModel(j.model_id ?? j.target)} didn’t finish: ${j.error ?? j.detail ?? 'unknown error'}`)
    else if (j.kind === 'runtime-install') toast('The local engine is installed and ready.')
    else if (j.kind === 'model-download') toast(`${nameOfModel(j.model_id ?? j.target)} is downloaded.`)
    else if (j.kind === 'model-activate') toast(`New chats use ${nameOfModel(j.model_id ?? j.target)}.`)
    else if (j.kind === 'quickstart') toast(`${nameOfModel(j.model_id ?? j.target)} is set up. New chats run on this Mac.`)
    refreshAll()
  })
  // The server's own state (loading into memory) moves too: watch it while anything loads.
  const loadingNow = Object.keys(status.data?.loading ?? {}).length > 0
  useEffect(() => {
    if (!loadingNow) return
    const t = setInterval(() => void reloadStatus(true), 2000)
    return () => clearInterval(t)
  }, [loadingNow, reloadStatus])

  const act = async (key: string, fn: () => Promise<any>, ok?: string) => {
    setBusy(key)
    try { const r = await fn(); if (ok) toast(ok); await poll(); refreshAll(); return r } catch (e: any) { toast(e?.message ?? String(e)) } finally { setBusy(null) }
  }
  const jobFor = (ids: (string | null | undefined)[], kind?: LocalJob['kind']) => jobs.find((j) => live(j) && (!kind || j.kind === kind) && ids.some((id) => id && (j.model_id === id || j.target === id)))
  const installJob = jobs.find((j) => live(j) && j.kind === 'runtime-install')
  const quickJob = jobs.find((j) => live(j) && j.kind === 'quickstart')

  const s = status.data
  const models = cat.data ?? []
  const recommended = models.find((m) => m.recommended)
  const extra = useMemo(() => (s?.models ?? []).filter((m) => !models.some((c) => c.downloaded_model_id === m.id || c.model_id === m.id || c.id === m.id)), [s, models])

  const sideload = async () => {
    const files = await window.hermesNative.pickFiles().catch(() => [])
    const f = files.find((x) => /\.gguf$/i.test(x.path))
    if (!files.length) return
    if (!f) { toast('Pick a .gguf model file.'); return }
    const r = await act('sideload', () => sideloadLocal(f.path))
    if (r) toast(r.already_present ? 'That model is already in your library.' : `Added ${f.name}.`)
  }

  return (
    <>
      <p className="x-note">Models that run entirely on this Mac: no account, and nothing leaves the computer. Hermes installs the engine and starts it when a chat needs it.</p>
      {status.error ? <ErrorLine text={`Couldn’t read the local engine: ${status.error}`} onRetry={() => void status.reload()} /> : null}

      <div className="ssec"><h2>Engine</h2></div>
      {!s ? <SkeletonRows n={1} /> : (
        <div className="card">
          {!s.runtime_installed ? (
            <div className="srow">
              <Icon name="download" size={18} />
              <div className="tx">
                <div className="t1"><span>Install the local engine</span></div>
                <div className="t2">Downloads llama.cpp, a few hundred MB. Models you download then run on this Mac.</div>
                {installJob ? <JobLine job={installJob} /> : null}
              </div>
              <div className="act">
                <button className="b-soft" disabled={!!installJob || busy === 'install'} onClick={() => void act('install', () => installRuntime())}>{installJob || busy === 'install' ? 'Installing…' : 'Install engine'}</button>
              </div>
            </div>
          ) : (
            <>
              <div className="srow">
                <i className={`dot ${s.server_running ? 'ok' : 'off'}`} />
                <div className="tx">
                  <div className="t1"><span>llama.cpp {s.tag}</span><Badge tone={s.server_running ? 'ok' : 'quiet'}>{s.server_running ? 'Running' : 'Off'}</Badge></div>
                  <div className="t2">{s.server_running ? 'Turning it off frees all its memory. New chats on local models wait until it’s back on.' : `Uses ${s.runtime_backend ?? 'the best'} backend. It starts on its own when a chat needs it.`}</div>
                  {s.server_base_url ? <div className="t3">{s.server_base_url}</div> : null}
                </div>
                <div className="act">
                  <button className="b-text" disabled={busy === 'server'} onClick={() => void act('server', () => localServer(s.server_running ? 'stop' : 'start'), s.server_running ? 'Local engine stopped. Its memory is free.' : 'Local engine running.')}>
                    {busy === 'server' ? <Spinner /> : s.server_running ? 'Turn off' : 'Turn on'}
                  </button>
                </div>
              </div>
              {s.update_available || installJob ? (
                <div className="srow">
                  <Icon name="download" size={18} />
                  <div className="tx">
                    <div className="t1"><span>Engine update available</span></div>
                    <div className="t2">A newer build ({s.configured_tag}) is ready; you have {s.tag}. Models keep working while it downloads.</div>
                    {installJob ? <JobLine job={installJob} /> : null}
                  </div>
                  <div className="act"><button className="b-soft" disabled={!!installJob} onClick={() => void act('install', () => installRuntime())}>{installJob ? 'Updating…' : 'Update engine'}</button></div>
                </div>
              ) : null}
            </>
          )}
          <div className="srow">
            <Icon name="folder" size={18} />
            <div className="tx"><div className="t1"><span>Model folder</span></div><div className="t3">{s.models_dir}</div></div>
            <div className="act"><button className="b-text x-btn-sm" onClick={() => void window.hermesNative.reveal(s.models_dir)}>Show in Finder</button></div>
          </div>
        </div>
      )}

      <div className="ssec"><h2>This Mac</h2></div>
      <div className="card">
        {!hw.data ? (hw.error ? <div className="srow"><span className="t2">Couldn’t read the hardware: {hw.error}</span></div> : <div className="x-skel" />) : (
          <div className="md-hw">
            <div><span className="k">{hw.data.uma ? 'Unified memory' : 'GPU memory'}</span><span className="v">{hw.data.vram_label || bytes(hw.data.vram_total_bytes)}</span></div>
            <div><span className="k">Free for models now</span><span className="v">{bytes(hw.data.vram_usable_bytes)}</span></div>
            {!hw.data.uma ? <div><span className="k">System memory</span><span className="v">{bytes(hw.data.ram_total_bytes)}</span></div> : null}
            <div><span className="k">Memory available</span><span className="v">{bytes(hw.data.ram_available_bytes)}</span></div>
            {hw.data.gpu_name ? <div><span className="k">Graphics</span><span className="v">{hw.data.gpu_name}</span></div> : null}
            {hw.data.gpu_util_percent != null ? <div><span className="k">Graphics busy</span><span className="v">{Math.round(hw.data.gpu_util_percent)}%</span></div> : null}
          </div>
        )}
      </div>

      {s && !s.active_model_id && recommended ? (
        <div className="x-info" style={{ marginTop: 14 }}>
          <Icon name="bolt" size={15} />
          <span><b style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Run a model on this Mac.</b> One click sets up {s.runtime_installed ? '' : 'the engine, '}{recommended.display_name}{recommended.downloaded ? '' : ` (${recommended.size_label} download)`} and makes it the default for new chats.
            {quickJob ? <JobLine job={quickJob} /> : null}</span>
          <button className="b-soft" disabled={!!quickJob || busy === 'quick'} onClick={() => void act('quick', () => quickstartLocal(recommended.id))}>{quickJob ? 'Setting up…' : 'Set up for me'}</button>
        </div>
      ) : null}

      <div className="ssec"><h2>Models</h2><span>Sized for this Mac</span><span className="sp" />
        <button className="b-text x-btn-sm" disabled={busy === 'sideload'} onClick={() => void sideload()}><Icon name="upload" size={14} /> Add a model file</button>
      </div>
      {cat.error ? <ErrorLine text={`Couldn’t read the model list: ${cat.error}`} onRetry={() => void cat.reload()} /> : null}
      {cat.loading && !cat.data ? <SkeletonRows n={4} /> : null}
      {cat.data ? (
        <div className="card flow">
          {!models.length && !extra.length ? <Empty title="No models listed" body="Hermes didn’t send its model list. Try again in a moment." face={false} /> : null}
          {models.map((m) => <LocalRow key={m.id} m={m} active={s?.active_model_id} loaded={s?.loaded_models ?? {}} loading={s?.loading ?? {}} placement={s?.placement ?? {}} busy={busy}
            job={jobFor([m.id, m.downloaded_model_id, m.model_id])} act={act} />)}
          {extra.map((m) => (
            <LocalRow key={m.id} m={{ id: m.id, display_name: m.id, description: 'Added by you', size_bytes: m.size_bytes, size_label: m.size_label, native_context: 0, native_context_label: '', recommended: false, downloaded: true, downloaded_model_id: m.id, mtp: false, fits: true, fit_summary: '' }}
              active={s?.active_model_id} loaded={s?.loaded_models ?? {}} loading={s?.loading ?? {}} placement={s?.placement ?? {}} busy={busy} job={jobFor([m.id])} act={act} />
          ))}
        </div>
      ) : null}

      <Browse busy={busy} act={act} jobs={jobs} />
    </>
  )
}

function LocalRow({ m, active, loaded, loading, placement, busy, job, act }: {
  m: LocalModel; active?: string | null; loaded: Record<string, string>; loading: Record<string, any>; placement: Record<string, any>; busy: string | null; job?: LocalJob
  act: (key: string, fn: () => Promise<any>, ok?: string) => Promise<any>
}) {
  const id = m.downloaded_model_id || m.model_id || m.id
  const isActive = !!active && (active === id || active === m.id)
  const inMemory = !!loaded[id] || !!loaded[m.id]
  const loadPct = loading[id] ?? loading[m.id]
  const pct = typeof loadPct === 'number' ? loadPct : loadPct?.percent
  const place = placement[id] ?? placement[m.id]
  const spilled = place === 'spilled' || place?.spilled === true || (typeof place === 'object' && place?.placement === 'spilled')
  const download = async () => {
    if (!m.fits && !(await confirm({ title: `${m.display_name} may not fit`, body: m.fit_detail || m.fit_summary || 'It needs more memory than this Mac has free. It may run very slowly or not at all.', action: 'Download anyway' }))) return
    void act(`dl:${m.id}`, () => downloadLocal(m.id))
  }
  const remove = async () => {
    if (!(await confirm({ title: `Delete ${m.display_name} from this Mac?`, body: `Frees ${m.size_label || 'its space'}. You can download it again later.`, action: 'Delete', danger: true }))) return
    void act(`rm:${m.id}`, () => deleteLocal(id), `${m.display_name} deleted.`)
  }
  const facts = [m.size_label, m.native_context ? `${m.native_context_label || tokens(m.native_context)} context` : '', m.vision ? 'sees images' : '', m.downloaded_quant || m.quant || ''].filter(Boolean).join(' · ')
  return (
    <div className="srow">
      <div className="tx">
        <div className="t1">
          <span>{m.display_name}</span>
          {m.recommended ? <Badge tone="quiet">Recommended</Badge> : null}
          {isActive ? <Badge tone="ok">Default</Badge> : null}
          {pct != null ? <Badge tone="run">Loading {Math.round(pct)}%</Badge> : inMemory ? <Badge tone="run">In memory</Badge> : null}
          {inMemory && spilled ? <span title="Part of it runs from system memory: it works, but slower. A smaller build or context would fit fully."><Badge tone="need">Partly in system memory</Badge></span> : null}
          {!m.downloaded && !m.fits ? <Badge tone="need">Too big for this Mac</Badge> : null}
        </div>
        <div className="t2">{m.description}{m.fit_summary && m.fits ? ` ${m.fit_summary}.` : ''}</div>
        {facts ? <div className="t3" style={{ fontFamily: 'inherit' }}>{facts}</div> : null}
        {job ? <JobLine job={job} /> : null}
      </div>
      <div className="act">
        {m.downloaded ? (
          <>
            {!isActive ? <button className="b-soft x-btn-sm" disabled={!!busy || !!job} onClick={() => void act(`use:${m.id}`, () => activateLocal(id), `Starting ${m.display_name}…`)}>{busy === `use:${m.id}` ? <Spinner /> : 'Use'}</button> : null}
            {inMemory ? <button className="x-icon-btn" title="Free its memory (it loads again on the next message)" aria-label="Free memory" disabled={!!busy} onClick={() => void act(`ej:${m.id}`, () => ejectLocal(id), `${m.display_name} unloaded. Its memory is free.`)}><Icon name="power" size={15} /></button> : null}
            <button className="x-icon-btn danger" aria-label={`Delete ${m.display_name}`} disabled={!!busy || !!job} onClick={() => void remove()}><Icon name="trash" size={15} /></button>
          </>
        ) : job ? null : (
          <button className="b-soft x-btn-sm" disabled={!!busy} onClick={() => void download()}>{busy === `dl:${m.id}` ? <Spinner /> : `Download · ${m.size_label}`}</button>
        )}
      </div>
    </div>
  )
}

/** One job's progress: bar, what it's doing, bytes, speed and time left, with pause and resume. */
function JobLine({ job }: { job: LocalJob }) {
  const [busy, setBusy] = useState(false)
  const pct = job.percent ?? (job.total_bytes ? (job.done_bytes / job.total_bytes) * 100 : undefined)
  const paused = job.status === 'paused'
  const toggle = async () => {
    setBusy(true)
    try {
      const r = paused ? await resumeLocal(job.job_id) : await pauseLocal(job.job_id)
      if (!(('paused' in r && r.paused) || ('resumed' in r && r.resumed))) toast(paused ? 'Hermes couldn’t resume this one yet.' : 'This step can’t pause; it will finish on its own.')
    } catch (e: any) { toast(e?.message ?? String(e)) } finally { setBusy(false) }
  }
  const words = [
    paused ? 'Paused' : job.detail || job.phase,
    job.total_bytes ? `${bytes(job.done_bytes)} of ${bytes(job.total_bytes)}` : '',
    !paused && job.bytes_per_sec ? `${bytes(job.bytes_per_sec)}/s` : '',
    !paused && job.eta_seconds ? `about ${duration(job.eta_seconds)} left` : '',
  ].filter(Boolean).join(' · ')
  return (
    <div className="md-job">
      <span className={`x-prog${paused ? ' paused' : ''}${pct == null ? ' indet' : ''}`}><i style={{ width: `${Math.max(2, Math.min(100, pct ?? 30))}%` }} /></span>
      {pct != null ? <span>{Math.round(pct)}%</span> : null}
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{words}</span>
      {(paused ? job.can_resume !== false : job.can_pause) ? (
        <button className="x-icon-btn" aria-label={paused ? 'Resume' : 'Pause'} disabled={busy || job.pause_requested} onClick={() => void toggle()}><Icon name={paused ? 'play' : 'pause'} size={13} /></button>
      ) : null}
    </div>
  )
}

const FIT: Record<HfFiles['fit'], { label: string; tone: 'ok' | 'need' | 'bad' | 'quiet' }> = {
  'fits-gpu': { label: 'Fits in memory', tone: 'ok' }, 'needs-ram': { label: 'Uses system memory, slower', tone: 'need' }, 'too-big': { label: 'Too big', tone: 'bad' }, unknown: { label: 'Fit unknown', tone: 'quiet' },
}

/** Search all of Hugging Face for GGUF models and download a build sized for this Mac. */
function Browse({ busy, act, jobs }: { busy: string | null; act: (key: string, fn: () => Promise<any>, ok?: string) => Promise<any>; jobs: LocalJob[] }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<HfHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, HfFiles[] | 'loading' | string>>({})
  const seq = useRef(0)
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) { setHits(null); setErr(''); return }
    const n = ++seq.current
    const timer = setTimeout(async () => {
      setSearching(true)
      try { const h = await hfSearch(t); if (n === seq.current) { setHits(h); setErr('') } } catch (e: any) { if (n === seq.current) setErr(e?.message ?? String(e)) } finally { if (n === seq.current) setSearching(false) }
    }, 400)
    return () => clearTimeout(timer)
  }, [q])
  const showFiles = async (repo: string) => {
    if (open === repo) { setOpen(null); return }
    setOpen(repo)
    if (Array.isArray(files[repo])) return
    setFiles((f) => ({ ...f, [repo]: 'loading' }))
    try { const fs = await hfFiles(repo); setFiles((f) => ({ ...f, [repo]: fs })) } catch (e: any) { setFiles((f) => ({ ...f, [repo]: e?.message ?? String(e) })) }
  }
  const dl = async (repo: string, g: HfFiles) => {
    if (g.fit === 'too-big' && !(await confirm({ title: 'This build is too big for this Mac', body: 'It needs more memory than this Mac has. It may not run at all.', action: 'Download anyway' }))) return
    const r = await act(`hf:${repo}:${g.label}`, () => downloadBrowsed(repo, g.paths))
    if (r) toast(r.already_downloaded ? 'Already downloaded.' : `Downloading ${repo.split('/').pop()} (${g.label}).`)
  }
  const running = jobs.filter(live).filter((j) => j.kind === 'model-download' && !!j.target && j.target.includes('/'))
  return (
    <>
      <div className="ssec"><h2>Find more models</h2><span>All of Hugging Face; sized for this Mac, not tested by Hermes</span></div>
      <div className="stools"><Search value={q} onChange={setQ} placeholder="Search models by name or author" /></div>
      {running.map((j) => <div key={j.job_id} className="x-info"><Icon name="download" size={15} /><span>{j.target}<JobLine job={j} /></span></div>)}
      {err ? <ErrorLine text={err} /> : null}
      {searching && !hits ? <SkeletonRows n={3} /> : null}
      {hits ? (
        <div className="card md-hits">
          {!hits.length ? <Empty title="No models found" body={`Nothing on Hugging Face matches “${q}”.`} face={false} /> : null}
          {hits.map((h) => {
            const fs = files[h.repo]
            return (
              <div key={h.repo}>
                <div className="srow click" onClick={() => void showFiles(h.repo)}>
                  <Icon name="chevR" size={14} className={`x-chev${open === h.repo ? ' open' : ''}`} />
                  <div className="tx">
                    <div className="t1"><span className="x-mono" style={{ fontSize: 'var(--text-base)' }}>{h.repo}</span>{h.gated ? <Badge tone="need">Needs a Hugging Face sign-in</Badge> : null}</div>
                    <div className="t2">{h.downloads.toLocaleString()} downloads · {h.likes.toLocaleString()} likes{h.updated ? ` · updated ${new Date(h.updated).toLocaleDateString()}` : ''}</div>
                  </div>
                </div>
                {open === h.repo ? (
                  <div className="md-files x-reveal">
                    {fs === 'loading' ? <div className="md-file"><Spinner /><span className="ml">Reading model files…</span></div> : null}
                    {typeof fs === 'string' && fs !== 'loading' ? <div className="md-file"><i className="dot bad" /><span className="ml">{fs}</span></div> : null}
                    {Array.isArray(fs) && !fs.length ? <div className="md-file"><span className="ml">No model files this engine can run.</span></div> : null}
                    {Array.isArray(fs) ? fs.map((g) => (
                      <div key={g.label} className="md-file">
                        <span className="ml">{g.label} · {bytes(g.total_bytes)}{g.paths.length > 1 ? ` · ${g.paths.length} files` : ''}</span>
                        <Badge tone={FIT[g.fit]?.tone ?? 'quiet'}>{FIT[g.fit]?.label ?? g.fit}</Badge>
                        <button className="b-soft x-btn-sm" disabled={!!busy} onClick={() => void dl(h.repo, g)}>{busy === `hf:${h.repo}:${g.label}` ? <Spinner /> : 'Download'}</button>
                      </div>
                    )) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </>
  )
}
