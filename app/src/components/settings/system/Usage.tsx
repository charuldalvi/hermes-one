// System › Usage: how much a bot used over the last week, month or quarter: words read and written
// (tokens), what it cost, day by day, per model, the side jobs Hermes runs, and the tools and
// skills used most.
import { useMemo, useState } from 'react'
import { modelUsage, usage } from '../../../lib/api-system'
import { prettyModel } from '../../../lib/api'
import { ErrorLine, Spinner, Tabs, useAsync } from '../../ui'
import { compact, money, when } from './parts'

const TASKS: Record<string, string> = {
  background_review: 'Looking back over chats', approval: 'Checking commands before they run', vision: 'Looking at pictures', title_generation: 'Naming chats',
  compression: 'Tidying long chats', compaction: 'Tidying long chats', memory: 'Updating memory', curator: 'Tidying skills', web_extract: 'Reading web pages', session_search: 'Searching past chats',
}
const nice = (s: string) => TASKS[s] ?? (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ')

function Bars({ daily }: { daily: any[] }) {
  const max = Math.max(1, ...daily.map((d) => (d.input_tokens ?? 0) + (d.output_tokens ?? 0)))
  const step = Math.ceil(daily.length / 10)
  return (
    <>
      <div className="sy-chart">
        {daily.map((d) => {
          const inp = d.input_tokens ?? 0, out = d.output_tokens ?? 0
          return (
            <div className="col" key={d.day}>
              <div className="sy-tip"><b>{new Date(`${d.day}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</b><br />{compact(inp)} read · {compact(out)} written<br />{d.sessions ?? 0} {d.sessions === 1 ? 'chat' : 'chats'} · {money(d.actual_cost || d.estimated_cost)}</div>
              <div className="bar out" style={{ height: `${(out / max) * 100}%` }} />
              <div className="bar" style={{ height: `${(inp / max) * 100}%`, borderRadius: out ? '1px' : undefined }} />
            </div>
          )
        })}
      </div>
      <div className="sy-axis">{daily.map((d, i) => <span key={d.day}>{i % step === 0 ? new Date(`${d.day}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}</span>)}</div>
      <div className="sy-legend"><span><i style={{ background: 'var(--gray-600)' }} />Read</span><span><i style={{ background: 'var(--text-secondary)' }} />Written</span></div>
    </>
  )
}

function Ranked({ items }: { items: { label: string; value: number; hint?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="card flow">
      {items.map((i) => (
        <div className="srow" key={i.label} style={{ minHeight: 48 }}>
          <div className="tx"><div className="t1"><span>{i.label}</span></div><div className="sy-hbar"><i style={{ width: `${(i.value / max) * 100}%` }} /></div></div>
          <span className="st">{i.hint ?? compact(i.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function UsageTab({ profile }: { profile: string }) {
  const [days, setDays] = useState<'7' | '30' | '90'>('7')
  const u = useAsync(() => usage(profile, Number(days)), [profile, days])
  const m = useAsync(() => modelUsage(profile, Number(days)).catch(() => null), [profile, days])
  const d = u.data
  const daily = useMemo(() => {
    // Fill the days Hermes skipped (nothing happened) so the bars line up with the calendar.
    const by = new Map<string, any>((d?.daily ?? []).map((x: any) => [x.day, x]))
    const out: any[] = []
    const n = Number(days)
    for (let i = n - 1; i >= 0; i--) {
      const t = new Date(); t.setDate(t.getDate() - i)
      const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
      out.push(by.get(key) ?? { day: key, input_tokens: 0, output_tokens: 0, sessions: 0 })
    }
    return out
  }, [d, days])
  const t = d?.totals ?? {}
  const cost = t.total_actual_cost || t.total_estimated_cost || 0
  return (
    <>
      <div className="stools"><Tabs<'7' | '30' | '90'> value={days} onChange={setDays} items={[{ key: '7', label: 'Last 7 days' }, { key: '30', label: '30 days' }, { key: '90', label: '90 days' }]} />{u.loading && d ? <Spinner size={13} /> : null}</div>
      {u.loading && !d ? <div className="empty"><Spinner size={18} /><span>Adding it all up…</span></div>
        : u.error && !d ? <ErrorLine text={`Couldn’t load usage: ${u.error}`} onRetry={() => void u.reload()} />
        : !d ? null : (
          <>
            <div className="sy-tiles flow">
              <div className="sy-tile"><span className="k">Read</span><span className="v">{compact(t.total_input)}</span><span className="s">tokens{t.total_cache_read ? ` · ${compact(t.total_cache_read)} from memory` : ''}</span></div>
              <div className="sy-tile"><span className="k">Written</span><span className="v">{compact(t.total_output)}</span><span className="s">tokens{t.total_reasoning ? ` · ${compact(t.total_reasoning)} thinking` : ''}</span></div>
              <div className="sy-tile"><span className="k">Cost</span><span className="v">{money(cost)}</span><span className="s">{t.total_actual_cost ? 'as the providers reported' : 'Hermes’ estimate'}</span></div>
              <div className="sy-tile"><span className="k">Chats and runs</span><span className="v">{compact(t.total_sessions)}</span><span className="s">{compact(t.total_api_calls)} calls to models</span></div>
            </div>
            <div className="ssec"><h2>Day by day</h2></div>
            <div className="card">{daily.some((x) => x.input_tokens || x.output_tokens) ? <Bars daily={daily} /> : <div className="srow"><div className="tx"><div className="t2">Nothing used in this time.</div></div></div>}</div>

            {m.data?.models?.length ? (
              <>
                <div className="ssec"><h2>By model</h2><span>{m.data.models.length}</span></div>
                <div className="card flow">
                  {m.data.models.map((x: any) => (
                    <div className="srow" key={`${x.provider}/${x.model}`}>
                      <div className="tx">
                        <div className="t1"><span>{prettyModel(x.model)}</span></div>
                        <div className="t2">{compact(x.input_tokens)} read · {compact(x.output_tokens)} written · {compact(x.api_calls)} calls{x.tool_calls ? ` · ${compact(x.tool_calls)} tool uses` : ''}</div>
                        <div className="t3">{x.provider ? `${x.provider} · ` : ''}{x.model}{x.last_used_at ? ` · last used ${when(x.last_used_at)}` : ''}</div>
                      </div>
                      <span className="st">{money(x.actual_cost || x.estimated_cost)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {d.by_task?.length ? (
              <>
                <div className="ssec"><h2>Side jobs</h2><span>work Hermes does around your chats</span></div>
                <Ranked items={d.by_task.map((x: any) => ({ label: nice(x.task), value: (x.input_tokens ?? 0) + (x.output_tokens ?? 0), hint: `${compact((x.input_tokens ?? 0) + (x.output_tokens ?? 0))} tokens · ${x.api_calls ?? 0} calls` }))} />
              </>
            ) : null}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0 16px' }}>
              {d.tools?.length ? <div><div className="ssec" style={{ marginTop: 30 }}><h2>Tools used most</h2></div><Ranked items={d.tools.slice(0, 10).map((x: any) => ({ label: x.tool.replace(/_/g, ' '), value: x.count, hint: `${x.count}×` }))} /></div> : null}
              {d.skills?.top_skills?.length ? <div><div className="ssec" style={{ marginTop: 30 }}><h2>Skills used most</h2><span>{d.skills.summary?.distinct_skills_used ?? ''} in all</span></div><Ranked items={d.skills.top_skills.slice(0, 10).map((x: any) => ({ label: x.skill, value: x.total_count, hint: `${x.total_count}×` }))} /></div> : null}
            </div>
            <p className="sy-note">Costs are Hermes’ estimate from each provider’s prices unless the provider reported them.</p>
          </>
        )}
    </>
  )
}
