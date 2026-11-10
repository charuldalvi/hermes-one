# Hermes One app

The desktop app (Mac and Windows). To install it, use the one-line installer in the [main README](../README.md#install), or download it from [Releases](https://github.com/charuldalvi/hermes-one/releases/latest).

## How it connects

- **On this computer**, Hermes One runs `hermes gateway ensure`, which starts Hermes if needed. Then it connects to the gateway's WebSocket with a one-use ticket, as Hermes Desktop does.
- **On another computer**, use Systems at the bottom of the sidebar:
  - **Tailscale or an address:** sign in with your Hermes password, or a pairing link.
  - **SSH:** Hermes One starts Hermes there and connects through an SSH tunnel.

Sign-ins are kept encrypted in the system keychain.

## Develop

```bash
npm install
npm start               # build and run from source
npm run typecheck
npm run package         # macOS: Hermes One.app, copied to ~/Applications (add -- --no-install to skip that)
npm run package:win     # Windows: a zip with the app, the plugin from ../plugin and an installer
```

- `electron/` is the main process: connecting to Hermes, other systems, the apps runtime, and the agent's Chrome (`browser.ts`).
- `src/` is the React window.
- `src/styles/tokens.css` holds every colour, size and duration.
