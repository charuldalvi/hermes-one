// Settings › Team: Chief and every bot, each with its own model, what it's for, and how it behaves
// (its SOUL.md). Add a bot, rename it, export it, or let it go. Model changes go to the bot's own
// config (Chief's is Hermes' main model), so the next thing it does uses the new one.
import { useMemo, useRef, useState } from 'react'
import * as api from '../../lib/api'
import { refreshTeam, toast } from '../../lib/hermes'
import { Icon } from '../../lib/icons'
import { ModelMark } from '../../lib/logos'
import { setState, useStore } from '../../lib/store'
import { BotFace } from '../BotFace'
import { NewGroupDialog } from '../Groups'
import { Badge, confirm, Dialog, ErrorLine, Popover, SaveField, Select, Spinner, useAsync, type Option } from '../ui'

const NAME_OK = /^[a-z0-9][a-z0-9_-]{0,63}$/

function modelIcon(id?: string, provider?: string) {
  return <ModelMark model={id} provider={provider} />
}

/** Every model you can pick, grouped by provider; providers you haven't signed in to are listed but can't be picked. */
export function modelChoices(opts?: api.ModelOptions): Option[] {
  const out: Option[] = []
  for (const p of opts?.providers ?? []) {
    const unavailable = new Set(p.unavailable_models ?? [])
    for (const m of p.models ?? []) {
      out.push({
        value: `${p.slug}::${m}`, label: api.prettyModel(m), group: p.name + (p.authenticated === false ? ' · not signed in' : ''),
        hint: m.includes('/') ? m.split('/')[0] : p.free_tier ? 'free' : undefined,
        icon: modelIcon(m, p.slug), disabled: p.authenticated === false || unavailable.has(m),
      })
    }
  }
  return out
}

export function ModelPicker({ profile, provider, model, options, onChanged }: { profile: string; provider?: string; model?: string; options?: api.ModelOptions; onChanged: (provider: string, model: string) => void }) {
  const [busy, setBusy] = useState(false)
  const choices = useMemo(() => modelChoices(options), [options])
  const value = provider && model ? `${provider}::${model}` : undefined
  const pick = async (v: string) => {
    const [prov, ...rest] = v.split('::')
    const mod = rest.join('::')
    setBusy(true)
    try {
      let r: any = await api.setProfileModel(profile, prov, mod)
      if (r?.confirm_required || r?.status === 'confirm_required') {
        const ok = await confirm({ title: `Use ${api.prettyModel(mod)}?`, body: r?.message ?? 'This model costs more per message than most.', action: 'Use it' })
        if (!ok) return
        r = await api.setProfileModel(profile, prov, mod, true)
      }
      onChanged(prov, mod)
      toast(`${profile === 'default' ? 'Quicksilver' : 'It'} now uses ${api.prettyModel(mod)}`)
    } catch (e: any) { toast(`Couldn’t change the model: ${e?.message ?? e}`) } finally { setBusy(false) }
  }
  return (
    <span className="mp">
      {busy ? <Spinner /> : null}
      <Select value={value} options={choices} onChange={(v) => void pick(v)} width={360} align="end" disabled={busy || !options}
        render={(o) => <>{modelIcon(model)}<span className="sv">{o?.label ?? (model ? api.prettyModel(model) : 'Choose a model')}</span></>} />
    </span>
  )
}

