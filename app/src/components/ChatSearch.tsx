// Search your chat with Chief (⌘F): every message that's loaded, newest first, with the words you typed
// marked. Picking one scrolls the chat to it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { prettyName } from '../lib/hermes'
import { Icon } from '../lib/icons'
import { chatOf, useStore } from '../lib/store'
import { Dialog, Search } from './ui'

function snippet(text: string, q: string): { before: string; hit: string; after: string } {
  const flat = text.replace(/\s+/g, ' ')
  const i = flat.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return { before: flat.slice(0, 140), hit: '', after: '' }
  const from = Math.max(0, i - 60)
  return { before: (from ? '…' : '') + flat.slice(from, i), hit: flat.slice(i, i + q.length), after: flat.slice(i + q.length, i + q.length + 90) + '…' }
}

export function ChatSearchButton() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setOpen(true) } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return (
    <>
      <button className="hbtn nodrag" title="Search this chat (⌘F)" onClick={() => setOpen(true)}><Icon name="search" /></button>
      <ChatSearch open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function ChatSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const msgs = useStore((s) => chatOf(s, s.chatWith).messages)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) { setQ(''); setSel(0) } }, [open])
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (t.length < 2) return []
    return msgs.filter((m) => (m.text || '').toLowerCase().includes(t)).reverse().slice(0, 80)
  }, [msgs, q])
  useEffect(() => { setSel(0) }, [q])
  const go = (i: number) => { const m = hits[i]; if (!m) return; onClose(); setTimeout(() => window.dispatchEvent(new CustomEvent('hermes:jump', { detail: m.id })), 60) }
  return (
    <Dialog open={open} onClose={onClose} width={620}>
      <div className="csearch" onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(hits.length - 1, sel + 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(0, sel - 1)) }
        else if (e.key === 'Enter') { e.preventDefault(); go(sel) }
      }}>
        <Search value={q} onChange={setQ} placeholder="Search your chat with Hermes" autoFocus />
        <div className="cs-results" ref={list}>
          {q.trim().length < 2 ? <p className="free">Type a word or two. Everything in this chat that’s loaded is searched.</p>
            : !hits.length ? <p className="free">Nothing matches “{q.trim()}”.</p>
            : hits.map((m, i) => {
              const sn = snippet(m.text, q.trim())
              const who = m.role === 'user' ? 'You' : m.role === 'command' ? m.command ?? 'Command' : m.from ? prettyName(m.from) : m.role === 'notice' ? 'Note' : 'Hermes'
              return (
                <button key={m.id} className={`cs-hit${i === sel ? ' on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(i)}>
                  <span className="cs-who">{who}<em>{m.at ? new Date(m.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</em></span>
                  <span className="cs-sn">{sn.before}<mark>{sn.hit}</mark>{sn.after}</span>
                </button>
              )
            })}
        </div>
      </div>
    </Dialog>
  )
}
