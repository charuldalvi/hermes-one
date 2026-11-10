// A plugin opened from Settings › Plugins: what it is and where it came from, the tools it adds, its
// settings (the manifest's config_schema), sign-in, update and remove. Updates walk Hermes' two
// questions the way Hermes Desktop does: a new version that asks for more, and a caution scan.
import { useMemo, useState } from 'react'
import type { InstalledPlugin } from '../../lib/api'
import { removePluginNamed, savePluginSettings, updatePluginTo, type ManagedPlugin, type PluginSetting } from '../../lib/api-capabilities'
import { toast } from '../../lib/hermes'
import { Icon } from '../../lib/icons'
import { Badge, confirm, Dialog, ErrorLine, Switch } from '../ui'
import { Chips, errText, FieldRow, Note, type FieldSpec } from './cap-parts'

export interface PluginRow { id: string; ref: string; name: string; hub: InstalledPlugin; m?: ManagedPlugin; on: boolean; bundled: boolean }

const TIER: Record<string, string> = { official: 'Official', verified: 'Verified', community: 'Community' }
export const sourceLabel = (r: PluginRow) =>
  r.bundled ? 'Comes with Hermes' : r.m?.catalog_tier ? `${TIER[r.m.catalog_tier] ?? r.m.catalog_tier} · from the catalog` : r.hub.source === 'git' ? 'Added from Git' : r.hub.source === 'entrypoint' ? 'Installed with pip' : 'Added by you'
export const updatable = (r: PluginRow) => !!(r.m?.update_available || r.hub.can_update_git)
const shortSha = (t?: string | null) => (t && /^[0-9a-f]{40}$/i.test(t) ? t.slice(0, 8) : t ?? '')
export const updateLabel = (r: PluginRow) => {
  const to = r.m?.catalog_version || shortSha(r.m?.catalog_sha) || shortSha(r.m?.update_target)
  return r.m?.update_available && to ? `Update to ${to}` : 'Update'
}
export const failed = (r: PluginRow) => /error|fail/i.test(r.hub.runtime_status ?? '')

/** Update one plugin, asking before anything Hermes wants you to agree to. Resolves when it's done. */
export async function runPluginUpdate(profile: string, r: PluginRow): Promise<'applied' | 'unchanged' | 'cancelled'> {
  const opts: { accept?: boolean; force?: boolean } = {}
  for (;;) {
    const a = await updatePluginTo(profile, r.ref, opts)
    if (a?.consent_required && !opts.accept) {
      const ok = await confirm({
        title: `Update ${r.name}?`, action: 'Update',
        body: <><div>The new version{a.sha ? ` (${a.sha.slice(0, 8)})` : ''} asks for more than the one you have:</div><ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{(a.delta_lines ?? []).map((l) => <li key={l}>{l}</li>)}</ul></>,
      })
      if (!ok) return 'cancelled'
      opts.accept = true; continue
    }
    if (a?.scan_blocked) {
      const findings = [...(a.scan_findings ?? [])].sort((x, y) => rank(x.severity) - rank(y.severity))
      if (a.scan_verdict === 'caution' && !opts.force) {
        const ok = await confirm({
          title: `Hermes’ safety check flagged ${r.name}’s update`, action: 'Update anyway', danger: true,
          body: <><div>{findings.length} thing{findings.length === 1 ? '' : 's'} in the new code look risky. Nothing has changed yet.</div>
            <pre className="cap-log">{findings.slice(0, 8).map((f) => `${f.severity.toUpperCase()}  ${f.file}:${f.line}  ${f.description || f.category}`).join('\n')}{findings.length > 8 ? `\n…and ${findings.length - 8} more` : ''}</pre></>,
        })
        if (!ok) return 'cancelled'
        opts.force = true; continue
      }
      throw new Error('Hermes’ safety check found dangerous code in the update, so it wasn’t installed.')
    }
    return a?.unchanged ? 'unchanged' : 'applied'
  }
}
const rank = (s: string) => { const i = ['critical', 'high', 'medium', 'low'].indexOf(s); return i < 0 ? 9 : i }

// ---------- settings form (a manifest's config_schema) ----------

