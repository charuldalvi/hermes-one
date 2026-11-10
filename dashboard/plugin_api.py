"""Hermes One's apps over Hermes' own HTTP API, for other clients such as a phone app.

Hermes' web server imports this file by path (``hermes_cli/web_server_dashboard.py``,
``_mount_plugin_api_routes``; hot-mounted on the first request) and mounts ``router`` under
``/api/plugins/hermes-one/``, behind Hermes' own auth, while ``hermes-one`` is in the launch profile's
``plugins.enabled``. The import is standalone (no package), so nothing here imports the plugin's
other files.

Every route proxies to Hermes One's localhost control endpoint: 127.0.0.1, with the port and the
per-launch token from ``~/Library/Application Support/Hermes One/apps/control.json``.

The contract:

- Success is the plain JSON value with HTTP 200. Failure is a 4xx/5xx with
  ``{"detail": "<plain message>", "code": "apps/..."}`` (the phone shows ``detail`` as the error line).
- While Hermes One is closed, every route answers 503 ``apps/closed``, except ``GET apps``: that
  one reads the list from disk and says ``"running": false``.

    GET  apps                        {running, apps: [AppSummary as in lib/apps.ts]}
    POST apps/{id}/screen            {screen, params, rev?}          -> {app, rev, same?, screen?}
    POST apps/{id}/act               {action, args, screen, params}  -> {app, rev, result, screen}
    GET  apps/{id}/info              {app, version, versions: [{version, bot, publishedAt}]}
    GET  apps/{id}/logs?lines=120    the log's last lines, as text
    POST apps/{id}/undo              {app, version}
    POST apps/{id}/remove            {app, removed}
    GET  apps/{id}/state             {app, rev, state}
    GET  apps/feed                   the agents feed the window last gave the apps
    GET  apps/events?after=&wait=25  {seq, events: [AppsEvent], gap?}  (a long poll; gap: reload all)
    GET  apps/{id}/web/{path}        exactly what hermes-app://{id}/web/... answers in the window
    GET  apps/{id}/file/{name}       ... hermes-app://{id}/file/...  (signed file links)
    GET  apps/{id}/stream/{name}     ... hermes-app://{id}/stream/... (signed audio streams)
         The file routes pass Range through, and the headers (CSP too) back.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote

try:
    import httpx
    from fastapi import APIRouter, Request
    from fastapi.responses import JSONResponse, PlainTextResponse, Response, StreamingResponse
except ImportError:  # imported outside Hermes' web server (to test the plain helpers)
    httpx = None  # type: ignore[assignment]
    APIRouter = None  # type: ignore[assignment,misc]

_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,30}$")
_FILE_KINDS = {"web", "file", "stream"}
_PASS_HEADERS = ("content-type", "content-length", "content-range", "accept-ranges", "cache-control", "content-security-policy")
_NO_STORE = {"cache-control": "no-store"}
_CLOSED = "Hermes One isn't open on the Mac. Open it there to use apps."
_EVENTS_WAIT_MAX = 25


# ---------------------------------------------------------------------------------------------
# Where Hermes One is
# ---------------------------------------------------------------------------------------------
def _control_file() -> Path:
    override = os.environ.get("HERMES_ONE_APPS_CONTROL", "").strip()
    if override:
        return Path(override).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Hermes One" / "apps" / "control.json"
    if sys.platform.startswith("win"):
        return Path(os.environ.get("APPDATA", str(Path.home()))) / "Hermes One" / "apps" / "control.json"
    return Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "Hermes One" / "apps" / "control.json"


def _control() -> tuple[str, str] | None:
    """(base URL, token) of the running Hermes One, or None when it never started (no control.json)."""
    try:
        data = json.loads(_control_file().read_text(encoding="utf-8"))
        return f"http://127.0.0.1:{int(data['port'])}", str(data["token"])
    except Exception:  # noqa: BLE001 - no file, or not ours
        return None


# ---------------------------------------------------------------------------------------------
# The list from disk, while Hermes One is closed (mirrors checkManifest and summary in apps.ts)
# ---------------------------------------------------------------------------------------------
def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value]
    return [] if value is None else [str(value)]


def _manifest(app_id: str, raw: Any) -> dict | None:
    if not isinstance(raw, dict):
        return None
    name = str(raw.get("name") or "").strip()
    if not name or len(name) > 40:
        return None
    return {
        "name": name,
        "icon": str(raw.get("icon") or "spark")[:24],
        "color": str(raw.get("color") or "blue")[:16],
        "description": str(raw.get("description") or "")[:200],
        "abilities": [a for a in _as_list(raw.get("abilities")) if a][:10],
        "background": raw.get("background") is True,
    }


def apps_on_disk(root: Path | None = None) -> list[dict]:
    """Every published app as an AppSummary, read from Hermes One's folder (rev 0, nothing running)."""
    root = root or _control_file().parent
    out: list[dict] = []
    try:
        children = sorted(p for p in root.iterdir() if p.is_dir() and _ID_RE.match(p.name))
    except OSError:
        return out
    for child in children:
        try:
            version = int((child / "current").read_text(encoding="utf-8").strip())
            folder = child / "versions" / str(version)
            manifest = _manifest(child.name, json.loads((folder / "app.json").read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
        if manifest is None:
            continue
        try:
            meta = json.loads((folder / ".meta.json").read_text(encoding="utf-8"))
            meta = meta if isinstance(meta, dict) else {}
        except (OSError, ValueError):
            meta = {}
        try:
            versions = sorted(int(p.name) for p in (child / "versions").iterdir() if p.name.isdigit())
        except OSError:
            versions = [version]
        summary = {
            "id": child.name, **manifest, "version": version, "versions": versions, "rev": 0,
            "tools": meta.get("tools") or [], "screens": meta.get("screens") or ["home"], "running": False,
        }
        for key in ("bot", "publishedAt"):
            if meta.get(key) is not None:
                summary[key] = meta[key]
        out.append(summary)
    out.sort(key=lambda a: (-(a.get("publishedAt") or 0), a["name"].lower()))
    return out


# ---------------------------------------------------------------------------------------------
# Talking to the control endpoint
# ---------------------------------------------------------------------------------------------
class _Closed(Exception):
    """Hermes One isn't running (or its control.json is stale)."""


class _Failed(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _error(status: int, code: str, message: str):
    # One line: the phone shows it as the error line (an app's stack lines stay in its log).
    line = message.strip().split("\n", 1)[0].strip() or "Hermes One couldn't do that."
    return JSONResponse({"detail": line, "code": code}, status_code=status, headers=_NO_STORE)


def _closed():
    return _error(503, "apps/closed", _CLOSED)


async def _value(method: str, route: str, *, body: dict | None = None, params: dict | None = None, timeout: float = 60.0) -> Any:
    """The control endpoint's value; raises _Closed or _Failed."""
    control = _control()
    if control is None:
        raise _Closed()
    base, token = control
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=3.0)) as client:
            response = await client.request(
                method, base + route, params=params, json=body if method == "POST" else None,
                headers={"Authorization": f"Bearer {token}"},
            )
    except (httpx.ConnectError, httpx.ConnectTimeout):
        raise _Closed() from None
    except httpx.TimeoutException:
        raise _Failed(504, "apps/timeout", "Hermes One took too long to answer.") from None
    except httpx.TransportError:  # it quit mid-answer
        raise _Closed() from None
    if response.status_code == 401:  # a stale control.json: another program has that port now
        raise _Closed()
    try:
        payload = response.json()
    except ValueError:
        raise _Failed(502, "apps/bad-answer", "Hermes One's answer wasn't JSON.") from None
    if isinstance(payload, dict) and payload.get("ok"):
        return payload.get("value")
    error = payload.get("error") if isinstance(payload, dict) else None
    error = error if isinstance(error, dict) else {}
    status = response.status_code if response.status_code >= 400 else 500
    raise _Failed(status, str(error.get("code") or "apps/error"), str(error.get("message") or "Hermes One couldn't do that."))


async def _json(method: str, route: str, **kwargs: Any):
    try:
        return JSONResponse(await _value(method, route, **kwargs), headers=_NO_STORE)
    except _Closed:
        return _closed()
    except _Failed as exc:
        return _error(exc.status, exc.code, exc.message)


async def _body(request: Request) -> dict:
    raw = await request.body()
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except ValueError:
        raise _Failed(400, "apps/invalid", "The request body must be JSON.") from None
    if not isinstance(value, dict):
        raise _Failed(400, "apps/invalid", "The request body must be a JSON object.")
    return value


def _no_app(app_id: str):
    return _error(404, "apps/no-app", f'There is no app called "{app_id}".')


def _object(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


# ---------------------------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------------------------
if APIRouter is not None:
    router = APIRouter()

    @router.get("/apps")
    async def list_apps():
        try:
            apps = await _value("GET", "/v1/apps", timeout=15.0)
            return JSONResponse({"running": True, "apps": apps or []}, headers=_NO_STORE)
        except _Closed:
            return JSONResponse({"running": False, "apps": apps_on_disk()}, headers=_NO_STORE)
        except _Failed as exc:
            return _error(exc.status, exc.code, exc.message)

    @router.get("/apps/feed")
    async def feed():
        return await _json("GET", "/v1/feed", timeout=15.0)

    @router.get("/apps/events")
    async def events(request: Request):
        query = request.query_params
        params: dict[str, str] = {}
        after = query.get("after", "").strip()
        if after:
            try:
                params["after"] = str(int(float(after)))
            except ValueError:
                return _error(400, "apps/invalid", "after must be a number (the seq of the last answer).")
        try:
            wait = max(0, min(_EVENTS_WAIT_MAX, int(float(query.get("wait") or 0))))
        except ValueError:
            wait = 0
        params["wait"] = str(wait)
        return await _json("GET", "/v1/events", params=params, timeout=wait + 15.0)

    @router.post("/apps/{app_id}/screen")
    async def screen(app_id: str, request: Request):
        if not _ID_RE.match(app_id):
            return _no_app(app_id)
        try:
            body = await _body(request)
        except _Failed as exc:
            return _error(exc.status, exc.code, exc.message)
        return await _json("POST", "/v1/screen", body={
            "id": app_id, "screen": str(body.get("screen") or "home"), "params": _object(body.get("params")), "rev": body.get("rev"),
        })

    @router.post("/apps/{app_id}/act")
    async def act(app_id: str, request: Request):
        if not _ID_RE.match(app_id):
            return _no_app(app_id)
        try:
            body = await _body(request)
        except _Failed as exc:
            return _error(exc.status, exc.code, exc.message)
        return await _json("POST", "/v1/act", body={
            "id": app_id, "action": str(body.get("action") or ""), "args": _object(body.get("args")),
            "screen": str(body.get("screen") or "home"), "params": _object(body.get("params")),
        })

    @router.get("/apps/{app_id}/info")
    async def info(app_id: str):
        if not _ID_RE.match(app_id):
            return _no_app(app_id)
        return await _json("GET", "/v1/info", params={"id": app_id}, timeout=15.0)

    @router.get("/apps/{app_id}/state")
    async def state(app_id: str):
        if not _ID_RE.match(app_id):
            return _no_app(app_id)
        return await _json("GET", "/v1/state", params={"id": app_id})

    @router.get("/apps/{app_id}/logs")
    async def logs(app_id: str, request: Request):
        if not _ID_RE.match(app_id):
            return _no_app(app_id)
        try:
            lines = max(1, min(300, int(request.query_params.get("lines") or 120)))
        except ValueError:
            lines = 120
        try:
            text = await _value("POST", "/v1/logs", body={"id": app_id, "lines": lines}, timeout=15.0)
        except _Closed:
            return _closed()
        except _Failed as exc:
            return _error(exc.status, exc.code, exc.message)
        return PlainTextResponse(str(text or ""), headers=_NO_STORE)

    @router.post("/apps/{app_id}/undo")
    async def undo(app_id: str):
        if not _ID_RE.match(app_id):
            return _no_app(app_id)
        return await _json("POST", "/v1/undo", body={"id": app_id})

    @router.post("/apps/{app_id}/remove")
    async def remove(app_id: str):
        if not _ID_RE.match(app_id):
            return _no_app(app_id)
        return await _json("POST", "/v1/remove", body={"id": app_id})

    # Last: these catch every other GET under an app (an unknown kind is a 404).
    @router.api_route("/apps/{app_id}/{kind}", methods=["GET", "HEAD"])
    @router.api_route("/apps/{app_id}/{kind}/{rest:path}", methods=["GET", "HEAD"])
    async def app_file(app_id: str, kind: str, request: Request, rest: str = ""):
        if not _ID_RE.match(app_id) or kind not in _FILE_KINDS:
            return _error(404, "apps/not-found", "Not found.")
        control = _control()
        if control is None:
            return _closed()
        base, token = control
        url = f"{base}/v1/files/{app_id}/{kind}/{quote(rest, safe='/')}"
        if request.url.query:
            url += f"?{request.url.query}"
        headers = {"Authorization": f"Bearer {token}"}
        if request.headers.get("range"):
            headers["Range"] = request.headers["range"]
        client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=3.0))
        try:
            upstream = await client.send(client.build_request(request.method, url, headers=headers), stream=True)
        except httpx.TransportError:
            await client.aclose()
            return _closed()
        if upstream.status_code == 401:
            await upstream.aclose()
            await client.aclose()
            return _closed()
        out = {key: upstream.headers[key] for key in _PASS_HEADERS if key in upstream.headers}
        if request.method == "HEAD" or upstream.status_code in (204, 304):
            await upstream.aclose()
            await client.aclose()
            return Response(status_code=upstream.status_code, headers=out)

        async def body():
            try:
                async for chunk in upstream.aiter_raw():
                    yield chunk
            finally:
                await upstream.aclose()
                await client.aclose()

        return StreamingResponse(body(), status_code=upstream.status_code, headers=out)


