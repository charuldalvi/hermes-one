// Settings › Memory, opened: one thing Hermes learned (a memory, or a skill it wrote) to read, edit,
// follow to what it links to, or forget; and a memory provider's setup (its settings, and installing
// what it needs). Parity with Hermes Desktop's star-map node menu and memory provider panel, and
// Hermes Remote's MemoryNodeSheet.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteLearningNode, editLearningNode, learningNode, memoryProviderConfig, saveMemoryProviderConfig, setupMemoryProvider,
  type LearnDetail, type LearnGraph, type MemoryProviderRow, type ProviderField, type SetupResult,
} from '../../lib/api-capabilities'
import { toast } from '../../lib/hermes'
import { Icon } from '../../lib/icons'
import { Badge, confirm, Dialog, ErrorLine, Spinner, useAsync } from '../ui'
import { errText, FieldRow, LogBox, Markdown, MEMORY_STATUS, memoryName, Note, parseFrontmatter, pretty, timeAgoSec, type FieldSpec } from './cap-parts'

export const SOURCE: Record<string, string> = { profile: 'About you', memory: 'About the work' }

export function NodeDialog({ profile, id, graph, bot, onClose, onOpen, onChanged }: {
  profile: string; id: string; graph: LearnGraph | undefined; bot: string; onClose: () => void; onOpen: (id: string) => void; onChanged: () => void
}) {
  const node = graph?.nodes.find((n) => n.id === id)
  const [detail, setDetail] = useState<LearnDetail>()
  const [err, setErr] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const asking = useRef(false)

  useEffect(() => {
    let live = true
    setDetail(undefined); setErr(undefined); setEditing(false)
    learningNode(profile, id).then((d) => { if (live) setDetail(d) }, (e) => { if (live) setErr(errText(e)) })
    return () => { live = false }
  }, [profile, id, attempt])

  const kind = detail?.kind ?? node?.kind ?? 'memory'
  const isSkill = kind === 'skill'
  const label = detail?.label || node?.label || id
  const links = useMemo(() => {
    const ids = new Set<string>()
    for (const e of graph?.edges ?? []) { if (e.source === id) ids.add(e.target); else if (e.target === id) ids.add(e.source) }
    ids.delete(id)
    return [...ids].map((x) => graph?.nodes.find((n) => n.id === x)).filter(Boolean) as LearnGraph['nodes']
  }, [graph, id])
  const parsed = useMemo(() => (isSkill && detail ? parseFrontmatter(detail.content) : null), [isSkill, detail])
  const dirty = editing && detail !== undefined && draft !== detail.content

  const close = async () => {
    if (busy || asking.current) return
    if (dirty) {
      asking.current = true
      const ok = await confirm({ title: 'Throw away your changes?', body: 'Your edit hasn’t been saved.', action: 'Throw away', danger: true })
      asking.current = false
      if (!ok) return
    }
    onClose()
  }
  const save = async () => {
    if (!dirty || busy) return
    setBusy(true)
    try { await editLearningNode(profile, id, draft); toast(isSkill ? `Saved ${label}` : 'Memory saved'); onChanged(); onClose() } catch (e) { toast(`Couldn’t save: ${errText(e)}`) } finally { setBusy(false) }
  }
  const forget = async () => {
    const ok = await confirm(isSkill
      ? { title: `Archive ${label}?`, body: <>Hermes stops using it. It isn’t deleted: it can come back with <code className="cap-code">hermes curator restore</code>.</>, action: 'Archive', danger: true }
      : { title: 'Delete this memory?', body: `${bot} forgets it for good. This can’t be undone.`, action: 'Delete', danger: true })
    if (!ok) return
    setBusy(true)
    try { await deleteLearningNode(profile, id); toast(isSkill ? `Archived ${label}` : 'Memory deleted'); onChanged(); onClose() } catch (e) { toast(`Couldn’t ${isSkill ? 'archive' : 'delete'} it: ${errText(e)}`); setBusy(false) }
  }

  const sourceLabel = isSkill ? (node?.createdBy === 'agent' ? 'Skill Hermes wrote' : 'Skill made here') : SOURCE[node?.memorySource ?? ''] ?? 'Memory'
  return (
    <Dialog open onClose={() => void close()} wide
      title={<span className="cap-dh"><span className="nm">{isSkill ? label : sourceLabel}</span>{isSkill ? <Badge tone="quiet">Skill</Badge> : null}</span>}
      footer={editing ? (
        <><span className="cap-dim">⌘S saves</span><span className="sp" /><button className="b-text" onClick={() => setEditing(false)} disabled={busy}>Cancel</button><button className="b-pri" onClick={() => void save()} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save'}</button></>
      ) : (
        <>
          <button className="b-ghost-danger" onClick={() => void forget()} disabled={busy || !detail}>{isSkill ? 'Archive' : 'Delete'}</button>
          <span className="sp" />
          <button className="b-text" onClick={onClose}>Close</button>
          <button className="b-soft" onClick={() => { setDraft(detail?.content ?? ''); setEditing(true) }} disabled={!detail || busy}><span className="cap-row"><Icon name="edit" size={14} />Edit</span></button>
        </>
      )}>
      <div onKeyDown={(e) => { if (editing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save() } }}>
        <div className="cap-meta">
          <span>{sourceLabel}</span>
          {node?.category && isSkill && node.category !== 'skills' ? <span>{pretty(node.category)}</span> : null}
          {node?.useCount ? <span>Used {node.useCount.toLocaleString()} time{node.useCount === 1 ? '' : 's'}</span> : null}
          {node?.timestamp ? <span>{isSkill ? 'Changed' : 'Saved'} {timeAgoSec(node.timestamp)}</span> : null}
          {node?.pinned ? <span>Pinned</span> : null}
        </div>
        {err ? <ErrorLine text={`Couldn’t read it: ${err}`} onRetry={() => setAttempt((n) => n + 1)} /> : null}
        {!detail && !err ? <div className="cap-row cap-dim" style={{ padding: '18px 0' }}><Spinner />Reading…</div> : null}
        {detail && editing ? (
          <textarea className="answer cap-editor" style={isSkill ? undefined : { minHeight: '30vh', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-md)', lineHeight: '24px' }}
            value={draft} autoFocus spellCheck={!isSkill} disabled={busy} onChange={(e) => setDraft(e.target.value)} aria-label="Edit" />
        ) : detail ? (
          isSkill && parsed ? (
            <>{parsed.meta.filter(([k]) => k !== 'name').length ? <dl className="cap-fm">{parsed.meta.filter(([k]) => k !== 'name').map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}</dl> : null}<Markdown text={parsed.body} /></>
          ) : <p className="cap-plain">{detail.content || 'Empty.'}</p>
        ) : null}

        {!editing ? (
          <>
            <div className="cap-h3">{links.length ? `Linked to ${links.length}` : 'Not linked to anything yet'}</div>
            {links.length ? (
              <div className="cap-links">
                {links.map((n) => <button key={n.id} onClick={() => onOpen(n.id)}><i className={`dot ${n.kind === 'skill' ? 'off' : 'run'}`} style={{ animation: 'none' }} /><span>{n.label}</span><em>{n.kind === 'skill' ? 'skill' : 'memory'}</em><Icon name="chevR" size={14} /></button>)}
              </div>
            ) : <div className="cap-dim">Hermes links memories and skills that relate as it learns.</div>}
          </>
        ) : null}
      </div>
    </Dialog>
  )
}

// ---------- a memory provider's setup ----------

const optionsOf = (f: ProviderField) => (f.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label || o.value }))
const shows = (f: ProviderField, values: Record<string, string>) =>
  !f.when || typeof f.when !== 'object' || Object.entries(f.when).every(([k, v]) => Array.isArray(v) ? v.map(String).includes(values[k] ?? '') : String(v) === (values[k] ?? ''))

