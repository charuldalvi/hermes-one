// Models: the control room for what your team thinks with. Main models for Chief and every bot in
// one list, then (for the bot you pick) backups, helper jobs, mixture of agents and subagents, and
// the models that run on this Mac. Other pages can open a tab by leaving sessionStorage
// 'models-tab' ('main' | 'backups' | 'helpers' | 'mixture' | 'subagents' | 'local').
import '../../styles/config.css'
import { useEffect, useState } from 'react'
import { toast } from '../../lib/hermes'
import { Icon } from '../../lib/icons'
import { getState, setState } from '../../lib/store'
import { ProfilePicker, Spinner, Tabs } from '../ui'
import { LocalTab } from './config/models-local'
import { MainTab } from './config/models-main'
import { MixtureTab } from './config/models-moa'
import { forgetCatalogs, loadCatalog } from './config/models-picker'
import { useNameOf } from './config/models-shared'
import { BackupsTab, HelpersTab } from './config/models-side'
import { SubagentsTab } from './config/models-subagents'

type Tab = 'main' | 'backups' | 'helpers' | 'mixture' | 'subagents' | 'local'
const TABS: { key: Tab; label: string }[] = [
  { key: 'main', label: 'Main' }, { key: 'backups', label: 'Backups' }, { key: 'helpers', label: 'Helpers' },
  { key: 'mixture', label: 'Mixture of agents' }, { key: 'subagents', label: 'Subagents' }, { key: 'local', label: 'On this Mac' },
]
const SCOPED: Tab[] = ['backups', 'helpers', 'mixture', 'subagents']
const BLURB: Record<Tab, string> = {
  main: 'The model each of your agents thinks with.',
  backups: 'Models tried in order when the main one fails.',
  helpers: 'Cheaper models for small side jobs.',
  mixture: 'Several models answer, one combines.',
  subagents: 'What runs the helpers an agent hands work to.',
  local: 'Models that run on this Mac, with no account.',
}

function takeTab(): Tab | undefined {
  try {
    const t = sessionStorage.getItem('models-tab') as Tab | null
    sessionStorage.removeItem('models-tab')
    return t && TABS.some((x) => x.key === t) ? t : undefined
  } catch { return undefined }
}

export function ModelsPage({ profile }: { profile: string }) {
  void profile // always "default" from the shell: this page covers Chief and every bot itself
  const nameOf = useNameOf()
  const [tab, setTab] = useState<Tab>(() => takeTab() ?? 'main')
  // The bot the per-bot tabs are about: the same choice the other per-bot Settings pages share.
  const [who, setWhoState] = useState(() => getState().scope || 'default')
  const setWho = (p: string) => { setWhoState(p); setState({ scope: p }) }
  const [refreshing, setRefreshing] = useState(false)
  const [epoch, setEpoch] = useState(0)

  // Fresh sign-ins every time the page opens; Chief's list starts loading straight away.
  useEffect(() => { forgetCatalogs(); void loadCatalog('default').catch(() => undefined) }, [])
  // Another page can leave a link while Settings stays open.
  useEffect(() => {
    const check = () => { const t = takeTab(); if (t) setTab(t) }
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])

  const refresh = async () => {
    setRefreshing(true)
    try {
      const target = SCOPED.includes(tab) ? who : 'default'
      const c = await loadCatalog(target, true)
      const n = c.providers.reduce((sum, p) => sum + (p.authenticated !== false ? p.models.length : 0), 0)
      toast(`Model list refreshed: ${n} models from ${c.providers.filter((p) => p.authenticated !== false && p.models.length).length} providers.`)
      setEpoch((e) => e + 1)
    } catch (e: any) { toast(`Couldn’t refresh the model list: ${e?.message ?? e}`) } finally { setRefreshing(false) }
  }

  const scoped = SCOPED.includes(tab)
  return (
    <>
      <div className="shead">
        <div className="tx">
          <h1>Models</h1>
          <p>Which model each of your agents thinks with, and the backups, helpers and subagents around them. Changes apply to new chats.</p>
        </div>
      </div>
      <div className="stools">
        <Tabs<Tab> items={TABS} value={tab} onChange={setTab} />
        <span style={{ flex: 1 }} />
        {tab !== 'local' ? (
          <button className="b-text x-btn-sm" disabled={refreshing} onClick={() => void refresh()} title="Ask every signed-in provider for its latest models">
            {refreshing ? <Spinner size={13} /> : <Icon name="refresh" size={14} />} Refresh models
          </button>
        ) : null}
      </div>
      {scoped ? (
        <div className="x-row" style={{ marginBottom: 14, justifyContent: 'space-between' }}>
          <span className="x-quiet" style={{ fontSize: 'var(--text-base)' }}>{BLURB[tab]} Each agent has its own.</span>
          <ProfilePicker value={who} onChange={setWho} />
        </div>
      ) : null}
      <div key={`${tab}:${scoped ? who : ''}:${epoch}`}>
        {tab === 'main' ? <MainTab onOpenHelpers={(p) => { setWho(p); setTab('helpers') }} /> : null}
        {tab === 'backups' ? <BackupsTab profile={who} /> : null}
        {tab === 'helpers' ? <HelpersTab profile={who} /> : null}
        {tab === 'mixture' ? <MixtureTab profile={who} /> : null}
        {tab === 'subagents' ? <SubagentsTab profile={who} /> : null}
        {tab === 'local' ? <LocalTab /> : null}
      </div>
      {scoped && who !== 'default' ? <p className="x-note" style={{ marginTop: 18 }}>Showing {nameOf(who)}’s settings. Quicksilver and the other agents keep their own.</p> : null}
    </>
  )
}
