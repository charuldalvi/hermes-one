// System › Maintenance: checks (doctor, security audit, prompt size, a setup summary), backups and
// restoring one, moving a bot to another Mac, file checkpoints, shell hooks, the skills curator,
// sharing a redacted report with support, and the anonymous-numbers switch.
import { useState } from 'react'
import {
  addHook, checkpoints, curator, debugShare, deleteHook, exportProfile, hooks, importProfile, metricsConsent, pruneCheckpoints,
  restoreBackup, runCurator, runOp, setCuratorPaused, setMetricsConsent, type Hook, type Op,
} from '../../../lib/api-system'
import { prettyName, toast } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { useStore } from '../../../lib/store'
import { BotFace } from '../../BotFace'
import { Badge, confirm, Dialog, ErrorLine, Select, Spinner, Switch, useAsync, type Option } from '../../ui'
import { ago, bytes, CopyValue, duration, errText, Field, reveal, RunLog, useActions, Warn } from './parts'

const CHECKS: { op: Op; title: string; what: string }[] = [
  { op: 'doctor', title: 'Run the doctor', what: 'Finds setup problems and says how to fix them' },
  { op: 'security-audit', title: 'Security check', what: 'Looks over keys, access and risky settings' },
  { op: 'prompt-size', title: 'Instruction size', what: 'How much each chat starts with before you say anything' },
  { op: 'dump', title: 'Setup summary', what: 'A plain summary of your setup, handy when asking for help' },
]

function HookDialog({ open, onClose, events, onAdd }: { open: boolean; onClose: () => void; events: string[]; onAdd: (h: { event: string; command: string; matcher?: string; timeout?: number }) => Promise<void> }) {
  const [event, setEvent] = useState('')
  const [command, setCommand] = useState('')
  const [matcher, setMatcher] = useState('')
  const [timeout, setTimeoutV] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const add = async () => {
    if (!event || !command.trim()) { setError('Pick when it runs and the command.'); return }
    setSaving(true); setError('')
    try { await onAdd({ event, command: command.trim(), matcher: matcher.trim() || undefined, timeout: timeout ? Number(timeout) : undefined }); setEvent(''); setCommand(''); setMatcher(''); setTimeoutV('') } catch (e) { setError(errText(e)) } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onClose={() => { if (!saving) onClose() }} width={540} title="Add a shell hook"
      footer={<>{error ? <span className="sy-err" style={{ flex: 1 }}>{error}</span> : <span className="sp" />}<button className="b-text" onClick={onClose} disabled={saving}>Cancel</button><button className="b-pri" onClick={() => void add()} disabled={saving}>{saving ? 'Adding…' : 'Add hook'}</button></>}>
      <div className="sy-form">
        <Warn>A hook runs a command on this Mac each time the event happens, with your permissions. Only add commands you trust.</Warn>
        <Field label="When"><Select value={event} options={events.map((e) => ({ value: e, label: e.replace(/_/g, ' ') }))} onChange={setEvent} placeholder="Pick an event" width={360} /></Field>
        <Field label="Command"><input className="answer mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="~/bin/notify.sh" /></Field>
        <div className="sy-row2">
          <Field label="Only for" optional hint="A tool or name to match, like terminal."><input className="answer mono" value={matcher} onChange={(e) => setMatcher(e.target.value)} placeholder="terminal" /></Field>
          <Field label="Give up after" optional hint="Seconds."><input className="answer" type="number" min={1} value={timeout} onChange={(e) => setTimeoutV(e.target.value)} placeholder="10" /></Field>
        </div>
      </div>
    </Dialog>
  )
}

