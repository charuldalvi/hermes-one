// Settings › Skills: every skill a bot has, grouped by what it's for. Find one, turn it on or off,
// open it to read or edit its SKILL.md, lock it, archive or uninstall it, write a new one, and check
// installed skills for updates. Parity with Hermes Desktop's Skills tab and Hermes Remote's SkillsPage.
import { useMemo, useState } from 'react'
import { setSkill, skills as loadSkills } from '../../lib/api'
import { followAction, hubUpdate, tail, type Provenance } from '../../lib/api-capabilities'
import { toast } from '../../lib/hermes'
import { Icon } from '../../lib/icons'
import { setState } from '../../lib/store'
import { Badge, confirm, Empty, ErrorLine, Search, Select, Switch, Tabs, useAsync } from '../ui'
import { clickable, errText, JobLine, MoreMenu, norm, plural, pretty, Section, SkeletonCard, useBotName, useQueue } from './cap-parts'
import { NewSkillDialog, ORIGIN, originOf, SkillDialog, type SkillRow } from './SkillDialogs'

type State = 'all' | 'on' | 'off'
type Sort = 'used' | 'az'
type Job = { text: string; lines: string[]; done?: boolean; ok?: boolean }

const catOf = (s: SkillRow) => (s.category ? String(s.category) : 'general')

