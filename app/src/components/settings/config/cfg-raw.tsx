// config.yaml as text (Hermes Remote's raw editor): edit, see exactly which lines change, then save.
// Keys, tokens and passwords in the file are never put on screen: each one is swapped for a marker
// like ‹hidden 3› before the text is shown, and swapped back when you save. Leave a marker as it is
// to keep that value; delete its line to remove it.
import { useEffect, useMemo, useState } from 'react'
import { isSecretKey, rawConfig, saveRawConfig } from '../../../lib/api-config'
import { toast } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { Dialog, ErrorLine, Spinner, useAsync } from '../../ui'

const NOT_SECRET = new Set(['record_key', 'docker_shared_container_key', 'sort_key', 'hotkey'])
function secretName(raw: string): boolean {
  const n = raw.trim().replace(/^["']|["']$/g, '')
  if (!n || NOT_SECRET.has(n)) return false
  return isSecretKey(n) || /^(key|authorization|proxy-authorization|cookie|x-api-key|api-key)$/i.test(n) || /_key$/i.test(n)
}
const emptyish = (v: string) => !v || /^(null|~|''|""|\[\]|\{\})$/.test(v) || /^["']?\$\{[^}]+\}["']?$/.test(v)
const TOKEN = (n: number) => `‹hidden ${n}›`
const LOOKS_LIKE_TOKEN = /\b(?:sk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|hf_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{16,})|(?<=Bearer\s)[A-Za-z0-9._~+/-]{16,}=*/g

/** The file with every secret value swapped for a numbered marker, and those values in order. */
export function maskYaml(text: string): { shown: string; secrets: string[] } {
  const lines = text.split('\n')
  const out: string[] = []
  const secrets: string[] = []
  const hide = (original: string) => { secrets.push(original); return TOKEN(secrets.length) }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // "--token=abc" style arguments in a list
    const arg = /^(\s*(?:#\s*)?-\s+["']?--?[A-Za-z0-9_-]*(?:key|token|secret|password)[A-Za-z0-9_-]*=)(.+)$/i.exec(line)
    if (arg && !emptyish(arg[2].trim())) { out.push(arg[1] + hide(arg[2])); continue }
    // "key: value", also inside a commented-out example ("#   key: value")
    const m = /^(\s*(?:#\s*)?(?:-\s+)?)("[^"]*"|'[^']*'|[^\s:#'"{\[][^:#]*?)(\s*):(\s+|$)(.*)$/.exec(line)
    if (m && secretName(m[2])) {
      const val = m[5]
      const bare = val.replace(/\s+#.*$/, '').trim()
      if (!emptyish(bare)) {
        let original = val
        if (/^[|>][-+0-9]*$/.test(bare) && !m[1].includes('#')) {
          // a block scalar: its more-indented lines are the value
          const indent = (/^\s*/.exec(line)?.[0].length ?? 0) + (m[1].includes('-') ? m[1].length - (/^\s*/.exec(line)?.[0].length ?? 0) : 0)
          let j = i + 1
          while (j < lines.length && (lines[j].trim() === '' || (/^\s*/.exec(lines[j])?.[0].length ?? 0) > indent)) j++
          while (j > i + 1 && lines[j - 1].trim() === '') j--
          original = [val, ...lines.slice(i + 1, j)].join('\n')
          i = j - 1
        }
        out.push(`${m[1]}${m[2]}${m[3]}:${m[4] || ' '}${hide(original)}`)
        continue
      }
    }
    // secrets inside a one-line {flow: mapping}
    if (line.includes('{')) {
      out.push(line.replace(/([{,]\s*["']?([A-Za-z0-9_-]+)["']?\s*:\s*)([^,}\]#]+?)(\s*(?=[,}\]]))/g, (all, pre: string, name: string, v: string, post: string) =>
        secretName(name) && !emptyish(v.trim()) ? `${pre}${hide(v)}${post}` : all))
      continue
    }
    out.push(line)
  }
  // anything that looks like a well-known token, wherever it sits (a comment, a URL, an argument)
  const shown = out.join('\n').replace(LOOKS_LIKE_TOKEN, (t) => hide(t))
  return { shown, secrets }
}
export const unmaskYaml = (shown: string, secrets: string[]) => shown.replace(/‹hidden (\d+)›/g, (t, n) => secrets[Number(n) - 1] ?? t)

type DiffLine = { kind: ' ' | '+' | '-' | '…'; text: string }
/** Changed lines with two lines of context around each change. */
export function lineDiff(a: string[], b: string[]): DiffLine[] {
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let ea = a.length, eb = b.length
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb-- }
  const A = a.slice(s, ea), B = b.slice(s, eb), n = A.length, m = B.length
  const ops: DiffLine[] = []
  if (n * m > 4_000_000) { A.forEach((t) => ops.push({ kind: '-', text: t })); B.forEach((t) => ops.push({ kind: '+', text: t })) }
  else {
    const w = m + 1, dp = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    let i = 0, j = 0
    while (i < n && j < m) {
      if (A[i] === B[j]) { ops.push({ kind: ' ', text: A[i] }); i++; j++ }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) ops.push({ kind: '-', text: A[i++] })
      else ops.push({ kind: '+', text: B[j++] })
    }
    while (i < n) ops.push({ kind: '-', text: A[i++] })
    while (j < m) ops.push({ kind: '+', text: B[j++] })
  }
  const all: DiffLine[] = [...a.slice(0, s).map((t) => ({ kind: ' ' as const, text: t })), ...ops, ...a.slice(ea).map((t) => ({ kind: ' ' as const, text: t }))]
  const keep = all.map(() => false)
  all.forEach((l, i) => { if (l.kind !== ' ') for (let k = Math.max(0, i - 2); k <= Math.min(all.length - 1, i + 2); k++) keep[k] = true })
  const out: DiffLine[] = []
  all.forEach((l, i) => { if (keep[i]) out.push(l); else if (out.length && out[out.length - 1].kind !== '…' && keep.slice(i).includes(true)) out.push({ kind: '…', text: '' }) })
  return out
}

export function RawEditor({ profile, onSaved, onDirty }: { profile: string; onSaved: () => void; onDirty: (dirty: boolean) => void }) {
  const file = useAsync(() => rawConfig(profile), [profile])
  const masked = useMemo(() => (file.data ? maskYaml(file.data.yaml ?? '') : null), [file.data])
  const [text, setText] = useState('')
  const [review, setReview] = useState<DiffLine[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (masked) setText(masked.shown) }, [masked])
  const dirty = !!masked && text !== masked.shown
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  const added = review?.filter((l) => l.kind === '+').length ?? 0
  const removed = review?.filter((l) => l.kind === '-').length ?? 0

  const save = async () => {
    if (!masked) return
    setSaving(true); setErr('')
    try {
      await saveRawConfig(profile, unmaskYaml(text, masked.secrets))
      setReview(null)
      toast('Saved config.yaml')
      await file.reload(true)
      onSaved()
    } catch (e: any) { setErr(e?.message ?? String(e)) } finally { setSaving(false) }
  }

  if (file.error && !file.data) return <ErrorLine text={file.error} onRetry={() => void file.reload()} />
  if (!masked) return <div className="card"><div className="x-skel" /><div className="x-skel" /><div className="x-skel" /></div>
  return (
    <div className="cf-raw flow">
      <div className="x-info"><Icon name="lock" size={15} /><span>Keys, tokens and passwords show as <b className="x-mono">‹hidden N›</b> and never appear here. Leave a marker as it is to keep that value; delete its line to remove it.</span></div>
      <div className="cf-rawbar">
        <span className="x-mono cf-ellipsis" title={file.data?.path}>{file.data?.path || 'config.yaml'}</span>
        <span className="sp" />
        {dirty ? <span className="x-state">Not saved yet</span> : null}
        <button className="b-text x-btn-sm" disabled={!dirty} onClick={() => setText(masked.shown)}>Discard</button>
        <button className="b-pri x-btn-sm" disabled={!dirty} onClick={() => { setErr(''); setReview(lineDiff(masked.shown.split('\n'), text.split('\n'))) }}>Review and save</button>
      </div>
      <textarea className="answer mono cf-yaml" value={text} spellCheck={false} wrap="off"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault()
            const el = e.currentTarget, a = el.selectionStart, b = el.selectionEnd
            const next = text.slice(0, a) + '  ' + text.slice(b)
            setText(next)
            requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2 })
          }
        }} />
      <Dialog open={!!review} onClose={() => !saving && setReview(null)} wide title="Save config.yaml?"
        footer={<><span className="x-state">{added} {added === 1 ? 'line' : 'lines'} added, {removed} removed</span><span className="sp" /><button className="b-text" disabled={saving} onClick={() => setReview(null)}>Keep editing</button><button className="b-pri" disabled={saving || !review?.length} onClick={() => void save()}>{saving ? <Spinner /> : null}Save config.yaml</button></>}>
        {err ? <ErrorLine text={err} /> : null}
        <div className="x-note">Hermes replaces the whole file with this text. Settings it doesn't recognise are kept as written.</div>
        <div className="cf-diff">
          {review?.map((l, i) => <div key={i} className={`dl ${l.kind === '+' ? 'add' : l.kind === '-' ? 'del' : l.kind === '…' ? 'gap' : ''}`}><i>{l.kind === '…' ? '' : l.kind}</i><span>{l.kind === '…' ? '⋯' : l.text || ' '}</span></div>)}
          {review && !review.length ? <div className="x-quiet">No changes.</div> : null}
        </div>
      </Dialog>
    </div>
  )
}
