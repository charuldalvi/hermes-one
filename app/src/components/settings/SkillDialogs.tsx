// A skill opened from Settings › Skills: read its SKILL.md, edit and save it, lock it against Hermes'
// own edits, archive one Hermes made, or uninstall one from the hub. And the "New skill" form.
// Same routes as Hermes Desktop's skill detail and Hermes Remote's SkillSheet / NewSkillSheet.
import { useEffect, useMemo, useRef, useState } from 'react'
import { skillContent, type Skill } from '../../lib/api'
import {
  createSkill, deleteLearningNode, followAction, hubUninstallSkill, lockSkill, saveSkill, tail, type Provenance,
} from '../../lib/api-capabilities'
import { toast } from '../../lib/hermes'
import { Icon } from '../../lib/icons'
import { Badge, confirm, Dialog, ErrorLine, Spinner, Switch } from '../ui'
import { errText, JobLine, Markdown, Note, parseFrontmatter, plural, pretty } from './cap-parts'

export type SkillRow = Skill & { provenance?: Provenance }

export const ORIGIN: Record<Provenance, { label: string; long: string }> = {
  agent: { label: 'Made here', long: 'Written by Hermes or by you' },
  hub: { label: 'Installed', long: 'Installed from the skills hub' },
  bundled: { label: 'Built in', long: 'Comes with Hermes' },
  external: { label: 'From your folders', long: 'From a folder you pointed Hermes at' },
}
export const originOf = (s: SkillRow): Provenance => (s.provenance && s.provenance in ORIGIN ? s.provenance : 'agent')
/** Hermes' own rule: only skills made here (or mounted from your folders) are yours to archive. */
const archivable = (p: Provenance) => p === 'agent' || p === 'external'

