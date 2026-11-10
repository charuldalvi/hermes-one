// The Hermes Marketplace (hermes-agent.nousresearch.com/marketplace) inside Hermes One: plugins, skills and
// apps for Hermes in one place, installed for the bot picked at the top. Hermes Remote's MarketplacePage
// is the model; each tab lives in components/market.
import { useState } from 'react'
import { Icon } from '../lib/icons'
import { setState, useStore } from '../lib/store'
import { agoText, lastMarketSnapshot, loadMarket, STORE_PAGE } from '../lib/api-market'
import { PageFrame } from './Settings'
import { ProfilePicker, Tabs, useAsync } from './ui'
import { AppsTab } from './market/AppsTab'
import { Pill, openLink } from './market/parts'
import { PluginsTab } from './market/Plugins'
import { SkillsTab } from './market/Skills'
import { useBotName } from './market/useConnectors'

type Tab = 'plugins' | 'skills' | 'apps'

export function Marketplace() {
  const scope = useStore((s) => s.scope)
  const raw = useStore((s) => s.marketTab)
  const tab: Tab = raw === 'skills' || raw === 'apps' ? raw : 'plugins'
  const botName = useBotName(scope)
  const market = useAsync(() => loadMarket(scope), [scope])
  const snap = market.data ?? lastMarketSnapshot() ?? undefined
  const [skillQuery, setSkillQuery] = useState('')
  const [installedOpen, setInstalledOpen] = useState(false)
  const updates = snap?.plugins.filter((p) => p.updateAvailable).length ?? 0
  const updated = agoText(snap?.generatedAt)

  return (
    <PageFrame icon="store" title="Marketplace" wide right={<ProfilePicker value={scope} onChange={(p) => setState({ scope: p })} label="Install for" />}>
      <div className="shead">
        <div className="tx">
          <h1>Marketplace</h1>
          <p>Plugins, skills and apps for Hermes. What you add here is for {botName}{scope === 'default' ? '' : ' only'}; managed apps follow your Nous account.</p>
        </div>
        <button className="b-soft mk-hbtn" onClick={() => { setState({ marketTab: 'plugins' }); setInstalledOpen(true) }}>
          <Icon name="box" size={15} />Installed{updates ? <em className="mk-count-b">{updates}</em> : null}
        </button>
      </div>
      <div className="mk-pills">
        {snap ? <Pill tone={snap.fromHost ? 'ok' : 'need'}>{[snap.host.name?.replace(/\.local$/, '') || 'This Mac', snap.host.version ? `Hermes ${snap.host.version}` : null].filter(Boolean).join(' · ')}</Pill> : null}
        {snap ? <Pill>{snap.plugins.length.toLocaleString()} plugins{updated ? ` · updated ${updated}` : ''}</Pill> : null}
        {updates ? <Pill tone="run">{updates === 1 ? '1 update' : `${updates} updates`}</Pill> : null}
        <button className="mk-link" onClick={() => openLink(STORE_PAGE)}>Open the website <Icon name="external" size={12} /></button>
      </div>
      <div className="mk-tabs">
        <Tabs<Tab> items={[{ key: 'plugins', label: 'Plugins' }, { key: 'skills', label: 'Skills' }, { key: 'apps', label: 'Apps' }]} value={tab} onChange={(t) => setState({ marketTab: t })} />
      </div>
      <div key={`${tab}:${scope}`}>
        {tab === 'plugins' ? (
          <PluginsTab snap={snap} error={market.error} profile={scope} botName={botName} onReload={() => void market.reload(true)}
            onSearchSkills={(q) => { setSkillQuery(q); setState({ marketTab: 'skills' }) }} installedOpen={installedOpen} setInstalledOpen={setInstalledOpen} />
        ) : tab === 'skills' ? (
          <SkillsTab profile={scope} botName={botName} query={skillQuery} setQuery={setSkillQuery} />
        ) : (
          <AppsTab profile={scope} />
        )}
      </div>
    </PageFrame>
  )
}
