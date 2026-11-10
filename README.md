# Hermes One

An unofficial desktop app for [Hermes Agent](https://github.com/NousResearch/hermes-agent): your Hermes as **one chat with your lead agent, Quicksilver**, who runs the rest of your agents. Your agents sit in the sidebar, each with its own face, and anything that needs you is one click away.

Hermes One is a community project. It is not made by or affiliated with Nous Research.

> **Prefer not to install another app?** Most of what Hermes One adds is also coming as a plugin for Hermes' own desktop app: [hermes-one-plugin](https://github.com/charuldalvi/hermes-one-plugin). Install the plugin either way: Hermes One uses its agent tools.

## What it does

**One chat with Quicksilver**
- Quicksilver is Hermes' default profile. Its chat has no threads: `/new` tidies the chat (Hermes' `/compact`) instead of starting another.
- The message box has a model chip with a thinking slider and fast mode, slash commands and skills, attachments, dictation, and **Talk**, a hands-free spoken conversation.
- Replies can be copied, read aloud, retried or edited.

**Your agents**
- Each agent has its own face, mood and status in the sidebar. Click one to talk to it directly.
- Quicksilver can add agents and arranges them into groups by craft. Group chats have a lead, @mentions and approvals.
- The side panel shows an agent's latest work: what it read, its steps and its answer.
- **Needs you:** approvals, questions and things to type (a sudo password, a key, a site login) from any agent arrive as cards. They also show in the Dock badge and as notifications.

**Beside the chat**
- **Browser:** the agent's own Chrome as a small browser, with closable tabs and an address bar. The agent's face marks the tab it's in, and Take over lets you click and type in the page. This works for Hermes on the same computer.
- **Screen:** an agent's Linux desktop, live, with Take over, on systems whose Hermes has one.
- **Terminal:** one tab per command an agent runs, with live output.

**Pages**
- **Apps:** small live apps your agents build, which run sandboxed.
- **Made:** files your agents produced.
- **Board:** Hermes' kanban.
- **Scheduled:** jobs.
- **Marketplace:** plugins, skills and connectors.
- **Settings:** models, skills, plugins, tools, memory, keys, messaging, system and all of Hermes' settings.

**Other computers.** Switch between Hermes on this computer and Hermes on another one, reached by Tailscale, an address, or SSH.

Light and dark follow your system. There's a frosted-window option and a quick-entry bar (⌥Space).

## Requirements

- [Hermes Agent](https://github.com/NousResearch/hermes-agent) 0.23 or newer, installed on this computer or reachable on another one.
- macOS or Windows 11. Linux is untested.
- Node.js 22 or newer to build it.

## Install

There are no prebuilt downloads yet. Build it yourself, which takes a few minutes:

```bash
git clone https://github.com/charuldalvi/hermes-one.git
cd hermes-one
npm install
npm run package        # macOS: builds Hermes One.app and copies it to ~/Applications
```

On Windows, run `npm run package:win`. It makes a zip with `Install Hermes One.cmd`. Windows SmartScreen warns the first time: choose More info, then Run anyway.

On a Mac, the app is signed with your own Apple Development certificate if you have one, otherwise ad hoc. Either works on the Mac that built it.

Then install the plugin into Hermes:

```bash
hermes plugins install charuldalvi/hermes-one-plugin
```

## How it connects

- **On this computer**, Hermes One runs `hermes gateway ensure` (which starts Hermes if needed) and connects to the gateway's WebSocket with a one-use ticket, as Hermes Desktop does.
- **On another computer**, use Systems at the bottom of the sidebar:
  - **Tailscale or an address:** sign in with your Hermes password, or a pairing link.
  - **SSH:** Hermes One starts Hermes there and connects through an SSH tunnel.

Sign-ins are kept encrypted in the system keychain.

## Develop

```bash
npm install
npm start              # build and run from source
npm run typecheck
```

- `electron/`: the main process: connecting to Hermes, other systems, the apps runtime, and the agent's Chrome (`browser.ts`).
- `src/`: the React window.
- `src/styles/tokens.css` holds every colour, size and duration.

## Credits

- [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research (MIT). Hermes One speaks its gateway protocol, and parts follow how Hermes Desktop works.
- [noVNC](https://github.com/novnc/noVNC) (MPL-2.0) draws the agent screen. [xterm.js](https://github.com/xtermjs/xterm.js) (MIT) draws the terminal.
- [Inter](https://rsms.me/inter/) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/) fonts (SIL OFL).

## License

MIT. See [LICENSE](LICENSE).
