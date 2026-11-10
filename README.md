# Hermes One plugin

A plugin for [Hermes Agent](https://github.com/NousResearch/hermes-agent) that turns your default agent into a lead who builds and runs a set of agents for you. It's the agent side of [Hermes One](https://github.com/charuldalvi/hermes-one), and works in Hermes on its own too.

It's a community project, not made by or affiliated with Nous Research.

## Install

**In Hermes Desktop:** click
[Install in Hermes](hermes://plugin/install?repo=charuldalvi/hermes-one-plugin&enable=1),
review what it installs, and confirm. If the link doesn't open from here, paste this into your browser's address bar:
`hermes://plugin/install?repo=charuldalvi/hermes-one-plugin&enable=1`

**From a terminal:**

```bash
hermes plugins install charuldalvi/hermes-one-plugin
hermes plugins enable hermes-one
```

Then restart Hermes' gateway, which loads plugins when it starts. Install it in each agent's profile too, if you want those agents to build apps.

## What your agents get

**Building the team** (the lead agent):
- `create_agent` adds an agent with its own role and personality. It starts from the lead's model, keys and skills, the way `hermes profile create --clone-from default` does.
- `list_agents` and `arrange_groups` keep the agents arranged in groups by craft, each with a lead and a purpose.
- `create_group`, `update_group` and `list_groups` form one-off groups of 2 to 6 agents.

**Apps** (any agent):
- `app_guide`, `publish_app`, `undo_app`, `list_hermes_apps`, `app_logs` and `use_app` let an agent build small live apps, like a habit tracker, a status board or an office view of your agents.
- Today these apps show up in the Hermes One app. Other clients reach them through the plugin's routes at `/api/plugins/hermes-one/`, which answer while Hermes One is open.

## Coming next

A desktop half for Hermes' own desktop app, so you don't need a second app:
- a Hermes One look;
- a live view of the agent's own browser beside the chat;
- a page for the apps your agents build.

## Requirements

Hermes Agent 0.23 or newer.

## License

MIT. See [LICENSE](LICENSE).
