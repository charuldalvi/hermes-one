// Keys and accounts: how a bot reaches the companies that run its models and tools. Three tabs:
// accounts you sign in to, API keys (stored in that bot's own .env, never shown unless you ask),
// and your own OpenAI-compatible servers. Another page can open a tab or a key directly by leaving
// sessionStorage 'keys-tab' ('accounts' | 'keys' | 'endpoints') or 'keys-focus' (a key name).
import '../../styles/config.css'
import { useCallback, useEffect, useState } from 'react'
import { Tabs } from '../ui'
import { AccountsTab } from './config/keys-accounts'
import { ApiKeysTab } from './config/keys-apikeys'
import { EndpointsTab } from './config/keys-endpoints'
import { useBotName } from './config/keys-shared'

type Tab = 'accounts' | 'keys' | 'endpoints'
const TABS: Tab[] = ['accounts', 'keys', 'endpoints']

function takeLink(): { tab?: Tab; focus?: string } {
  try {
    const tab = sessionStorage.getItem('keys-tab') as Tab | null
    const focus = sessionStorage.getItem('keys-focus')
    sessionStorage.removeItem('keys-tab'); sessionStorage.removeItem('keys-focus')
    return { tab: tab && TABS.includes(tab) ? tab : focus ? 'keys' : undefined, focus: focus || undefined }
  } catch { return {} }
}

export function KeysPage({ profile }: { profile: string }) {
  const name = useBotName(profile)
  const [link] = useState(takeLink)
  const [tab, setTab] = useState<Tab>(link.tab ?? 'accounts')
  const [focus, setFocus] = useState<string | undefined>(link.focus)
  const [seen, setSeen] = useState<Set<Tab>>(() => new Set([link.tab ?? 'accounts']))
  const [counts, setCounts] = useState<Partial<Record<Tab, number>>>({})
  const pick = (t: Tab) => { setTab(t); setSeen((s) => (s.has(t) ? s : new Set(s).add(t))) }

  // Settings stays open while another page leaves a link; pick it up when the window regains focus too.
  useEffect(() => {
    const check = () => { const l = takeLink(); if (l.tab) pick(l.tab); if (l.focus) setFocus(l.focus) }
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])

  const countA = useCallback((n: number) => setCounts((c) => (c.accounts === n ? c : { ...c, accounts: n })), [])
  const countK = useCallback((n: number) => setCounts((c) => (c.keys === n ? c : { ...c, keys: n })), [])
  const countE = useCallback((n: number) => setCounts((c) => (c.endpoints === n ? c : { ...c, endpoints: n })), [])
  const focusDone = useCallback(() => setFocus(undefined), [])

  return (
    <>
      <div className="shead">
        <div className="tx">
          <h1>Keys and accounts</h1>
          <p>How {name} reaches the companies that run its models and tools. Keys stay on this Mac in {name === 'Quicksilver' ? 'Quicksilver’s' : `${name}’s`} own settings and are never shown unless you ask.</p>
        </div>
      </div>
      <div className="stools ky-tabs">
        <Tabs<Tab> value={tab} onChange={pick} items={[
          { key: 'accounts', label: 'Accounts', count: counts.accounts || undefined },
          { key: 'keys', label: 'API keys', count: counts.keys || undefined },
          { key: 'endpoints', label: 'Custom endpoints', count: counts.endpoints || undefined },
        ]} />
      </div>
      {seen.has('accounts') ? <div hidden={tab !== 'accounts'}><AccountsTab profile={profile} botName={name} onCount={countA} /></div> : null}
      {seen.has('keys') ? <div hidden={tab !== 'keys'}><ApiKeysTab profile={profile} botName={name} focus={focus} onFocusDone={focusDone} onCount={countK} /></div> : null}
      {seen.has('endpoints') ? <div hidden={tab !== 'endpoints'}><EndpointsTab profile={profile} botName={name} onCount={countE} /></div> : null}
    </>
  )
}
