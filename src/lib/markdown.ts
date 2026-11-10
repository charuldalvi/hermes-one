// Reply text: Markdown rendered safely (marked + DOMPurify), with Hermes' own conventions handled:
// MEDIA:<path> tags and ::preview lines become file chips; internal notes are filtered elsewhere.
import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: false })

const MEDIA_RE = /^\s*MEDIA:\s*(\S.+)$/gm
const PREVIEW_RE = /^\s*::preview\{file=["']?([^"'}]+)["']?\}\s*$/gm

export function splitMedia(text: string): { body: string; files: string[] } {
  const files: string[] = []
  const body = text
    .replace(MEDIA_RE, (_m, p) => { files.push(p.trim()); return '' })
    .replace(PREVIEW_RE, (_m, p) => { files.push(p.trim()); return '' })
  return { body: body.trim(), files }
}

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] })
}

/** Hermes stores some of its own notes in the transcript; they are not chat (Hermes Remote's HermesText rules). */
export function isInternalNote(text: string): boolean {
  const t = text.trimStart()
  return /^\[(Runtime note|System note|System:|IMPORTANT: Background process|ASYNC DELEGATION)/.test(t)
    || t.startsWith('[SILENT]') || /^<(system|context)-/.test(t)
}

export function baseName(p: string) { return p.split(/[\\/]/).filter(Boolean).pop() ?? p }

export function timeAgo(ms?: number): string {
  if (!ms) return ''
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 45) return 'now'
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

export function elapsed(fromMs?: number): string {
  if (!fromMs) return ''
  const s = Math.max(0, Math.floor((Date.now() - fromMs) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}