export function SkillDialog({ profile, skill, bot, onClose, onToggle, onPatch, onRemoved, onSaved }: {
  profile: string; skill: SkillRow; bot: string; onClose: () => void
  onToggle: (on: boolean) => void; onPatch: (patch: Partial<SkillRow>) => void; onRemoved: () => void; onSaved: () => void
}) {
  const origin = originOf(skill)
  const [content, setContent] = useState<string>()
  const [loadErr, setLoadErr] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState<{ text: string; lines: string[]; done?: boolean; ok?: boolean }>()

  useEffect(() => {
    let live = true
    setLoadErr(undefined)
    skillContent(profile, skill.name).then((c) => { if (live) setContent(c) }, (e) => { if (live) setLoadErr(errText(e)) })
    return () => { live = false }
  }, [profile, skill.name, attempt])

  const parsed = useMemo(() => (content !== undefined ? parseFrontmatter(content) : null), [content])
  const meta = parsed?.meta.filter(([k]) => k !== 'name' && k !== 'description' && k !== '') ?? []
  const dirty = editing && draft !== content

  const asking = useRef(false)
  const close = async () => {
    if (saving || asking.current) return
    if (dirty) {
      asking.current = true
      const ok = await confirm({ title: 'Throw away your changes?', body: `Your edits to ${skill.name} haven’t been saved.`, action: 'Throw away', danger: true })
      asking.current = false
      if (!ok) return
    }
    onClose()
  }
  const startEdit = () => { setDraft(content ?? ''); setSaveErr(undefined); setEditing(true) }
  const save = async () => {
    if (!dirty || saving) return
    setSaving(true); setSaveErr(undefined)
    try {
      await saveSkill(profile, skill.name, draft)
      setContent(draft); setEditing(false); onSaved()
      toast(`Saved ${skill.name}. New chats use it.`)
    } catch (e) { setSaveErr(errText(e)) } finally { setSaving(false) }
  }
  const toggleLock = async () => {
    const next = !skill.locked
    setBusy(true); onPatch({ locked: next })
    try { await lockSkill(profile, skill.name, next); toast(next ? `Locked ${skill.name}` : `Unlocked ${skill.name}`) } catch (e) { onPatch({ locked: !next }); toast(`Couldn’t ${next ? 'lock' : 'unlock'} ${skill.name}: ${errText(e)}`) } finally { setBusy(false) }
  }
  const archive = async () => {
    if (!(await confirm({ title: `Archive ${skill.name}?`, body: <>Hermes stops using it. It isn’t deleted: it can come back with <code className="cap-code">hermes curator restore</code>.</>, action: 'Archive', danger: true }))) return
    setBusy(true)
    try { await deleteLearningNode(profile, skill.name); toast(`Archived ${skill.name}`); onRemoved() } catch (e) { toast(`Couldn’t archive ${skill.name}: ${errText(e)}`); setBusy(false) }
  }
  const uninstall = async () => {
    if (!(await confirm({ title: `Uninstall ${skill.name}?`, body: `It’s removed from ${bot}. You can install it again from the Marketplace.`, action: 'Uninstall', danger: true }))) return
    setBusy(true); setJob({ text: `Uninstalling ${skill.name}…`, lines: [] })
    try {
      const r = await followAction(profile, await hubUninstallSkill(profile, skill.name), (lines) => setJob((j) => j && { ...j, lines }))
      if (r.exit_code === 0) { toast(`Uninstalled ${skill.name}`); onRemoved(); return }
      setJob({ text: `Couldn’t uninstall: ${tail(r, 1) || 'Hermes stopped early.'}`, lines: r.lines, done: true, ok: false })
    } catch (e) { setJob({ text: `Couldn’t uninstall: ${errText(e)}`, lines: [], done: true, ok: false }) }
    setBusy(false)
  }

  const used = skill.usage ?? 0
  const footer = editing ? (
    <>
      <span className="cap-dim">⌘S saves</span><span className="sp" />
      <button className="b-text" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
      <button className="b-pri" onClick={() => void save()} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</button>
    </>
  ) : (
    <>
      {origin === 'hub' ? <button className="b-ghost-danger" onClick={() => void uninstall()} disabled={busy}>Uninstall</button> : null}
      {archivable(origin) ? <button className="b-ghost-danger" onClick={() => void archive()} disabled={busy}>Archive</button> : null}
      <button className="b-text" onClick={() => void toggleLock()} disabled={busy} title={skill.locked ? 'Let Hermes change it again' : 'Stop Hermes changing it on its own'}>
        <span className="cap-row"><Icon name="lock" size={14} />{skill.locked ? 'Unlock' : 'Lock'}</span>
      </button>
      <span className="sp" />
      <button className="b-text" onClick={onClose}>Close</button>
      <button className="b-soft" onClick={startEdit} disabled={content === undefined || busy}><span className="cap-row"><Icon name="edit" size={14} />Edit</span></button>
    </>
  )

  return (
    <Dialog open onClose={() => void close()} wide footer={footer}
      title={<span className="cap-dh"><span className="nm">{skill.name}</span>{skill.locked ? <Badge tone="quiet"><Icon name="lock" size={12} />Locked</Badge> : null}</span>}>
      <div onKeyDown={(e) => { if (editing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save() } }}>
        <div className="cap-meta">
          <span>{pretty(skill.category) || 'General'}</span>
          <span title={ORIGIN[origin].long}>{ORIGIN[origin].label}</span>
          <span>{used ? `Used ${plural(used, 'time')}` : 'Not used yet'}</span>
          <span style={{ marginLeft: 'auto' }} className="cap-row">
            <span className="cap-dim">{skill.enabled ? 'On' : 'Off'}</span>
            <Switch on={skill.enabled} onChange={onToggle} label={`${skill.name} on`} />
          </span>
        </div>
        {job ? <JobLine {...job} onClose={() => setJob(undefined)} /> : null}
        {editing ? (
          <>
            {origin === 'bundled' || origin === 'hub' ? <Note tone="need">{origin === 'bundled' ? 'This skill comes with Hermes. Updating Hermes puts the original back, so your change may not last.' : 'Updating installed skills puts the hub’s version back, so your change may not last.'}</Note> : null}
            {saveErr ? <ErrorLine text={saveErr} /> : null}
            <textarea className="answer cap-editor" value={draft} autoFocus spellCheck={false} disabled={saving} onChange={(e) => setDraft(e.target.value)} aria-label={`${skill.name} SKILL.md`} />
          </>
        ) : (
          <>
            {skill.description ? <p className="cap-desc">{skill.description}</p> : null}
            {skill.locked ? <Note>Locked: Hermes can’t change this skill on its own. You still can.</Note> : null}
            {loadErr ? <ErrorLine text={`Couldn’t read SKILL.md: ${loadErr}`} onRetry={() => setAttempt((n) => n + 1)} /> : null}
            {!parsed && !loadErr ? <div className="cap-row cap-dim" style={{ padding: '20px 0' }}><Spinner />Reading SKILL.md…</div> : null}
            {parsed ? (
              <>
                {meta.length ? <dl className="cap-fm">{meta.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}</dl> : null}
                {parsed.body.trim() ? <Markdown text={parsed.body} /> : <div className="cap-dim">This skill has no instructions yet.</div>}
              </>
            ) : null}
            <div className="cap-dim" style={{ marginTop: 18 }}>Changes to skills apply to new chats.{origin === 'bundled' ? ' Built-in skills can be turned off, not removed.' : ''}</div>
          </>
        )}
      </div>
    </Dialog>
  )
}

