// The message box: a raised card whose top strip says who you're talking to (Chief, or the agent whose
// chat is open), the field, then + on the left and that chat's model (with its real logo) and send on the
// right. Send turns into stop. Each chat keeps its own unsent draft.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EFFORT_HINTS, EFFORT_LABELS, EFFORT_STOPS, effortStop, prettyModel } from '../lib/api'
import type { Attachment } from '../lib/gateway'
import { completeSlash, loadCommands, loadModels, sendTo, setChatSetting, stopChat, switchModel, type ModelItem, type SlashCommand } from '../lib/hermes'
import { Icon } from '../lib/icons'
import { BrandMark, ModelMark, providerBrand } from '../lib/logos'
import { chatMood } from '../lib/moods'
import { useChat, useStore } from '../lib/store'
import { BotFace } from './BotFace'
import { EffortSlider } from './EffortSlider'
import { Popover, Search, Spinner, Switch } from './ui'
import { VoiceButton } from './Voice'
import { getPrefs } from '../lib/prefs'
import { TalkButton } from './Talk'


interface ProviderGroup { key: string; name: string; models: ModelItem[]; current: boolean }
/** Models a provider shows before "Show more": a long list (CommandCode has ~100) made the card too tall. */
const FIRST = 10

/** A provider's first ten models; the model in use goes first when it's further down, so it stays in view. */
function firstModels(models: ModelItem[]): ModelItem[] {
  if (models.length <= FIRST) return models
  const head = models.slice(0, FIRST)
  const cur = models.find((m) => m.current)
  return cur && !head.includes(cur) ? [cur, ...head.slice(0, FIRST - 1)] : head
}

/** Models by provider, in Hermes' order, with the provider of the model in use first. */
function byProvider(items: ModelItem[]): ProviderGroup[] {
  const groups = new Map<string, ProviderGroup>()
  for (const it of items) {
    const g = groups.get(it.provider) ?? { key: it.provider, name: it.providerName, models: [], current: false }
    g.models.push(it)
    if (it.current) g.current = true
    groups.set(it.provider, g)
  }
  return [...groups.values()].sort((a, b) => Number(b.current) - Number(a.current))
}