const initial = (f: PluginSetting) =>
  f.type === 'boolean' ? (f.value === true ? 'true' : 'false')
    : f.type === 'secret' ? ''
    : f.type === 'json' ? (f.value == null ? '' : JSON.stringify(f.value, null, 2))
    : f.type === 'enum' ? String(f.value ?? f.choices?.[0] ?? '')
    : f.value == null ? '' : String(f.value)
const spec = (f: PluginSetting): FieldSpec => ({
  key: f.key, label: f.label || f.key, description: f.description, required: f.required, env: f.type === 'secret' ? f.env : undefined, isSet: f.has_value,
  kind: f.type === 'boolean' ? 'bool' : f.type === 'enum' ? 'select' : f.type === 'secret' ? 'secret' : f.type === 'json' ? 'json' : f.type === 'number' ? 'number' : 'text',
  options: f.choices?.map((c) => ({ value: c, label: c })),
})
function coerce(f: PluginSetting, raw: string): unknown {
  if (f.type === 'boolean') return raw === 'true'
  if (f.type === 'number') { const n = Number(raw); if (raw.trim() === '' || Number.isNaN(n)) throw new Error(`${f.label}: needs a number`); return n }
  if (f.type === 'json') { const v = JSON.parse(raw || 'null'); if (v === null || typeof v !== 'object') throw new Error(`${f.label}: needs a JSON list or object`); return v }
  if (f.type === 'enum' && f.choices?.length && !f.choices.includes(raw)) throw new Error(`${f.label}: pick one of ${f.choices.join(', ')}`)
  return raw
}

function SettingsForm({ profile, plugin, onSaved }: { profile: string; plugin: ManagedPlugin; onSaved: () => void }) {
  const fields = plugin.settings_schema ?? []
  const seed = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, initial(f)])), [fields])
  const [draft, setDraft] = useState<Record<string, string>>(seed)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string>()
  const dirty = fields.some((f) => (draft[f.key] ?? '') !== seed[f.key])
  const save = async () => {
    setErr(undefined)
    const values: Record<string, unknown> = {}, secrets: Record<string, string> = {}
    try {
      for (const f of fields) {
        const raw = draft[f.key] ?? ''
        if (f.type === 'secret') { if (raw && f.env) secrets[f.env] = raw; continue }
        if (raw !== seed[f.key]) values[f.key] = coerce(f, raw)
      }
    } catch (e) { setErr(errText(e)); return }
    setSaving(true)
    try {
      await savePluginSettings(profile, plugin.key ?? plugin.name, values, secrets)
      setDraft((d) => Object.fromEntries(fields.map((f) => [f.key, f.type === 'secret' ? '' : d[f.key] ?? ''])))
      toast(`Saved ${plugin.name}’s settings`); onSaved()
    } catch (e) { setErr(errText(e)) } finally { setSaving(false) }
  }
  return (
    <>
      <div className="cap-h3">Settings<span className="sp" />{dirty ? <button className="b-text" onClick={() => setDraft(seed)} disabled={saving}>Undo</button> : null}<button className="b-soft" onClick={() => void save()} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save settings'}</button></div>
      {err ? <ErrorLine text={err} /> : null}
      <div className="card">{fields.map((f) => <FieldRow key={f.key} field={spec(f)} value={draft[f.key] ?? ''} disabled={saving || !plugin.key} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />)}</div>
    </>
  )
}

// ---------- the dialog ----------

