// System › Overview: is Hermes healthy, is it up to date (and update it, following the update
// to the end), the messaging gateway (its apps, restart, stop, start), and how this Mac is doing.
import { useState } from 'react'
import { gatewayAction, runOp, startUpdate, status, systemStats, updateCheck, updateReceipt, type Status } from '../../../lib/api-system'
import { prettyName, toast } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { useStore } from '../../../lib/store'
import { Badge, confirm, ErrorLine, Spinner, useAsync } from '../../ui'
import { interruptNote } from './gateway'
import { ago, bytes, CopyValue, duration, errText, Fold, Meter, RunLog, useActions, usePoll, Warn, when } from './parts'

const PLATFORM_NAMES: Record<string, string> = { api_server: 'API server', webhook: 'Webhooks', telegram: 'Telegram', whatsapp: 'WhatsApp', bluebubbles: 'iMessage (BlueBubbles)', sms: 'SMS' }
const GATEWAY_STATE: Record<string, string> = { running: 'Running', stopped: 'Stopped', starting: 'Starting', draining: 'Finishing chats before a restart', restarting: 'Restarting', crashed: 'Stopped unexpectedly', stale: 'Not answering' }
const BAD_PRESSURE = new Set(['elevated', 'high', 'critical', 'warning', 'severe', 'low'])

function Health({ s }: { s: Status }) {
  const comp = s.components ?? {}
  const bad = Object.entries(comp).filter(([, c]) => c.status && c.status !== 'ok')
  const ok = (s.overall ?? 'ok') === 'ok' && !bad.length
  return (
    <div className="srow">
      <i className={`dot ${ok ? 'ok' : s.overall === 'error' || s.overall === 'down' ? 'bad' : 'need'}`} />
      <div className="tx">
        <div className="t1"><span>{ok ? 'Everything looks fine' : 'Running, with problems'}</span></div>
        <div className="t2">{ok ? `Hermes ${s.version ?? ''} is running${s.active_agents ? `, ${s.active_agents} ${s.active_agents === 1 ? 'chat' : 'chats'} working right now` : ''}.` : bad.map(([k, c]) => `${k === 'platforms' ? 'Chat apps' : k.charAt(0).toUpperCase() + k.slice(1)}: ${c.status}${k === 'platforms' && c.configured ? ` (${c.connected ?? 0} of ${c.configured} connected)` : ''}`).join(' · ')}</div>
      </div>
    </div>
  )
}

