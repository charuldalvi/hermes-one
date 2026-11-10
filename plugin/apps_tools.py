"""Hermes One apps: tools for building small live apps that show up in the Hermes One Mac app.

Agents (Hermes and every other agent) write an app as a folder of files in one shared place,
``<hermes root>/hermes-one/apps-src/<id>/`` (``~/.hermes/hermes-one/apps-src/<id>/``), then call
``publish_app``. Hermes One (the Electron app) test-runs it in a sandbox, keeps the last ten versions
and shows it on its Apps page and as an Open card under the agent's reply.

The tools reach the running Hermes One through its localhost control endpoint: 127.0.0.1, a port and
a fresh token per launch, written to ``~/Library/Application Support/Hermes One/apps/control.json``
(mode 0600). When Hermes One isn't open the tools say so in plain words.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

_TOOLSET = "hermes_one"
_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,30}$")
_NOT_OPEN = (
    "Hermes One isn't open on this Mac, so apps can't be published or used right now. "
    "Ask the user to open Hermes One, then try again."
)


# ---------------------------------------------------------------------------------------------
# Where things are
# ---------------------------------------------------------------------------------------------
def _hermes_home() -> Path:
    """The calling profile's home (context-aware in a multi-profile gateway)."""
    try:
        from hermes_constants import get_hermes_home  # type: ignore

        return Path(get_hermes_home()).expanduser().resolve()
    except Exception:  # noqa: BLE001 - older cores
        return Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes")).expanduser().resolve()


def _root_home() -> Path:
    home = _hermes_home()
    return home.parent.parent if home.parent.name == "profiles" else home


def _profile() -> str:
    home = _hermes_home()
    return home.name if home.parent.name == "profiles" else "default"


def apps_src() -> Path:
    """Where app sources live: one folder for all the agents, so Hermes can fix any agent's app."""
    override = os.environ.get("HERMES_ONE_APPS_SRC", "").strip()
    return Path(override).expanduser() if override else _root_home() / "hermes-one" / "apps-src"


def _shown(path: Path) -> str:
    text = str(path)
    home = str(Path.home())
    return "~" + text[len(home):] if text.startswith(home) else text


def _control_file() -> Path:
    override = os.environ.get("HERMES_ONE_APPS_CONTROL", "").strip()
    if override:
        return Path(override).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Hermes One" / "apps" / "control.json"
    if sys.platform.startswith("win"):
        return Path(os.environ.get("APPDATA", str(Path.home()))) / "Hermes One" / "apps" / "control.json"
    return Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "Hermes One" / "apps" / "control.json"


class _AppsError(Exception):
    pass


def _call(method: str, route: str, body: dict | None = None, timeout: float = 120) -> object:
    try:
        control = json.loads(_control_file().read_text(encoding="utf-8"))
        port = int(control["port"])
        token = str(control["token"])
    except Exception:  # noqa: BLE001 - no file, or not ours
        raise _AppsError(_NOT_OPEN) from None
    data = json.dumps(body or {}).encode("utf-8") if method == "POST" else None
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{route}",
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - fixed loopback URL
            payload = json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8") or "{}")
        except Exception:  # noqa: BLE001
            raise _AppsError(f"Hermes One answered {exc.code}.") from None
    except (urllib.error.URLError, ConnectionError, OSError):
        raise _AppsError(_NOT_OPEN) from None
    if not isinstance(payload, dict) or not payload.get("ok"):
        error = payload.get("error") if isinstance(payload, dict) else None
        message = error.get("message") if isinstance(error, dict) else None
        raise _AppsError(str(message or "Hermes One couldn't do that."))
    return payload.get("value")


def _ok(**fields) -> str:
    return json.dumps({"ok": True, **fields}, ensure_ascii=False)


def _fail(message: str, **fields) -> str:
    return json.dumps({"ok": False, "error": message, **fields}, ensure_ascii=False)