export function PluginDialog({ profile, row, bot, managedOk, onClose, onToggle, onChanged, onRemoved }: {
  profile: string; row: PluginRow; bot: string; managedOk: boolean; onClose: () => void; onToggle: (on: boolean) => void; onChanged: () => void; onRemoved: () => void
}) {
  const [busy, setBusy] = useState<'update' | 'remove' | null>(null)
  const { hub, m } = row
  const tools = m?.tools ?? []
  const servers = m?.servers ?? []

  const update = async () => {
    setBusy('update')
    try {
      const out = await runPluginUpdate(profile, row)
      if (out === 'applied') { toast(`Updated ${row.name}`); onChanged() } else if (out === 'unchanged') toast(`${row.name} is already up to date`)
    } catch (e) { toast(`Couldn’t update ${row.name}: ${errText(e)}`) } finally { setBusy(null) }
  }
  const remove = async () => {
    if (!(await confirm({ title: `Remove ${row.name}?`, body: `Its files are deleted from this Mac and ${bot} stops using it. You can add it again from the Marketplace.`, action: 'Remove', danger: true }))) return
    setBusy('remove')
    try { await removePluginNamed(profile, row.ref); toast(`Removed ${row.name}`); onRemoved() } catch (e) { toast(`Couldn’t remove ${row.name}: ${errText(e)}`); setBusy(null) }
  }
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Couldn’t copy')) }

  return (
    <Dialog open onClose={onClose} wide
      title={<span className="cap-dh"><span className="nm">{row.name}</span>{hub.version ? <Badge tone="quiet">v{hub.version}</Badge> : null}</span>}
      footer={<>
        {hub.can_remove ? <button className="b-ghost-danger" onClick={() => void remove()} disabled={!!busy}>{busy === 'remove' ? 'Removing…' : 'Remove'}</button> : null}
        <span className="sp" />
        <button className="b-text" onClick={onClose}>Close</button>
        {updatable(row) ? <button className="b-soft" onClick={() => void update()} disabled={!!busy}>{busy === 'update' ? 'Updating…' : updateLabel(row)}</button> : null}
      </>}>
      <div className="cap-meta">
        <span>{sourceLabel(row)}</span>
        {tools.length ? <span>{tools.length} tool{tools.length === 1 ? '' : 's'}</span> : null}
        <span style={{ marginLeft: 'auto' }} className="cap-row"><span className="cap-dim">{row.on ? 'On' : 'Off'}</span><Switch on={row.on} onChange={onToggle} label={`${row.name} on`} /></span>
      </div>
      {hub.description ? <p className="cap-desc" style={{ whiteSpace: 'pre-wrap' }}>{hub.description.trim()}</p> : null}

      {failed(row) ? <Note tone="bad">This plugin didn’t load. Hermes’ logs (Settings › System) say why.</Note> : null}
      {hub.auth_required ? (
        <Note tone="need">
          {row.name} needs you to sign in. Run this in Terminal on this Mac{hub.auth_command ? ':' : '.'}
          {hub.auth_command ? <span className="cap-row" style={{ marginTop: 6 }}><code>{hub.auth_command}</code><button className="b-text" onClick={() => copy(hub.auth_command!)}><span className="cap-row"><Icon name="copy" size={13} />Copy</span></button></span> : null}
        </Note>
      ) : null}
      {m?.update_available ? <Note tone="need">A newer version is ready{m.catalog_version ? `: ${m.catalog_version}` : ''}.</Note> : null}
      {m?.has_desktop_half ? <Note>It also has a part made for Hermes Desktop’s window. Hermes One uses the part that works in chats.</Note> : null}
      {servers.map((s) => <Note key={s.name} tone={s.state === 'connected' ? undefined : 'need'}><b>{s.name}</b>: {s.sentence || s.state.replace(/_/g, ' ')}</Note>)}

      <div className="cap-h3">Tools it adds</div>
      {m ? <Chips items={tools} empty="No tools of its own. It changes how Hermes works instead." /> : <div className="cap-dim">{managedOk ? 'Hermes didn’t list this plugin’s tools.' : 'Couldn’t ask Hermes for its tools right now.'}</div>}

      {m?.settings_schema?.length ? <SettingsForm key={JSON.stringify(m.settings_schema)} profile={profile} plugin={m} onSaved={onChanged} /> : null}

      <div className="cap-h3">Details</div>
      <dl className="kv">
        <dt>Where it came from</dt><dd>{sourceLabel(row)}</dd>
        {m?.catalog_name ? <><dt>Catalog entry</dt><dd>{m.catalog_name}{m.installed_sha ? <span className="cap-dim"> · at {m.installed_sha.slice(0, 8)}</span> : null}</dd></> : null}
        {m?.pinned_sha && !m.catalog_name ? <><dt>Pinned to</dt><dd style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>{m.pinned_sha.slice(0, 8)}</dd></> : null}
        {m?.key && m.key !== row.name ? <><dt>Name in Hermes</dt><dd style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>{m.key}</dd></> : null}
        {hub.path ? <><dt>Folder</dt><dd><span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>{hub.path}</span> <button className="cap-link" onClick={() => void window.hermesNative.reveal(hub.path!)}>Show in Finder</button></dd></> : null}
      </dl>
    </Dialog>
  )
}
