// Example of the "agents" ability (the agents feed): a list from ctx.hermes.agents() and a web view that draws the agents
// in their colours and flashes a line for each new talk (hermes.onTalk).
export default {
  state: { heard: 0 },
  onAgents(ctx, feed) { ctx.state.heard = (ctx.state.heard || 0) + 1; ctx.state.lastTalks = feed.talks.length },
  screens: {
    home(ctx) {
      const f = ctx.hermes.agents()
      return {
        title: 'Agents feed',
        subtitle: `${f.agents.length} agents · ${f.groups.length} groups · ${f.talks.length} talks · onAgents ran ${ctx.state.heard} times`,
        body: [
          { type: 'web', height: 300 },
          { type: 'section', label: 'Agents', children: f.agents.map((a) => ({ type: 'row', title: `${a.name}${a.lead ? ' (lead)' : ''}`, subtitle: `${a.look.shape} · ${a.look.color} · ${a.look.pose}`, trailing: a.status + (a.doing ? ` · ${a.doing}` : '') })) },
          { type: 'section', label: 'Talks', children: f.talks.length ? f.talks.slice(-5).map((t) => ({ type: 'row', title: `${t.from} → ${t.to.join(', ')}`, trailing: t.kind })) : [{ type: 'text', text: 'No talks yet', style: 'caption' }] },
        ],
      }
    },
  },
}