export function MaintenanceTab({ profile }: { profile: string }) {
  const bots = useStore((s) => s.bots)
  const who = profile === 'default' ? 'Hermes' : bots.find((b) => b.profile === profile)?.name ?? prettyName(profile)
  const { runs, start, clear } = useActions()
  const cps = useAsync(() => checkpoints(profile), [profile])
  const hk = useAsync(() => hooks(profile), [profile])
  const cur = useAsync(() => curator(profile), [profile])
  const metrics = useAsync(() => metricsConsent(profile).catch(() => null), [profile])
  const [backup, setBackup] = useState<string | null>(null)
  const [hookOpen, setHookOpen] = useState(false)
  const [share, setShare] = useState<{ busy: boolean; urls?: Record<string, string>; failures?: Record<string, string>; ttl?: number | null; error?: string } | null>(null)
  const [exportWho, setExportWho] = useState(profile)

  const doBackup = () => void start('backup', 'Backing up Hermes', async () => { const r = await runOp(profile, 'backup'); setBackup(r.archive ?? null); return r }, { onDone: (r) => toast(r.error ? `The backup didn’t finish: ${r.error}` : 'Backup saved') })
  const restore = async () => {
    const picked = await window.hermesNative.pickFiles().catch(() => [])
    const file = picked?.[0]
    if (!file) return
    if (!/\.zip$/i.test(file.path)) { toast('Pick a Hermes backup (.zip).'); return }
    if (!(await confirm({ title: 'Restore from this backup?', body: `${file.name} replaces ${who}’s current config, keys, memory and chats with the ones in the backup. Anything newer is lost. Make a fresh backup first if you’re not sure.`, action: 'Restore', danger: true }))) return
    void start('restore', 'Restoring the backup', () => restoreBackup(profile, file.path), { onDone: (r) => toast(r.error ? `The restore didn’t finish: ${r.error}` : 'Restored. Restart messaging so everything picks it up.') })
  }
  const doExport = async () => {
    try { const r = await exportProfile(exportWho); toast('Saved. It’s shown in Finder.'); reveal(r.archive) } catch (e) { toast(`Couldn’t export it: ${errText(e)}`) }
  }
  const doImport = async () => {
    const picked = await window.hermesNative.pickFiles().catch(() => [])
    const file = picked?.[0]
    if (!file) return
    if (!(await confirm({ title: `Add the agent in ${file.name}?`, body: 'It joins your agents with its own skills, memory and settings. An agent with the same name already here is not replaced; you’ll get an error instead.', action: 'Add agent' }))) return
    try { const r = await importProfile(file.path); toast(`${prettyName(r.name)} is now one of your agents`) } catch (e) { toast(`Couldn’t add it: ${errText(e)}`) }
  }
  const prune = async () => {
    if (!(await confirm({ title: 'Prune old checkpoints?', body: 'Old file checkpoints are deleted. Changes from before them can’t be undone any more.', action: 'Prune', danger: true }))) return
    void start('prune', 'Pruning checkpoints', () => pruneCheckpoints(profile), { onDone: () => void cps.reload(true) })
  }
  const add = async (h: { event: string; command: string; matcher?: string; timeout?: number }) => { await addHook(profile, h); setHookOpen(false); toast(`Hook added. It runs from ${who}’s next chat.`); void hk.reload(true) }
  const removeHook = async (h: Hook) => {
    if (!(await confirm({ title: 'Remove this hook?', body: <><span className="sy-mono">{h.command}</span> stops running on {h.event.replace(/_/g, ' ')}.</>, action: 'Remove', danger: true }))) return
    hk.setData((d) => (d ? { ...d, hooks: d.hooks.filter((x) => !(x.event === h.event && x.command === h.command)) } : d))
    try { await deleteHook(profile, h); toast('Hook removed') } catch (e) { toast(`Couldn’t remove it: ${errText(e)}`); void hk.reload(true) }
  }
  const toggleCurator = async (on: boolean) => {
    cur.setData((c) => (c ? { ...c, paused: !on } : c))
    try { await setCuratorPaused(profile, !on); toast(on ? 'The curator tidies skills on its own again' : 'The curator is paused') } catch (e) { cur.setData((c) => (c ? { ...c, paused: on } : c)); toast(`Couldn’t change it: ${errText(e)}`) }
  }
  const doShare = async () => {
    if (!(await confirm({ title: 'Share with Hermes support?', body: 'Hermes uploads a report about your setup and its recent logs to its paste service and gives you links to send to whoever is helping you. Keys and tokens are scrubbed first, but the logs can still mention your chats and files. The links delete themselves after a while.', action: 'Upload and get links' }))) return
    setShare({ busy: true })
    try { const r = await debugShare(); setShare({ busy: false, urls: r.urls, failures: r.failures, ttl: r.auto_delete_seconds }) } catch (e) { setShare({ busy: false, error: errText(e) }) }
  }
  const toggleMetrics = async (on: boolean) => {
    const before = metrics.data
    metrics.setData((m) => (m ? { ...m, enabled: on, send: on } : m))
    try { const r = await setMetricsConsent(profile, on); metrics.setData((m) => (m ? { ...m, ...r } : m)); toast(on ? 'Thanks. Anonymous numbers are shared.' : 'Nothing is shared any more') } catch (e) { metrics.setData(before); toast(`Couldn’t change it: ${errText(e)}`) }
  }

  const exportOpts: Option[] = [...bots].sort((a, b) => (a.isChief ? -1 : b.isChief ? 1 : a.name.localeCompare(b.name))).map((b) => ({ value: b.profile, label: b.isChief ? 'Hermes' : b.name, icon: <BotFace profile={b.profile} size={20} poseKey={b.poseKey} watch={false} /> }))
  const c = cur.data
  return (
    <>
      <div className="ssec"><h2>Checks</h2><span>for {who}</span></div>
      <div className="card">
        {CHECKS.map((k) => (
          <div key={k.op}>
            <div className="srow click" onClick={() => { if (!runs[k.op]?.running) void start(k.op, k.title, () => runOp(profile, k.op)) }}>
              <Icon name={k.op === 'security-audit' ? 'shield' : k.op === 'doctor' ? 'check' : 'file'} size={17} />
              <div className="tx"><div className="t1"><span>{k.title}</span></div><div className="t2">{k.what}</div></div>
              {runs[k.op]?.running ? <Spinner size={13} /> : <Icon name="play" size={14} />}
            </div>
            <RunLog run={runs[k.op]} onClose={() => clear(k.op)} />
          </div>
        ))}
      </div>

      <div className="ssec"><h2>Backup</h2></div>
      <div className="card">
        <div className="srow">
          <Icon name="download" size={17} />
          <div className="tx"><div className="t1"><span>Back up now</span></div><div className="t2">A zip on this Mac with {profile === 'default' ? 'your config, keys, memory and chats' : `${who}’s config, keys, memory and chats`}. Keep a copy somewhere safe.</div></div>
          <button className="b-soft" onClick={doBackup} disabled={runs.backup?.running}>{runs.backup?.running ? 'Backing up…' : 'Back up'}</button>
        </div>
        {backup && runs.backup && !runs.backup.running && !runs.backup.error ? (
          <div className="srow"><Icon name="file" size={17} /><div className="tx"><div className="t1"><span>{backup.split(/[\\/]/).pop()}</span></div><div className="t3">{backup}</div></div><button className="b-text" onClick={() => reveal(backup)}>Show in Finder</button></div>
        ) : null}
        <RunLog run={runs.backup} onClose={() => clear('backup')} />
        <div className="srow">
          <Icon name="upload" size={17} />
          <div className="tx"><div className="t1"><span>Restore from a backup</span></div><div className="t2">Puts a backup back in place of what’s here now.</div></div>
          <button className="b-text" onClick={() => void restore()} disabled={runs.restore?.running}>Choose backup…</button>
        </div>
        <RunLog run={runs.restore} onClose={() => clear('restore')} />
      </div>

      <div className="ssec"><h2>Move an agent</h2><span>to another Mac, or back</span></div>
      <div className="card">
        <div className="srow">
          <Icon name="download" size={17} />
          <div className="tx"><div className="t1"><span>Export an agent</span></div><div className="t2">Saves one agent (its skills, memory and settings) as a file you can add on another Mac.</div></div>
          <Select value={exportWho} options={exportOpts} onChange={setExportWho} width={240} align="end" render={(o) => <>{o?.icon}<span className="sv">{o?.label ?? who}</span></>} />
          <button className="b-soft" onClick={() => void doExport()}>Export</button>
        </div>
        <div className="srow">
          <Icon name="upload" size={17} />
          <div className="tx"><div className="t1"><span>Add an agent from a file</span></div><div className="t2">An agent exported from Hermes (.tar.gz) joins your agents.</div></div>
          <button className="b-text" onClick={() => void doImport()}>Choose file…</button>
        </div>
      </div>

      <div className="ssec"><h2>File checkpoints</h2>{cps.data ? <span>{bytes(cps.data.total_bytes)} in {cps.data.sessions.length} {cps.data.sessions.length === 1 ? 'chat' : 'chats'}</span> : null}</div>
      <div className="card">
        <div className="srow">
          <Icon name="folder" size={17} />
          <div className="tx"><div className="t1"><span>Snapshots before changes</span></div><div className="t2">Hermes snapshots files before it changes them, so a chat’s changes can be undone. Pruning frees the space old ones take.</div>
            {cps.error ? <div className="sy-err">{cps.error}</div> : null}</div>
          <button className="b-soft" onClick={() => void prune()} disabled={runs.prune?.running || !cps.data?.sessions.length}>{runs.prune?.running ? 'Pruning…' : 'Prune old ones'}</button>
        </div>
        <RunLog run={runs.prune} onClose={() => clear('prune')} />
      </div>

      <div className="ssec"><h2>Shell hooks</h2><span>{hk.data ? hk.data.hooks.length || 'none' : ''}</span><span className="sp" /><button className="b-text" style={{ height: 26 }} onClick={() => setHookOpen(true)} disabled={!hk.data}><Icon name="plus" size={13} /> Add a hook</button></div>
      {hk.error && !hk.data ? <ErrorLine text={`Couldn’t load hooks: ${hk.error}`} onRetry={() => void hk.reload()} /> : (
        <div className="card">
          {hk.loading && !hk.data ? <div className="srow"><Spinner size={13} /></div> : !hk.data?.hooks.length ? <div className="srow"><div className="tx"><div className="t2">No hooks. A hook runs a command each time something happens, like before a tool runs or when a chat ends.</div></div></div>
            : hk.data.hooks.map((h, i) => (
              <div className="srow" key={`${h.event}:${h.command}:${i}`}>
                <Icon name="terminal" size={17} />
                <div className="tx">
                  <div className="t1"><span>{h.event.replace(/_/g, ' ')}</span>{h.matcher ? <Badge tone="quiet">only {h.matcher}</Badge> : null}{!h.allowed ? <Badge tone="need">Not approved</Badge> : null}{!h.executable ? <Badge tone="quiet">Script not runnable</Badge> : null}</div>
                  <div className="t3" title={h.command}>{h.command}</div>
                  {h.approved_at ? <div className="t2" style={{ fontSize: 12 }}>Approved {ago(h.approved_at)}{h.timeout ? ` · gives up after ${h.timeout} s` : ''}</div> : null}
                </div>
                <button className="hbtn" title="Remove" onClick={() => void removeHook(h)}><Icon name="trash" size={15} /></button>
              </div>
            ))}
        </div>
      )}

      <div className="ssec"><h2>Skills curator</h2></div>
      <div className="card">
        {cur.error && !c ? <div className="srow"><span className="sy-err">Couldn’t load the curator: {cur.error}</span></div> : !c ? <div className="srow"><Spinner size={13} /></div> : (
          <>
            <div className="srow">
              <Icon name="book" size={17} />
              <div className="tx"><div className="t1"><span>Tidy skills on its own</span>{!c.enabled ? <Badge tone="quiet">Turned off in settings</Badge> : null}</div>
                <div className="t2">The curator merges, archives and improves skills {who} hasn’t used in a while{c.interval_hours ? `, every ${duration(c.interval_hours * 3600)}` : ''}{c.min_idle_hours ? ` when idle for ${c.min_idle_hours} h` : ''}.</div>
                <div className="t3" style={{ fontFamily: 'inherit' }}>{c.last_run_at ? `Last ran ${ago(c.last_run_at)}` : 'Hasn’t run yet'}{c.stale_after_days ? ` · unused after ${c.stale_after_days} days` : ''}{c.archive_after_days ? ` · archived after ${c.archive_after_days}` : ''}</div></div>
              <Switch on={c.enabled && !c.paused} onChange={(v) => void toggleCurator(v)} disabled={!c.enabled} label="Tidy skills on its own" />
            </div>
            <div className="srow">
              <Icon name="play" size={17} />
              <div className="tx"><div className="t1"><span>Run it now</span></div><div className="t2">Reviews {who}’s skills straight away.</div></div>
              <button className="b-soft" onClick={() => void start('curator', 'Tidying skills', () => runCurator(profile), { onDone: () => void cur.reload(true) })} disabled={runs.curator?.running}>{runs.curator?.running ? 'Running…' : 'Run'}</button>
            </div>
            <RunLog run={runs.curator} onClose={() => clear('curator')} />
          </>
        )}
      </div>

      <div className="ssec"><h2>Help and privacy</h2></div>
      <div className="card">
        <div className="srow">
          <Icon name="external" size={17} />
          <div className="tx"><div className="t1"><span>Share with Hermes support</span></div><div className="t2">Uploads a scrubbed report and recent logs, and gives you links to send to whoever is helping you.</div></div>
          <button className="b-soft" onClick={() => void doShare()} disabled={share?.busy}>{share?.busy ? 'Uploading…' : 'Get links'}</button>
        </div>
        {share && !share.busy ? (
          <div style={{ padding: '0 16px 14px', display: 'grid', gap: 8 }} className="sy-reveal">
            {share.error ? <div className="sy-err">{share.error}</div> : null}
            {Object.entries(share.urls ?? {}).map(([k, url]) => <Field key={k} label={k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ')}><CopyValue value={url} what="Copied the link" /></Field>)}
            {Object.entries(share.failures ?? {}).map(([k, why]) => <div key={k} className="sy-err">{k}: {why}</div>)}
            {share.ttl ? <div className="sy-note" style={{ margin: 0 }}>These links delete themselves after {duration(share.ttl)}.</div> : null}
          </div>
        ) : null}
        {metrics.data && !metrics.data.managed ? (
          <div className="srow">
            <Icon name="chart" size={17} />
            <div className="tx"><div className="t1"><span>Share anonymous usage numbers</span></div><div className="t2">Helps Nous improve Hermes: counts, never what you write. For {who}.</div></div>
            <Switch on={!!metrics.data.enabled && !!metrics.data.send} onChange={(v) => void toggleMetrics(v)} label="Share anonymous usage numbers" />
          </div>
        ) : null}
      </div>

      <HookDialog open={hookOpen} onClose={() => setHookOpen(false)} events={hk.data?.valid_events ?? []} onAdd={add} />
    </>
  )
}
