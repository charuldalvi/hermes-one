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

## In Hermes Desktop

The plugin also adds to Hermes' own desktop app. That part stays off until you turn it on in **Capabilities → Plugins → Hermes One**.

- **The Hermes One look:** pick **Hermes One** in Settings → Appearance. It's one quiet charcoal tone in dark mode and paper in light, with near-white text, a white main button, and the Inter and JetBrains Mono fonts.
- **The agent's browser:** the agent's own Chrome, live, in a tab of its own.
  - **Opening it:** run ⌘K → *Show the agent's browser*, or let it open by itself when the agent in your chat starts browsing. Close it and it stays closed for 10 minutes.
  - **What it shows:** the agent's tabs, which you can close, with a dot on the one it's working in. The view follows it there. There's also the address bar and the page.
  - **Take over:** sends your clicks, scrolls and typing to the page.
  - **Size:** the agent's window gets a desktop width in the tab's shape, so sites show their computer layout.
  - **Where it works:** the plugin's own routes inside Hermes stream the browser, so it works whether Hermes runs on your computer or on a server.

Coming next: a page for the apps your agents build.

## Develop

`desktop/plugin.js` is built from `desktop-src/`:

```bash
npm install
npm run build
```

## Requirements

Hermes Agent 0.23 or newer.

## License

MIT. See [LICENSE](LICENSE).