/** The model card: how hard this chat's agent thinks (the pixel slider), fast mode, and every model to switch to. */
function ModelCard({ anchor, open, onClose }: { anchor: HTMLElement | null; open: boolean; onClose: () => void }) {
  const chief = useChat().chat
  const [items, setItems] = useState<ModelItem[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { if (open) { setQ(''); loadModels().then(setItems).catch((e) => { setErr(String(e?.message ?? e)); setItems([]) }) } }, [open])
  const cur = items?.find((i) => i.current) ?? items?.find((i) => i.model === chief.model)
  const reasoning = cur ? cur.reasoning : true
  const stop = effortStop(chief.effort)
  const t = q.trim().toLowerCase()
  const shown = useMemo(() => (items ?? []).filter((i) => i.signedIn && (!t || `${i.label} ${i.model} ${i.providerName}`.toLowerCase().includes(t))), [items, t])
  const groups = useMemo(() => byProvider(shown), [shown])
  // One provider open at a time; it starts on the provider in use. A search opens every provider with a match.
  const [openKey, setOpenKey] = useState<string | null>(null)
  useEffect(() => { if (open) setOpenKey(null) }, [open])
  // Providers showing every model (after "Show more"); reset each time the card opens or the search changes.
  const [full, setFull] = useState<Set<string>>(new Set())
  useEffect(() => { setFull(new Set()) }, [open, t])
  const opened = (g: ProviderGroup) => (t ? true : openKey === null ? g.current || (!groups.some((x) => x.current) && g === groups[0]) : openKey === g.key)
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} width={360} align="end" side="above" className="modelcard">
      <div className="mc-think">
        <div className="mc-row"><span className="mc-lab">Thinking</span><b>{reasoning ? EFFORT_LABELS[stop] : 'Not offered'}</b></div>
        <EffortSlider stop={stop} labels={EFFORT_LABELS} enabled={reasoning} width={336} onStop={(i) => void setChatSetting('reasoning', EFFORT_STOPS[i])} />
        <p className="mc-hint">{!reasoning ? 'This model answers without thinking first.' : chief.fast === 'fast' ? `${EFFORT_HINTS[stop]} Fast mode is on: quicker, and can cost more.` : EFFORT_HINTS[stop]}</p>
        {cur?.fast ? (
          <div className="mc-row mc-fast"><Icon name="bolt" size={15} /><span>Fast mode</span><em>Quicker answers, can cost more</em>
            <Switch on={chief.fast === 'fast'} label="Fast mode" onChange={(on) => void setChatSetting('fast', on ? 'fast' : 'normal')} /></div>
        ) : null}
      </div>
      <div className="mc-models">
        <div className="pop-search"><Search value={q} onChange={setQ} placeholder="Switch model" /></div>
        {items === null ? <div className="mh"><Spinner size={12} /> Loading models…</div> : null}
        {err ? <div className="mh">{err}</div> : null}
        {groups.map((g) => {
          const isOpen = opened(g)
          const brand = providerBrand(g.key, g.models.map((m) => m.model))
          const inUse = g.models.find((m) => m.current)
          return (
            <div key={g.key} className={`mc-prov${isOpen ? ' open' : ''}${g.current ? ' cur' : ''}`}>
              <button className="mc-ph" aria-expanded={isOpen} onClick={() => setOpenKey(isOpen && !t ? '' : g.key)}>
                <span className="mc-pl">{brand ? <BrandMark brand={brand} size={16} /> : <Icon name={g.key === 'moa' ? 'users' : 'spark'} size={16} />}</span>
                <span className="mc-pn">{g.name}</span>
                {inUse && !isOpen ? <span className="mc-pu">{prettyModel(inUse.label)}</span> : null}
                <span className="mc-pc">{g.models.length}</span>
                <Icon name="chevD" size={14} className="mc-chev" />
              </button>
              <div className="mc-pb"><div className="mc-pbi">
                {(full.has(g.key) ? g.models : firstModels(g.models)).map((it) => (
                  <button key={`${it.provider}/${it.model}`} tabIndex={isOpen ? 0 : -1} className={`mi${it.current ? ' on' : ''}`} onClick={() => { onClose(); if (!it.current) void switchModel(it.model, it.provider) }}>
                    <ModelMark model={it.model} provider={it.provider} />
                    <span className="ml">{prettyModel(it.label)}</span>
                    {it.fast ? <Icon name="bolt" size={12} style={{ color: 'var(--text-icon)' }} /> : null}
                    {it.current ? <Icon name="check" size={14} /> : null}
                  </button>
                ))}
                {g.models.length > FIRST ? (
                  <button className="mi mc-more" tabIndex={isOpen ? 0 : -1} onClick={() => setFull((f) => { const n = new Set(f); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}>
                    <Icon name={full.has(g.key) ? 'chevU' : 'chevD'} size={14} />
                    <span className="ml">{full.has(g.key) ? 'Show fewer' : `Show ${g.models.length - firstModels(g.models).length} more`}</span>
                  </button>
                ) : null}
              </div></div>
            </div>
          )
        })}
        {items && !shown.length && !err ? <div className="mh">No models match.</div> : null}
      </div>
    </Popover>
  )
}

const SUGGESTED = ['model', 'usage', 'status', 'personality', 'skills', 'retry', 'undo', 'compact', 'btw', 'background', 'cron', 'help']

