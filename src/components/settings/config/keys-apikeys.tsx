// API keys: every key Hermes knows for this bot, grouped like Desktop: model providers (one card per
// provider, extra options folded under it), tools, skills, Hermes' own settings, and keys you added
// yourself. Chat-app keys live on the Messaging page.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { envVars, setEnvVar, type EnvInfo } from '../../../lib/api-config'
import { toast } from '../../../lib/hermes'
import { Icon } from '../../../lib/icons'
import { setState } from '../../../lib/store'
import { Empty, ErrorLine, Search, Spinner, Switch, useAsync } from '../../ui'
import { errText, KeyRow, prettyKey, prettyTool, providerGroups, SkeletonCard, type ProviderGroup } from './keys-shared'

const OTHER_PROVIDERS_SHOWN = 6

export function ApiKeysTab({ profile, botName, focus, onFocusDone, onCount }: {
  profile: string; botName: string; focus?: string; onFocusDone: () => void; onCount: (n: number) => void
}) {
  const { data, error, loading, reload, setData } = useAsync(() => envVars(profile), [profile])
  const [q, setQ] = useState('')
  const dq = useDeferredValue(q)
  const t = dq.trim().toLowerCase()
  const [advanced, setAdvanced] = useState(false)
  const [allProviders, setAllProviders] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState<string | null>(null)
  const list = data ?? []

  const onChange = (key: string, patch: Partial<EnvInfo> | null) =>
    setData((cur) => (cur ?? []).flatMap((i) => (i.key !== key ? [i] : patch === null ? [] : [{ ...i, ...patch }])))

  useEffect(() => { if (data) onCount(data.filter((i) => i.is_set && !i.channel_managed).length) }, [data, onCount])

  const groups = useMemo(() => providerGroups(list), [list])
  const match = (i: EnvInfo, extra = '') => !t || `${i.key} ${i.description} ${i.provider_label ?? ''} ${i.provider ?? ''} ${(i.tools ?? []).join(' ')} ${extra}`.toLowerCase().includes(t)
  const groupMatch = (g: ProviderGroup) => !t || `${g.name} ${g.description ?? ''}`.toLowerCase().includes(t) || [g.primary, ...g.advanced].some((i) => match(i))
  const visible = (i: EnvInfo) => !i.channel_managed && (advanced || !i.advanced || i.is_set || !!t) && match(i)

  const shownGroups = groups.filter(groupMatch)
  const used = shownGroups.filter((g) => g.hasAnySet)
  const others = shownGroups.filter((g) => !g.hasAnySet)
  const othersShown = t || allProviders ? others : others.slice(0, OTHER_PROVIDERS_SHOWN)
  const tools = list.filter((i) => i.category === 'tool' && visible(i)).sort(bySetThenKey)
  const skills = list.filter((i) => i.category === 'skill' && visible(i)).sort(bySetThenKey)
  const settings = list.filter((i) => (i.category === 'setting' || i.category === 'messaging') && visible(i)).sort(bySetThenKey)
  const custom = list.filter((i) => i.category === 'custom' && !i.channel_managed && match(i)).sort(bySetThenKey)
  const channelCount = list.filter((i) => i.channel_managed).length
  const hiddenAdvanced = list.filter((i) => !i.channel_managed && i.category !== 'provider' && i.category !== 'custom' && i.advanced && !i.is_set).length
  const nothing = !!t && !shownGroups.length && !tools.length && !skills.length && !settings.length && !custom.length

  // A link from elsewhere ("set the key for X") opens that key's row and flashes it.
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (!focus || !data || handled.current === focus) return
    handled.current = focus
    const info = data.find((i) => i.key === focus)
    setQ('')
    if (!info) { toast(`${botName} has no key called ${focus}.`); onFocusDone(); return }
    const g = providerGroups(data).find((x) => x.keys.includes(focus))
    if (g && g.primary.key !== focus) setOpen((s) => new Set(s).add(g.name))
    if (g && !g.hasAnySet) setAllProviders(true)
    if (!g && info.advanced) setAdvanced(true)
    setTimeout(() => {
      document.getElementById(`ky-key-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setFlash(focus)
      setTimeout(() => setFlash((f) => (f === focus ? null : f)), 1800)
      handled.current = null
      onFocusDone()
    }, 80)
  }, [focus, data, onFocusDone, botName])

  const row = (i: EnvInfo) => (
    <KeyRow key={i.key} profile={profile} info={i} label={prettyKey(i.key)} sub={i.description || undefined} docs={i.url} flash={flash === i.key} onChange={onChange}
      extra={i.tools?.length ? <div className="ky-tools">Used for {i.tools.map(prettyTool).join(', ')}</div> : null} />
  )
  const provider = (g: ProviderGroup) => {
    const isOpen = open.has(g.name) || (!!t && g.advanced.some((i) => match(i)) && !match(g.primary))
    return (
      <KeyRow key={g.name} profile={profile} info={g.primary} label={g.name} sub={g.description} docs={g.docsUrl} check flash={flash === g.primary.key} onChange={onChange}>
        {g.advanced.length ? (
          <>
            <button className="ky-more" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(g.name)) n.delete(g.name); else n.add(g.name); return n })}>
              <Icon name="chevR" size={13} className={`x-chev${isOpen ? ' open' : ''}`} />
              {isOpen ? 'Fewer options' : `More options (${g.advanced.length})`}
              {!isOpen && g.advanced.some((i) => i.is_set) ? <span className="x-quiet">· some set</span> : null}
            </button>
            {isOpen ? <div className="ky-sub x-reveal">{g.advanced.map((i) => <KeyRow key={i.key} profile={profile} info={i} label={prettyKey(i.key)} sub={i.description || undefined} flash={flash === i.key} onChange={onChange} />)}</div> : null}
          </>
        ) : null}
      </KeyRow>
    )
  }

  return (
    <>
      <div className="stools">
        <Search value={q} onChange={setQ} placeholder="Find a key by name, provider or what it’s for" />
        <label className="ky-adv"><Switch on={advanced} onChange={setAdvanced} label="Show advanced keys" /><span>Show advanced{hiddenAdvanced && !advanced ? ` (${hiddenAdvanced})` : ''}</span></label>
        <button className="x-icon-btn" title="Read again" aria-label="Read again" onClick={() => void reload(true)}>{loading && data ? <Spinner /> : <Icon name="refresh" size={15} />}</button>
      </div>
      {error ? <ErrorLine text={`Couldn’t read ${botName}’s keys: ${error}`} onRetry={() => void reload()} /> : null}
      {!data && loading ? <><SkeletonCard rows={5} /><SkeletonCard rows={3} /></> : null}
      {data ? (
        <>
          {channelCount && !t ? (
            <div className="x-info"><Icon name="mail" size={15} /><span>{channelCount} keys for chat apps like Telegram, Slack and Discord are set up on the Messaging page.</span>
              <button className="b-text x-btn-sm" onClick={() => setState({ settingsPage: 'messaging' })}>Open Messaging</button></div>
          ) : null}
          {nothing ? <Empty title="No keys match" body="Try a provider name, a key name like OPENAI_API_KEY, or what it’s for, like “web search”." face={false} /> : null}

          {used.length || othersShown.length ? (
            <>
              <div className="ssec"><h2>Model providers</h2><span>Companies that run the models. One key each; a sign-in on Accounts works too.</span></div>
              {used.length ? <div className="card flow">{used.map(provider)}</div> : null}
              {othersShown.length ? (
                <>
                  {used.length ? <div className="ky-subhead">{t ? 'Not set up' : 'Other providers'}</div> : null}
                  <div className="card flow">{othersShown.map(provider)}</div>
                  {!t && others.length > OTHER_PROVIDERS_SHOWN ? (
                    <button className="ky-more ky-more-list" onClick={() => setAllProviders(!allProviders)}>
                      <Icon name="chevR" size={13} className={`x-chev${allProviders ? ' open' : ''}`} />
                      {allProviders ? 'Show fewer providers' : `Show all ${others.length} providers`}
                    </button>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          {tools.length ? <><div className="ssec"><h2>Tools</h2><span>Web search, browsers, pictures, voice and memory.</span></div><div className="card flow">{tools.map(row)}</div></> : null}
          {skills.length ? <><div className="ssec"><h2>Skills</h2><span>Keys a skill needs to reach its service.</span></div><div className="card flow">{skills.map(row)}</div></> : null}
          {settings.length ? <><div className="ssec"><h2>Hermes settings</h2><span>Passwords and addresses Hermes itself uses.</span></div><div className="card flow">{settings.map(row)}</div></> : null}

          {!t || custom.length ? (
            <>
              <div className="ssec"><h2>Your own keys</h2><span>Anything else you want {botName} to have, like a key a script reads.</span></div>
              <div className="card flow">
                {custom.map(row)}
                <AddKey profile={profile} known={list} onAdded={(info) => { setData((cur) => [...(cur ?? []).filter((i) => i.key !== info.key), info]); setTimeout(() => void reload(true), 400) }}
                  onKnown={(key) => { setQ(''); setFlash(key); setTimeout(() => document.getElementById(`ky-key-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60); setTimeout(() => setFlash(null), 1800) }} />
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </>
  )
}

