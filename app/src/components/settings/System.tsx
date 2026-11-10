// System: Hermes itself. Overview (health, updates, messaging, this Mac), Usage, Logs, Maintenance
// (checks, backups, hooks, curator, support) and About. Usage, Logs and Maintenance are kept per
// bot, so they get their own "For" picker; the rest is the same for the whole Mac.
import { useState } from 'react'
import { ProfilePicker, Tabs } from '../ui'
import { AboutTab } from './system/About'
import { LogsTab } from './system/Logs'
import { MaintenanceTab } from './system/Maintenance'
import { OverviewTab } from './system/Overview'
import { UsageTab } from './system/Usage'

type Tab = 'overview' | 'usage' | 'logs' | 'maintenance' | 'about'
const SUB: Record<Tab, string> = {
  overview: 'Is Hermes healthy and up to date, is messaging running, and how this Mac is doing.',
  usage: 'How much an agent used: words read and written, cost, models, tools and skills.',
  logs: 'What Hermes wrote down while it worked. Handy when something goes wrong.',
  maintenance: 'Checks, backups, moving agents, hooks, the skills curator and getting help.',
  about: 'Which Hermes this is and where its files live.',
}

export function SystemPage({ profile }: { profile: string }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [who, setWho] = useState(profile || 'default')
  const scoped = tab === 'usage' || tab === 'logs' || tab === 'maintenance'
  return (
    <>
      <div className="shead">
        <div className="tx"><h1>System</h1><p>{SUB[tab]}</p></div>
        {scoped ? <ProfilePicker value={who} onChange={setWho} /> : null}
      </div>
      <div className="stools">
        <Tabs<Tab> value={tab} onChange={setTab} items={[
          { key: 'overview', label: 'Overview' }, { key: 'usage', label: 'Usage' }, { key: 'logs', label: 'Logs' },
          { key: 'maintenance', label: 'Maintenance' }, { key: 'about', label: 'About' },
        ]} />
      </div>
      <div key={`${tab}:${scoped ? who : ''}`}>
        {tab === 'overview' ? <OverviewTab />
          : tab === 'usage' ? <UsageTab profile={who} />
          : tab === 'logs' ? <LogsTab profile={who} />
          : tab === 'maintenance' ? <MaintenanceTab profile={who} />
          : <AboutTab />}
      </div>
    </>
  )
}
