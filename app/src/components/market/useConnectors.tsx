// The Connectors page's state and flows, shared with the Marketplace's Apps tab: one read of every app
// (managed and on this Mac), usage and tool counts, optimistic switches, and the dialogs for opening an
// app, connecting, installing from the catalog, adding your own server and editing mcp.json by hand.
import { useEffect, useRef, useState } from 'react'
import { prettyName, toast } from '../../lib/hermes'
import { useStore } from '../../lib/store'
import {
  appPending, appTrouble, connectorTools, loadConnectors, onAccountUpdate, plain, plural, reload as reloadServers, setManagedEnabled,
  setServerEnabled, toolTitle, usageCounts, usagePrefix, usageSum, type AppEntry, type UsageCounts,
} from '../../lib/api-market'
import { useAsync } from '../ui'
import { AddServerDialog, catalogMeta, InstallServerDialog, ServersJsonDialog } from './AddServer'
import { AppDetail } from './AppDetail'
import { ConnectFlow, type ConnectRequest } from './ConnectFlow'
import { useFlips } from './parts'

export function useBotName(profile: string) {
  const name = useStore((s) => s.bots.find((b) => b.profile === profile)?.name)
  return profile === 'default' ? 'Hermes' : name ?? prettyName(profile)
}

export const kindLabel = (e: AppEntry) => (e.kind === 'managed' ? 'Managed' : e.kind === 'plugin' ? 'Plugin' : 'On this Mac')

/** A short line for an app you could add: who runs it and what it needs. */
export function availableMeta(e: AppEntry): string {
  if (e.kind === 'managed') return 'Managed' + (e.category ? ` · ${e.category.toLowerCase()}` : '')
  return e.catalog ? catalogMeta(e.catalog) : 'Runs on this Mac'
}

/** A connected app's line: its tools, when Hermes last used it, or what's wrong. */
export function metaFor(e: AppEntry, on: boolean, usage: UsageCounts | null, toolCounts: Record<string, number>): string {
  if (appPending(e)) return 'Finishing sign-in…'
  const t = appTrouble(e)
  if (t) return ['failed', 'needs_sign_in'].includes(t.status) && e.kind !== 'managed' ? 'Not answering' : 'Needs you'
  const plugin = e.server?.source === 'plugin' ? e.server.plugin : null
  if (plugin && !on) return `Off · from ${plugin}`
  if (!on) return e.kind === 'managed' ? (e.orgLocked ? 'Off by your organisation' : 'Off · sign-in kept') : 'Off'
  const total = e.kind === 'managed' ? toolCounts[e.hostedSlug ?? ''] : e.runtime?.tools || undefined
  const tools = total !== undefined ? (e.toolsOff > 0 ? `${total} tools, ${e.toolsOff} off` : plural(total, 'tool')) : null
  const prefix = usagePrefix(e)
  const used = usage ? ((usageSum(usage.today, prefix) ?? 0) > 0 ? 'used today' : (usageSum(usage.week, prefix) ?? 0) > 0 ? 'used this week' : 'not used this week') : null
  const accounts = e.accounts.length > 1 ? `${e.accounts.length} accounts` : null
  const line = [tools, accounts, used, plugin ? `from ${plugin}` : null].filter(Boolean).join(' · ')
  if (line) return line
  if (e.runtime?.status === 'lazy' || e.runtime?.status === 'configured') return 'Starts when Hermes needs it'
  if (e.runtime?.status === 'connecting') return 'Starting…'
  return e.description.slice(0, 70)
}