const bySetThenKey = (a: EnvInfo, b: EnvInfo) => Number(b.is_set) - Number(a.is_set) || a.key.localeCompare(b.key)

function AddKey({ profile, known, onAdded, onKnown }: { profile: string; known: EnvInfo[]; onAdded: (info: EnvInfo) => void; onKnown: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const valid = /^[A-Z][A-Z0-9_]*$/.test(name)
  const existing = known.find((i) => i.key === name && i.category !== 'custom')
  const close = () => { setOpen(false); setName(''); setValue(''); setErr('') }
  const save = async () => {
    if (!valid) { setErr('Use capital letters, numbers and underscores, starting with a letter.'); return }
    if (existing) { close(); onKnown(existing.key); toast(`${existing.key} already has its own row.`); return }
    if (!value.trim()) { setErr('Paste a value first.'); return }
    setBusy(true); setErr('')
    try {
      await setEnvVar(profile, name, value.trim())
      onAdded({ key: name, is_set: true, description: '', url: null, category: 'custom', is_password: true, tools: [], advanced: false, custom: true })
      toast(`Saved ${name}.`)
      close()
    } catch (e) { setErr(`Hermes didn’t save it: ${errText(e)}`) } finally { setBusy(false) }
  }
  if (!open) return <div className="ky-addrow"><button className="b-text x-btn-sm" onClick={() => setOpen(true)}><Icon name="plus" size={14} /> Add your own key</button></div>
  return (
    <div className="ky-addform x-reveal">
      <div className="ky-editrow">
        <input className="answer mono" autoFocus placeholder="NAME_OF_KEY" value={name} spellCheck={false} autoComplete="off" disabled={busy}
          onChange={(e) => { setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_')); setErr('') }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }} />
        <input className="answer mono" type="password" placeholder="Value" value={value} autoComplete="off" disabled={busy}
          onChange={(e) => { setValue(e.target.value); setErr('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); else if (e.key === 'Escape') { e.stopPropagation(); close() } }} />
        <button className="b-soft" disabled={busy || !name || !value.trim()} onClick={() => void save()}>{busy ? <Spinner size={13} /> : null}Save</button>
        <button className="b-text" disabled={busy} onClick={close}>Cancel</button>
      </div>
      <div className={`ky-msg${err ? ' bad' : existing ? ' warn' : ''}`}>{err || (existing ? `Hermes already knows ${existing.key}; saving takes you to its row.` : 'Hermes treats it as a secret: it is never shown unless you ask.')}</div>
    </div>
  )
}
