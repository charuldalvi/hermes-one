# Hermes One

Your [Hermes Agent](https://github.com/NousResearch/hermes-agent) as **one chat with your lead agent, Quicksilver**, who builds and runs the rest of your agents.

It comes in two parts, in this one repo:

- **[The plugin](plugin/)** goes into Hermes. Your lead agent can add agents and arrange them into groups, and any agent can build small live apps. In Hermes Desktop it also adds a Hermes One look and a live view of the agent's own browser.
- **[The app](app/)** is a desktop app for Mac and Windows. It shows your agents in a sidebar, each with its own face, and one chat with Quicksilver. Beside the chat it shows the agent's browser, its screen (on Linux servers) and its terminal, plus the apps your agents build.

Hermes One is a community project. It is not made by or affiliated with Nous Research.

## Install

One command installs (or updates) both: the plugin into your Hermes and every agent's profile, and the app. It restarts Hermes so the plugin loads, but only when no agent is working.

**Mac** (and Linux, plugin only):

```bash
curl -fsSL https://raw.githubusercontent.com/charuldalvi/hermes-one/main/install.sh | sh
```

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/charuldalvi/hermes-one/main/install.ps1 | iex
```

To get only the plugin on a Mac, run `curl -fsSL https://raw.githubusercontent.com/charuldalvi/hermes-one/main/install.sh | sh -s -- --plugin-only`. Use `--app-only` for only the app.

You need [Hermes Agent](https://github.com/NousResearch/hermes-agent) 0.23 or newer.

### Other ways

- **Only the plugin, from Hermes:** `hermes plugins install charuldalvi/hermes-one#plugin --enable`. In Hermes Desktop, paste `hermes://plugin/install?repo=charuldalvi/hermes-one%23plugin&enable=1` into your browser's address bar.
- **Only the app:** download it from [Releases](https://github.com/charuldalvi/hermes-one/releases/latest). The Mac app isn't notarised by Apple, so the first time, right-click it and choose Open. The install command doesn't need that.

In Hermes Desktop, the plugin's look and browser view stay off until you turn them on in **Capabilities → Plugins → Hermes One**.

## What you get

**In the app**
- One chat with Quicksilver, with no threads. It has a model chip with a thinking slider, slash commands, attachments, dictation and a hands-free **Talk** mode.
- **Your agents** in the sidebar, each with its own face, mood and status. Click one to talk to it directly.
  - Quicksilver adds agents and arranges them into groups by craft.
  - Group chats have a lead, @mentions and approvals.
  - Anything that needs you (an approval, a question, a password) shows up as a card.
- **Beside the chat:**
  - the agent's own browser, with closable tabs, an address bar and Take over;
  - its screen, on Linux servers;
  - its terminal, one tab per command, live.
- **Pages:** apps your agents build, files they made, Hermes' board, scheduled jobs, the marketplace, and all of Hermes' settings.
- **Other computers:** reach Hermes on another machine by Tailscale, an address or SSH.

**From the plugin**, for your agents:
- `create_agent`, `list_agents`, `arrange_groups`, `create_group`, `update_group` and `list_groups` build and organise the team.
- `app_guide`, `publish_app`, `use_app` and their friends let an agent build small live apps, like a habit tracker or an office view of your agents.

**From the plugin, in Hermes Desktop:**
- the Hermes One theme;
- the agent's browser, live, in a tab of its own, which opens by itself when the agent starts browsing.

## Build it yourself

**App** (Node.js 22 or newer):

```bash
cd app
npm install
npm start               # run from source
npm run package         # macOS: builds Hermes One.app into ~/Applications
npm run package:win     # Windows zip with an installer
```

**Plugin:** `plugin/desktop/plugin.js` is built from `plugin/desktop-src/` with `cd plugin/desktop-src && npm install && npm run build`. Check the whole plugin with `hermes plugins validate plugin`.

**Releases:** pushing a tag like `v0.3.0` runs [the release workflow](.github/workflows/release.yml). It builds the Mac (Apple silicon and Intel) and Windows zips and attaches them to the release, where the installers find them.

## Credits

- [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research (MIT). Hermes One speaks its gateway protocol, and parts follow how Hermes Desktop works.
- [noVNC](https://github.com/novnc/noVNC) (MPL-2.0) draws the agent screen, and [xterm.js](https://github.com/xtermjs/xterm.js) (MIT) the terminal.
- [Inter](https://rsms.me/inter/) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/) fonts (SIL OFL).

## License

MIT. See [LICENSE](LICENSE).