# ---------------------------------------------------------------------------------------------
# The agent's own Chrome, for the desktop half's Browser tab.
#
# Hermes browses with a real Chrome it starts itself: one per agent, headless, with a DevTools port
# (``--remote-debugging-port=0``, written to ``DevToolsActivePort`` in its profile folder). These routes
# run wherever Hermes runs (this computer or a server), find that Chrome, stream the picture of its tab
# (``Page.startScreencast``) and pass your clicks and keys on when you take over. They only ever talk to
# 127.0.0.1, and only to Chromes whose profile folder lies inside one of this Hermes' homes.
#
#     GET  browser/agents             {profiles: [...]}  the agents with a Chrome open right now
#     WS   browser/watch/{profile}    {kind:'hello', watch}, then {kind:'tabs'|'frame'|'nav'|'none'|'gone', ...}
#     POST browser/act                {watch, type, ...}  select, close, follow, fit, navigate, back,
#                                     forward, reload, mouse, key, text
#     GET  browser/snapshot?profile=  {tabs, current, url, frame}  one picture, for when there's no socket
# ---------------------------------------------------------------------------------------------
import asyncio
import secrets

try:
    from fastapi import WebSocket, WebSocketDisconnect
except ImportError:  # outside Hermes' web server
    WebSocket = WebSocketDisconnect = None  # type: ignore[assignment,misc]