def _clean_id(args: dict) -> str:
    return str(args.get("id") or args.get("app") or "").strip().lower()


# ---------------------------------------------------------------------------------------------
# The guide (app_guide returns it; the system prompt only points at it)
# ---------------------------------------------------------------------------------------------
GUIDE = r"""# Building a Hermes One app

A Hermes One app is a small app that shows up in the Hermes One Mac app, live, with no install: on
its Apps page, and as an Open card under your reply in the chat. Hermes One draws its screens with
its own native parts, so every app looks and moves like the rest of Hermes One (dark, quiet, plain
words). Screens are drawn in a column about 480 px wide, unless they're wide (see Screens), and the
same screens can show on a phone, about 380 px wide: a web page should fit any width.

Anything goes: a habit tracker, a radio or music player, a dashboard for a web API, a reading list,
a pomodoro timer, a client list, a recipe box, a home-automation remote, a game in a web view.

## The steps

1. Pick an id: lowercase letters, digits and dashes, starting with a letter (`habits`, `focus-radio`).
2. Write `{SRC}/<id>/app.json` and `{SRC}/<id>/main.js` (and `{SRC}/<id>/web/` if it needs a web
   view). This folder is shared by all the agents, so any agent can change any app.
3. Call `publish_app` with the id. It test-runs the app (it must start and draw its home screen); if
   anything is wrong you get the error and the old version stays live. Fix it and publish again.
   `check_only: true` test-runs without going live.
4. Read the warnings it returns and fix them too, then tell the user in a line what the app does.
   An Open card for it appears under your reply by itself.

To change an app, edit its files in `{SRC}/<id>/` and publish again. `undo_app` goes back to the
previous version. `app_logs` shows what the app printed and its errors. `list_hermes_apps` lists the apps
and their tools. `use_app` runs one of an app's tools, so you can drive apps for the user ("tick
my reading habit" → the habits app's `tick_habit` tool).

## app.json

```json
{
  "name": "Habits",
  "icon": "check",
  "color": "green",
  "description": "Tick off daily habits and keep streaks",
  "read": ["~/Documents/Habits"],
  "abilities": [],
  "background": false
}
```

- `name` (required): 1–40 characters, shown on its tile.
- `icon`: one of `music radio note check list calendar clock timer chart money mail camera photo
  video film mic book code globe map heart star bolt home cart game sun moon cloud bell folder file
  search user users chat link shield cpu plug palette spark leaf coffee bike dumbbell plane car pin
  gift key lock terminal rocket trophy flag inbox phone desktop trash plus play settings refresh`,
  or a single emoji.
- `color`: the tile's colour: `blue violet green amber rose teal orange ink`.
- `read`: folders on this Mac the app may read (like `~/Music`). Without them it reads only its own
  files and its data folder.
- `abilities`: what Hermes One must do for it (list the ones the app uses):
  - `audio`: plays sound in Hermes One (keeps playing on other pages; media keys work).
  - `web`: shows a web view.
  - `notify`: macOS notifications and reminders (scheduled ones ring while Hermes One is open).
  - `signin`: signs in to another service (Spotify, Google, GitHub…) through its own login page.
  - `photos`, `camera`, `files`: the user picks a photo, video or file on the Mac.
  - `location`: asks macOS where the Mac is.
  - `agents`: sees the user's agents live: who they are, each one's own bead look, what each is doing,
    and who talks to whom (never what they say). See "The agents" below.
  - (`screensaver` and `widget` are not in Hermes One yet.)
- `background`: `true` keeps the app running while Hermes One is open, even when nobody has it open
  (timers, polling an API). Leave it off unless the app must work on its own.

## main.js

An ES module with one default export:

```js
export default {
  // The app's state: plain JSON. It's saved after every action and survives restarts and new
  // versions. Only the first time is this used; after that the saved state is loaded.
  state: { habits: [], done: {} },

  // Screens: each is a function of ctx that returns what to draw. `home` is required.
  screens: {
    home: ({ state }) => ({
      title: 'Habits',
      subtitle: `${state.habits.length} habits`,
      body: [
        { type: 'field', placeholder: 'New habit', button: 'Add', action: { do: 'act', name: 'add' } },
        ...state.habits.map(h => ({
          type: 'row', title: h.name, subtitle: `${h.streak} day streak`, icon: 'check',
          toggle: { on: Boolean(state.done[h.id]), action: { do: 'act', name: 'tick', args: { id: h.id } } },
          menu: [{ label: 'Delete', icon: 'trash', danger: true, action: { do: 'act', name: 'remove', args: { id: h.id } } }]
        }))
      ]
    })
  },

  // Actions run when the user taps something. Change ctx.state; the screen redraws by itself.
  // Return nothing, or an action (or a list of them) to run after, like a toast.
  actions: {
    add: ({ state }, { text }) => {
      if (!text?.trim()) return { do: 'toast', text: 'Type a habit first' }
      state.habits.push({ id: crypto.randomUUID(), name: text.trim(), streak: 0 })
    },
    tick: ({ state }, { id, on }) => { state.done[id] = on },
    remove: ({ state }, { id }) => { state.habits = state.habits.filter(h => h.id !== id) }
  },

  // Optional: tools agents can call through use_app. `run` returns a short string for the agent.
  tools: {
    add_habit: {
      description: 'Add a habit to track',
      parameters: { name: { type: 'string', description: 'The habit, like "Read 20 pages"' } },
      run: ({ state }, { name }) => { state.habits.push({ id: crypto.randomUUID(), name, streak: 0 }); return `Added ${name}.` }
    }
  },

  // Optional: runs once when the app starts. Use it for timers; call ctx.hermes.update() after
  // changing state outside an action, so open screens redraw.
  start(ctx) {}
}
```

Rules that keep apps working:

- Apps run inside Hermes One in a sandbox with no npm and no Node modules. `import` works for files
  in the app's own folder (`import { x } from './lib.js'`, `import data from './data.json'`) and for
  `node:path` and `node:crypto` (hashes, random bytes). For files use `ctx.hermes.files`; for the
  web use `fetch` (http and https, up to 20 MB, 30 s). Also there: `setTimeout`/`setInterval`,
  `URL`, `URLSearchParams`, `TextEncoder`/`TextDecoder`, `atob`/`btoa`, `crypto.randomUUID()`,
  `structuredClone`, `AbortController`, `console.log` (it lands in the app's log).
- The app can't start programs, and can write only to its data folder (`ctx.hermes.dataDir`).
- Screens and actions may be `async`. Keep each under a few seconds (an app that doesn't answer in
  20 s is stopped); do slow work in `start` or in the background and call `ctx.hermes.update()`.
- State must be plain JSON (no Maps, Dates or functions). Store times as numbers (ms).

### ctx

- `ctx.state`: the app's state; change it in place.
- `ctx.params`: the params of the screen being drawn or acted on (from `{ do: 'open', params }`).
- `ctx.screen`: that screen's name.
- `ctx.hermes.files.list(dir, { deep, exts })`: files under a folder you may read:
  `[{ path, name, file, folder, ext, size, modified }]`.
- `await ctx.hermes.files.scan(dir, { deep, exts })`: the same without blocking. Use it for big
  folders and private ones (`~/Music`, `~/Documents`, `~/Desktop`, `~/Downloads`, `~/Pictures`):
  macOS may hold the first read until the user allows Hermes One in. Scan in `start` (not awaited)
  and call `ctx.hermes.update()` when it's done.
- `ctx.hermes.files.url(path)`: a link Hermes One loads that file from (images, audio).
- `ctx.hermes.files.read(path)` / `ctx.hermes.files.write(name, data)` / `ctx.hermes.files.exists(path)`:
  relative paths are in the data folder. `read(path, 'base64')` or `read(path, null)` for bytes.
- `ctx.hermes.update()`: redraw open screens now.
- `ctx.hermes.chat(bot, text)`: say something in the chat as the user (it goes to Hermes, marked as
  from this app; name an agent (its profile) to have Hermes pass it on). Only when the user tapped something that
  clearly asks for it.
- `ctx.hermes.perform(action)`: run an action now, even if the app isn't open (play audio, a toast,
  `{ do: 'open', screen }` to show a screen).
- `ctx.hermes.notify({ title, text, at?, id?, cancel? })`: a macOS notification. With `at` (ms) it
  rings then (while Hermes One is open); the same `id` replaces an earlier one; `{ id, cancel: true }`
  takes a scheduled one back. Needs `notify`.
- `ctx.hermes.agents()`: the agents feed (needs `agents`). See "The agents" below.
- `ctx.hermes.callbackUrl`: where a sign-in page sends the user back. See Signing in.
- `ctx.hermes.oauth.pkce()` → `{ verifier, challenge, method }` and `ctx.hermes.oauth.state()`.
- Apps written for Pod work too: `ctx.pod` is the same object.

## Screens

A screen is `{ title, subtitle?, actions?, body, refresh?, wide? }`:

- `title`: big title at the top. `subtitle`: a quiet line under it.
- `actions`: up to two icon buttons at the top right: `[{ icon, label, action }]`.
- `body`: the blocks, top to bottom; it scrolls.
- `refresh`: seconds; Hermes One redraws the screen this often while it's open (clocks, progress).
- `wide`: `true` to use the window's whole width (boards, tables, maps). Screens are otherwise a narrow
  column (about 480 px), like a phone. A screen with a `web` block of height `"fill"` is wide anyway.

### Blocks

Every block is `{ type, … }`. `null` and `false` in a list are skipped, so `cond && { … }` works.

| type | fields |
|---|---|
| `text` | `text`, `style` (`display` (big numbers) `title` `headline` `body` `reading` `callout` `caption` `mono`), `color` (`text` `text2` `text3` `accent` `amber` `ok` `danger`), `align` (`start` `center` `end`) |
| `markdown` | `text` (headings, lists, links, code, bold) |
| `section` | `label`, `children`, `trailing` (small text on the right), `action` (makes the trailing text tappable, like "See all") |
| `card` | `children`, `action?`, `tone` (`plain` `accent` `amber`) |
| `row` | `title`, `subtitle?`, `icon?` or `image?` (url), `trailing?`, `chevron?`, `toggle?: { on, action }`, `action?`, `hold?` (right click), `menu?: [{ label, icon?, danger?, action }]` |
| `list` | `items`: rows (row blocks without repeating `type`). Rows next to each other join into one list by themselves |
| `stack` | `children`, `direction` (`row` default or `column`), `gap`, `align` (`start` `center` `end` `between`). In a row, children share the width evenly |
| `grid` | `children`, `columns` (2–4) |
| `image` | `src` (url), `ratio` (width/height, default 1.78), `radius`, `caption?`, `action?` |
| `button` | `label`, `icon?`, `style` (`primary` `secondary` `danger`), `action`, `full?` |
| `icon_button` | `icon`, `label`, `action`, `filled?` |
| `toggle` | `label`, `on`, `action` (gets `{ on }` in args) |
| `slider` | `label?`, `value`, `min` (0), `max` (1), `step?`, `action` (gets `{ value }` when let go) |
| `segmented` | `options: [{ value, label }]`, `value`, `action` (gets `{ value }`) |
| `chips` | `options: [{ value, label, count? }]`, `value`, `action` (gets `{ value }`) |
| `field` | `placeholder`, `value?`, `button?` (label), `multiline?`, `action` (gets `{ text }` on submit), `clear?` (default true) |
| `progress` | `value` (0–1), `label?` |
| `stat` | `label`, `value`, `hint?`, `tone?` (`accent` `ok` `amber` `danger`) |
| `chart` | `kind` (`bar` `line`), `points: [{ label, value }]`, `label?` |
| `badge` | `text`, `tone?` (`ok` `amber` `danger`) |
| `code` | `text` (monospace box) |
| `empty` | `title`, `text?`, `icon?`, `action?`, `button?` (a friendly empty state) |
| `player` | `style` (`full` or `compact`): what Hermes One is playing, with controls (needs `audio`) |
| `web` | `path` (in the app's `web/` folder, default `index.html`), `height` (px, or `"fill"`: the rest of the window's height and its whole width) (needs `web`) |
| `divider` | — |
| `spacer` | `size` (px) |

Images take any `https://` url, or `ctx.hermes.files.url(path)` for a file on the Mac.

### Actions

What a tap does. An action is an object with `do`:

| do | fields | what happens |
|---|---|---|
| `act` | `name`, `args?` | runs `actions[name](ctx, args)` (plus `{ text }`, `{ on }` or `{ value }` from fields and controls), then redraws |
| `open` | `screen`, `params?` | opens another of the app's screens on top (back returns) |
| `back` | — | closes this screen |
| `play` | `queue: [{ url, title, artist?, art?, live? }]`, `index?` | plays audio in Hermes One (needs `audio`) |
| `audio` | `op` (`pause` `resume` `next` `previous` `stop`) | controls what's playing |
| `link` | `url` | opens a web page in the browser |
| `share` / `copy` | `text` | copies to the clipboard |
| `toast` | `text` | a short message at the bottom |
| `chat` | `bot`, `text` | says `text` in the chat (to Hermes, or through Hermes to `bot`) and shows it |
| `pick` | `kind` (`photo` `video` `camera` `file`), `act`, `args?`, `types?` (like `[".pdf"]`) | the user picks a file on the Mac; it's copied into the app's data folder (`uploads/`), then `actions[act]` runs with `{ file: { path, name, size, type } }` added to args. Show it with `ctx.hermes.files.url(file.path)` |
| `locate` | `act`, `args?` | asks macOS where the Mac is, then runs `actions[act]` with `{ lat, lon, accuracy, at }` |
| `notify` | `title`, `text`, `at?`, `id?`, `cancel?` | the same as `ctx.hermes.notify`, from a tap |
| `confirm` | `text`, `then`, `button?`, `danger?` | asks first, then runs `then` |
| `refresh` | — | redraws the screen |

An action may return any of these (or a list) to run afterwards.

### Signing in (Spotify, Google, GitHub…)

With `"abilities": ["signin"]`, an app can sign in to a service that uses OAuth 2.0:

1. The user creates an app in the service's developer dashboard (you can't do this for them). Show
   `ctx.hermes.callbackUrl` on a screen (in a `code` block) and ask them to add it as a redirect
   address, and to paste the client id into a `field` in your app (keep it in state, never in main.js).
2. A Connect button runs an action that makes a PKCE pair and a state, keeps them in `ctx.state`,
   and returns `{ do: 'link', url }` to the service's authorize page with
   `redirect_uri=ctx.hermes.callbackUrl`.
3. The browser comes back to Hermes One, which calls your app's `callback(ctx, query)`. Check
   `query.state`, trade `query.code` for tokens with `fetch` (with the verifier), keep them in state,
   and return `{ title: 'Connected', text: '…' }` for the page (or `{ title, text, ok: false }`).
4. Refresh the access token with the refresh token before it expires.

```js
callback: async ({ state, hermes }, query) => {
  if (!query.code || query.state !== state.pending?.state) return { title: "That sign-in didn't match", ok: false }
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: query.code, redirect_uri: hermes.callbackUrl, client_id: state.clientId, code_verifier: state.pending.verifier })
  })
  if (!response.ok) return { title: "Spotify didn't accept that", text: await response.text(), ok: false }
  state.tokens = { ...(await response.json()), at: Date.now() }
  state.pending = null
  return { title: 'Connected to Spotify', text: 'Go back to Hermes One.' }
}
```

`callbackUrl` is a 127.0.0.1 address on this Mac; it stays the same from launch to launch.

### Web view

When native blocks can't draw it (a game, a canvas, a visualiser), put a page in `web/` and show it
with `{ type: 'web', height: 'fill' }`, with `"abilities": ["web"]`. In the page:

- `await hermes.act(name, args)` runs an action and resolves with what it returned.
- `hermes.state` is the app's state; `hermes.onState(fn)` calls `fn` when it changes.
- CSS variables `--app-bg --app-surface --app-raised --app-text --app-text2 --app-text3 --app-accent
  --app-line --app-ok --app-amber --app-danger` match Hermes One.
- The page can load its own files from `web/` (scripts, styles, images) but can't reach the network
  or the Mac: fetch data through actions.

## The agents

With `"abilities": ["agents"]` an app can follow the user's agents live: an office or studio view, a
status board, a "who's busy" widget. `ctx.hermes.agents()` (and, in a web page, `hermes.agents`) is:

```
{ at,                                   // when it was made (ms)
  agents: [{ id, name, lead, role, look: { shape, color, pose }, status, doing?, since? }],
  groups: [{ id, name, members: [agent ids], lead? }],
  talks:  [{ id, at, from, to: [agent ids], kind, group? }] }
```

- `id` is the agent's profile name; `'default'` is Hermes, the lead (`lead: true`), which hands work out.
- `status`: `free`, `working`, `needs` (waiting on the user), `asleep` or `error`; `doing` says what (a short
  phrase like "Searching the web" or "In Coding crew"), `since` when it started (ms).
- `look` is the agent's own bead, the same as in Hermes One's sidebar: draw each agent in its `color`.
  `shape` is one of `round squircle capsule drop hexagon letter cloud triangle diamond cookie sunny
  clover arch`; `pose` is `Round Peek Corner Side Hang Lean`.
- `talks` are the last 50 times someone addressed someone, newest last. `from` and each of `to` is an agent
  id or `'you'` (the user). `kind`: `ask` (the user asked an agent or a group), `handoff` (one agent handed
  work to another), `reply` (an agent reported back), `group` (a message in a group; `group` is its id).
  A talk never includes the words: only who, to whom and when.

Hearing changes: export `onAgents(ctx, feed)` in the app object; it runs on every change (save what you need
in `ctx.state` and the screens redraw). In a web page, `hermes.onAgents(fn)` calls `fn(feed)` on every change
and `hermes.onTalk(fn)` calls `fn(talk)` once for each new talk as it happens, which is the moment to move
someone (walk from one desk to another, a speech bubble). Agents come and go: handle new ids and missing ones.

## When Hermes One can't do it yet

If the user asks for something these parts and abilities can't do (new hardware, a system feature),
say so plainly instead of faking it.

## Making it good

- Plain words people would say; a clear title; short labels; one main (primary) button per screen.
  Use `section` labels to group, `row`s for lists, `stat`s and `chart`s for numbers, `empty` for
  nothing-yet states with a button that fixes it.
- Every screen must make sense with no data yet.
- Keep `home` fast: read files and APIs in actions, `start`, or with a cache in state.
- Never put the user's secrets in a screen or in main.js. API keys the user gives you go in the
  data folder (`ctx.hermes.files.write('keys.json', …)`).
"""

