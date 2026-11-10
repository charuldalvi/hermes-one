// System › About: which Hermes this is (version, build, how it was installed), what it runs on,
// and where its files live, with a way to show each folder in Finder.
import pkg from '../../../../package.json'
import { profiles } from '../../../lib/api'
import { health, status, systemStats, updateCheck } from '../../../lib/api-system'
import { prettyName } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { useStore } from '../../../lib/store'
import { BotFace } from '../../BotFace'
import { ErrorLine, Spinner, useAsync } from '../../ui'
import { copy, open, reveal } from './parts'

export function AboutTab() {
  const bots = useStore((s) => s.bots)
  const st = useAsync(() => status(), [])
  const h = useAsync(() => health().catch(() => null), [])
  const sys = useAsync(() => systemStats().catch(() => null), [])
  const up = useAsync(() => updateCheck().catch(() => null), [])
  const ps = useAsync(() => profiles().catch(() => []), [])
  const ep = useAsync(() => window.hermesNative.endpoint().catch(() => null), [])
  if (st.loading && !st.data) return <div className="empty"><Spinner size={18} /></div>
  if (st.error && !st.data) return <ErrorLine text={`Couldn’t reach Hermes: ${st.error}`} onRetry={() => void st.reload()} />
  const s = st.data!
  const m = sys.data
  const home = ep.data?.profile_id
  return (
    <>
      <div className="ssec"><h2>Hermes</h2></div>
      <div className="card"><dl className="sy-kv">
        <dt>Version</dt><dd>{h.data?.displayVersion || s.version}{s.release_date ? <span className="sy-dim"> · released {s.release_date}</span> : null}</dd>
        {h.data?.commit ? <><dt>Build</dt><dd className="sy-mono">{h.data.commit.slice(0, 12)}</dd></> : null}
        {up.data?.install_method ? <><dt>Installed with</dt><dd>{up.data.install_method === 'git' ? 'A copy of the source (updates in place)' : up.data.install_method}{up.data.channel ? ` · ${up.data.channel} channel` : ''}</dd></> : null}
        <dt>Settings file</dt><dd>version {s.config_version ?? '?'}{(s.config_version ?? 0) < (s.latest_config_version ?? 0) ? <span className="sy-dim"> (this Hermes uses {s.latest_config_version})</span> : null}</dd>
        <dt>Messaging</dt><dd>{s.gateway_mode === 'multiplex' ? `One gateway for every agent (${(s.gateway_shared_with ?? []).length})` : s.gateway_mode ?? '—'}</dd>
        <dt>This app</dt><dd>Hermes One {pkg.version}</dd>
        <dt>Nous account</dt><dd>{s.nous_session_valid === 'valid' ? 'Signed in' : s.nous_session_valid ? s.nous_session_valid.replace(/_/g, ' ') : 'Not signed in'}</dd>
      </dl></div>

      {m ? (
        <>
          <div className="ssec"><h2>This Mac</h2></div>
          <div className="card"><dl className="sy-kv">
            <dt>Name</dt><dd>{m.hostname}</dd>
            <dt>System</dt><dd>{m.os === 'Darwin' ? `macOS ${m.platform?.match(/macOS-([\d.]+)/)?.[1] ?? ''}` : `${m.os} ${m.os_release}`} · {m.arch}</dd>
            <dt>Processor</dt><dd>{m.cpu_count} cores</dd>
            <dt>Python</dt><dd>{m.python_version}{m.python_impl && m.python_impl !== 'CPython' ? ` (${m.python_impl})` : ''}</dd>
          </dl></div>
        </>
      ) : null}

      <div className="ssec"><h2>Where things live</h2></div>
      <div className="card">
        {home ? (
          <div className="srow">
            <Icon name="folder" size={17} />
            <div className="tx"><div className="t1"><span>Hermes’ home</span></div><div className="t3">{home}</div></div>
            <button className="b-text" onClick={() => reveal(home)}>Show in Finder</button>
          </div>
        ) : null}
        {(ps.data ?? []).map((p) => {
          const b = bots.find((x) => x.profile === p.name)
          return (
            <div className="srow" key={p.name}>
              <BotFace profile={p.name} size={22} poseKey={b?.poseKey} watch={false} />
              <div className="tx"><div className="t1"><span>{p.is_default ? 'Hermes' : b?.name ?? prettyName(p.name, p.display_name)}</span></div><div className="t3">{p.path}</div></div>
              <button className="hbtn" title="Copy the path" onClick={() => void copy(p.path, 'Copied the path')}><Icon name="copy" size={14} /></button>
              <button className="b-text" onClick={() => reveal(p.path)}>Show</button>
            </div>
          )
        })}
      </div>
      <div className="stools" style={{ marginTop: 16 }}>
        <button className="b-text" onClick={() => open('https://hermes-agent.nousresearch.com/docs')}><Icon name="external" size={14} /> Hermes docs</button>
      </div>
    </>
  )
}