/** What "/" offers: commands as you type a name, then Hermes' own completions for its argument. */
function useSlash(text: string) {
  const [all, setAll] = useState<SlashCommand[]>([])
  const [args, setArgs] = useState<{ text: string; display?: string; meta?: string }[]>([])
  const active = /^\/[^\s]*$/.test(text)
  const argMode = /^\/\S+\s/.test(text) && !text.includes('\n')
  useEffect(() => { if (text.startsWith('/') && !all.length) void loadCommands().then(setAll).catch(() => {}) }, [text.startsWith('/')])
  useEffect(() => {
    if (!argMode) { setArgs([]); return }
    let alive = true
    const t = setTimeout(() => { completeSlash(text).then((items) => { if (alive) setArgs(items.slice(0, 40)) }).catch(() => { if (alive) setArgs([]) }) }, 120)
    return () => { alive = false; clearTimeout(t) }
  }, [text, argMode])
  const items = useMemo(() => {
    if (active) {
      const q = text.slice(1).toLowerCase()
      if (!q) {
        const picked = SUGGESTED.map((n) => all.find((c) => c.name === n)).filter(Boolean) as SlashCommand[]
        return picked.map((c) => ({ key: c.name, label: `/${c.name}`, hint: c.description, insert: `/${c.name} `, group: 'Suggested' }))
      }
      return all.filter((c) => c.name.startsWith(q) || c.aliases.some((a) => a.startsWith(q)) || (q.length > 3 && c.description.toLowerCase().includes(q)))
        .sort((a, b) => Number(b.name.startsWith(q)) - Number(a.name.startsWith(q)) || b.usage - a.usage)
        .slice(0, 30).map((c) => ({ key: c.name, label: `/${c.name}`, hint: c.description, insert: `/${c.name} `, group: c.skill ? 'Skills' : c.category ?? 'Commands' }))
    }
    if (argMode) {
      const head = text.slice(0, text.lastIndexOf(' ') + 1)
      return args.map((a) => ({ key: a.text, label: a.display ?? a.text, hint: a.meta, insert: head + a.text, group: 'Choices' }))
    }
    return []
  }, [all, args, text, active, argMode])
  return items
}

const drafts = new Map<string, string>()