_PROMPT = (
    "Apps: you can build small live apps for the user (a tracker, a player, a dashboard, a game) that "
    "appear in the Hermes One Mac app's Apps page and as an Open card under your reply. An app is a "
    "folder at {src}/<id>/ with app.json and main.js; the folder is shared by all the agents. Before "
    "writing or changing an app, call app_guide for the format. Then call publish_app with the id: it "
    "test-runs the app and makes it live, or returns the error while the old version stays live. Fix "
    "any warnings and publish again, then tell the user in one line what the app does (the Open card "
    "appears by itself). undo_app goes back one version, app_logs shows what an app printed and its "
    "errors, list_hermes_apps lists apps and their tools, and use_app runs an app's tool for the user. If "
    "Hermes One isn't open these tools say so; ask the user to open it. Find these tools with "
    "tool_search if they aren't loaded."
)


def apps_prompt() -> str:
    return _PROMPT.format(src=_shown(apps_src()))


# ---------------------------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------------------------
_ID_PARAM = {"type": "string", "description": "The app's id: its folder name under apps-src, like \"habits\"."}

APP_GUIDE_SCHEMA = {
    "name": "app_guide",
    "description": "How to build a Hermes One app: a small live app for the user (tracker, player, dashboard, game, anything), written as files in the agents' shared apps-src folder. Read this before you write or change an app.",
    "parameters": {"type": "object", "properties": {}},
}
LIST_APPS_SCHEMA = {
    "name": "list_hermes_apps",
    "description": "List the user's Hermes One apps: each one's id, name, version, who made it, its screens, and the tools you can run with use_app.",
    "parameters": {"type": "object", "properties": {}},
}
PUBLISH_APP_SCHEMA = {
    "name": "publish_app",
    "description": "Make the app in apps-src/<id>/ live in Hermes One, or update it. It test-runs the app first: on an error you get the message and the old version stays live. Read app_guide before writing an app.",
    "parameters": {
        "type": "object",
        "properties": {
            "id": _ID_PARAM,
            "check_only": {"type": "boolean", "description": "Only test-run it and report problems, without making it live."},
        },
        "required": ["id"],
    },
}
UNDO_APP_SCHEMA = {
    "name": "undo_app",
    "description": "Put a Hermes One app back to its previous version (when the user doesn't like a change).",
    "parameters": {"type": "object", "properties": {"id": _ID_PARAM}, "required": ["id"]},
}
APP_LOGS_SCHEMA = {
    "name": "app_logs",
    "description": "What a Hermes One app printed lately, its errors and its restarts. Use it to find out why an app misbehaves.",
    "parameters": {
        "type": "object",
        "properties": {"id": _ID_PARAM, "lines": {"type": "integer", "description": "How many recent lines (default 120, at most 300)."}},
        "required": ["id"],
    },
}
USE_APP_SCHEMA = {
    "name": "use_app",
    "description": "Run one of a Hermes One app's tools for the user, like the habits app's tick_habit. list_hermes_apps shows each app's tools and what they take.",
    "parameters": {
        "type": "object",
        "properties": {
            "id": _ID_PARAM,
            "tool": {"type": "string", "description": "The tool's name, from list_hermes_apps."},
            "args": {"type": "object", "description": "The tool's arguments, like {\"name\": \"Read 20 pages\"}.", "additionalProperties": True},
        },
        "required": ["id", "tool"],
    },
}


