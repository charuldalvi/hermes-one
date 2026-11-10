// The chat in the middle: Chief's, or the agent you clicked (its own Bot Chat, where Chief's hand-offs
// show as "From Chief" cards). Your messages in the grey pill; replies as full-width text headed by the
// bead; the work folded into "Worked for…"; hand-offs as agent chips; answers from agents as results;
// anything waiting on you as a card at the end.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { prettyName, profileForHandle, runCommand, toast, toolLabel } from '../lib/hermes'
import { rest } from '../lib/api'
import { baseName, elapsed, renderMarkdown, splitMedia } from '../lib/markdown'
import { Icon } from '../lib/icons'
import { botMood, chatMood } from '../lib/moods'
import { chatOf, getState, useChat, usePaneProfile, useStore, type Bot, type ChatState, type Msg, type Need } from '../lib/store'
import { BotFace } from './BotFace'
import { NeedCard } from './NeedCard'
import { AppCard } from './apps/AppCard'
import { openPanel } from './Sidebar'

const PAGE = 60

function dur(m: Msg) {
  if (!m.startedAt || !m.endedAt) return ''
  const s = Math.max(1, Math.round((m.endedAt - m.startedAt) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}
function dayLabel(ms: number) {
  const d = new Date(ms), now = new Date()
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (same(d, now)) return 'Today'
  if (same(d, y)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}
const clock = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '')

const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return (
    <div className="md" onClick={(e) => {
      const a = (e.target as HTMLElement).closest('a')
      if (a?.href) { e.preventDefault(); void window.hermesNative.openExternal(a.href) }
    }}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {streaming ? <span className="caret" /> : null}
    </div>
  )
})

function Files({ files }: { files: string[] }) {
  if (!files.length) return null
  return <div className="resrow">{files.map((f) => (
    <button className="res click" key={f} title={`${f}\nClick to open · ⌥-click to show in Finder`} onClick={(e) => void (e.altKey ? window.hermesNative.reveal(f) : window.hermesNative.openPath?.(f))}>
      <Icon name={/\.(png|jpe?g|gif|webp|heic)$/i.test(f) ? 'image' : /\.(mp4|mov|webm)$/i.test(f) ? 'play' : 'file'} size={14} />{baseName(f)}
    </button>
  ))}</div>
}

/** Under a finished reply: copy it, or hear it in Hermes' voice (its own text-to-speech). */
let playing: { audio: HTMLAudioElement; url: string; id: string } | null = null
function TurnActions({ id, text, last }: { id: string; text: string; last?: boolean }) {
  const profile = usePaneProfile()
  const [copied, setCopied] = useState(false)
  const [voice, setVoice] = useState<'idle' | 'loading' | 'playing'>('idle')
  const speak = async () => {
    if (voice === 'playing' && playing?.id === id) { playing.audio.pause(); URL.revokeObjectURL(playing.url); playing = null; setVoice('idle'); return }
    if (playing) { playing.audio.pause(); URL.revokeObjectURL(playing.url); playing = null }
    setVoice('loading')
    try {
      const plain = text.replace(/```[\s\S]*?```/g, ' (code) ').replace(/[#*_`>|]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').slice(0, 4000)
      const r = await rest<any>('POST', '/api/audio/speak', { text: plain })
      const blob = await (await fetch(r.data_url)).blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      playing = { audio, url, id }
      audio.onended = () => { URL.revokeObjectURL(url); if (playing?.id === id) playing = null; setVoice('idle') }
      await audio.play()
      setVoice('playing')
    } catch (e: any) { toast(`Couldn’t read it aloud: ${e?.message ?? e}`); setVoice('idle') }
  }
  return (
    <div className="tacts">
      <button title="Copy" onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400) }}><Icon name={copied ? 'check' : 'copy'} size={14} /></button>
      <button title={voice === 'playing' ? 'Stop' : 'Read aloud'} onClick={() => void speak()}>{voice === 'loading' ? <span className="spin" style={{ width: 12, height: 12 }} /> : <Icon name={voice === 'playing' ? 'stop' : 'volume'} size={14} />}</button>
      {last ? <button title="Try again (a new answer to the same message)" onClick={() => void runCommand('/retry', profile)}><Icon name="refresh" size={14} /></button> : null}
    </div>
  )
}

