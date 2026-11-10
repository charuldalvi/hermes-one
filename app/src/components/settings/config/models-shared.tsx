// Small pieces the Models tabs share: who a profile is, the main-model change with Hermes'
// "this one costs more" check, a number field that saves on its own, and the loading rows.
import { useEffect, useState } from 'react'
import { assignMain, type AssignResult } from '../../../lib/api-config'
import { setState, useStore } from '../../../lib/store'
import { confirm } from '../../ui'

/** "Chief" for the default profile, else the bot's name. */
export function useNameOf() {
  const bots = useStore((s) => s.bots)
  return (profile: string) => (profile === 'default' ? 'Hermes' : bots.find((b) => b.profile === profile)?.name ?? profile)
}

/**
 * Sets a profile's main model. When Hermes says the model costs more than most (or trains on your
 * data), it asks first and tries again with your OK. Null when you say no.
 */
export async function assignWithConfirm(profile: string, provider: string, model: string, baseUrl?: string): Promise<AssignResult | null> {
  const body = { provider, model, ...(baseUrl ? { base_url: baseUrl } : {}) }
  let r = await assignMain(profile, body)
  if (r?.confirm_required) {
    const ok = await confirm({ title: 'This model costs more than most', body: r.confirm_message || 'Hermes asks before switching to it.', action: 'Use it anyway' })
    if (!ok) return null
    r = await assignMain(profile, { ...body, confirm_expensive_model: true })
    if (r?.confirm_required || r?.ok === false) throw new Error(r?.confirm_message || 'Hermes didn’t save it.')
  } else if (r?.ok === false) throw new Error(r?.confirm_message || 'Hermes didn’t save it.')
  // The sidebar shows each bot's model; keep it in step.
  setState((s) => ({ bots: s.bots.map((b) => (b.profile === profile ? { ...b, model: r?.model || model } : b)) }))
  return r
}

/** A number box that saves when you leave it or press Enter. Empty means "not set". */
export function NumberSave({ value, onSave, placeholder, min, step, width = 110, disabled }: {
  value: number | null | undefined; onSave: (v: number | null) => Promise<unknown>; placeholder?: string; min?: number; step?: number; width?: number; disabled?: boolean
}) {
  const [v, setV] = useState(value == null ? '' : String(value))
  const [state, setStateV] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  useEffect(() => { setV(value == null ? '' : String(value)) }, [value])
  const commit = async () => {
    const t = v.trim()
    const n = t === '' ? null : Number(t)
    if (n !== null && !Number.isFinite(n)) { setStateV('error'); return }
    if (n === (value ?? null)) { setStateV('idle'); return }
    setStateV('saving')
    try { await onSave(n); setStateV('saved'); setTimeout(() => setStateV('idle'), 1500) } catch { setStateV('error'); setV(value == null ? '' : String(value)) }
  }
  return (
    <span className="x-row" style={{ flexWrap: 'nowrap' }}>
      <span className={`x-state ${state}`}>{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Not a number' : ''}</span>
      <input className="answer" style={{ width, height: 32, padding: '0 10px' }} inputMode="decimal" value={v} placeholder={placeholder} min={min} step={step} disabled={disabled}
        onChange={(e) => { setV(e.target.value); if (state === 'error') setStateV('idle') }} onBlur={() => void commit()}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value == null ? '' : String(value)); (e.target as HTMLInputElement).blur() } }} />
    </span>
  )
}

export function SkeletonRows({ n = 4 }: { n?: number }) {
  return <div className="card">{Array.from({ length: n }, (_, i) => <div key={i} className="x-skel" />)}</div>
}

/** "2 minutes" style wording for a number of seconds. */
export function duration(s?: number | null): string {
  if (s == null || !Number.isFinite(s) || s < 0) return ''
  if (s < 60) return `${Math.max(1, Math.round(s))} sec`
  if (s < 3600) return `${Math.round(s / 60)} min`
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60)
  return m ? `${h} h ${m} min` : `${h} h`
}
