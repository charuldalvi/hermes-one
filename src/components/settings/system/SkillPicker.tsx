// Pick skills a job or webhook should load first: the chosen ones as chips, the bot's skills in a
// searchable popover. Names Hermes doesn't list (typed by hand earlier) stay as they are.
import { useMemo, useRef, useState } from 'react'
import { skills as loadSkills } from '../../../lib/api'
import { Icon } from '../../../lib/icons'
import { Popover, Search, Spinner, useAsync } from '../../ui'

export function SkillPicker({ profile, value, onChange }: { profile: string; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const btn = useRef<HTMLButtonElement>(null)
  const { data, loading, error } = useAsync(() => (open ? loadSkills(profile) : Promise.resolve(undefined)), [profile, open])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    const all = (data ?? []).filter((s) => s.enabled !== false)
    return (t ? all.filter((s) => `${s.name} ${s.description ?? ''} ${s.category ?? ''}`.toLowerCase().includes(t)) : all).slice(0, 80)
  }, [data, q])
  const toggle = (name: string) => onChange(value.includes(name) ? value.filter((x) => x !== name) : [...value, name])
  return (
    <div className="sy-chips">
      {value.map((s) => (
        <button key={s} className="sy-chip on mono" onClick={() => toggle(s)} title="Remove"><span>{s}</span><Icon name="x" size={12} /></button>
      ))}
      <button ref={btn} className="sy-chip" onClick={() => { setOpen(!open); setQ('') }}><Icon name="plus" size={13} /><span>{value.length ? 'Add another' : 'Add a skill'}</span></button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} width={340}>
        <div className="pop-search"><Search value={q} onChange={setQ} placeholder="Search this agent’s skills" autoFocus /></div>
        <div className="pop-list">
          {loading && !data ? <div className="mh" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Spinner size={12} />Loading skills…</div> : null}
          {error ? <div className="mh">Couldn’t load skills: {error}</div> : null}
          {shown.map((s) => (
            <button key={s.name} className={`mi${value.includes(s.name) ? ' on' : ''}`} onClick={() => toggle(s.name)}>
              <span className="ml">{s.name}</span>
              {s.category ? <span className="mhint">{s.category}</span> : null}
              {value.includes(s.name) ? <Icon name="check" size={14} /> : null}
            </button>
          ))}
          {data && !shown.length ? <div className="mh">{q ? 'Nothing matches.' : 'This agent has no skills turned on.'}</div> : null}
        </div>
      </Popover>
    </div>
  )
}