const TEMPLATE = (name: string) => `---
name: ${name || 'my-skill'}
description: One line on when Hermes should use this skill.
---

# ${name ? pretty(name) : 'My skill'}

What to do, step by step.
`

export function NewSkillDialog({ profile, bot, categories, onClose, onCreated }: { profile: string; bot: string; categories: string[]; onClose: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [content, setContent] = useState(TEMPLATE(''))
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string>()
  const valid = /^[a-z0-9][a-z0-9-]{0,63}$/.test(name)

  const rename = (raw: string) => {
    const next = raw.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '')
    setName(next)
    // keep the template's name line in step until you write your own text
    if (!touched) setContent(TEMPLATE(next))
    else setContent((c) => c.replace(/^name:.*$/m, `name: ${next || 'my-skill'}`))
  }
  const create = async () => {
    if (!valid || !content.trim() || saving) return
    setSaving(true); setErr(undefined)
    try { await createSkill(profile, name, content, category); toast(`Created ${name} for ${bot}`); onCreated(name) } catch (e) { setErr(errText(e)) } finally { setSaving(false) }
  }
  const asking = useRef(false)
  const close = async () => {
    if (saving || asking.current) return
    if (name || touched) {
      asking.current = true
      const ok = await confirm({ title: 'Throw away this skill?', body: 'It hasn’t been created yet.', action: 'Throw away', danger: true })
      asking.current = false
      if (!ok) return
    }
    onClose()
  }
  return (
    <Dialog open onClose={() => void close()} wide title="New skill"
      footer={<><span className="cap-dim">For {bot}. New chats can use it straight away.</span><span className="sp" /><button className="b-text" onClick={() => void close()}>Cancel</button><button className="b-pri" onClick={() => void create()} disabled={!valid || !content.trim() || saving}>{saving ? 'Creating…' : 'Create skill'}</button></>}>
      <div className="cap-form" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void create() } }}>
        {err ? <ErrorLine text={err} /> : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>Name<input className="answer mono" value={name} autoFocus placeholder="release-notes" onChange={(e) => rename(e.target.value)} /><span className="hint">Lowercase letters, numbers and dashes.</span></label>
          <label>Group (optional)<input className="answer" value={category} list="skill-cats" placeholder="productivity" onChange={(e) => setCategory(e.target.value.toLowerCase().replace(/\s+/g, '-'))} />
            <datalist id="skill-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist><span className="hint">Puts it in a folder with similar skills.</span></label>
        </div>
        <label>Instructions (SKILL.md)
          <textarea className="answer cap-editor" style={{ minHeight: '40vh' }} spellCheck={false} value={content} onChange={(e) => { setTouched(true); setContent(e.target.value) }} />
          <span className="hint">Keep the part between the <code className="cap-code">---</code> lines: Hermes reads the description to know when to use it.</span>
        </label>
      </div>
    </Dialog>
  )
}