export function OverviewTab() {
  const bots = useStore((s) => s.bots)
  const st = useAsync(() => status(), [])
  const upd = useAsync(() => updateCheck(), [])
  const receipt = useAsync(() => updateReceipt().catch(() => null), [])
  const stats = useAsync(() => systemStats(), [])
  const { runs, start, clear } = useActions()
  const [checking, setChecking] = useState(false)
  usePoll(() => { void st.reload(true); void stats.reload(true) }, runs.gw?.running || runs.update?.running ? 3000 : 6000)

  const s = st.data
  const u = upd.data
  const check = async () => { setChecking(true); try { upd.setData(await updateCheck(true)); toast('Checked for updates') } catch (e) { toast(`Couldn’t check: ${errText(e)}`) } finally { setChecking(false) } }
  const update = async () => {
    if (!(await confirm({ title: 'Update Hermes now?', body: `Hermes downloads the update${u?.behind ? ` (${u.behind} ${u.behind === 1 ? 'change' : 'changes'})` : ''} and restarts. Chats pick up where they were; one in the middle of an answer may be cut off. This app reconnects on its own.`, action: 'Update' }))) return
    void start('update', 'Updating Hermes', () => startUpdate(), {
      tolerateDrop: true, maxMs: 45 * 60_000,
      onDone: (r) => { toast(r.error ? `The update didn’t finish: ${r.error}` : 'Hermes is up to date'); void upd.reload(true); void receipt.reload(true); void st.reload(true) },
    })
  }
  const gateway = async (action: 'restart' | 'stop' | 'start') => {
    let interrupt = false
    if (action !== 'start') {
      const note = await interruptNote(action)
      if (!(await confirm({ title: action === 'restart' ? 'Restart messaging?' : 'Stop messaging?', body: note.text, action: note.busy ? `${action === 'restart' ? 'Restart' : 'Stop'} anyway` : action === 'restart' ? 'Restart' : 'Stop', danger: note.busy || action === 'stop' }))) return
      interrupt = note.busy
    }
    const label = action === 'restart' ? 'Restarting messaging' : action === 'stop' ? 'Stopping messaging' : 'Starting messaging'
    void start('gw', label, () => gatewayAction(action, interrupt), {
      tolerateDrop: true, maxMs: 3 * 60_000,
      onDone: (r) => { toast(r.error ? `${label} didn’t finish: ${r.error}` : action === 'restart' ? 'Messaging is back' : action === 'stop' ? 'Messaging is stopped' : 'Messaging is running'); void st.reload(true) },
    })
  }
  const migrate = () => void start('migrate', 'Updating the settings file', () => runOp('default', 'config-migrate'), { onDone: () => void st.reload(true) })

  if (st.loading && !s) return <div className="empty"><Spinner size={18} /><span>Asking Hermes how it’s doing…</span></div>
  if (st.error && !s) return <ErrorLine text={`Couldn’t reach Hermes: ${st.error}`} onRetry={() => void st.reload()} />
  if (!s) return null
  const platforms = Object.entries(s.gateway_platforms ?? {})
  const shared = (s.gateway_shared_with ?? []).filter(Boolean)
  const running = !!s.gateway_running
  const sum = receipt.data?.summary
  const m = stats.data
  const memTone = (p?: number) => (p && p > 90 ? 'bad' : p && p > 80 ? 'need' : undefined)
  return (
    <>
      <div className="card"><Health s={s} /></div>
      {s.memory?.last_boot_suspected_oom ? <Warn bad><b>Hermes was stopped last time because the Mac ran low on memory.</b> Closing other apps can help.</Warn> : null}
      {(s.config_version ?? 0) < (s.latest_config_version ?? 0) ? (
        <Warn action={<button className="b-soft" onClick={migrate} disabled={runs.migrate?.running}>Update it</button>}>
          <b>Your settings file is from an older Hermes</b> (version {s.config_version}; this Hermes uses {s.latest_config_version}). Updating it adds the new settings and keeps yours.
        </Warn>
      ) : null}
      {runs.migrate ? <div className="card" style={{ marginBottom: 14, paddingTop: 12 }}><RunLog run={runs.migrate} onClose={() => clear('migrate')} /></div> : null}

      <div className="ssec"><h2>Hermes</h2><span>{s.version ? `version ${s.version}` : ''}</span><span className="sp" />
        <button className="b-text" style={{ height: 26 }} onClick={() => void check()} disabled={checking || runs.update?.running}>{checking ? 'Checking…' : 'Check for updates'}</button>
      </div>
      <div className="card">
        <div className="srow">
          <Icon name={u?.update_available ? 'download' : 'check'} size={18} />
          <div className="tx">
            <div className="t1"><span>{upd.loading && !u ? 'Checking for an update…' : upd.error && !u ? 'Couldn’t check for an update' : u?.update_available ? 'An update is ready' : 'Up to date'}</span>{u?.update_available ? <Badge tone="run">{u.behind && u.behind > 0 ? `${u.behind} ${u.behind === 1 ? 'change' : 'changes'}` : 'New'}</Badge> : null}</div>
            <div className="t2">{upd.error && !u ? upd.error : u?.message || (s.release_date ? `Released ${s.release_date}` : '')}</div>
            {sum?.outcome ? <div className="t3" style={{ fontFamily: 'inherit' }}>Last update: {sum.outcome === 'ok' || sum.outcome === 'success' ? 'went fine' : sum.outcome.replace(/_/g, ' ')}{sum.finished_at ? `, ${when(sum.finished_at)}` : ''}{sum.user_action ? `. ${sum.user_action}` : ''}</div> : null}
          </div>
          <div className="act">
            {u?.update_available && u.can_apply ? <button className="b-pri" onClick={() => void update()} disabled={runs.update?.running}>{runs.update?.running ? 'Updating…' : 'Update Hermes'}</button> : null}
          </div>
        </div>
        {u?.update_available && !u.can_apply && u.update_command ? <div style={{ padding: '0 16px 14px' }}><div className="sy-note" style={{ margin: '0 0 8px' }}>This Hermes can’t update itself from here. Run this in Terminal:</div><CopyValue value={u.update_command} what="Copied the command" /></div> : null}
        {u?.commits?.length ? <div style={{ padding: '0 16px 14px' }}><Fold label="What’s new">
          <div className="sy-runs">{u.commits.slice(0, 30).map((c) => <div key={c.sha} className="sy-run" style={{ cursor: 'default' }}><span className="tt">{c.summary}</span><span className="tm">{ago(c.at)}</span></div>)}</div>
        </Fold></div> : null}
        <RunLog run={runs.update} onClose={() => clear('update')} />
      </div>

      <div className="ssec"><h2>Messaging</h2><span>{GATEWAY_STATE[s.gateway_state ?? ''] ?? (running ? 'Running' : 'Stopped')}</span><span className="sp" />
        <div className="act">
          {running ? <><button className="b-text" style={{ height: 26 }} onClick={() => void gateway('stop')} disabled={runs.gw?.running}>Stop</button><button className="b-soft" style={{ height: 28 }} onClick={() => void gateway('restart')} disabled={runs.gw?.running}>Restart</button></>
            : <button className="b-soft" style={{ height: 28 }} onClick={() => void gateway('start')} disabled={runs.gw?.running}>Start</button>}
        </div>
      </div>
      <div className="card">
        <div className="srow">
          <i className={`dot ${running ? 'ok' : 'off'}`} />
          <div className="tx">
            <div className="t1"><span>{running ? 'Messaging is running' : 'Messaging is stopped'}</span>{s.gateway_busy ? <Badge tone="run">Busy</Badge> : null}</div>
            <div className="t2">{running ? `It carries Telegram, webhooks and the other apps${shared.length > 1 ? ` for all ${shared.length} agents (${shared.map((p) => bots.find((b) => b.profile === p)?.name ?? prettyName(p)).join(', ')})` : ''}.` : 'Agents don’t answer on Telegram or the other apps until it starts.'}{s.gateway_exit_reason ? ` Last stop: ${s.gateway_exit_reason}.` : ''}</div>
            {s.gateway_updated_at ? <div className="t3" style={{ fontFamily: 'inherit' }}>Checked in {ago(s.gateway_updated_at)}{s.active_sessions ? ` · ${s.active_sessions} open ${s.active_sessions === 1 ? 'chat' : 'chats'}` : ''}</div> : null}
          </div>
        </div>
        {platforms.map(([id, p]) => (
          <div className="srow" key={id} style={{ minHeight: 46 }}>
            <i className={`dot ${p.state === 'connected' ? 'ok' : p.state === 'fatal' || p.state === 'startup_failed' ? 'bad' : p.needs_attention ? 'need' : 'off'}`} />
            <div className="tx"><div className="t1"><span>{PLATFORM_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1)}</span></div>
              {p.error_message ? <div className="sy-err">{p.error_message}</div> : p.retrying_since ? <div className="t2">Trying again since {ago(p.retrying_since)}</div> : null}</div>
            <span className="st">{(p.state ?? '').replace(/_/g, ' ')}</span>
          </div>
        ))}
        <RunLog run={runs.gw} onClose={() => clear('gw')} />
      </div>

      <div className="ssec"><h2>This Mac</h2><span>{m?.hostname?.replace(/\.local$/, '') ?? ''}</span></div>
      {stats.error && !m ? <ErrorLine text={`Couldn’t read the Mac’s numbers: ${stats.error}`} onRetry={() => void stats.reload()} /> : !m ? <div className="empty"><Spinner size={16} /></div> : (
        <div className="sy-tiles flow">
          <div className="sy-tile"><span className="k">Processor</span><span className="v">{Math.round(m.cpu_percent ?? 0)}%</span><Meter percent={m.cpu_percent ?? 0} tone={memTone(m.cpu_percent)} /><span className="s">{m.cpu_count} cores{m.load_avg ? ` · load ${m.load_avg[0].toFixed(1)}` : ''}</span></div>
          {m.memory ? <div className="sy-tile"><span className="k">Memory</span><span className="v">{Math.round(m.memory.percent)}%</span><Meter percent={m.memory.percent} tone={memTone(m.memory.percent)} /><span className="s">{bytes(m.memory.total - m.memory.available)} of {bytes(m.memory.total)}</span></div> : null}
          {m.disk ? <div className="sy-tile"><span className="k">Disk</span><span className="v">{Math.round(m.disk.percent)}%</span><Meter percent={m.disk.percent} tone={memTone(m.disk.percent)} /><span className="s">{bytes(m.disk.free)} free of {bytes(m.disk.total)}</span></div> : null}
          {m.process ? <div className="sy-tile"><span className="k">Hermes itself</span><span className="v">{bytes(m.process.rss)}</span><span className="s">{m.process.num_threads} threads · running {duration(Date.now() / 1000 - m.process.create_time)}</span></div> : null}
          {m.uptime_seconds ? <div className="sy-tile"><span className="k">Mac awake for</span><span className="v">{duration(m.uptime_seconds)}</span><span className="s">{m.os === 'Darwin' ? 'macOS' : m.os} {m.platform?.match(/macOS-([\d.]+)/)?.[1] ?? m.os_release} · {m.arch}</span></div> : null}
        </div>
      )}
      {s.disk && BAD_PRESSURE.has(s.disk.pressure ?? '') ? <Warn bad><b>The disk is nearly full.</b> Hermes needs space for chats, memory and logs.</Warn> : null}
      {s.memory && BAD_PRESSURE.has(s.memory.pressure ?? '') ? <Warn><b>The Mac is low on memory.</b> Hermes may slow down or be stopped.</Warn> : null}
    </>
  )
}