function BotCard({ p, options, open, onToggle, onChanged }: { p: api.Profile; options?: api.ModelOptions; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const bot = useStore((s) => s.bots.find((b) => b.profile === p.name))
  const chief = p.is_default
  const name = chief ? 'Quicksilver' : bot?.name ?? p.display_name ?? p.name
  const [model, setModel] = useState({ provider: p.provider, model: p.model })
  const [menu, setMenu] = useState(false)
  const more = useRef<HTMLButtonElement>(null)
  const [renaming, setRenaming] = useState(false)
  const soul = useAsync(() => (open ? api.soul(p.name) : Promise.resolve('')), [open, p.name])
  const [describing, setDescribing] = useState(false)
  const [role, setRole] = useState(p.description ?? '')

  const remove = async () => {
    setMenu(false)
    const ok = await confirm({ title: `Let ${name} go?`, body: `This deletes the ${p.name} profile: its settings, skills, memory and chats on this Mac. It can’t be undone. Export it first if you might want it back.`, action: `Delete ${name}`, danger: true })
    if (!ok) return
    try { await api.deleteProfile(p.name); toast(`${name} is no longer one of your agents`); onChanged(); await refreshTeam() } catch (e: any) { toast(`Couldn’t delete: ${e?.message ?? e}`) }
  }
  const exportIt = async () => {
    setMenu(false)
    try { const r: any = await api.rest('POST', `/api/profiles/${encodeURIComponent(p.name)}/export`, {}); const out = r?.archive ?? r?.path; toast(out ? `Saved to ${out}` : 'Exported'); if (out) void window.hermesNative.reveal(out) } catch (e: any) { toast(`Couldn’t export: ${e?.message ?? e}`) }
  }
  const autoRole = async () => {
    setDescribing(true)
    try { const r = await api.describeAuto(p.name); if (r.ok && r.description) { setRole(r.description); toast('Role written from its skills and personality') } else toast(r.reason ?? 'Hermes couldn’t write one this time') } catch (e: any) { toast(`Couldn’t write it: ${e?.message ?? e}`) } finally { setDescribing(false) }
  }

  return (
    <div className={`card botcard${open ? ' open' : ''}`}>
      <div className="srow click" onClick={onToggle}>
        <BotFace profile={p.name} size={40} poseKey={bot?.poseKey} watch={false} />
        <div className="tx">
          <div className="t1"><span>{name}</span>{chief ? <Badge tone="quiet">Leads your agents</Badge> : null}{!p.has_env && !chief ? <Badge tone="quiet">Uses Quicksilver’s keys</Badge> : null}</div>
          <div className="t2">{role || (chief ? 'Talks with you and hands work to the agents.' : 'No role written yet.')}</div>
        </div>
        <div className="act" onClick={(e) => e.stopPropagation()}>
          <ModelPicker profile={p.name} provider={model.provider} model={model.model} options={options} onChanged={(provider, m) => { setModel({ provider, model: m }); setState((s) => ({ bots: s.bots.map((b) => (b.profile === p.name ? { ...b, model: m } : b)) })) }} />
          <button ref={more} className="hbtn" aria-label="More" onClick={() => setMenu(!menu)}><Icon name="dots" /></button>
        </div>
        <Icon name="chevD" size={16} className="chev" />
      </div>
      <Popover anchor={more.current} open={menu} onClose={() => setMenu(false)} width={220} align="end">
        <button className="mi" onClick={() => { setMenu(false); setState({ settingsPage: 'skills', scope: p.name }) }}><Icon name="book" size={15} /><span className="ml">Skills ({p.skill_count ?? 0})</span></button>
        <button className="mi" onClick={() => { setMenu(false); setState({ settingsPage: 'tools', scope: p.name }) }}><Icon name="tool" size={15} /><span className="ml">Tools</span></button>
        <button className="mi" onClick={() => { setMenu(false); setState({ settingsPage: 'config', scope: p.name }) }}><Icon name="sliders" size={15} /><span className="ml">All its settings</span></button>
        {!chief ? <button className="mi" onClick={() => { setMenu(false); setRenaming(true) }}><Icon name="edit" size={15} /><span className="ml">Rename</span></button> : null}
        <button className="mi" onClick={() => void exportIt()}><Icon name="download" size={15} /><span className="ml">Export</span></button>
        {!chief ? <button className="mi" style={{ color: 'var(--tint-red)' }} onClick={() => void remove()}><Icon name="trash" size={15} /><span className="ml" style={{ color: 'var(--tint-red)' }}>Delete</span></button> : null}
      </Popover>
      <div className="botmore" aria-hidden={!open}>
        <div className="botmore-in">
          <div className="fl"><span>What it’s for</span><button className="b-text sm" disabled={describing} onClick={() => void autoRole()}>{describing ? <Spinner size={12} /> : <Icon name="spark" size={14} />}Write it for me</button></div>
          <SaveField value={role} placeholder="One line: what this agent does for you" onSave={async (v) => { await api.setDescription(p.name, v); setRole(v); onChanged() }} />
          <div className="fl"><span>How it behaves</span><em>Its personality and standing instructions (SOUL.md)</em></div>
          {soul.loading ? <Spinner /> : soul.error ? <ErrorLine text={soul.error} onRetry={() => void soul.reload()} /> :
            <SaveField value={soul.data ?? ''} multiline rows={9} mono placeholder="Who this agent is and how it works" onSave={(v) => api.setSoul(p.name, v)} />}
          <div className="kvline">
            <span><Icon name="book" size={14} />{p.skill_count ?? 0} skills</span>
            <span><Icon name="folder" size={14} /><button className="lnk" onClick={() => void window.hermesNative.reveal(p.path)}>{p.path.replace(/^\/Users\/[^/]+/, '~')}</button></span>
            {p.gateway_running ? <span><i className="dot ok" />Running</span> : null}
          </div>
        </div>
      </div>
      <RenameDialog open={renaming} from={p.name} onClose={() => setRenaming(false)} onDone={async () => { onChanged(); await refreshTeam() }} />
    </div>
  )
}

function RenameDialog({ open, from, onClose, onDone }: { open: boolean; from: string; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(from)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ok = NAME_OK.test(v) && v !== from
  const go = async () => {
    setBusy(true); setErr('')
    try { await api.renameProfile(from, v); toast(`Renamed to ${v}`); onClose(); onDone() } catch (e: any) { setErr(e?.message ?? String(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Rename this agent" width={440}
      footer={<><span className="sp" /><button className="b-text" onClick={onClose}>Cancel</button><button className="b-pri" disabled={!ok || busy} onClick={() => void go()}>{busy ? 'Renaming…' : 'Rename'}</button></>}>
      <p className="free">Its chats, skills and memory stay with it. Lowercase letters, numbers, - and _.</p>
      <input className="answer" value={v} autoFocus onChange={(e) => setV(e.target.value.toLowerCase())} onKeyDown={(e) => { if (e.key === 'Enter' && ok) void go() }} />
      {err ? <p className="free" style={{ color: 'var(--tint-red)', marginTop: 8 }}>{err}</p> : null}
    </Dialog>
  )
}

function AddBotDialog({ open, onClose, onDone, options }: { open: boolean; onClose: () => void; onDone: () => void; options?: api.ModelOptions }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [soulText, setSoulText] = useState('')
  const [model, setModel] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const taken = useStore((s) => s.bots.some((b) => b.profile === name))
  const ok = NAME_OK.test(name) && !taken && role.trim().length > 2
  const choices = useMemo(() => modelChoices(options), [options])
  const go = async () => {
    setBusy(true); setErr('')
    try {
      await api.createProfile(name)
      await api.setDescription(name, role.trim()).catch(() => {})
      if (soulText.trim()) await api.setSoul(name, soulText.trim()).catch(() => {})
      if (model) { const [prov, ...m] = model.split('::'); await api.setProfileModel(name, prov, m.join('::')).catch(() => {}) }
      toast(`${name} is now one of your agents`)
      setName(''); setRole(''); setSoulText(''); setModel(undefined)
      onClose(); onDone(); await refreshTeam()
    } catch (e: any) { setErr(e?.message ?? String(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Add an agent" width={560}
      footer={<><span className="sp" /><button className="b-text" onClick={onClose}>Cancel</button><button className="b-pri" disabled={!ok || busy} onClick={() => void go()}>{busy ? 'Adding…' : 'Add agent'}</button></>}>
      <div className="form">
        <label><span>Name</span><input className="answer" value={name} autoFocus placeholder="researcher" onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))} />
          <em>{taken ? 'There’s already an agent with that name.' : 'Lowercase letters, numbers, - and _. It starts with Quicksilver’s keys, settings and skills.'}</em></label>
        <label><span>What it’s for</span><input className="answer" value={role} placeholder="Finds sources and writes short briefs" onChange={(e) => setRole(e.target.value)} /></label>
        <label><span>Model</span><Select value={model} options={choices} onChange={setModel} placeholder="Same as Quicksilver" width={380} /></label>
        <label><span>How it behaves <em>optional</em></span><textarea className="answer" rows={5} value={soulText} placeholder="You are a careful researcher. Always cite sources…" onChange={(e) => setSoulText(e.target.value)} /></label>
        {err ? <p className="free" style={{ color: 'var(--tint-red)' }}>{err}</p> : null}
      </div>
    </Dialog>
  )
}

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const pick = async () => { const f = await window.hermesNative.pickFiles(); if (f[0]) setPath(f[0].path) }
  const go = async () => {
    setBusy(true); setErr('')
    try { await api.rest('POST', '/api/profiles/import', { archive: path }); toast('Agent imported'); onClose(); onDone(); await refreshTeam() } catch (e: any) { setErr(e?.message ?? String(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Import an agent" width={500}
      footer={<><span className="sp" /><button className="b-text" onClick={onClose}>Cancel</button><button className="b-pri" disabled={!path || busy} onClick={() => void go()}>{busy ? 'Importing…' : 'Import'}</button></>}>
      <p className="free">Pick an agent you exported before (a .tar.gz from Export).</p>
      <div style={{ display: 'flex', gap: 8 }}><input className="answer" value={path} placeholder="/path/to/bot.tar.gz" onChange={(e) => setPath(e.target.value)} /><button className="b-soft" onClick={() => void pick()}>Choose…</button></div>
      {err ? <p className="free" style={{ color: 'var(--tint-red)', marginTop: 8 }}>{err}</p> : null}
    </Dialog>
  )
}

export function TeamPage(_: { profile: string }) {
  const list = useAsync(api.profiles, [])
  const options = useAsync(() => api.modelOptions(), [])
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [grouping, setGrouping] = useState(false)
  const sorted = useMemo(() => [...(list.data ?? [])].sort((a, b) => (a.is_default ? -1 : b.is_default ? 1 : a.name.localeCompare(b.name))), [list.data])
  return (
    <>
      <div className="shead">
        <div className="tx"><h1>Agents</h1><p>Quicksilver talks with you and hands work out. Give each agent the model, role and personality that fit its work.</p></div>
        <button className="b-soft" onClick={() => setImporting(true)}><Icon name="upload" size={15} /> Import</button>
        <button className="b-soft" onClick={() => setGrouping(true)}><Icon name="group" size={15} /> New group</button>
        <button className="b-pri" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Add an agent</button>
      </div>
      {list.error ? <ErrorLine text={list.error} onRetry={() => void list.reload()} /> : null}
      {options.error ? <ErrorLine text={`Models couldn’t be listed: ${options.error}`} onRetry={() => void options.reload()} /> : null}
      {list.loading && !list.data ? <div className="empty"><Spinner size={18} /></div> : (
        <div className="flow team">
          {sorted.map((p) => <BotCard key={p.name} p={p} options={options.data} open={open === p.name} onToggle={() => setOpen(open === p.name ? null : p.name)} onChanged={() => void list.reload(true)} />)}
        </div>
      )}
      <AddBotDialog open={adding} onClose={() => setAdding(false)} onDone={() => void list.reload(true)} options={options.data} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} onDone={() => void list.reload(true)} />
      <NewGroupDialog open={grouping} onClose={() => setGrouping(false)} />
    </>
  )
}
