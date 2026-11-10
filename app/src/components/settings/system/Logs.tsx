// System › Logs: what Hermes wrote down, newest at the bottom. Pick a log, show only warnings or
// errors, narrow to one part of Hermes, search, follow it live, copy what you see.
import { useEffect, useRef, useState } from 'react'
import { logs } from '../../../lib/api-system'
import { Icon } from '../../../lib/icons'
import { ErrorLine, Search, Select, Spinner, Switch, useAsync } from '../../ui'
import { copy, LogLines, usePoll } from './parts'

const FILES = [
  { value: 'agent', label: 'Everything', hint: 'agent.log' }, { value: 'errors', label: 'Errors only', hint: 'errors.log' }, { value: 'gateway', label: 'Messaging', hint: 'gateway.log' },
  { value: 'mcp', label: 'Connector servers', hint: 'mcp-stderr.log' }, { value: 'gui', label: 'Web server', hint: 'gui.log' }, { value: 'update', label: 'Updates', hint: 'update.log' },
  { value: 'desktop', label: 'Hermes Desktop', hint: 'desktop.log' },
]
const LEVELS = [{ value: '', label: 'All lines' }, { value: 'INFO', label: 'Info and up' }, { value: 'WARNING', label: 'Warnings and errors' }, { value: 'ERROR', label: 'Errors' }]
const PARTS = [{ value: '', label: 'Every part' }, { value: 'agent', label: 'The agents' }, { value: 'tools', label: 'Tools' }, { value: 'gateway', label: 'Messaging' }, { value: 'cron', label: 'Scheduled jobs' }, { value: 'cli', label: 'Commands' }, { value: 'gui', label: 'Web server' }]
const COUNTS = [{ value: '100', label: '100 lines' }, { value: '200', label: '200 lines' }, { value: '500', label: '500 lines' }]

export function LogsTab({ profile }: { profile: string }) {
  const [file, setFile] = useState('agent')
  const [level, setLevel] = useState('')
  const [part, setPart] = useState('')
  const [lines, setLines] = useState('200')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [live, setLive] = useState(false)
  useEffect(() => { const t = window.setTimeout(() => setQ(search.trim()), 350); return () => window.clearTimeout(t) }, [search])
  const { data, error, loading, reload } = useAsync(() => logs({ file, lines: Number(lines), level: level || undefined, component: part || undefined, search: q || undefined, profile }), [file, lines, level, part, q, profile])
  usePoll(() => void reload(true), 3000, live)
  const box = useRef<HTMLPreElement>(null)
  const stick = useRef(true)
  useEffect(() => { const b = box.current; if (b && stick.current) b.scrollTop = b.scrollHeight }, [data])
  const shown = data ?? []
  return (
    <>
      <div className="stools">
        <Search value={search} onChange={setSearch} placeholder="Find in the log" />
        <Select value={file} options={FILES} onChange={setFile} width={260} />
        <Select value={level} options={LEVELS} onChange={setLevel} width={240} />
      </div>
      <div className="stools" style={{ marginTop: -6 }}>
        {file === 'agent' || file === 'errors' ? <Select value={part} options={PARTS} onChange={setPart} width={220} /> : null}
        <Select value={lines} options={COUNTS} onChange={setLines} width={160} />
        <label className="sy-inline" style={{ cursor: 'pointer' }}><Switch on={live} onChange={setLive} label="Follow live" />Follow live</label>
        <div className="sy-tools-r">
          {loading && data ? <Spinner size={13} /> : null}
          <button className="hbtn" onClick={() => void reload()} aria-label="Refresh" title="Refresh"><Icon name="refresh" size={15} /></button>
          <button className="b-text" onClick={() => void copy(shown.join('\n'), `Copied ${shown.length} lines`)} disabled={!shown.length}><Icon name="copy" size={14} /> Copy</button>
        </div>
      </div>
      {error && !data ? <ErrorLine text={`Couldn’t read the log: ${error}`} onRetry={() => void reload()} /> : null}
      {loading && !data ? <div className="empty"><Spinner size={18} /><span>Reading the log…</span></div>
        : data && !shown.length ? <div className="empty"><b>{q || level || part ? 'Nothing matches' : 'Nothing in this log yet'}</b>{q || level || part ? <span>Try a wider filter.</span> : null}</div>
        : data ? <pre className="sy-log tall" ref={box} onScroll={(e) => { const b = e.currentTarget; stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 40 }}><LogLines lines={shown} search={q} /></pre> : null}
      <p className="sy-note">Logs stay on this Mac. To send them to someone helping you, use “Share with Hermes support” in Maintenance.</p>
    </>
  )
}
