// Settings › Memory: what a bot remembers between chats and where. The memory provider (switch it,
// set one up), the built-in notes (on or off, how full, forget them), and everything Hermes has
// learned (memories and the skills it wrote) to search, read, edit and forget. Parity with Hermes
// Desktop's memory layers and star map, and Hermes Remote's MemoryPage. The curator lives on System.
import { useMemo, useState } from 'react'
import { memory as loadMemory, setMemoryProvider } from '../../lib/api'
import { configRecord, forgetMemory, learningGraph, patchConfig, type LearnGraph, type MemoryInfo, type MemoryProviderRow } from '../../lib/api-capabilities'
import { toast } from '../../lib/hermes'
import { Icon } from '../../lib/icons'
import { Badge, confirm, Empty, ErrorLine, Search, Spinner, Switch, Tabs, useAsync } from '../ui'
import { clickable, errText, MEMORY_STATUS, memoryName, MoreMenu, norm, plural, Section, SkeletonCard, timeAgoSec, useBotName } from './cap-parts'
import { NodeDialog, ProviderSetupDialog, SOURCE } from './MemoryDialogs'

type Kind = 'all' | 'profile' | 'memory' | 'skill'
interface Item { key: string; id?: string; kind: 'memory' | 'skill'; source?: string; text: string; sub?: string; ts?: number | null; uses?: number }

/** Links the graph draws: edges between two different points it has (Hermes Remote's linkCount). */
const linkCount = (g: LearnGraph) => { const ids = new Set(g.nodes.map((n) => n.id)); return g.edges.filter((e) => e.source !== e.target && ids.has(e.source) && ids.has(e.target)).length }

