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