export function useConnectors(profile: string) {
  const botName = useBotName(profile)
  const { data: snap, error, loading, reload } = useAsync(() => loadConnectors(profile), [profile])
  const [usage, setUsage] = useState<UsageCounts | null>(null)
  const [toolCounts, setToolCounts] = useState<Record<string, number>>({})
  const [toolNames, setToolNames] = useState<Record<string, string[]>>({})
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<ConnectRequest | null>(null)
  const [installing, setInstalling] = useState<AppEntry | null>(null)
  const [adding, setAdding] = useState(false)
  const [json, setJson] = useState(false)
  const [note, setNote] = useState<string>()
  const [busy, setBusy] = useState<string | null>(null)
  const flips = useFlips()
  const quiet = () => reload(true)

  useEffect(() => { usageCounts().then(setUsage).catch(() => undefined) }, [])
  // Tool counts for the connected managed apps, one quiet call each (Hermes caches the lists).
  const asked = useRef(new Set<string>())
  useEffect(() => {
    for (const e of snap?.connected ?? []) {
      const slug = e.hostedSlug
      if (e.kind !== 'managed' || !slug || asked.current.has(slug)) continue
      asked.current.add(slug)
      connectorTools(slug).then(({ tools }) => {
        setToolCounts((m) => ({ ...m, [slug]: tools.length }))
        setToolNames((m) => ({ ...m, [slug]: tools.map((t) => toolTitle(t, slug)) }))
      }).catch(() => undefined)
    }
  }, [snap])
  // An account connected or changed anywhere (a chat card, another app): read again, quietly.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const off = onAccountUpdate((op) => { if (op.settled || op.targets.some((x) => x.state === 'connected')) { clearTimeout(t); t = setTimeout(() => void reload(true), 800) } })
    return () => { off(); clearTimeout(t) }
  }, [reload])

  const isOn = (e: AppEntry) => flips.value(e.key, e.enabled)
  const toggle = (e: AppEntry, on: boolean) => {
    const server = e.server
    void flips.flip(e.key, on, () => (e.kind === 'managed' ? setManagedEnabled(e.hostedSlug!, on) : server ? setServerEnabled(profile, server.name, on) : Promise.resolve()), {
      done: on ? `${e.name} is on.` : e.kind === 'managed' ? `${e.name} is off. Its sign-in is kept.` : `${e.name} is off.`,
      failed: (err) => plain(err), reload: quiet,
    })
  }
  const connect = (e: AppEntry) => {
    if (e.kind === 'managed' && e.hostedSlug) setConnecting({ kind: 'hosted', name: e.name, logo: e.logo, slug: e.hostedSlug })
    else if (e.catalog) setInstalling(e)
  }
  const reconnect = async (e: AppEntry) => {
    const t = appTrouble(e)
    if (e.kind === 'managed' && e.hostedSlug) setConnecting({ kind: 'hosted', name: e.name, logo: e.logo, slug: e.hostedSlug, reconnect: true, connectionId: e.accounts[0]?.connection_id })
    else if (t?.status === 'needs_sign_in' && e.server) setConnecting({ kind: 'server', name: e.name, logo: e.logo, server: e.server.name, profile })
    else { setBusy(e.key); await reloadServers(); await quiet(); setBusy(null); toast(`Asked Hermes to start ${e.name} again.`) }
  }

  const fresh = openKey ? snap?.connected.find((x) => x.key === openKey) : undefined
  const twin = fresh?.catalog?.connector_slug ? snap?.connected.find((x) => x.hostedSlug === fresh.catalog?.connector_slug && isOn(x)) : undefined
  const changed = (n?: string) => { if (n) setNote(n); void quiet() }

  const dialogs = (
    <>
      {fresh ? <AppDetail key={fresh.key} entry={fresh} policy={snap?.policy ?? null} usage={usage} profile={profile} botName={botName} twin={twin}
        onClose={() => setOpenKey(null)} onConnect={setConnecting} onChanged={changed} /> : null}
      {installing?.catalog ? <InstallServerDialog entry={installing.catalog} logo={installing.logo} profile={profile} botName={botName} onClose={() => setInstalling(null)}
        onDone={(r) => { setInstalling(null); setNote(r.message); void quiet(); if (r.signIn) setConnecting(r.signIn) }} /> : null}
      {adding ? <AddServerDialog profile={profile} botName={botName} onClose={() => setAdding(false)}
        onAdded={(r) => { setAdding(false); setNote(r.message); void quiet(); if (r.signIn) setConnecting(r.signIn) }} /> : null}
      {json ? <ServersJsonDialog profile={profile} botName={botName} onClose={() => setJson(false)} onSaved={() => { setJson(false); setNote('Saved your servers.'); void quiet() }} /> : null}
      {connecting ? <ConnectFlow key={JSON.stringify(connecting)} request={connecting} onClose={(ok) => { const r = connecting; setConnecting(null); if (ok) setNote(`${r.name} is connected.`); void quiet() }} /> : null}
    </>
  )

  return {
    botName, snap, error, loading, reload, usage, toolCounts, toolNames, isOn, toggle, connect, reconnect, busy,
    openApp: (e: AppEntry) => setOpenKey(e.key), addOwn: () => setAdding(true), editJson: () => setJson(true), note, setNote, dialogs,
  }
}
export type ConnectorsModel = ReturnType<typeof useConnectors>
