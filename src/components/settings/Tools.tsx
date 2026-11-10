// Settings › Tools: the groups of tools a bot can use on its own (search the web, run commands, make
// images…), each on or off and open to set up its provider, keys and model; where commands run; and
// Computer Use's permissions on this Mac. Parity with Hermes Desktop's Tools tab and Hermes Remote's
// ToolsPage, through the same routes.
import { useMemo, useState } from 'react'
import { setToolset, toolsets as loadToolsets, type Toolset } from '../../lib/api'
import { toolCalls } from '../../lib/api-capabilities'
import { toast } from '../../lib/hermes'
import { Badge, Empty, ErrorLine, Search, Tabs, useAsync, Switch } from '../ui'
import { clickable, errText, MoreMenu, norm, plural, Section, SkeletonCard, useBotName, useQueue } from './cap-parts'
import { BLURB, ComputerUsePanel, onlyToolNames, TerminalPanel, ToolsetDialog } from './ToolParts'

type T = Toolset & { platform_label?: string }

/** Browsing groups by what a toolset lets Hermes do (Hermes Desktop's TOOLSET_THEMES). */
const THEMES: { label: string; names: string[] }[] = [
  { label: 'Getting work done', names: ['browser', 'computer_use', 'web', 'terminal', 'file', 'code_execution', 'cronjob', 'kanban', 'delegation', 'todo', 'clarify'] },
  { label: 'Making things', names: ['vision', 'video', 'stt', 'tts', 'image_gen', 'video_gen'] },
  { label: 'Remembering', names: ['memory', 'session_search', 'skills'] },
  { label: 'Connecting', names: ['connections', 'a2a', 'homeassistant', 'x_search', 'messaging', 'spotify'] },
  { label: 'Only inside chat apps', names: ['discord', 'discord_admin', 'yuanbao'] },
]
const themeOf = (name: string) => THEMES.find((t) => t.names.includes(name))?.label ?? 'More tools'
const ORDER = [...THEMES.map((t) => t.label), 'More tools']