export function SkillsPage({ profile }: { profile: string }) {
  const bot = useBotName(profile)
  const { data, error, loading, reload, setData } = useAsync(() => loadSkills(profile) as Promise<SkillRow[]>, [profile])
  const [q, setQ] = useState('')
  const [state, setStateF] = useState<State>('all')
  const [origin, setOrigin] = useState<'all' | Provenance>('all')
  const [sort, setSort] = useState<Sort>('used')
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [job, setJob] = useState<Job>()
  const [bulkBusy, setBulkBusy] = useState(false)
  const queue = useQueue()

  const list = data ?? []
  const patch = (name: string, p: Partial<SkillRow>) => setData((cur) => cur?.map((s) => (s.name === name ? { ...s, ...p } : s)))

  /** On or off right away; put back with a note when Hermes says no. Writes go one at a time. */
  const flip = (name: string, on: boolean) => {
    patch(name, { enabled: on })
    return queue(() => setSkill(profile, name, on)).then(() => true, (e) => {
      patch(name, { enabled: !on })
      toast(`Couldn’t turn ${name} ${on ? 'on' : 'off'}: ${errText(e)}`)
      return false
    })
  }

  const bulk = async (targets: SkillRow[], on: boolean, ask?: { title: string; body: string; action: string }) => {
    if (!targets.length || bulkBusy) return
    if (ask && !(await confirm({ ...ask }))) return
    setBulkBusy(true)
    let done = 0
    for (const s of targets) { if (await flip(s.name, on)) done++; else break }
    setBulkBusy(false)
    if (done) toast(`Turned ${on ? 'on' : 'off'} ${plural(done, 'skill')}`)
  }

  const checkUpdates = async () => {
    if (job && !job.done) return
    setJob({ text: 'Checking installed skills for updates…', lines: [] })
    try {
      const r = await followAction(profile, await hubUpdate(profile), (lines) => setJob((j) => j && { ...j, lines }))
      const ok = r.exit_code === 0
      setJob({ text: ok ? 'Installed skills are up to date.' : `Checking for updates didn’t finish: ${tail(r, 1) || 'Hermes stopped early.'}`, lines: r.lines, done: true, ok })
      if (ok) void reload(true)
    } catch (e) { setJob({ text: `Couldn’t check for updates: ${errText(e)}`, lines: [], done: true, ok: false }) }
  }

  const counts = useMemo(() => {
    const by: Record<string, number> = { all: list.length, on: 0, off: 0, agent: 0, hub: 0, bundled: 0, external: 0 }
    for (const s of list) { by[s.enabled ? 'on' : 'off']++; by[originOf(s)]++ }
    return by
  }, [list])

  const groups = useMemo(() => {
    const t = norm(q.trim())
    const shown = list.filter((s) =>
      (state === 'all' || (state === 'on') === s.enabled)
      && (origin === 'all' || originOf(s) === origin)
      && (!t || norm(s.name).includes(t) || norm(s.description).includes(t) || norm(s.category).includes(t)))
    const cmp = sort === 'used'
      ? (a: SkillRow, b: SkillRow) => (b.usage ?? 0) - (a.usage ?? 0) || a.name.localeCompare(b.name)
      : (a: SkillRow, b: SkillRow) => a.name.localeCompare(b.name)
    const by = new Map<string, SkillRow[]>()
    for (const s of shown) { const c = catOf(s); by.set(c, [...(by.get(c) ?? []), s]) }
    const out = [...by.entries()].map(([cat, items]) => ({ cat, items: items.sort(cmp), used: items.reduce((n, s) => n + (s.usage ?? 0), 0) }))
    return out.sort((a, b) => (sort === 'used' ? b.used - a.used : 0) || (a.cat === 'general' ? 1 : b.cat === 'general' ? -1 : a.cat.localeCompare(b.cat)))
  }, [list, q, state, origin, sort])

  const shownCount = groups.reduce((n, g) => n + g.items.length, 0)
  const unused = list.filter((s) => s.enabled && !(s.usage ?? 0))
  const categories = useMemo(() => [...new Set(list.map((s) => s.category).filter(Boolean) as string[])].sort(), [list])
  const current = open ? list.find((s) => s.name === open) : undefined
  const filtered = !!q.trim() || state !== 'all' || origin !== 'all'

  return (
    <>
      <div className="shead">
        <div className="tx"><h1>Skills</h1><p>Written guides {bot} follows when a job calls for one. Turn off what it shouldn’t use, or open a skill to read and change it.</p></div>
        <div className="cap-acts">
          <button className="b-soft" onClick={() => setState({ view: 'marketplace', marketTab: 'skills' })}>Find more</button>
          <button className="b-pri" onClick={() => setCreating(true)}><span className="cap-row"><Icon name="plus" size={14} />New skill</span></button>
          <MoreMenu items={[
            { label: 'Check for updates', icon: 'refresh', hint: 'Installed skills', onClick: () => void checkUpdates(), disabled: !!job && !job.done },
            { label: 'Turn off unused skills', icon: 'power', hint: unused.length ? String(unused.length) : undefined, disabled: !unused.length || bulkBusy,
              onClick: () => void bulk(unused, false, { title: `Turn off ${plural(unused.length, 'unused skill')}?`, body: `These are on but ${bot} hasn’t used them yet. You can turn any of them back on later.`, action: 'Turn off' }) },
            { label: 'Turn all on', icon: 'check', disabled: !counts.off || bulkBusy, onClick: () => void bulk(list.filter((s) => !s.enabled), true) },
            { label: 'Turn all off', icon: 'x', disabled: !counts.on || bulkBusy,
              onClick: () => void bulk(list.filter((s) => s.enabled), false, { title: `Turn off all ${plural(counts.on, 'skill')}?`, body: `${bot} won’t follow any skill until you turn some back on.`, action: 'Turn all off' }) },
            { label: 'Reload', icon: 'refresh', onClick: () => void reload() },
          ]} />
        </div>
      </div>

      {job ? <JobLine {...job} onClose={() => setJob(undefined)} /> : null}
      {error && data ? <ErrorLine text={`Couldn’t refresh: ${error}`} onRetry={() => void reload()} /> : null}

      <div className="stools">
        <Search value={q} onChange={setQ} placeholder={`Find a skill${list.length ? ` among ${list.length}` : ''}`} />
        <Tabs value={state} onChange={setStateF} items={[{ key: 'all', label: 'All', count: counts.all }, { key: 'on', label: 'On', count: counts.on }, { key: 'off', label: 'Off', count: counts.off }]} />
        <Select value={origin} onChange={(v) => setOrigin(v as any)} width={280} align="end" options={[
          { value: 'all', label: 'Any origin', hint: String(counts.all) },
          ...(Object.keys(ORIGIN) as Provenance[]).map((p) => ({ value: p, label: ORIGIN[p].label, hint: `${counts[p]} · ${ORIGIN[p].long}` })),
        ]} />
        <Select value={sort} onChange={(v) => setSort(v as Sort)} width={200} align="end" options={[{ value: 'used', label: 'Most used' }, { value: 'az', label: 'A to Z' }]} />
      </div>

      {loading && !data ? <SkeletonCard rows={8} />
        : error && !data ? <ErrorLine text={`Couldn’t load ${bot}’s skills: ${error}`} onRetry={() => void reload()} />
        : !list.length ? (
          <Empty title="No skills yet" body={`Write one for ${bot}, or find ready-made skills in the Marketplace.`} />
        ) : !shownCount ? (
          <>
            <Empty title={state === 'off' && !q && origin === 'all' ? 'Every skill is on' : 'No skills match'} body={filtered ? 'Try another word, or clear the filters.' : undefined} face={false} />
            {filtered ? <div style={{ textAlign: 'center' }}><button className="b-text" onClick={() => { setQ(''); setStateF('all'); setOrigin('all') }}>Clear filters</button></div> : null}
          </>
        ) : (
          <>
            <div className="cap-sum">{filtered ? `${shownCount} of ${list.length} skills` : plural(list.length, 'skill')} · {counts.on} on · {list.filter((s) => s.usage).length} used{list.some((s) => s.locked) ? ` · ${list.filter((s) => s.locked).length} locked` : ''}</div>
            {groups.map((g) => (
              <Section key={g.cat} title={pretty(g.cat)} sub={g.items.length}>
                <div className="card flow">
                  {g.items.map((s) => {
                    const o = originOf(s)
                    return (
                      <div key={s.name} className={`srow click${s.enabled ? '' : ' off'}`} {...clickable(() => setOpen(s.name))} aria-label={`Open ${s.name}`}>
                        <div className="tx">
                          <div className="t1"><span>{s.name}</span>
                            {s.locked ? <span className="cap-lock" title="Locked: Hermes can’t change it on its own"><Icon name="lock" size={13} /></span> : null}
                            {o === 'agent' || o === 'hub' ? <Badge tone="quiet">{ORIGIN[o].label}</Badge> : null}
                          </div>
                          {s.description ? <div className="t2">{s.description}</div> : null}
                        </div>
                        <div className="act">
                          {s.usage ? <span className="cap-use" title={`Used ${plural(s.usage, 'time')}`}>{s.usage.toLocaleString()}×</span> : null}
                          <Switch on={s.enabled} onChange={(v) => void flip(s.name, v)} label={`${s.name} on`} disabled={bulkBusy} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Section>
            ))}
          </>
        )}

      {current ? (
        <SkillDialog key={current.name} profile={profile} skill={current} bot={bot} onClose={() => setOpen(null)}
          onToggle={(v) => void flip(current.name, v)} onPatch={(p) => patch(current.name, p)} onSaved={() => void reload(true)}
          onRemoved={() => { setData((cur) => cur?.filter((s) => s.name !== current.name)); setOpen(null); void reload(true) }} />
      ) : null}
      {creating ? (
        <NewSkillDialog profile={profile} bot={bot} categories={categories} onClose={() => setCreating(false)}
          onCreated={async (name) => { setCreating(false); await reload(true); setOpen(name) }} />
      ) : null}
    </>
  )
}