def app_guide_handler(args: dict, **_kwargs) -> str:
    return GUIDE.replace("{SRC}", _shown(apps_src()))


def list_hermes_apps_handler(args: dict, **_kwargs) -> str:
    try:
        apps = _call("GET", "/v1/apps", timeout=20)
    except _AppsError as exc:
        return _fail(str(exc))
    if not apps:
        return _ok(apps=[], message="No apps yet. app_guide explains how to build one.")
    out = []
    for app in apps if isinstance(apps, list) else []:
        out.append({
            "id": app.get("id"),
            "name": app.get("name"),
            "version": app.get("version"),
            "description": app.get("description"),
            "made_by": app.get("bot"),
            "screens": app.get("screens"),
            "tools": [{"name": t.get("name"), "description": t.get("description"), "parameters": t.get("parameters")} for t in app.get("tools") or []],
            "source": _shown(apps_src() / str(app.get("id"))),
        })
    return _ok(apps=out)


def publish_app_handler(args: dict, **_kwargs) -> str:
    app_id = _clean_id(args)
    if not _ID_RE.match(app_id):
        return _fail("Give the app's id: lowercase letters, digits and dashes, starting with a letter (like \"habits\").")
    folder = apps_src() / app_id
    if not (folder / "app.json").exists():
        return _fail(f"There is no {_shown(folder)}/app.json yet. Write the app there first (app_guide explains how).")
    check_only = bool(args.get("check_only"))
    try:
        done = _call("POST", "/v1/publish", {"id": app_id, "dir": str(folder), "bot": _profile(), "check_only": check_only}, timeout=120)
    except _AppsError as exc:
        return _fail(str(exc), id=app_id)
    done = done if isinstance(done, dict) else {}
    warnings = done.get("warnings") or []
    tools = [t.get("name") for t in done.get("tools") or []]
    if check_only:
        message = f"{done.get('name', app_id)} runs fine (not published)." + (" Fix the warnings, then publish." if warnings else "")
    else:
        message = (
            f"{done.get('name', app_id)} version {done.get('version')} is live in Hermes One (its Apps page, and an Open card under your reply)."
            + (" Fix the warnings too, then publish again." if warnings else " Tell the user in one line what it does.")
        )
    return _ok(id=app_id, name=done.get("name"), version=done.get("version"), checked=check_only, screens=done.get("screens"), tools=tools, warnings=warnings, message=message)