export function ProviderSetupDialog({ profile, provider, bot, onClose, onDone }: { profile: string; provider: MemoryProviderRow; bot: string; onClose: () => void; onDone: () => void }) {
  const cfg = useAsync(() => memoryProviderConfig(profile, provider.name), [profile, provider.name])
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [results, setResults] = useState<SetupResult[] | null>(null)
  const [err, setErr] = useState<string>()
  const name = memoryName(provider.name, provider.description)
  const fields = cfg.data?.fields ?? []
  const setup = cfg.data?.setup ?? provider.setup
  const needsInstall = setup && (setup.dependencies_installed === false || (provider.status === 'unavailable' && (setup.external_dependencies?.length || setup.pip_dependencies?.length)))

  useEffect(() => { if (cfg.data) setValues(Object.fromEntries(cfg.data.fields.map((f) => [f.key, f.kind === 'secret' ? '' : String(f.value ?? '')]))) }, [cfg.data])

  const typed = () => {
    const out: Record<string, string> = {}
    for (const f of fields) {
      const v = values[f.key] ?? ''
      if (f.kind === 'secret') { if (v.trim()) out[f.key] = v.trim(); continue }
      if (v !== String(f.value ?? '')) out[f.key] = v
    }
    return out
  }
  const missing = fields.filter((f) => f.required && shows(f, values) && !(f.kind === 'secret' ? f.is_set || (values[f.key] ?? '').trim() : (values[f.key] ?? '').trim()))

  const install = async () => {
    setInstalling(true); setErr(undefined); setResults(null)
    try { const r = await setupMemoryProvider(profile, provider.name, typed()); setResults(r.results ?? []); toast(r.ok ? `${name} is installed` : `${name} didn’t finish installing`); await cfg.reload(true) } catch (e) { setErr(errText(e)) } finally { setInstalling(false) }
  }
  const save = async () => {
    setSaving(true); setErr(undefined)
    try { await saveMemoryProviderConfig(profile, provider.name, typed()); toast(`Memory now uses ${name}`); onDone() } catch (e) { setErr(errText(e)) } finally { setSaving(false) }
  }
  const copy = (t: string) => void navigator.clipboard?.writeText(t).then(() => toast('Copied'), () => toast('Couldn’t copy'))
  const st = MEMORY_STATUS[provider.status]

  return (
    <Dialog open onClose={() => { if (!saving && !installing) onClose() }} wide title={<span className="cap-dh"><span className="nm">Set up {name}</span>{st ? <Badge tone={st.tone}>{st.label}</Badge> : null}</span>}
      footer={<>{cfg.data?.docs_url ? <button className="cap-link" onClick={() => void window.hermesNative.openExternal(cfg.data!.docs_url!)}>How it works<Icon name="external" size={12} /></button> : null}<span className="sp" />
        <button className="b-text" onClick={onClose} disabled={saving || installing}>Cancel</button>
        <button className="b-pri" onClick={() => void save()} disabled={saving || installing || cfg.loading || missing.length > 0} title={missing.length ? `Fill in ${missing.map((f) => f.label).join(', ')}` : undefined}>{saving ? 'Saving…' : `Save and use for ${bot}`}</button></>}>
      {provider.description ? <p className="cap-desc">{provider.description}</p> : null}
      {err ? <ErrorLine text={err} /> : null}
      {cfg.loading && !cfg.data ? <div className="cap-row cap-dim" style={{ padding: '14px 0' }}><Spinner />Reading its settings…</div> : null}
      {cfg.error && !cfg.data ? <ErrorLine text={`Couldn’t read its settings: ${cfg.error}`} onRetry={() => void cfg.reload()} /> : null}

      {needsInstall || setup?.external_dependencies?.length ? (
        <>
          <div className="cap-h3">What it needs on this Mac<span className="sp" /><button className={needsInstall ? 'b-soft' : 'b-text'} onClick={() => void install()} disabled={installing || saving}><span className="cap-row">{installing ? <Spinner size={12} /> : <Icon name="download" size={14} />}{installing ? 'Installing…' : needsInstall ? 'Install it' : 'Install again'}</span></button></div>
          {setup?.pip_dependencies?.length ? <Note>Python packages: {setup.pip_dependencies.map((p) => <code key={p} style={{ marginRight: 6 }}>{p}</code>)}</Note> : null}
          {(setup?.external_dependencies ?? []).map((d) => (
            <Note key={d.name} tone={needsInstall ? 'need' : undefined}>
              <b>{d.name}</b>{d.install ? <> · installs with <span className="cap-row" style={{ marginTop: 6 }}><code>{d.install}</code><button className="b-text" onClick={() => copy(d.install!)}><span className="cap-row"><Icon name="copy" size={13} />Copy</span></button></span></> : null}
            </Note>
          ))}
          {results ? <LogBox lines={results.map((r) => `${r.status === 'failed' ? '✗' : '✓'} ${r.kind ?? ''} ${r.name ?? ''}: ${r.status.replace(/_/g, ' ')}${r.error ? ` (${r.error})` : ''}`)} /> : null}
        </>
      ) : null}

      {fields.length ? (
        <>
          <div className="cap-h3">Settings</div>
          <div className="card">
            {fields.filter((f) => shows(f, values)).map((f) => {
              const spec: FieldSpec = { key: f.key, label: f.label || f.key, kind: f.kind, description: f.description, placeholder: f.placeholder, required: f.required, options: optionsOf(f), isSet: f.is_set, url: f.url || undefined }
              return <FieldRow key={f.key} field={spec} value={values[f.key] ?? ''} disabled={saving} onChange={(v) => setValues((cur) => ({ ...cur, [f.key]: v }))} />
            })}
          </div>
        </>
      ) : cfg.data ? <Note>{name} has no settings to fill in.{setup?.required_env?.length ? <> It reads {setup.required_env.map((k) => <code key={k} style={{ marginLeft: 4 }}>{k}</code>)} from Keys and accounts.</> : null}</Note> : null}
      <div className="cap-dim" style={{ marginTop: 14 }}>Saving makes {name} the memory {bot} uses in new chats. Built-in notes stay either way.</div>
    </Dialog>
  )
}