export function Composer() {
  const { profile, chat: chief } = useChat()
  const isChiefChat = profile === 'default'
  const bot = useStore((s) => s.bots.find((b) => b.profile === profile))
  const name = isChiefChat ? 'Hermes' : bot?.name ?? profile
  const needs = useStore((s) => s.needs)
  const connection = useStore((s) => s.connection)
  const [text, setText] = useState(() => drafts.get(profile) ?? '')
  useEffect(() => { drafts.set(profile, text) }, [profile, text])
  const [files, setFiles] = useState<Attachment[]>([])
  const [drag, setDrag] = useState(false)
  const addFiles = (more: Attachment[]) => setFiles((f) => [...f, ...more.filter((m) => !f.some((x) => x.path === m.path))])
  const [card, setCard] = useState(false)
  const slash = useSlash(text)
  const [pick, setPick] = useState(0)
  const [slashOff, setSlashOff] = useState(false)
  useEffect(() => { setPick(0); setSlashOff(false) }, [slash.length, text.split(' ')[0]])
  const slashOpen = slash.length > 0 && !slashOff
  useEffect(() => {
    const open = () => setCard(true)
    const prefill = (e: Event) => { setText(String((e as CustomEvent).detail ?? '')); area.current?.focus() }
    window.addEventListener('hermes:open-model-card', open)
    window.addEventListener('hermes:prefill', prefill)
    return () => { window.removeEventListener('hermes:open-model-card', open); window.removeEventListener('hermes:prefill', prefill) }
  }, [])
  const chip = useRef<HTMLButtonElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(240, el.scrollHeight) + 'px'
  }, [text])
  useEffect(() => {
    const focus = () => area.current?.focus()
    window.addEventListener('hermes:focus-composer', focus)
    return () => window.removeEventListener('hermes:focus-composer', focus)
  }, [])

  const ready = (text.trim().length > 0 || files.length > 0) && connection === 'open'
  const submit = async () => {
    if (!ready) return
    const t = text, f = files
    setText(''); setFiles([])
    const ok = await sendTo(profile, t, f)
    if (!ok && !t.trim().startsWith('/')) { setText(t); setFiles(f) }
  }

  return (
    <div className="composer">
      <div className="cmp">
        <div className="strip">
          <BotFace profile={profile} size={24} mood={chatMood(profile, chief, 24, needs)} watch={false} poseKey={isChiefChat ? undefined : bot?.poseKey} />
          <span className="nm">{name}</span>
          <span className="ds">{chief.busy ? `${chief.step ?? 'Working'}…` : isChiefChat ? 'Leads your agents' : bot?.role || 'One of your agents'}</span>
        </div>
        <div className={`field${drag ? ' drag-on' : ''}`}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true) } }}
          onDragLeave={() => setDrag(false)}
          onDrop={async (e) => { e.preventDefault(); setDrag(false); const list = await Promise.all([...e.dataTransfer.files].map((f) => window.hermesNative.describeFile(f))); addFiles(list.filter((a) => a?.path)) }}>
          {files.length ? <div className="thumbs">{files.map((f) => (
            <span className="res" key={f.path} title={f.path}><Icon name={f.mime.startsWith('image/') ? 'image' : 'file'} size={14} />{f.name}
              <button style={{ marginLeft: 4, color: 'var(--text-secondary)' }} onClick={() => setFiles((x) => x.filter((y) => y.path !== f.path))} aria-label={`Remove ${f.name}`}><Icon name="x" size={12} /></button></span>
          ))}</div> : null}
          <textarea ref={area} rows={1} value={text} placeholder={isChiefChat ? 'Ask anything, or tell Hermes who should do it' : `Ask ${name} anything`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (slashOpen) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setPick((pick + 1) % slash.length); return }
                if (e.key === 'ArrowUp') { e.preventDefault(); setPick((pick - 1 + slash.length) % slash.length); return }
                if (e.key === 'Escape') { e.preventDefault(); setSlashOff(true); return }
                const it = slash[pick]
                if (it && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && text.trim() !== it.insert.trim()))) { e.preventDefault(); setText(it.insert); return }
              }
              const cmdSend = getPrefs().sendKey === 'cmd-enter'
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && (cmdSend ? (e.metaKey || e.ctrlKey) : !e.shiftKey)) { e.preventDefault(); void submit() }
            }}
            onPaste={async (e) => {
              const img = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))?.getAsFile()
              if (!img) return
              e.preventDefault()
              const buf = new Uint8Array(await img.arrayBuffer())
              let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
              addFiles([await window.hermesNative.savePasted(btoa(bin), img.type.split('/')[1] || 'png')])
            }} />
          <div className="tools">
            <button className="plus" title="Attach files" onClick={async () => addFiles(await window.hermesNative.pickFiles())}><Icon name="plus" size={18} /></button>
            <span className="sp" />
            {isChiefChat ? <TalkButton /> : null}
            <VoiceButton onText={(t) => { setText((x) => (x ? `${x.replace(/\s+$/, '')} ${t}` : t)); area.current?.focus() }} />
            <button ref={chip} className={`model${card ? ' on' : ''}`} title="Model, thinking and fast mode" onClick={() => setCard(!card)}>
              <ModelMark model={chief.model ?? bot?.model} provider={chief.provider} size={15} /><span className="mn">{prettyModel(chief.model ?? bot?.model)}</span>
              {chief.effort ? <span className="eff">{EFFORT_LABELS[effortStop(chief.effort)]}</span> : null}
              {chief.fast === 'fast' ? <Icon name="bolt" size={13} className="fastb" /> : null}
              <Icon name="chevD" size={14} />
            </button>
            {chief.busy
              ? <button className="send stop" title="Stop" onClick={() => void stopChat(profile)}><Icon name="stop" size={13} /></button>
              : <button className={`send${ready ? ' ready' : ''}`} title="Send" onClick={() => void submit()}><Icon name="send" size={15} /></button>}
          </div>
        </div>
      </div>
      <div className="hint">{connection === 'open' ? (getPrefs().sendKey === 'cmd-enter' ? '⌘ Enter to send · Enter for a new line' : 'Enter to send · Shift Enter for a new line') + ' · / for commands' : 'Waiting for Hermes…'}</div>
      <ModelCard anchor={chip.current} open={card} onClose={() => setCard(false)} />
      {slashOpen ? (
        <div className="slash" role="listbox">
          {slash.map((it, i) => {
            const head = i === 0 || slash[i - 1].group !== it.group ? it.group : null
            return (
              <div key={it.key + i}>
                {head ? <div className="mh">{head}</div> : null}
                <button className={`mi${i === pick ? ' on' : ''}`} role="option" aria-selected={i === pick} onMouseEnter={() => setPick(i)} onMouseDown={(e) => { e.preventDefault(); setText(it.insert); area.current?.focus() }}>
                  <code>{it.label}</code><span className="mhint">{it.hint}</span>
                </button>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
