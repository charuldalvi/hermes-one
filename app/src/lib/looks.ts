// Each agent's own bead: a body shape, a colour and a resting pose. No two agents share a shape (the engine
// draws twelve) or, while there are colours to go round, a colour; the six poses are spread evenly. A look is
// kept once given (remembered on this Mac), so adding an agent never changes anyone else's bead.
// Hermes (the default profile) isn't here: it keeps its own round bead in the app's accent colour.
// @ts-ignore plain JS engine
import { setLooks } from '../bead/engine.js'

export interface Look { shape: string; color: string; pose: string }

const KEY = 'hermes-one:looks'
const SHAPES = ['squircle', 'capsule', 'drop', 'hexagon', 'letter', 'cloud', 'triangle', 'diamond', 'cookie', 'sunny', 'clover', 'arch']
// Away from the status colours (amber needs you, red went wrong, green done) and from Hermes' blue.
const COLORS = ['#8b5cf6', '#14b8a6', '#ec4899', '#0ea5e9', '#06b6d4', '#d946ef', '#a855f7', '#6366f1', '#fb923c', '#a3e635', '#fb7185']
const POSES = ['Round', 'Peek', 'Corner', 'Side', 'Hang', 'Lean']

/** The look a name suggests (Hermes Remote's crew looks, plus a few more crafts), when it's still free. */
function suggested(profile: string): Partial<Look> | null {
  const n = profile.toLowerCase()
  if (/inbox|mail/.test(n)) return { color: '#d946ef', shape: 'letter' }
  if (/direct/.test(n)) return { color: '#8b5cf6', shape: 'squircle' }
  if (/operat|camera|render/.test(n)) return { color: '#14b8a6', shape: 'capsule' }
  if (/author|writ|prompt/.test(n)) return { color: '#ec4899', shape: 'drop' }
  if (/continu|review|check/.test(n)) return { color: '#0ea5e9', shape: 'hexagon' }
  if (/research|search/.test(n)) return { color: '#06b6d4', shape: 'cloud' }
  if (/edit|cut/.test(n)) return { color: '#fb923c', shape: 'arch' }
  if (/implement|code|build|engineer|dev/.test(n)) return { color: '#6366f1', shape: 'diamond' }
  if (/architect|design|plan/.test(n)) return { color: '#a855f7', shape: 'triangle' }
  if (/test|qa/.test(n)) return { color: '#a3e635', shape: 'cookie' }
  return null
}

let looks: Record<string, Look> = {}
const read = (): Record<string, Look> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }
const write = (v: Record<string, Look>) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* given again next launch, the same way */ } }

/** Gives every agent in `profiles` a look (keeping the ones they have) and hands them to the bead engine. */
export function assignLooks(profiles: string[]) {
  const saved = read()
  const next: Record<string, Look> = {}
  for (const p of profiles) if (saved[p]) next[p] = saved[p]
  const shapes = new Set(Object.values(next).map((l) => l.shape))
  const colors = new Set(Object.values(next).map((l) => l.color))
  const poseUse = new Map(POSES.map((p) => [p, Object.values(next).filter((l) => l.pose === p).length]))
  // Agents whose name suggests a look go first, so they get it; then the rest, alphabetically.
  const fresh = profiles.filter((p) => !next[p]).sort((a, b) => Number(!!suggested(b)) - Number(!!suggested(a)) || a.localeCompare(b))
  for (const p of fresh) {
    const want = suggested(p)
    const shape = want?.shape && !shapes.has(want.shape) ? want.shape : SHAPES.find((s) => !shapes.has(s)) ?? SHAPES[fresh.indexOf(p) % SHAPES.length]
    const color = want?.color && !colors.has(want.color) ? want.color : COLORS.find((c) => !colors.has(c)) ?? COLORS[fresh.indexOf(p) % COLORS.length]
    const pose = [...POSES].sort((a, b) => (poseUse.get(a) ?? 0) - (poseUse.get(b) ?? 0))[0]
    next[p] = { shape, color, pose }
    shapes.add(shape); colors.add(color); poseUse.set(pose, (poseUse.get(pose) ?? 0) + 1)
  }
  // Agents that were removed keep their remembered look, in case they come back.
  write({ ...saved, ...next })
  looks = next
  setLooks(next)
}

export function lookOf(profile: string): Look | undefined { return looks[profile] }