def _hermes_root() -> Path:
    home = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes")).expanduser()
    return home.parent.parent if home.parent.name == "profiles" else home


def _hermes_homes() -> list[tuple[str, str]]:
    """(profile, real home) for the main home ("default") and every agent's; longest first."""
    root = _hermes_root()
    homes = [("default", os.path.realpath(root))]
    try:
        for entry in sorted((root / "profiles").iterdir()):
            if entry.is_dir():
                homes.append((entry.name, os.path.realpath(entry)))
    except OSError:
        pass
    return sorted(homes, key=lambda h: -len(h[1]))


def _profile_dir_of(args: list[str]) -> str | None:
    if not any(a.startswith("--remote-debugging-port") for a in args) or any(a.startswith("--type=") for a in args):
        return None
    for a in args:
        if a.startswith("--user-data-dir="):
            return a.split("=", 1)[1].strip("'\"") or None
    return None


async def _debug_chrome_dirs() -> list[str]:
    """Profile folders of the Chromes running with a DevTools port (main processes only)."""
    dirs: list[str] = []
    if sys.platform.startswith("linux") and Path("/proc").is_dir():
        # Exact arguments, and works in slim containers without ps.
        for proc in Path("/proc").iterdir():
            if proc.name.isdigit():
                try:
                    args = [a.decode("utf-8", "replace") for a in (proc / "cmdline").read_bytes().split(b"\0") if a]
                except OSError:
                    continue
                folder = _profile_dir_of(args)
                if folder and folder not in dirs:
                    dirs.append(folder)
        return dirs
    if os.name == "nt":
        return dirs  # not on Windows yet
    try:
        ps = await asyncio.create_subprocess_exec("ps", "-ax", "-o", "command=", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        out, _ = await asyncio.wait_for(ps.communicate(), 5)
    except Exception:
        return dirs
    for line in out.decode("utf-8", "replace").splitlines():
        if "--remote-debugging-port" not in line or "--user-data-dir=" not in line or " --type=" in line:
            continue
        # ps doesn't quote arguments, and a folder name may hold spaces: it runs up to the next " --flag".
        folder = re.split(r"\s+--[a-z]", line.split("--user-data-dir=", 1)[1], maxsplit=1)[0].strip().strip("'\"")
        if folder and folder not in dirs:
            dirs.append(folder)
    return dirs


async def find_browsers() -> list[dict]:
    """The agents' Chromes running now, each matched to the agent whose Hermes home holds its profile folder."""
    homes = _hermes_homes()
    found: list[dict] = []
    for raw in await _debug_chrome_dirs():
        folder = os.path.realpath(raw)
        owner = next((p for p, h in homes if folder == h or folder.startswith(h + os.sep)), None)
        if owner is None:
            continue
        try:
            lines = Path(folder, "DevToolsActivePort").read_text().split("\n")
            port, ws_path = int(lines[0].strip()), (lines[1].strip() if len(lines) > 1 else "")
        except (OSError, ValueError, IndexError):
            continue
        try:
            async with httpx.AsyncClient(timeout=1.5, trust_env=False) as client:
                answer = await client.get(f"http://127.0.0.1:{port}/json/version")
            if answer.status_code != 200 or (ws_path and not str(answer.json().get("webSocketDebuggerUrl", "")).endswith(ws_path)):
                continue
        except Exception:
            continue
        found.append({"profile": owner, "port": port, "ws_path": ws_path})
    return found


_KEYS = {"Enter": (13, "\r"), "Backspace": (8, None), "Tab": (9, None), "Escape": (27, None), "Delete": (46, None),
         "Home": (36, None), "End": (35, None), "PageUp": (33, None), "PageDown": (34, None), "ArrowLeft": (37, None),
         "ArrowUp": (38, None), "ArrowRight": (39, None), "ArrowDown": (40, None), " ": (32, " ")}


class _Cdp:
    """A small Chrome DevTools Protocol client over the browser's own WebSocket (sessions flattened)."""

    def __init__(self, on_event):
        self._on_event = on_event
        self._ws = None
        self._next = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._tasks: set[asyncio.Task] = set()
        self.closed = asyncio.Event()

    async def open(self, port: int, ws_path: str):
        from websockets.asyncio.client import connect
        self._ws = await connect(f"ws://127.0.0.1:{port}{ws_path}", max_size=None, open_timeout=5, proxy=None)
        self.spawn(self._read())

    def spawn(self, coro):
        """Run alongside (never inline in the reader: a call awaited there would wait on itself)."""
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(lambda t: (self._tasks.discard(t), t.cancelled() or t.exception()))
        return task

    async def _read(self):
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(msg.get("id"), int):
                    fut = self._pending.pop(msg["id"], None)
                    if fut is not None and not fut.done():
                        if "error" in msg:
                            fut.set_exception(RuntimeError(str((msg["error"] or {}).get("message", "DevTools error"))))
                        else:
                            fut.set_result(msg.get("result") or {})
                elif msg.get("method"):
                    try:
                        await self._on_event(msg["method"], msg.get("params") or {}, msg.get("sessionId"))
                    except Exception:
                        pass
        except Exception:
            pass
        finally:
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(RuntimeError("closed"))
            self._pending.clear()
            self.closed.set()

    async def call(self, method: str, params: dict | None = None, session: str | None = None, timeout: float = 10.0) -> dict:
        if self._ws is None or self.closed.is_set():
            raise RuntimeError("closed")
        self._next += 1
        fut = asyncio.get_running_loop().create_future()
        self._pending[self._next] = fut
        frame = {"id": self._next, "method": method, "params": params or {}}
        if session:
            frame["sessionId"] = session
        await self._ws.send(json.dumps(frame))
        return await asyncio.wait_for(fut, timeout)

    async def close(self):
        try:
            if self._ws is not None:
                await self._ws.close()
        except Exception:
            pass
        for task in list(self._tasks):
            task.cancel()


class _BrowserWatch:
    """Watching one agent's Chrome: its tabs, the picture of the tab on view, and your input when you take over."""

    def __init__(self, browser: dict, send):
        self.browser = browser
        self._send = send
        self.cdp = _Cdp(self._event)
        self._infos: dict[str, dict] = {}
        self._agent: set[str] = set()
        self._session: str | None = None
        self._current: str | None = None
        self._follow = True
        self._frame = (0, 0)
        self._fit: tuple[float, float] | None = None

    async def start(self):
        await self.cdp.open(self.browser["port"], self.browser["ws_path"])
        await self.cdp.call("Target.setDiscoverTargets", {"discover": True})
        for info in (await self.cdp.call("Target.getTargets")).get("targetInfos") or []:
            self._info(info, initial=True)
        first = self._agent_tab() or next((t["id"] for t in self._pages()), None)
        await self._push_tabs()
        if first:
            await self.view(first)

    async def stop(self):
        await self.cdp.close()

    def _pages(self) -> list[dict]:
        return [t for t in self._infos.values() if t["type"] == "page" and not t["url"].startswith("devtools://")]

    def _agent_tab(self) -> str | None:
        ids = [t["id"] for t in self._pages() if t["id"] in self._agent]
        return ids[-1] if ids else None

    def _info(self, t: dict, initial: bool = False):
        tid = str(t.get("targetId"))
        prev = self._infos.get(tid)
        attached = bool(t.get("attached"))
        self._infos[tid] = {"id": tid, "title": str(t.get("title") or ""), "url": str(t.get("url") or ""), "attached": attached, "type": str(t.get("type") or "")}
        # Someone else attached to a tab we aren't on: that's the agent working in it.
        if attached and (initial or not (prev and prev["attached"])) and tid != self._current:
            self._agent.add(tid)
        elif not attached:
            self._agent.discard(tid)

    async def _push_tabs(self):
        await self._send({"kind": "tabs", "current": self._current, "follow": self._follow,
                          "tabs": [{"id": t["id"], "title": t["title"] or t["url"], "url": t["url"], "agent": t["id"] in self._agent} for t in self._pages()]})

    async def _event(self, method: str, p: dict, session: str | None):
        if method in ("Target.targetCreated", "Target.targetInfoChanged"):
            info = p.get("targetInfo") or {}
            tid = str(info.get("targetId"))
            was_agent = tid in self._agent
            self._info(info)
            if tid == self._current:
                self.cdp.spawn(self._nav_state())
            elif not self._current and any(t["id"] == tid for t in self._pages()):
                self.cdp.spawn(self.view(tid))  # nothing on view (the last tab closed): show the next page that opens
            if self._follow and not was_agent and tid in self._agent and tid != self._current:
                self.cdp.spawn(self.view(tid))  # follow the agent to a tab it just started working in
            await self._push_tabs()
        elif method == "Target.targetDestroyed":
            tid = str(p.get("targetId"))
            self._infos.pop(tid, None)
            self._agent.discard(tid)
            if tid == self._current:
                self._current = self._session = None
                nxt = self._agent_tab() or next((t["id"] for t in self._pages()), None)
                if nxt:
                    self.cdp.spawn(self.view(nxt))
            await self._push_tabs()
        elif method == "Page.screencastFrame" and session and session == self._session:
            self.cdp.spawn(self.cdp.call("Page.screencastFrameAck", {"sessionId": p.get("sessionId")}, session))
            meta = p.get("metadata") or {}
            self._frame = (int(meta.get("deviceWidth") or self._frame[0]), int(meta.get("deviceHeight") or self._frame[1]))
            if self._current:
                await self._send({"kind": "frame", "data": p.get("data", ""), "width": self._frame[0], "height": self._frame[1], "tab": self._current})
        elif method == "Page.frameNavigated" and session == self._session and not (p.get("frame") or {}).get("parentId"):
            self.cdp.spawn(self._nav_state())

    async def view(self, tid: str):
        old, self._current, self._session = self._session, tid, None
        if old:
            self.cdp.spawn(self.cdp.call("Page.stopScreencast", {}, old))
            self.cdp.spawn(self.cdp.call("Target.detachFromTarget", {"sessionId": old}))
        await self._push_tabs()
        try:
            session = (await self.cdp.call("Target.attachToTarget", {"targetId": tid, "flatten": True}))["sessionId"]
            if self._current != tid:
                self.cdp.spawn(self.cdp.call("Target.detachFromTarget", {"sessionId": session}))
                return
            self._session = session
            await self.cdp.call("Page.enable", {}, session)
            await self.cdp.call("Page.startScreencast", {"format": "jpeg", "quality": 80, "maxWidth": 1920, "maxHeight": 1600, "everyNthFrame": 1}, session)
            await self._nav_state()
            await self.fit()
        except Exception:
            pass  # the tab went away meanwhile

    async def fit(self):
        """Hermes starts the agent's Chrome headless at its default 800 x 600, so sites show their tablet or phone
        layout and the picture fills only the top of a tall pane. Give its window a desktop width (at least
        1100 px) in the pane's shape: the page lays out as on a computer and fills the pane. The agent keeps it."""
        tid, session, want = self._current, self._session, self._fit
        if not tid or not session or not want or want[0] < 50 or want[1] < 50:
            return
        width = round(min(1920, max(1100, want[0] * 1.3)))
        height = round(min(2400, max(600, width * want[1] / want[0])))
        try:
            metrics = await self.cdp.call("Page.getLayoutMetrics", {}, session)
            layout = metrics.get("cssLayoutViewport") or {}
            vw, vh = float(layout.get("clientWidth") or 0), float(layout.get("clientHeight") or 0)
            if abs(vw - width) < 24 and abs(vh - height) < 24:
                return
            win = await self.cdp.call("Browser.getWindowForTarget", {"targetId": tid})
            bounds = win.get("bounds") or {}
            if bounds.get("windowState", "normal") != "normal":
                return
            extra_w = max(0, float(bounds.get("width") or vw) - vw)
            extra_h = max(0, float(bounds.get("height") or vh) - vh)
            await self.cdp.call("Browser.setWindowBounds", {"windowId": win["windowId"], "bounds": {"width": int(width + extra_w), "height": int(height + extra_h)}})
        except Exception:
            pass

    async def _nav_state(self):
        session, tid = self._session, self._current
        if not session or not tid:
            return
        try:
            hist = await self.cdp.call("Page.getNavigationHistory", {}, session)
            entries, index = hist.get("entries") or [], int(hist.get("currentIndex") or 0)
            url = (entries[index] if 0 <= index < len(entries) else {}).get("url") or self._infos.get(tid, {}).get("url", "")
            await self._send({"kind": "nav", "tab": tid, "url": url, "canBack": index > 0, "canForward": index < len(entries) - 1})
        except Exception:
            pass

    async def act(self, a: dict):
        kind = a.get("type")
        if kind == "select":
            tid = str(a.get("tab"))
            self._follow = tid in self._agent or bool(a.get("follow"))
            await self.view(tid)
            return
        if kind == "close":
            await self.cdp.call("Target.closeTarget", {"targetId": str(a.get("tab"))})
            return
        if kind == "follow":
            self._follow = True
            tid = self._agent_tab()
            if tid and tid != self._current:
                await self.view(tid)
            else:
                await self._push_tabs()
            return
        if kind == "fit":
            self._fit = (float(a.get("width") or 0), float(a.get("height") or 0))
            await self.fit()
            return
        session = self._session
        if not session:
            return
        if kind == "navigate":
            url = str(a.get("url") or "").strip()
            if not url:
                return
            if not re.match(r"^[a-z][a-z0-9+.-]*:", url, re.I):
                url = f"https://www.google.com/search?q={quote(url)}" if (" " in url or "." not in url) else f"https://{url}"
            if re.match(r"^https?:", url, re.I):  # only web pages from the address bar
                await self.cdp.call("Page.navigate", {"url": url}, session)
        elif kind in ("back", "forward"):
            hist = await self.cdp.call("Page.getNavigationHistory", {}, session)
            entries, index = hist.get("entries") or [], int(hist.get("currentIndex") or 0) + (-1 if kind == "back" else 1)
            if 0 <= index < len(entries):
                await self.cdp.call("Page.navigateToHistoryEntry", {"entryId": entries[index]["id"]}, session)
        elif kind == "reload":
            await self.cdp.call("Page.reload", {}, session)
        elif kind == "mouse":
            x, y = round(float(a.get("x") or 0) * self._frame[0]), round(float(a.get("y") or 0) * self._frame[1])
            action = str(a.get("action") or "mouseMoved")
            params = {"type": action, "x": x, "y": y, "modifiers": int(a.get("modifiers") or 0)}
            if action == "mouseWheel":
                params.update(deltaX=float(a.get("deltaX") or 0), deltaY=float(a.get("deltaY") or 0))
            else:
                params.update(button=str(a.get("button") or "none"), clickCount=int(a.get("clickCount") or 0))
            await self.cdp.call("Input.dispatchMouseEvent", params, session)
        elif kind == "key":
            key = str(a.get("key") or "")
            code, text = _KEYS.get(key, (ord(key.upper()), key) if len(key) == 1 else (0, None))
            modifiers = int(a.get("modifiers") or 0)
            typed = a.get("action") == "keyDown" and text and not modifiers & (2 | 4)  # not with ctrl or cmd
            params = {"type": "keyUp" if a.get("action") == "keyUp" else ("keyDown" if typed else "rawKeyDown"), "key": key,
                      "code": str(a.get("code") or ""), "modifiers": modifiers, "windowsVirtualKeyCode": code, "nativeVirtualKeyCode": code}
            if typed:
                params.update(text=text, unmodifiedText=text)
            await self.cdp.call("Input.dispatchKeyEvent", params, session)
        elif kind == "text":
            await self.cdp.call("Input.insertText", {"text": str(a.get("text") or "")}, session)


_WATCHES: dict[str, _BrowserWatch] = {}


async def browser_snapshot(profile: str) -> dict:
    """One picture of the agent's tab, plus its tabs: what the pane shows when it can't hold a socket open."""
    browser = next((b for b in await find_browsers() if b["profile"] == profile), None)
    if browser is None:
        return {"running": False}
    cdp = _Cdp(lambda *_: asyncio.sleep(0))
    try:
        await cdp.open(browser["port"], browser["ws_path"])
        infos = (await cdp.call("Target.getTargets")).get("targetInfos") or []
        pages = [t for t in infos if t.get("type") == "page" and not str(t.get("url", "")).startswith("devtools://")]
        tabs = [{"id": t["targetId"], "title": t.get("title") or t.get("url", ""), "url": t.get("url", ""), "agent": bool(t.get("attached"))} for t in pages]
        if not pages:
            return {"running": True, "tabs": [], "current": None}
        target = next((t for t in pages if t.get("attached")), pages[-1])
        session = (await cdp.call("Target.attachToTarget", {"targetId": target["targetId"], "flatten": True}))["sessionId"]
        shot = await cdp.call("Page.captureScreenshot", {"format": "jpeg", "quality": 70}, session, timeout=15.0)
        return {"running": True, "tabs": tabs, "current": target["targetId"], "url": target.get("url", ""), "frame": shot.get("data", "")}
    except Exception as exc:
        return {"running": True, "error": str(exc)}
    finally:
        await cdp.close()


if APIRouter is not None:

    @router.get("/browser/agents")
    async def browser_agents():
        return JSONResponse({"profiles": sorted({b["profile"] for b in await find_browsers()})}, headers=_NO_STORE)

    @router.get("/browser/snapshot")
    async def browser_snapshot_route(profile: str = "default"):
        return JSONResponse(await browser_snapshot(profile), headers=_NO_STORE)

    @router.post("/browser/act")
    async def browser_act(request: Request):
        body = await _body(request)
        watch = _WATCHES.get(str(body.get("watch") or ""))
        if watch is None:
            return _error(404, "browser/gone", "That browser view has closed. Open it again.")
        try:
            await watch.act(body)
        except Exception as exc:
            return _error(502, "browser/failed", f"The browser didn't take that: {exc}")
        return {"ok": True}

    @router.websocket("/browser/watch")
    @router.websocket("/browser/watch/{profile}")
    async def browser_watch(ws: WebSocket, profile: str = ""):
        """Stays open while the pane is: waits for the agent's Chrome, streams it, waits again if it closes."""
        await ws.accept()
        profile = profile or ws.query_params.get("profile") or "default"
        watch_id = secrets.token_urlsafe(12)
        lock = asyncio.Lock()

        async def send(frame: dict):
            async with lock:
                await ws.send_json(frame)

        async def client_gone():
            try:
                while True:
                    await ws.receive_text()
            except Exception:
                return

        gone = asyncio.create_task(client_gone())
        watch: _BrowserWatch | None = None
        try:
            await send({"kind": "hello", "watch": watch_id})
            while not gone.done():
                browser = next((b for b in await find_browsers() if b["profile"] == profile), None)
                if browser is None:
                    await send({"kind": "none"})
                    await asyncio.wait({gone}, timeout=2.0)
                    continue
                watch = _BrowserWatch(browser, send)
                _WATCHES[watch_id] = watch
                closed = asyncio.ensure_future(watch.cdp.closed.wait())
                try:
                    await watch.start()
                    await asyncio.wait({gone, closed}, return_when=asyncio.FIRST_COMPLETED)
                except Exception:
                    pass
                finally:
                    closed.cancel()
                    _WATCHES.pop(watch_id, None)
                    await watch.stop()
                if not gone.done():
                    await send({"kind": "gone"})
                    await asyncio.wait({gone}, timeout=2.0)
        except Exception:
            pass
        finally:
            gone.cancel()
            _WATCHES.pop(watch_id, None)
