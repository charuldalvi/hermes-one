// Development only (off-screen snapshot runs): the team's real beads, big, on the dark and the light
// base, in a fixed grid, so mockups can use the exact faces the app draws.
import { createRoot } from 'react-dom/client'
import { BotFace, type Mood } from '../components/BotFace'
import { getState } from '../lib/store'

export const CELL = 140
export function showBeadSheet() {
  const bots = [...getState().bots].sort((a, b) => (a.isChief ? -1 : b.isChief ? 1 : a.name.localeCompare(b.name)))
  const host = document.createElement('div')
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#808080' })
  document.body.appendChild(host)
  const rows: { bg: string; moods?: Mood[] }[] = [{ bg: '#1a1a1a' }, { bg: '#f6f6f6' }, { bg: '#1a1a1a', moods: ['writing', 'hand', 'doze', 'thinking'] }, { bg: '#f6f6f6', moods: ['writing', 'hand', 'doze', 'thinking'] }]
  createRoot(host).render(
    <div>
      {rows.map((row, r) => (row.moods ? row.moods.map((m) => ({ bot: bots[0], mood: m })) : bots.map((bot) => ({ bot, mood: 'idle' as Mood }))).map(({ bot, mood }, i) => (
        <div key={`${r}-${i}`} style={{ position: 'absolute', left: i * CELL, top: r * CELL, width: CELL, height: CELL, background: row.bg, display: 'grid', placeItems: 'center' }}>
          <div style={{ position: 'relative', width: 112, height: 112 }}><BotFace profile={bot.profile} size={112} mood={mood} poseKey={bot.poseKey} watch={false} /></div>
        </div>
      )))}
      <pre id="bead-order" style={{ position: 'absolute', left: 0, top: 4 * CELL, color: '#000', font: '12px monospace' }}>{JSON.stringify(bots.map((b) => ({ profile: b.profile, name: b.isChief ? 'Hermes' : b.name, role: b.role ?? '' })))}</pre>
    </div>,
  )
}
