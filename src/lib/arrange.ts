// Chief keeps the agents arranged in groups by craft ("Film crew"). Chief does the deciding, with the
// hermes-one plugin's list_agents and arrange_groups tools; this file only notices when there's something
// new to arrange (an agent added since Chief last looked, or a group holding an agent that was removed) and
// asks Chief, in the background, to arrange them again. An agent with no partner in its craft stays on its
// own: once Chief has seen it, being in no group isn't a reason to ask again.
import { groupsReady } from './groups'
import { askChiefAside, prettyName } from './hermes'
import { getState } from './store'

const ASKED = 'hermes-one:arranged-for'
/** The agents there were when Chief was last asked to arrange (it has considered each of them). */
const CONSIDERED = 'hermes-one:arranged-agents'
let seen: { key: string; at: number } | null = null
let asking = false

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* asked again next launch */ } }

const agents = () => getState().bots.filter((b) => !b.isChief).map((b) => b.profile).sort()

/** Agents added since Chief last arranged that aren't in a group, and removed agents still in a group. */
function drift() {
  const s = getState()
  const team = agents()
  const inGroups = new Set(s.rooms.flatMap((r) => r.members))
  const known = new Set(s.bots.map((b) => b.profile))
  const raw = read(CONSIDERED)
  // First run with this rule: everyone here now has already been arranged once.
  if (raw === null) write(CONSIDERED, team.join(','))
  const considered = new Set((raw ?? team.join(',')).split(',').filter(Boolean))
  return { team, fresh: team.filter((p) => !inGroups.has(p) && !considered.has(p)), gone: [...inGroups].filter((p) => p !== 'default' && !known.has(p)).sort() }
}

function check() {
  const s = getState()
  if (s.connection !== 'open' || !groupsReady() || s.chief.busy || !s.chief.sessionId || asking || !s.bots.length) return
  const { team, fresh, gone } = drift()
  if (team.length < 2 || (!fresh.length && !gone.length)) { seen = null; return }
  const key = `${team.join(',')}|${fresh.join(',')}|${gone.join(',')}`
  if (read(ASKED) === key) return
  // Wait until it holds for 20 s: Chief may be arranging right now after adding an agent.
  if (!seen || seen.key !== key) { seen = { key, at: Date.now() }; return }
  if (Date.now() - seen.at < 20_000) return
  write(ASKED, key)
  seen = null
  void arrangeTeam({ fresh, gone })
}

/** Asks Chief to arrange the agents into groups (also the "Let Chief arrange" button). */
export async function arrangeTeam(why: { fresh?: string[]; gone?: string[]; asked?: boolean } = {}) {
  if (asking) return
  asking = true
  write(CONSIDERED, agents().join(','))
  const names = (ps: string[]) => ps.map((p) => prettyName(p)).join(', ')
  const reason = why.asked
    ? 'The user asked you to look at the agents’ groups again.'
    : [why.fresh?.length ? `${why.fresh.length === 1 ? 'A new agent' : 'New agents'} since you last arranged the groups: ${names(why.fresh)}.` : '',
       why.gone?.length ? `${why.gone.length === 1 ? 'This agent has' : 'These agents have'} been removed but ${why.gone.length === 1 ? 'is' : 'are'} still in a group: ${names(why.gone)}.` : ''].filter(Boolean).join(' ')
  const text = `${reason} Arrange the agents into groups by craft: call list_agents to see every agent's role, then call arrange_groups with the whole arrangement. A group is 2 to 6 agents who really do the same kind of work or hand work to each other, with a short name like "Film crew", a lead and a one-line purpose. An agent with no partner in its craft stays on its own: don't pair unrelated agents, and don't put yourself in a group. Then answer in plain words, one short line per group (its name, who's in it, who leads it), and one line naming the agents who work on their own. Nothing else.`
  try { await askChiefAside('Quicksilver is arranging the agents into groups', text, 'Working on it in the background. The groups appear in the sidebar when they’re ready.') }
  finally { asking = false }
}

export function startAutoArrange() { setInterval(check, 10_000) }