function Turn({ m, bots, needs, live, step, last, profile, chat, name }: { m: Msg; bots: Bot[]; needs: Need[]; live: boolean; step?: string; last?: boolean; profile: string; chat: ChatState; name: string }) {
  const [open, setOpen] = useState(false)
  const pose = bots.find((b) => b.profile === profile)?.poseKey
  const { body, files } = useMemo(() => splitMedia(m.text || ''), [m.text])
  const tools = m.tools ?? []
  const handoffs = [...new Set((m.handoffs ?? []).map((h) => profileForHandle(h) ?? h))]
  const working = m.streaming && !body
  return (
    <div className="turn">
      <div className="who">
        <BotFace profile={profile} size={32} mood={m.streaming ? chatMood(profile, chat, 32, needs) : 'idle'} poseKey={profile === 'default' ? undefined : pose} watch={false} />{name}
        <span className="when">{clock(m.endedAt ?? m.at)}</span>
      </div>
      {tools.length ? (
        <>
          <button className="fold" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name="chevR" size={14} />{m.streaming ? (step ?? 'Working') : `Worked for ${dur(m) || 'a moment'}`}
            {m.streaming ? <span className="tm">{elapsed(m.startedAt)}</span> : null}
          </button>
          {open ? (
            <div className="steps">
              {tools.map((t) => <div className="stp" key={t.id}><span>{t.done ? '·' : '›'} {toolLabel(t)}</span></div>)}
            </div>
          ) : null}
        </>
      ) : null}
      {working ? (
        <div className="working">{tools.length ? null : <>{step ?? 'Thinking'}…<span className="tm">{elapsed(m.startedAt)}</span></>}</div>
      ) : body ? <Markdown text={body} streaming={m.streaming} /> : null}
      <Files files={files} />
      {tools.filter((t) => t.name === 'publish_app' && t.args?.id && !t.args?.check_only).map((t) => (
        <AppCard key={t.id} appId={String(t.args.id)} state={!t.done ? 'building' : t.error ? 'failed' : undefined} />
      ))}
      {!m.streaming && body ? <TurnActions id={m.id} text={body} last={last} /> : null}
      {handoffs.length ? (
        <>
          <div className="chiplab">{handoffs.some((h) => bots.find((b) => b.profile === h)?.status === 'working') ? 'Working' : 'Asked'}</div>
          <div className="chips">
            {handoffs.map((h) => {
              const b = bots.find((x) => x.profile === h)
              const waiting = needs.some((n) => !n.outcome && n.profile === h)
              return (
                <button key={h} className="chip" onClick={(e) => openPanel(h, e.currentTarget.querySelector('.face'))}>
                  <BotFace profile={h} size={26} mood={botMood(b, 26, needs)} poseKey={b?.poseKey} watch={false} />
                  {b?.name ?? prettyName(h)}{waiting ? <i className="dot need" /> : null}
                </button>
              )
            })}
          </div>
        </>
      ) : null}
      {live && !m.streaming ? null : null}
    </div>
  )
}

function Reply({ m, bots, needs }: { m: Msg; bots: Bot[]; needs: Need[] }) {
  const [more, setMore] = useState(false)
  const b = bots.find((x) => x.profile === m.from)
  const { body, files } = useMemo(() => splitMedia(m.text || ''), [m.text])
  const long = body.length > 420
  if (!m.from) return <div className={`notice${m.error ? ' err' : ''}`}>{m.text}</div>
  return (
    <div className="turn">
      <button className="who" style={{ alignSelf: 'flex-start' }} onClick={(e) => openPanel(m.from!, e.currentTarget.querySelector('.face'))}>
        <BotFace profile={m.from} size={32} mood={botMood(b, 32, needs)} poseKey={b?.poseKey} watch={false} />{b?.name ?? prettyName(m.from)}
        <span className="when">answered {clock(m.at)}</span>
      </button>
      <div style={long && !more ? { maxHeight: 132, overflow: 'hidden', WebkitMaskImage: 'linear-gradient(#000 60%, transparent)' } : undefined}>
        <Markdown text={body} />
      </div>
      {long ? <button className="fold" onClick={() => setMore(!more)}>{more ? 'Show less' : 'Show all'}</button> : null}
      <Files files={files} />
    </div>
  )
}

