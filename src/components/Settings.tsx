// Settings: everything Hermes can be set up to do, for Chief and each bot. A quiet list of pages on the
// left (the same liquid highlight as the sidebar), the page on the right. Pages that differ per bot
// show "For: <bot>" in the header; the choice is shared across those pages.
import { useEffect, useLayoutEffect, useRef, type ComponentType } from 'react'
import { Icon } from '../lib/icons'
import { Liquid } from '../lib/motion'
import { setState, useStore } from '../lib/store'
import { AppPrefsPage } from './settings/AppPrefs'
import { ConfigPage } from './settings/Config'
import { ConnectorsPage } from './settings/Connectors'
import { KeysPage } from './settings/Keys'
import { MemoryPage } from './settings/Memory'
import { MessagingPage } from './settings/Messaging'
import { ModelsPage } from './settings/Models'
import { PluginsPage } from './settings/Plugins'
import { SkillsPage } from './settings/Skills'
import { SystemPage } from './settings/System'
import { TeamPage } from './settings/Team'
import { ToolsPage } from './settings/Tools'
import { ProfilePicker } from './ui'

export interface PageDef { key: string; label: string; icon: string; group: string; scoped?: boolean; Page: ComponentType<{ profile: string }> }

export const SETTINGS_PAGES: PageDef[] = [
  { key: 'team', label: 'Agents', icon: 'users', group: 'Your agents', Page: TeamPage },
  { key: 'models', label: 'Models', icon: 'spark', group: 'Your agents', Page: ModelsPage },
  { key: 'skills', label: 'Skills', icon: 'book', group: 'What they can do', scoped: true, Page: SkillsPage },
  { key: 'plugins', label: 'Plugins', icon: 'plug', group: 'What they can do', scoped: true, Page: PluginsPage },
  { key: 'connectors', label: 'Connectors', icon: 'link', group: 'What they can do', scoped: true, Page: ConnectorsPage },
  { key: 'tools', label: 'Tools', icon: 'tool', group: 'What they can do', scoped: true, Page: ToolsPage },
  { key: 'memory', label: 'Memory', icon: 'brain', group: 'What they can do', scoped: true, Page: MemoryPage },
  { key: 'keys', label: 'Keys and accounts', icon: 'key', group: 'Hermes', scoped: true, Page: KeysPage },
  { key: 'messaging', label: 'Messaging', icon: 'mail', group: 'Hermes', scoped: true, Page: MessagingPage },
  { key: 'config', label: 'All settings', icon: 'sliders', group: 'Hermes', scoped: true, Page: ConfigPage },
  { key: 'system', label: 'System', icon: 'desk', group: 'Hermes', Page: SystemPage },
  { key: 'app', label: 'This app', icon: 'settings', group: 'Hermes One', Page: AppPrefsPage },
]

const SEL = new Liquid('sel')
const HOV = new Liquid('hov')

export function Settings() {
  const page = useStore((s) => s.settingsPage)
  const scope = useStore((s) => s.scope)
  const nav = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const def = SETTINGS_PAGES.find((p) => p.key === page) ?? SETTINGS_PAGES[0]

  useEffect(() => { const n = nav.current; if (n) { n.prepend(HOV.el); n.prepend(SEL.el) } }, [])
  const first = useRef(true)
  useLayoutEffect(() => {
    const row = nav.current?.querySelector<HTMLElement>(`[data-k="${def.key}"]`)
    if (!row) return
    if (first.current) { SEL.snap(row); first.current = false } else SEL.moveTo(row)
    body.current?.scrollTo({ top: 0 })
  }, [def.key])

  let lastGroup = ''
  return (
    <div className="settings">
      <div className="snav" ref={nav}
        onPointerOver={(e) => { const row = (e.target as HTMLElement).closest<HTMLElement>('.row'); if (row) HOV.moveTo(row) }}
        onPointerLeave={() => HOV.hide()}>
        {SETTINGS_PAGES.map((p) => {
          const head = p.group !== lastGroup ? p.group : null
          lastGroup = p.group
          return (
            <div key={p.key} style={{ display: 'contents' }}>
              {head ? <div className="lab"><span>{head}</span></div> : null}
              <button className={`row${p.key === def.key ? ' on' : ''}`} data-k={p.key} onClick={() => setState({ settingsPage: p.key })}>
                <Icon name={p.icon} /><span className="nm">{p.label}</span>
              </button>
            </div>
          )
        })}
      </div>
      <div className="spage">
        <div className="hdr drag">
          <span className="crumb"><Icon name="settings" /><span>Settings</span><span className="sl">/</span><span className="cur">{def.label}</span></span>
          <span className="sp" />
          {def.scoped ? <span className="nodrag"><ProfilePicker value={scope} onChange={(p) => setState({ scope: p })} /></span> : null}
        </div>
        <div className="sbody" ref={body}>
          <div className="sinner" key={`${def.key}:${def.scoped ? scope : ''}`}>
            <def.Page profile={def.scoped ? scope : 'default'} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** A full-width page outside Settings (Scheduled, Marketplace, Apps) with the same header and column. */
export function PageFrame({ icon, title, right, children, wide }: { icon: string; title: string; right?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="chat">
      <div className="hdr drag"><span className="crumb"><Icon name={icon} /><span className="cur">{title}</span></span><span className="sp" />{right ? <span className="nodrag">{right}</span> : null}</div>
      <div className="sbody"><div className="sinner" style={wide ? { maxWidth: 1100 } : undefined}>{children}</div></div>
    </div>
  )
}
