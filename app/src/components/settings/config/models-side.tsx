// Backups (fallback_providers: models tried in order when the main one fails) and helpers (the
// auxiliary models behind titles, compression, vision and other side jobs), for one profile.
import { useEffect, useMemo, useState } from 'react'
import { prettyModel } from '../../../lib/api'
import { assignAux, auxiliary, configValues, saveField, type AuxTask } from '../../../lib/api-config'
import { toast } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { Badge, confirm, Empty, ErrorLine, Select, useAsync } from '../../ui'
import { EFFORTS, EFFORT_WORDS, effortWord, findProvider, ModelPicker, providerName } from './models-picker'
import { SkeletonRows, useNameOf } from './models-shared'

// ---------- backups ----------

interface Backup extends Record<string, unknown> { provider: string; model: string }
function toBackups(v: unknown): Backup[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => {
    if (x && typeof x === 'object') return { ...(x as Record<string, unknown>), provider: String((x as any).provider ?? ''), model: String((x as any).model ?? '') }
    if (typeof x === 'string') { const i = x.indexOf('/'); return i > 0 ? { provider: x.slice(0, i), model: x.slice(i + 1) } : { provider: '', model: x } }
    return { provider: '', model: '' }
  })
}

export function BackupsTab({ profile }: { profile: string }) {
  const nameOf = useNameOf()
  const cfg = useAsync(() => configValues(profile), [profile])
  const [rows, setRows] = useState<Backup[] | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (cfg.data) setRows(toBackups(cfg.data.fallback_providers)) }, [cfg.data])

  /** Saves the complete entries (a half-picked row stays on screen only); extra keys ride along untouched. */
  const commit = async (next: Backup[], before: Backup[], what: string) => {
    setRows(next)
    const complete = next.filter((r) => r.provider && r.model)
    if (JSON.stringify(complete) === JSON.stringify(before.filter((r) => r.provider && r.model))) return
    setSaving(true)
    try { await saveField(profile, 'fallback_providers', complete); toast(what) } catch (e: any) { setRows(before); toast(`Couldn’t save the backups: ${e?.message ?? e}`) } finally { setSaving(false) }
  }
  const move = (i: number, d: -1 | 1) => {
    if (!rows) return
    const j = i + d
    if (j < 0 || j >= rows.length) return
    const next = [...rows]; [next[i], next[j]] = [next[j], next[i]]
    void commit(next, rows, 'Order saved.')
  }
  const remove = async (i: number) => {
    if (!rows) return
    const r = rows[i]
    if (r.model && !(await confirm({ title: `Remove ${prettyModel(r.model)} from the backups?`, body: 'Hermes stops trying it when the main model fails.', action: 'Remove', danger: true }))) return
    void commit(rows.filter((_, k) => k !== i), rows, 'Backup removed.')
  }

  return (
    <>
      <p className="x-note">When {nameOf(profile)}’s main model fails or is overloaded, Hermes tries these in order, top first. Leave it empty to just report the failure.</p>
      {cfg.error ? <ErrorLine text={`Couldn’t read the backups: ${cfg.error}`} onRetry={() => void cfg.reload()} /> : null}
      {!rows ? (cfg.loading ? <SkeletonRows n={2} /> : null) : (
        <div className="card">
          {!rows.length ? <Empty title="No backups yet" body="Add one so a busy or failing provider doesn’t stop the work." face={false} /> : null}
          <div className="flow">
            {rows.map((r, i) => (
              <div key={i} className="md-slot">
                <span className="n">{i + 1}</span>
                <ModelPicker profile={profile} provider={r.provider} model={r.model} align="start" disabled={saving}
                  onPick={(p, m) => void commit(rows.map((x, k) => (k === i ? { ...x, provider: p, model: m } : x)), rows, `${prettyModel(m)} is backup ${i + 1}.`)} />
                <span className="act">
                  <button className="x-icon-btn" aria-label="Move up" disabled={i === 0 || saving} onClick={() => move(i, -1)}><Icon name="chevD" size={14} style={{ transform: 'rotate(180deg)' }} /></button>
                  <button className="x-icon-btn" aria-label="Move down" disabled={i === rows.length - 1 || saving} onClick={() => move(i, 1)}><Icon name="chevD" size={14} /></button>
                  <button className="x-icon-btn danger" aria-label="Remove" disabled={saving} onClick={() => void remove(i)}><Icon name="trash" size={14} /></button>
                </span>
              </div>
            ))}
          </div>
          <div className="md-add">
            <button className="b-text x-btn-sm" disabled={saving} onClick={() => setRows([...rows, { provider: '', model: '' }])}><Icon name="plus" size={14} /> Add a backup</button>
            <span className="sp" style={{ flex: 1 }} />
            {saving ? <span className="x-state">Saving…</span> : null}
          </div>
        </div>
      )}
    </>
  )
}