/** Work handed to this agent by Chief (or another agent): a quiet card instead of your grey pill. */
function FromCard({ m, bots }: { m: Msg; bots: Bot[] }) {
  const [more, setMore] = useState(false)
  const b = bots.find((x) => x.profile === m.from)
  const who = m.from === 'default' ? 'Hermes' : b?.name ?? prettyName(m.from ?? '', undefined)
  const long = m.text.length > 360
  return (
    <div className="fromcard">
      <div className="fh"><BotFace profile={m.from ?? 'default'} size={18} watch={false} poseKey={b?.poseKey} />From {who}<span className="when">{clock(m.at)}</span></div>
      <div className={`fb${long && !more ? ' clip' : ''}`}><Markdown text={m.text} /></div>
      {long ? <button className="fold" onClick={() => setMore(!more)}>{more ? 'Show less' : 'Show all'}</button> : null}
    </div>
  )
}

/** A slash command and what Hermes answered, in a quiet card (Hermes Remote's command card). */
function CommandCard({ m }: { m: Msg }) {
  // Command output keeps Hermes' own line breaks (outside code blocks).
  const html = useMemo(() => renderMarkdown((m.text || '').split(/(```[\s\S]*?```)/).map((part) => (part.startsWith('```') ? part : part.replace(/([^\n|])\n(?!\n|\|)/g, '$1  \n'))).join('')), [m.text])
  return (
    <div className={`cmdcard${m.error ? ' err' : ''}`}>
      {m.command?.startsWith('/')
        ? <div className="cmdh"><Icon name="terminal" size={14} /><code>{m.command}</code>{m.pending ? <span className="spin" style={{ width: 12, height: 12 }} /> : null}</div>
        : <div className="cmdh"><Icon name="users" size={14} /><span className="cmdt">{m.command}</span>{m.pending ? <span className="spin" style={{ width: 12, height: 12 }} /> : null}</div>}
      {m.text ? <div className="md cmdout" dangerouslySetInnerHTML={{ __html: html }} onClick={(e) => { const a = (e.target as HTMLElement).closest('a'); if (a?.href) { e.preventDefault(); void window.hermesNative.openExternal(a.href) } }} /> : null}
    </div>
  )
}