export function ToolsPage({ profile }: { profile: string }) {
  const bot = useBotName(profile)
  const ts = useAsync(() => loadToolsets(profile) as Promise<T[]>, [profile])
  const calls = useAsync(() => toolCalls(profile), [profile])
  const [q, setQ] = useState('')
  const [state, setStateF] = useState<'all' | 'on' | 'off'>('all')
  const [open, setOpen] = useState<string | null>(null)
  const queue = useQueue()
  const list = ts.data ?? []
  const used = calls.data ?? {}

  const patch = (name: string, p: Partial<T>) => ts.setData((cur) => cur?.map((t) => (t.name === name ? { ...t, ...p } : t)))
  const flip = (t: T, on: boolean) => {
    patch(t.name, { enabled: on })
    return queue(() => setToolset(profile, t.name, on)).then(() => undefined, (e) => {
      patch(t.name, { enabled: !on }); toast(`Couldn’t turn ${t.label || t.name} ${on ? 'on' : 'off'}: ${errText(e)}`)
    })
  }
  const callsOf = (t: T) => (t.tools ?? []).reduce((n, x) => n + (used[x] ?? 0), 0)

  const groups = useMemo(() => {
    const s = norm(q.trim())
    const shown = list.filter((t) => (state === 'all' || (state === 'on') === t.enabled)
      && (!s || [t.name, t.label, t.description, BLURB[t.name], ...(t.tools ?? [])].some((x) => norm(x).includes(s))))
    const by = new Map<string, T[]>()
    for (const t of shown) { const k = themeOf(t.name); by.set(k, [...(by.get(k) ?? []), t]) }
    return ORDER.filter((k) => by.has(k)).map((k) => ({ label: k, items: by.get(k)!.sort((a, b) => callsOf(b) - callsOf(a) || (a.label || a.name).localeCompare(b.label || b.name)) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, q, state, used])

  const on = list.filter((t) => t.enabled).length
  const shown = groups.reduce((n, g) => n + g.items.length, 0)
  const current = open ? list.find((t) => t.name === open) : undefined
  const needsKey = list.filter((t) => t.enabled && t.configured === false).length

  return (
    <>
      <div className="shead">
        <div className="tx"><h1>Tools</h1><p>What {bot} can do by itself: search the web, run commands, work with files, make images. Turn a group off and it won’t use it; open one to choose how it works.</p></div>
        <div className="cap-acts"><MoreMenu items={[{ label: 'Reload', icon: 'refresh', onClick: () => { void ts.reload(); void calls.reload(true) } }]} /></div>
      </div>

      <div className="stools">
        <Search value={q} onChange={setQ} placeholder="Find a tool, like web_search or image" />
        <Tabs value={state} onChange={setStateF} items={[{ key: 'all', label: 'All', count: list.length }, { key: 'on', label: 'On', count: on }, { key: 'off', label: 'Off', count: list.length - on }]} />
      </div>

      {ts.loading && !ts.data ? <SkeletonCard rows={8} />
        : ts.error && !ts.data ? <ErrorLine text={`Couldn’t load ${bot}’s tools: ${ts.error}`} onRetry={() => void ts.reload()} />
        : !list.length ? <Empty title="No tools" body="Hermes didn’t report any tool groups for this agent." />
        : (
          <>
            {ts.error ? <ErrorLine text={`Couldn’t refresh: ${ts.error}`} onRetry={() => void ts.reload()} /> : null}
            <div className="cap-sum">{q || state !== 'all' ? `${shown} of ${list.length} groups` : plural(list.length, 'group')} · {on} on{needsKey ? ` · ${needsKey} need${needsKey === 1 ? 's' : ''} a key` : ''}</div>
            {!shown ? (
              <>
                <Empty title="No tools match" body="Try another word, or show all." face={false} />
                <div style={{ textAlign: 'center' }}><button className="b-text" onClick={() => { setQ(''); setStateF('all') }}>Clear filters</button></div>
              </>
            ) : groups.map((g) => (
              <Section key={g.label} title={g.label} sub={g.items.length}>
                <div className="card flow">
                  {g.items.map((t) => {
                    const n = callsOf(t)
                    const desc = BLURB[t.name] ?? (onlyToolNames(t.description, t.tools) ? '' : t.description ?? '')
                    return (
                      <div key={t.name} className={`srow click${t.enabled ? '' : ' off'}`} {...clickable(() => setOpen(t.name))} aria-label={`Open ${t.label || t.name}`}>
                        <div className="tx">
                          <div className="t1"><span>{t.label || t.name}</span>
                            {t.enabled && t.configured === false ? <Badge tone="need">Needs a key</Badge> : null}
                            {t.available === false ? <Badge tone="quiet">Not available yet</Badge> : null}
                          </div>
                          {desc ? <div className="t2">{desc}</div> : null}
                          {t.tools?.length ? <div className="t3">{t.tools.join(', ')}</div> : <div className="t3">No tools of its own</div>}
                        </div>
                        <div className="act">
                          {n ? <span className="cap-use" title={`Used ${plural(n, 'time')} this year`}>{n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n}×</span> : null}
                          <Switch on={t.enabled} onChange={(v) => void flip(t, v)} label={`${t.label || t.name} on`} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Section>
            ))}
          </>
        )}

      {!q && state === 'all' ? (
        <>
          <Section title="Where commands run" sub="For the terminal, files and code">
            <TerminalPanel profile={profile} bot={bot} />
          </Section>
          <Section title="Computer Use on this Mac" sub="Clicking and typing in your apps">
            <ComputerUsePanel onInstall={list.some((t) => t.name === 'computer_use') ? () => setOpen('computer_use') : undefined} />
          </Section>
        </>
      ) : null}

      {current ? (
        <ToolsetDialog key={current.name} profile={profile} toolset={current} bot={bot} calls={used} onClose={() => setOpen(null)}
          onToggle={(v) => void flip(current, v)} onChanged={() => void ts.reload(true)} />
      ) : null}
    </>
  )
}