// ---------- helpers ----------

const TASKS: Record<string, { label: string; hint: string }> = {
  vision: { label: 'Looking at images', hint: 'Describes pictures for models that can’t see' },
  compression: { label: 'Shortening long chats', hint: 'Summarises old messages near the context limit' },
  approval: { label: 'Smart approvals', hint: 'Decides which commands are safe to run' },
  mcp: { label: 'Connector tools', hint: 'Picks the right tool from connected servers' },
  title_generation: { label: 'Chat titles', hint: 'Names each conversation' },
  review: { label: 'Reviews', hint: 'The reviewer behind /review' },
  voice_chat: { label: 'Voice replies', hint: 'Spoken answers in voice mode' },
  triage_specifier: { label: 'Kanban triage', hint: 'Fleshes out new cards' },
  kanban_decomposer: { label: 'Kanban planning', hint: 'Splits work into steps' },
  profile_describer: { label: 'Agent descriptions', hint: 'Writes each agent’s one-line description' },
  curator: { label: 'Skills curator', hint: 'Reviews how skills get used' },
}

const isAuto = (t?: AuxTask) => !t || !t.provider || t.provider === 'auto'

export function HelpersTab({ profile }: { profile: string }) {
  const nameOf = useNameOf()
  const aux = useAsync(() => auxiliary(profile), [profile])
  const [busy, setBusy] = useState<string | null>(null)
  const main = aux.data?.main
  const tasks = aux.data?.tasks ?? []
  const labelOf = (key: string) => TASKS[key]?.label ?? tasks.find((t) => t.task === key)?.label ?? key.replace(/_/g, ' ')

  // Pinned to a provider other than the main one, and not a free local server: it keeps billing that provider.
  const stale = useMemo(() => {
    const m = (main?.provider ?? '').toLowerCase()
    if (!m) return []
    return tasks.filter((t) => { const p = (t.provider ?? '').toLowerCase(); return p && p !== 'auto' && p !== 'main' && p !== m && !t.local_endpoint })
  }, [tasks, main])

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    try { await fn(); toast(ok); await aux.reload(true) } catch (e: any) { toast(`Couldn’t change it: ${e?.message ?? e}`) } finally { setBusy(null) }
  }
  const endpoint = (p: string) => { const u = findProvider(profile, p)?.api_url; return u ? { base_url: u } : {} }
  const resetAll = async () => {
    if (!main) return
    if (!(await confirm({ title: 'Point every helper at the main model?', body: `All ${tasks.length} helper jobs go back to following ${prettyModel(main.model)}. Your own choices for them are cleared.`, action: 'Reset all' }))) return
    void run('__all', () => assignAux(profile, '__reset__', { provider: main.provider, model: main.model }), 'Every helper follows the main model.')
  }

  return (
    <>
      <p className="x-note">Small side jobs, like naming chats or shortening long ones, can run on a cheaper model. “Automatic” follows {nameOf(profile)}’s main model{main?.model ? <> (<b>{prettyModel(main.model)}</b>)</> : null}.</p>
      {aux.error ? <ErrorLine text={`Couldn’t read the helpers: ${aux.error}`} onRetry={() => void aux.reload()} /> : null}
      {stale.length ? (
        <div className="x-warn">
          <Icon name="alert" size={15} />
          <span>{stale.map((t) => labelOf(t.task)).join(', ')} {stale.length === 1 ? 'is' : 'are'} pinned to {[...new Set(stale.map((t) => providerName(t.provider)))].join(', ')}, not the main provider. {stale.length === 1 ? 'It keeps' : 'They keep'} billing there.</span>
          <button className="b-text x-btn-sm" disabled={!!busy} onClick={() => void resetAll()}>Reset all to main</button>
        </div>
      ) : null}
      {aux.loading && !aux.data ? <SkeletonRows n={6} /> : null}
      {aux.data ? (
        <>
          <div className="ssec"><h2>Helper jobs</h2><span>{tasks.length}</span><span className="sp" />
            <button className="b-text x-btn-sm" disabled={!main?.model || !!busy} onClick={() => void resetAll()}>{busy === '__all' ? 'Resetting…' : 'Reset all to main'}</button>
          </div>
          <div className="card flow">
            {tasks.map((t) => {
              const copy = TASKS[t.task] ?? { label: t.label || t.task, hint: t.hint || (t.plugin ? `Added by ${t.plugin}` : '') }
              const auto = isAuto(t)
              const eff = t.effective
              const summary = auto
                ? t.inherit_from ? `Follows ${labelOf(t.inherit_from)}${eff?.model ? ` · ${prettyModel(eff.model)}` : ''}` : 'Automatic: follows the main model'
                : `${prettyModel(t.model) || 'Any model'} · ${providerName(t.provider)}${t.local_endpoint ? ' · on your network' : ''}`
              return (
                <div key={t.task} className="srow ctlrow" style={{ alignItems: 'center' }}>
                  <div className="tx">
                    <div className="t1"><span>{copy.label}</span>{t.plugin ? <Badge tone="quiet">{t.plugin}</Badge> : null}</div>
                    <div className="t2">{copy.hint ? `${copy.hint}. ` : ''}{summary}{t.reasoning_effort ? ` · thinking ${effortWord(t.reasoning_effort).toLowerCase()}` : ''}</div>
                  </div>
                  <div className="md-ctl" style={{ width: 'min(380px, 50%)' }}>
                    <Select width={200} align="end" value={t.reasoning_effort ?? '__inherit'} disabled={!!busy || auto}
                      options={[{ value: '__inherit', label: 'Usual thinking', hint: 'Same as main' }, ...EFFORTS.map((e) => ({ value: e, label: `Thinking: ${EFFORT_WORDS[e]}` }))]}
                      render={(o) => <span className="sv">{o?.value === '__inherit' || !o ? 'Thinking' : EFFORT_WORDS[o.value]}</span>}
                      onChange={(v) => void run(t.task, () => assignAux(profile, t.task, { provider: t.provider, model: t.model, ...(t.base_url ? { base_url: t.base_url } : {}), reasoning_effort: v === '__inherit' ? null : v }), `${copy.label}: thinking saved.`)} />
                    <ModelPicker profile={profile} provider={auto ? null : t.provider} model={auto ? null : t.model} busy={busy === t.task} disabled={!!busy && busy !== t.task}
                      extras={[
                        { key: 'auto', label: t.inherit_from ? `Follow ${labelOf(t.inherit_from)}` : 'Automatic', hint: t.inherit_from ? undefined : 'Follows the main model', active: auto,
                          onPick: () => { if (!auto) void run(t.task, () => assignAux(profile, t.task, { provider: 'auto', model: '', reasoning_effort: null }), `${copy.label} follows ${t.inherit_from ? labelOf(t.inherit_from) : 'the main model'}.`) } },
                        ...(main?.model && !(t.provider === main.provider && t.model === main.model) ? [{ key: 'main', label: 'Same as main, pinned', hint: prettyModel(main.model),
                          onPick: () => void run(t.task, () => assignAux(profile, t.task, { provider: main.provider, model: main.model, ...endpoint(main.provider) }), `${copy.label} uses ${prettyModel(main.model)}.`) }] : []),
                      ]}
                      onPick={(p, m) => void run(t.task, () => assignAux(profile, t.task, { provider: p, model: m, ...endpoint(p) }), `${copy.label} uses ${prettyModel(m)}.`)} />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : null}
    </>
  )
}