export function Chat() {
  const { profile, chat: chief } = useChat()
  const isChiefChat = profile === 'default'
  const bots = useStore((s) => s.bots)
  const bot = bots.find((b) => b.profile === profile)
  const name = isChiefChat ? 'Hermes' : bot?.name ?? prettyName(profile)
  const needs = useStore((s) => s.needs)
  useStore((s) => s.tick)
  const [shown, setShown] = useState(PAGE)
  const scroller = useRef<HTMLDivElement>(null)
  // A classic scrollbar (a mouse, or "always show") takes width from the messages' box, so the message column
  // centres a few px left of the composer. Its width goes to the chat as --sbw, and the composer keeps the same
  // room on its right (app.css), so their edges line up. Overlay scrollbars measure 0.
  useEffect(() => {
    const el = scroller.current
    const chat = el?.parentElement
    if (!el || !chat) return
    const measure = () => chat.style.setProperty('--sbw', `${Math.max(0, el.offsetWidth - el.clientWidth)}px`)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    measure()
    return () => { ro.disconnect(); chat.style.removeProperty('--sbw') }
  }, [chief.loading])
  const stick = useRef(true)
  const msgs = chief.messages
  const start = Math.max(0, msgs.length - shown)
  const visible = msgs.slice(start)
  const liveNeeds = useMemo(() => needs, [needs])
  const lastId = msgs[msgs.length - 1]?.id
  const lastText = msgs[msgs.length - 1]?.text

  useLayoutEffect(() => {
    const sc = scroller.current
    if (sc && stick.current) sc.scrollTop = sc.scrollHeight
  }, [lastId, lastText, liveNeeds.length, chief.loading])
  useEffect(() => { stick.current = true }, [lastId])
  // Narrowing the chat (the panel opening) makes it taller: stay pinned to the newest message.
  useEffect(() => {
    const sc = scroller.current
    if (!sc) return
    const ro = new ResizeObserver(() => { if (stick.current) sc.scrollTop = sc.scrollHeight })
    ro.observe(sc)
    if (sc.firstElementChild) ro.observe(sc.firstElementChild)
    return () => ro.disconnect()
  }, [chief.loading])

  // Search jumps here: show enough older messages, scroll to the one picked and flash it.
  useEffect(() => {
    const jump = (e: Event) => {
      const id = String((e as CustomEvent).detail)
      const all = chatOf(getState(), profile).messages
      const idx = all.findIndex((m) => m.id === id)
      if (idx < 0) return
      const need = all.length - idx
      if (need > shown) setShown(need + 10)
      stick.current = false
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = scroller.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(id)}"]`)
        if (!el) return
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        const target = el.nextElementSibling as HTMLElement | null
        target?.classList.remove('flash'); void target?.offsetWidth; target?.classList.add('flash')
      }))
    }
    window.addEventListener('hermes:jump', jump)
    return () => window.removeEventListener('hermes:jump', jump)
  }, [shown, profile])

  if (chief.loading) return <div className="cscroll" ref={scroller}><div className="ccol" /></div>

  let prevDay = ''
  const lastAssistantId = [...msgs].reverse().find((x) => x.role === 'assistant')?.id
  const lastUserId = [...msgs].reverse().find((x) => x.role === 'user')?.id
  return (
    <div className="cscroll" ref={scroller} onScroll={(e) => {
      const sc = e.currentTarget
      stick.current = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80
    }}>
      <div className="ccol">
        {start > 0 ? <button className="older" onClick={() => setShown(shown + PAGE)}>Show earlier messages</button> : null}
        {!msgs.length ? (
          isChiefChat ? (
            <div className="center" style={{ minHeight: 360 }}><div className="box">
              <BotFace profile="default" size={160} mood="idle" disc={false} />
              <h2>Hi, I’m Hermes.</h2>
              <p>Everything you ask goes to me. I hand work to the rest of the agents and bring the results back here.</p>
            </div></div>
          ) : (
            <div className="center" style={{ minHeight: 360 }}><div className="box">
              <BotFace profile={profile} size={160} mood="idle" disc={false} />
              <h2>Hi, I’m {name}.</h2>
              <p>{bot?.role ? `${bot.role.replace(/\.?\s*$/, '')}. ` : ''}Ask me anything here.</p>
              <p className="hint2">My jobs from the Board are under Latest work: the panel button at the top right.</p>
            </div></div>
          )
        ) : null}
        {visible.map((m) => {
          const day = m.at ? dayLabel(m.at) : ''
          const showDay = day && day !== prevDay
          if (day) prevDay = day
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {showDay ? <div className="day">{day}</div> : null}
              <span className="anchor" data-mid={m.id} />
              {m.role === 'user' && m.from && !isChiefChat ? <FromCard m={m} bots={bots} />
                : m.role === 'user' ? <div className={`you${m.id === lastUserId && !chief.busy ? ' last' : ''}`}>{m.id === lastUserId && !chief.busy ? <button className="youedit" title="Edit and send again" onClick={() => { void runCommand('/undo', profile); window.dispatchEvent(new CustomEvent('hermes:prefill', { detail: m.text })) }}><Icon name="edit" size={13} /></button> : null}{m.images?.length ? <div className="imgs">{m.images.map((n, i) => <span className="res" key={n + i}><Icon name={/\.(png|jpe?g|gif|webp|heic)$/i.test(n) || n === 'Picture' ? 'image' : 'file'} size={14} />{n}</span>)}</div> : null}{m.text}</div>
                : m.role === 'command' ? <CommandCard m={m} />
                : m.role === 'assistant' ? <Turn m={m} bots={bots} needs={needs} live={false} step={chief.step} last={m.id === lastAssistantId && !chief.busy} profile={profile} chat={chief} name={name} />
                : <Reply m={m} bots={bots} needs={needs} />}
            </div>
          )
        })}
        {chief.busy && msgs[msgs.length - 1]?.role !== 'assistant' ? (
          <div className="turn"><div className="who"><BotFace profile={profile} size={32} mood="thinking" poseKey={isChiefChat ? undefined : bot?.poseKey} watch={false} />{name}</div>
            <div className="working">{chief.step ?? 'Thinking'}…<span className="tm">{elapsed(chief.turnStartedAt)}</span></div></div>
        ) : null}
        {needs.filter((n) => (isChiefChat || n.profile === profile) && (!n.outcome || Date.now() - n.at < 60_000)).map((n) => (
          <div className="inline-need" key={n.key}>
            <div className="who"><BotFace profile={n.profile} size={32} mood={botMood(bots.find((b) => b.profile === n.profile), 40, needs)} poseKey={bots.find((b) => b.profile === n.profile)?.poseKey} watch={false} />{bots.find((b) => b.profile === n.profile)?.name ?? prettyName(n.profile)}<span className="when">{n.outcome ? '' : 'needs you'}</span></div>
            <NeedCard need={n} bot={bots.find((b) => b.profile === n.profile)} />
          </div>
        ))}
      </div>
    </div>
  )
}