def undo_app_handler(args: dict, **_kwargs) -> str:
    app_id = _clean_id(args)
    try:
        done = _call("POST", "/v1/undo", {"id": app_id}, timeout=30)
    except _AppsError as exc:
        return _fail(str(exc), id=app_id)
    version = done.get("version") if isinstance(done, dict) else None
    return _ok(id=app_id, version=version, message=f"Back to version {version}. Its source folder still has your latest files; change them before publishing again.")


def app_logs_handler(args: dict, **_kwargs) -> str:
    app_id = _clean_id(args)
    try:
        text = _call("POST", "/v1/logs", {"id": app_id, "lines": args.get("lines") or 120}, timeout=20)
    except _AppsError as exc:
        return _fail(str(exc), id=app_id)
    return _ok(id=app_id, log=str(text or "") or "Nothing logged yet.")


def use_app_handler(args: dict, **_kwargs) -> str:
    app_id = _clean_id(args)
    tool = str(args.get("tool") or "").strip()
    raw = args.get("args")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else {}
        except ValueError:
            return _fail("args must be a JSON object, like {\"name\": \"Read 20 pages\"}.")
    if raw is not None and not isinstance(raw, dict):
        return _fail("args must be an object, like {\"name\": \"Read 20 pages\"}.")
    try:
        value = _call("POST", "/v1/tool", {"id": app_id, "tool": tool, "args": raw or {}}, timeout=60)
    except _AppsError as exc:
        return _fail(str(exc), id=app_id, tool=tool)
    return _ok(id=app_id, tool=tool, result=value if isinstance(value, (str, int, float, bool)) or value is None else value)


TOOLS = (
    (APP_GUIDE_SCHEMA, app_guide_handler, "📘"),
    (LIST_APPS_SCHEMA, list_hermes_apps_handler, "🧩"),
    (PUBLISH_APP_SCHEMA, publish_app_handler, "🚀"),
    (UNDO_APP_SCHEMA, undo_app_handler, "↩️"),
    (APP_LOGS_SCHEMA, app_logs_handler, "📜"),
    (USE_APP_SCHEMA, use_app_handler, "🎛️"),
)


def register_apps(ctx) -> None:
    """Register the app tools in every profile (any agent can build apps), and the prompt paragraph."""
    for schema, handler, emoji in TOOLS:
        ctx.register_tool(schema["name"], _TOOLSET, schema, handler, description=schema["description"], emoji=emoji)
    try:
        ctx.register_system_prompt_section("hermes-one-apps", apps_prompt(), position="after_memory")
    except Exception:  # noqa: BLE001 - optional on older cores
        pass