export function MemoryPage({ profile }: { profile: string }) {
  const bot = useBotName(profile)
  const mem = useAsync(() => loadMemory(profile) as Promise<MemoryInfo>, [profile])
  const graph = useAsync(() => learningGraph(profile), [profile])
  const cfg = useAsync(() => configRecord(profile).catch(() => null), [profile])
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [setupFor, setSetupFor] = useState<MemoryProviderRow | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)

  const m = mem.data
  const active = m?.active ?? ''
  const providers = m?.providers ?? []

  const choose = async (p: MemoryProviderRow | null) => {
    const name = p?.name ?? ''
    if (name === active || switching !== null) return
    if (p && p.status !== 'ready') { setSetupFor(p); return }
    const label = memoryName(name, p?.description)
    if (!(await confirm({ title: `Use ${label} for memory?`, body: `${bot}’s new chats remember things through it. Built-in notes stay either way, and nothing already saved is lost.`, action: `Use ${label}` }))) return
    setSwitching(name)
    try { await setMemoryProvider(profile, name); toast(`Memory now uses ${label}`); await mem.reload(true) } catch (e) { toast(`Couldn’t switch memory: ${errText(e)}`) } finally { setSwitching(null) }
  }

  const memCfg = cfg.data?.memory ?? {}
  const setBuiltin = async (key: 'memory_enabled' | 'user_profile_enabled', on: boolean) => {
    const before = cfg.data
    cfg.setData((c) => c && { ...c, memory: { ...(c.memory ?? {}), [key]: on } })
    try { await patchConfig(profile, { memory: { [key]: on } }) } catch (e) { cfg.setData(before); toast(`Couldn’t change that: ${errText(e)}`) }
  }
  const forget = async (target: 'memory' | 'user' | 'all') => {
    const what = target === 'memory' ? { t: 'Forget the notes about the work?', b: `${bot}’s notes on your projects and how things are done (MEMORY.md) are wiped.` }
      : target === 'user' ? { t: 'Forget the notes about you?', b: `What ${bot} has noted about you (USER.md) is wiped.` }
      : { t: 'Forget everything in the built-in notes?', b: `Both of ${bot}’s notes are wiped: about the work and about you.` }
    if (!(await confirm({ title: what.t, body: `${what.b} This can’t be undone.`, action: target === 'all' ? 'Forget everything' : 'Forget', danger: true }))) return
    try {
      const r = await forgetMemory(profile, target)
      toast(r?.deleted?.length ? `Forgot ${r.deleted.join(' and ')}` : 'There was nothing to forget')
      await Promise.all([mem.reload(true), graph.reload(true)])
    } catch (e) { toast(`Couldn’t forget: ${errText(e)}`) }
  }

  // Memories come from the graph's nodes (their ids open them) with the card's full text; skills it learned too.
  const items: Item[] = useMemo(() => {
    const g = graph.data
    if (!g) return []
    const cards = new Map(g.memory.filter((c) => c.fingerprint).map((c) => [`${c.source}:${c.fingerprint}`, c]))
    const used = new Set<string>()
    const out: Item[] = []
    for (const n of g.nodes) {
      if (n.kind === 'memory') {
        const fp = n.id.split(':').pop() ?? ''
        const card = cards.get(`${n.memorySource}:${fp}`)
        if (card) used.add(`${card.source}:${card.fingerprint}`)
        out.push({ key: n.id, id: n.id, kind: 'memory', source: n.memorySource, text: card?.body || card?.title || n.label, ts: n.timestamp ?? card?.timestamp })
      } else {
        out.push({ key: n.id, id: n.id, kind: 'skill', text: n.label, sub: [n.createdBy === 'agent' ? 'Hermes wrote it' : 'Made here', n.category && n.category !== 'skills' ? n.category : '', n.useCount ? `used ${n.useCount.toLocaleString()}×` : ''].filter(Boolean).join(' · '), ts: n.timestamp, uses: n.useCount })
      }
    }
    g.memory.forEach((c, i) => { if (!c.fingerprint || !used.has(`${c.source}:${c.fingerprint}`)) out.push({ key: `card-${i}`, kind: 'memory', source: c.source, text: c.body || c.title, ts: c.timestamp }) })
    return out.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
  }, [graph.data])

  const counts = useMemo(() => ({ all: items.length, profile: items.filter((i) => i.kind === 'memory' && i.source === 'profile').length, memory: items.filter((i) => i.kind === 'memory' && i.source !== 'profile').length, skill: items.filter((i) => i.kind === 'skill').length }), [items])
  const t = norm(q.trim())
  const shown = items.filter((i) => (kind === 'all' || (kind === 'skill' ? i.kind === 'skill' : i.kind === 'memory' && (kind === 'profile' ? i.source === 'profile' : i.source !== 'profile'))) && (!t || norm(i.text).includes(t) || norm(i.sub).includes(t)))
  const stats = graph.data?.stats ?? {}

  const builtinRow = (key: 'memory' | 'user', cfgKey: 'memory_enabled' | 'user_profile_enabled', title: string, file: string, about: string) => {
    const size = m?.builtin_files?.[key] ?? 0
    const limit = Number(memCfg[key === 'memory' ? 'memory_char_limit' : 'user_char_limit']) || 0
    const on = memCfg[cfgKey] !== false
    return (
      <div className={`srow${on ? '' : ' off'}`}>
        <div className="tx">
          <div className="t1"><span>{title}</span>{limit && size >= limit * 0.95 ? <Badge tone="need">Nearly full</Badge> : null}</div>
          <div className="t2">{about}</div>
          <div className="t3">{file} · {size ? `${size.toLocaleString()}${limit ? ` of ${limit.toLocaleString()}` : ''} characters` : 'empty'}</div>
        </div>
        <div className="act">
          <button className="b-ghost-danger" onClick={() => void forget(key)} disabled={!size}>Forget</button>
          {cfg.data ? <Switch on={on} onChange={(v) => void setBuiltin(cfgKey, v)} label={`Use ${title.toLowerCase()}`} /> : null}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="shead">
        <div className="tx"><h1>Memory</h1><p>What {bot} remembers between chats, and where it keeps it. Open anything it has learned to read, change or forget it.</p></div>
        <div className="cap-acts"><MoreMenu items={[{ label: 'Reload', icon: 'refresh', onClick: () => { void mem.reload(); void graph.reload(); void cfg.reload(true) } }, { label: 'Forget everything in the built-in notes', icon: 'trash', danger: true, onClick: () => void forget('all') }]} /></div>
      </div>

      {mem.loading && !m ? <SkeletonCard rows={3} />
        : mem.error && !m ? <ErrorLine text={`Couldn’t read ${bot}’s memory: ${mem.error}`} onRetry={() => void mem.reload()} />
        : m ? (
          <>
            {mem.error ? <ErrorLine text={`Couldn’t refresh: ${mem.error}`} onRetry={() => void mem.reload()} /> : null}
            <Section title="Where it remembers" sub="New chats use the one you pick">
              <div className="card flow">
                {[null, ...providers].map((p) => {
                  const name = p?.name ?? ''
                  const isActive = name === active
                  const st = p ? MEMORY_STATUS[p.status] : undefined
                  return (
                    <div key={name || 'builtin'} className="srow click" {...clickable(() => void choose(p))} aria-label={isActive ? `${memoryName(name, p?.description)}, in use` : `Use ${memoryName(name, p?.description)}`}>
                      <div className="tx">
                        <div className="t1"><span>{memoryName(name, p?.description)}</span>
                          {isActive ? <Badge><Icon name="check" size={12} />In use</Badge> : null}
                          {st && (p!.status !== 'ready' || !isActive) ? <Badge tone={st.tone}>{st.label}</Badge> : null}
                        </div>
                        <div className="t2">{p ? p.description : 'Hermes’ own notes, kept in two small files on this Mac. Nothing to set up.'}</div>
                      </div>
                      <div className="act">
                        {switching === name ? <Spinner /> : null}
                        {p && p.status !== 'ready' ? <button className="b-soft" onKeyDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setSetupFor(p) }}>Set up</button>
                          : p && isActive ? <button className="b-text" onKeyDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setSetupFor(p) }}>Settings</button> : null}
                      </div>
                    </div>
                  )
                })}
              </div>
              {active && providers.find((p) => p.name === active)?.status !== 'ready' ? <div className="cap-note need"><i className="dot need" /><span>{memoryName(active, providers.find((p) => p.name === active)?.description)} isn’t ready, so new chats can’t recall through it until it’s set up.</span></div> : null}
            </Section>

            <Section title="Built-in notes" sub="Always kept, whichever you pick above">
              <div className="card">
                {builtinRow('memory', 'memory_enabled', 'Notes about the work', 'MEMORY.md', 'Short notes on your projects, tools and how things are done.')}
                {builtinRow('user', 'user_profile_enabled', 'Notes about you', 'USER.md', 'What it knows about you and how you like to work.')}
              </div>
              {cfg.data ? <div className="cap-dim" style={{ marginTop: 8 }}>A note that’s switched off isn’t read or written in new chats. Forget wipes it for good.</div> : null}
            </Section>
          </>
        ) : null}

      <Section title="What it has learned" sub={graph.data ? plural(items.length, 'thing') : undefined}>
        {graph.loading && !graph.data ? <SkeletonCard rows={5} />
          : graph.error && !graph.data ? <ErrorLine text={`Couldn’t read what ${bot} has learned: ${graph.error}`} onRetry={() => void graph.reload()} />
          : !items.length ? <Empty title="Nothing learned yet" body={`As ${bot} saves memories and writes skills, they show up here.`} />
          : (
            <>
              <div className="cap-stats">
                <div className="cap-stat"><b>{(stats.memory_nodes ?? counts.profile + counts.memory).toLocaleString()}</b><span>Memories</span></div>
                <div className="cap-stat"><b>{(stats.learned_skills ?? counts.skill).toLocaleString()}</b><span>Skills learned</span></div>
                <div className="cap-stat"><b>{linkCount(graph.data!).toLocaleString()}</b><span>Links between them</span></div>
              </div>
              <div className="stools">
                <Search value={q} onChange={setQ} placeholder="Search what it remembers" />
                <Tabs value={kind} onChange={setKind} items={[{ key: 'all', label: 'All', count: counts.all }, { key: 'profile', label: 'About you', count: counts.profile }, { key: 'memory', label: 'About the work', count: counts.memory }, { key: 'skill', label: 'Skills', count: counts.skill }]} />
              </div>
              {!shown.length ? <Empty title="Nothing matches" body="Try another word." face={false} /> : (
                <div className="card flow">
                  {shown.map((i) => (
                    <div key={i.key} className={`srow${i.id ? ' click' : ''}`} {...(i.id ? clickable(() => setOpen(i.id!)) : {})}>
                      <div className="tx">
                        {i.kind === 'skill' ? <><div className="t1"><span>{i.text}</span><Badge tone="quiet">Skill</Badge></div>{i.sub ? <div className="t2">{i.sub}</div> : null}</>
                          : <div className="t2 cap-mem">{i.text}</div>}
                      </div>
                      <div className="act">
                        {i.kind === 'memory' ? <span className="cap-src">{SOURCE[i.source ?? ''] ?? 'Memory'}</span> : null}
                        {i.ts ? <span className="cap-use">{timeAgoSec(i.ts)}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
      </Section>

      {open ? <NodeDialog key={open} profile={profile} id={open} graph={graph.data} bot={bot} onClose={() => setOpen(null)} onOpen={setOpen} onChanged={() => { void graph.reload(true); void mem.reload(true) }} /> : null}
      {setupFor ? <ProviderSetupDialog profile={profile} provider={setupFor} bot={bot} onClose={() => setSetupFor(null)} onDone={() => { setSetupFor(null); void mem.reload(true) }} /> : null}
    </>
  )
}
