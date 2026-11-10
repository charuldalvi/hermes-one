"""Hermes' group tools: list_agents, arrange_groups, create_group, update_group and list_groups.

Hermes keeps the agents arranged in groups by craft (a "Film crew", a "Research desk"): list_agents shows
every agent's role and the groups there are, and arrange_groups applies Hermes' whole arrangement at once.
Groups Hermes arranged are remembered in <root>/hermes-one/arranged-groups.json, so a later arrangement
can retire the ones it no longer wants; groups the user made are never touched by it.

A group is a Bot Mode room of 2 to 6 agents that work together. Rooms live behind the local gateway's
socket API (groups.*), so these tools talk to the gateway the way a desktop client does: a one-use
ticket from the gateway's private control channel (same user only), then a JSON-RPC call over its
local WebSocket. Nothing leaves this computer. On Windows the control channel is a named pipe, reached
through Hermes' own ticket client (it checks both ends).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import uuid
from pathlib import Path
from typing import Any

HANDLE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def hermes_bin() -> str:
    """The `hermes` command: HERMES_BIN, where Hermes' installer puts it, else whatever PATH has."""
    candidates = [os.environ.get("HERMES_BIN"), str(Path.home() / ".local/bin/hermes")]
    if os.name == "nt":  # %LOCALAPPDATA%\hermes\bin\hermes.exe (or .cmd when Hermes couldn't make an .exe)
        for home in (os.environ.get("HERMES_HOME"), str(Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "hermes")):
            if home:
                candidates += [str(Path(home) / "bin" / "hermes.exe"), str(Path(home) / "bin" / "hermes.cmd")]
    for c in candidates:
        if c and Path(c).exists():
            return c
    return shutil.which("hermes") or "hermes"


_hermes_bin = hermes_bin


def _endpoint() -> dict:
    out = subprocess.run([_hermes_bin(), "gateway", "ensure", "--json"], capture_output=True, text=True, timeout=90)
    payload = json.loads(out.stdout or "{}")
    ep = payload.get("endpoint") or {}
    if not ep.get("api_origin") or not ep.get("instance_id"):
        raise RuntimeError(f"Hermes' gateway isn't ready ({payload.get('state') or 'unknown'})")
    if not re.match(r"^http://(127\.0\.0\.1|\[::1\])(:\d+)?$", ep["api_origin"]):
        raise RuntimeError("Hermes gave a non-local address; refusing to connect")
    return ep


def _control_socket(home: str) -> str:
    direct = Path(home) / "gateway.sock"
    if direct.is_socket():
        return str(direct)
    pointer = (Path(home) / "gateway.sock.path").read_text().strip()
    if not os.path.isabs(pointer) or os.path.basename(pointer) != "control.sock":
        raise RuntimeError("Invalid gateway control pointer")
    return pointer


def _ticket_windows(ep: dict) -> str:
    """Windows: Hermes' own ticket client, which dials the gateway's named pipe and checks it's Hermes."""
    from types import SimpleNamespace
    from hermes_cli.gateway_client import _session_ticket  # Hermes' client (Hermes Desktop uses it too)
    endpoint = SimpleNamespace(profile_id=ep["profile_id"], instance_id=ep["instance_id"],
                               control_home=ep.get("control_home"), runtime_protocol=ep.get("runtime_protocol", 1))
    return _session_ticket(Path(ep["profile_id"]), endpoint, purpose="interactive", scope="host")


def _ticket(ep: dict) -> str:
    if os.name == "nt":
        return _ticket_windows(ep)
    home = ep.get("control_home") or ep["profile_id"]
    req = {"protocol": 1, "id": 1, "verb": "session-ticket",
           "params": {"profile_id": ep["profile_id"], "instance_id": ep["instance_id"], "purpose": "interactive", "scope": "host"}}
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(5)
        s.connect(_control_socket(home))
        s.sendall((json.dumps(req) + "\n").encode())
        buf = b""
        while b"\n" not in buf:
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
    reply = json.loads(buf.split(b"\n", 1)[0] or b"{}")
    ticket = (reply.get("result") or {}).get("ticket")
    if not reply.get("ok") or not isinstance(ticket, str):
        raise RuntimeError(reply.get("error") or "Hermes refused a ticket")
    return ticket


def _call(calls: list[tuple[str, dict]], tolerant: bool = False) -> list[Any]:
    """Runs JSON-RPC calls in order on one fresh local connection; returns each result. Raises on an error,
    or with tolerant=True puts {"error": ...} in that call's place and carries on."""
    from websockets.sync.client import connect  # bundled with Hermes

    ep = _endpoint()
    url = ep["api_origin"].replace("http://", "ws://", 1) + "/api/ws"
    results: list[Any] = []
    with connect(url, subprotocols=["hermes-gateway-v1", "hermes-gateway-ticket." + _ticket(ep)], open_timeout=15, max_size=2**24) as ws:
        # Wait for the hello before asking anything.
        for _ in range(50):
            msg = json.loads(ws.recv(timeout=15))
            if msg.get("method") == "event" and (msg.get("params") or {}).get("type") == "gateway.ready":
                break
        for i, (method, params) in enumerate(calls, start=1):
            rid = f"hermes-one-{i}"
            ws.send(json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params}))
            while True:
                msg = json.loads(ws.recv(timeout=60))
                if msg.get("id") != rid:
                    continue
                if msg.get("error"):
                    err = msg["error"]
                    detail = (err.get("data") or {}).get("detail") if isinstance(err.get("data"), dict) else None
                    text = f"{method}: {detail or err.get('message') or err}"
                    if not tolerant:
                        raise RuntimeError(text)
                    results.append({"error": text})
                    break
                results.append(msg.get("result"))
                break
    return results


def _profiles() -> set[str]:
    root = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
    names = {"default"}
    pdir = root / "profiles"
    if pdir.is_dir():
        names |= {p.name for p in pdir.iterdir() if p.is_dir() and (p / "config.yaml").exists()}
    return names


def _root() -> Path:
    home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes").resolve()
    return home.parent.parent if home.parent.name == "profiles" else home


def _registry_path() -> Path:
    return _root() / "hermes-one" / "arranged-groups.json"


def _arranged() -> set[str]:
    try:
        return set(json.loads(_registry_path().read_text()).get("rooms") or [])
    except (OSError, ValueError):
        return set()


def _save_arranged(ids: set[str]) -> None:
    p = _registry_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps({"rooms": sorted(ids)}, indent=2))
    tmp.replace(p)


def _handle(profile: str) -> str:
    return "hermes" if profile == "default" else profile


def _roster(members: list[str]) -> list[dict]:
    known = _profiles()
    seen: set[str] = set()
    roster = []
    for raw in members:
        name = str(raw).strip().lstrip("@").lower()
        if name in ("hermes",):
            name = "default"
        if not HANDLE_RE.match(name):
            raise ValueError(f"'{raw}' isn't an agent name")
        if name not in known:
            raise ValueError(f"There's no agent called '{raw}'. Agents: {', '.join(sorted(known - {'default'}))}")
        if name in seen:
            raise ValueError(f"'{raw}' is listed twice")
        seen.add(name)
        handle = "hermes" if name == "default" else name
        roster.append({"member_id": name, "profile": name, "handle": handle, "target": {"kind": "local", "profile": name}})
    if not 2 <= len(roster) <= 6:
        raise ValueError("A group needs 2 to 6 agents")
    return roster


def _find_room(rooms: list[dict], group: str) -> dict | None:
    g = group.strip().lower()
    for r in rooms:
        if str(r.get("room_id", "")).lower() == g or str(r.get("name", "")).strip().lower() == g:
            return r
    return None


def _member_id(name: str) -> str:
    n = str(name).strip().lstrip("@").lower()
    return "default" if n in ("hermes",) else n


def _lead_context(room_id: str, lead: str | None, purpose: str | None, keep: dict | None = None) -> tuple[str, dict] | None:
    """groups.context sets purpose and notes together (both strings), so a change keeps the room's notes
    (and its purpose, when none is given) from `keep`, the room's current context."""
    if not lead and purpose is None:
        return None
    keep = keep or {}
    params: dict = {"room_id": room_id, "event_id": str(uuid.uuid4()),
                    "purpose": str(purpose if purpose is not None else keep.get("purpose") or "")[:2000],
                    "notes": str(keep.get("notes") or "")}
    if lead:
        params["routing"] = "lead"
        params["lead_member_id"] = _member_id(lead)
    return ("groups.context", params)


def _contexts(room_ids: list[str]) -> dict[str, dict]:
    """Each room's purpose, notes, routing and lead (groups.state), read on one connection."""
    if not room_ids:
        return {}
    states = _call([("groups.state", {"room_id": rid}) for rid in room_ids], tolerant=True)
    return {rid: ((st or {}).get("context") or {}) for rid, st in zip(room_ids, states) if isinstance(st, dict) and "error" not in st}


def _ok(**data) -> str:
    return json.dumps({"ok": True, **data})


def _fail(message: str) -> str:
    return json.dumps({"ok": False, "error": message})


def create_group(args: dict, **_: Any) -> str:
    try:
        name = str(args.get("name") or "").strip()
        if not name:
            return _fail("Give the group a name")
        roster = _roster(list(args.get("members") or []))
        room_id = str(uuid.uuid4())
        calls: list[tuple[str, dict]] = [("groups.create", {"room_id": room_id, "name": name[:80], "members": roster})]
        ctx = _lead_context(room_id, args.get("lead"), args.get("purpose"))
        if ctx:
            calls.append(ctx)
        _call(calls)
        return _ok(room_id=room_id, name=name, members=[m["handle"] for m in roster], lead=args.get("lead"),
                   note="The group shows in Hermes One's sidebar under Groups.")
    except Exception as exc:  # the tool answers in words; the model decides what to do next
        return _fail(str(exc))


def update_group(args: dict, **_: Any) -> str:
    """Renames a group, changes its lead or purpose, or (because a room's members are fixed) replaces it
    with a new room that has the new members."""
    try:
        group = str(args.get("group") or "").strip()
        if not group:
            return _fail("Say which group (its name or id)")
        rooms = (_call([("groups.list", {"limit": 100})])[0] or {}).get("rooms") or []
        room = _find_room(rooms, group)
        if not room:
            return _fail(f"No group called '{group}'. Groups: {', '.join(r.get('name', '?') for r in rooms) or 'none yet'}")
        rid = room["room_id"]
        members = args.get("members")
        if members:
            new_name = str(args.get("name") or room.get("name") or "Group").strip()
            roster = _roster(list(members))
            new_id = str(uuid.uuid4())
            calls: list[tuple[str, dict]] = [("groups.create", {"room_id": new_id, "name": new_name[:80], "members": roster})]
            ctx = _lead_context(new_id, args.get("lead"), args.get("purpose"))
            if ctx:
                calls.append(ctx)
            if args.get("retire_old", True):
                calls.append(("groups.disband", {"room_id": rid}))
            _call(calls)
            return _ok(room_id=new_id, replaced=rid, name=new_name, members=[m["handle"] for m in roster],
                       note="A group's members can't change in place, so a new group replaced the old one.")
        calls = []
        if args.get("name"):
            calls.append(("groups.rename", {"room_id": rid, "event_id": str(uuid.uuid4()), "name": str(args["name"]).strip()[:80]}))
        keep = _contexts([rid]).get(rid) if (args.get("lead") or args.get("purpose") is not None) else None
        ctx = _lead_context(rid, args.get("lead"), args.get("purpose"), keep)
        if ctx:
            calls.append(ctx)
        if not calls:
            return _fail("Nothing to change: give a new name, lead, purpose or members")
        _call(calls)
        return _ok(room_id=rid, name=args.get("name") or room.get("name"), lead=args.get("lead"))
    except Exception as exc:
        return _fail(str(exc))


def list_groups(args: dict, **_: Any) -> str:
    try:
        rooms = (_call([("groups.list", {"limit": 100})])[0] or {}).get("rooms") or []
        return _ok(groups=[{"id": r.get("room_id"), "name": r.get("name"), "members": [m.get("handle") or m.get("profile") for m in r.get("members") or []]} for r in rooms])
    except Exception as exc:
        return _fail(str(exc))


def list_agents(args: dict, **_: Any) -> str:
    """Every agent with its role, and every group with its members, lead and purpose."""
    try:
        profiles, listing = _call([("profiles.list", {}), ("groups.list", {"limit": 100})])
        rows = (profiles or {}).get("profiles") or []
        rooms = (listing or {}).get("rooms") or []
        ctx = _contexts([r["room_id"] for r in rooms if r.get("room_id")])
        mine = _arranged()
        agents = [{"name": _handle(str(p.get("name"))), "role": p.get("description") or "", "model": p.get("model") or "",
                 **({"is_you_chief": True} if p.get("is_default") else {})} for p in rows if p.get("name")]
        groups = []
        in_group: set[str] = set()
        for r in rooms:
            members = [_handle(str(m.get("profile") or m.get("member_id"))) for m in r.get("members") or []]
            in_group |= set(members)
            c = ctx.get(r.get("room_id"), {})
            groups.append({"name": r.get("name"), "members": members, "lead": _handle(c["lead_member_id"]) if c.get("lead_member_id") else None,
                           "purpose": c.get("purpose") or "", "arranged_by_you": r.get("room_id") in mine})
        loose = [b["name"] for b in agents if b["name"] != "hermes" and b["name"] not in in_group]
        return _ok(agents=agents, groups=groups, not_in_any_group=loose)
    except Exception as exc:
        return _fail(str(exc))


def arrange_groups(args: dict, **_: Any) -> str:
    """Applies Hermes' whole arrangement: makes the groups that don't exist, changes the ones whose members,
    lead or purpose differ (members can't change in place, so those are replaced), and retires groups Hermes
    arranged before that aren't in the new arrangement. Groups the user made are left alone."""
    try:
        if "groups" not in args:
            return _fail("Give the whole arrangement: a list of groups, each with a name and 2 to 6 members (an empty list retires yours)")
        plan = list(args.get("groups") or [])
        seen: set[str] = set()
        wanted = []
        for g in plan:
            name = " ".join(str(g.get("name") or "").split())[:80]
            if not name:
                return _fail("Every group needs a name")
            if name.lower() in seen:
                return _fail(f"'{name}' is in the arrangement twice")
            seen.add(name.lower())
            roster = _roster(list(g.get("members") or []))
            if any(m["member_id"] == "default" for m in roster):
                return _fail(f"Leave yourself out of '{name}': you already lead every agent. Arranged groups are for agents "
                             "who work together; an agent with no partner in its craft stays on its own.")
            lead = g.get("lead")
            if lead and _member_id(lead) not in {m["member_id"] for m in roster}:
                return _fail(f"The lead of '{name}' ({lead}) isn't one of its members")
            wanted.append({"name": name, "roster": roster, "lead": lead, "purpose": g.get("purpose")})

        rooms = (_call([("groups.list", {"limit": 100})])[0] or {}).get("rooms") or []
        by_name = {str(r.get("name", "")).strip().lower(): r for r in rooms}
        mine = _arranged()
        ctx = _contexts([r["room_id"] for r in rooms if str(r.get("name", "")).strip().lower() in seen])
        calls: list[tuple[str, dict]] = []
        outcome: list[dict] = []
        kept_ids: set[str] = set()
        new_ids: list[str] = []
        clashes: list[str] = []
        for w in wanted:
            room = by_name.get(w["name"].lower())
            members = sorted(m["member_id"] for m in w["roster"])
            handles = [m["handle"] for m in w["roster"]]
            if room and room.get("room_id") not in mine:
                # The user made this one: never change it. Same name, different plan: say so instead.
                kept_ids.add(room["room_id"])
                clashes.append(w["name"])
                outcome.append({"group": w["name"], "done": "left as it is: the user made a group with this name; use another name if you want a different one"})
                continue
            if room and sorted(str(m.get("profile") or m.get("member_id")) for m in room.get("members") or []) == members:
                rid = room["room_id"]
                cur = ctx.get(rid, {})
                changed = (w["lead"] and _member_id(w["lead"]) != cur.get("lead_member_id")) or (w["purpose"] is not None and str(w["purpose"]) != cur.get("purpose", ""))
                if changed:
                    calls.append(_lead_context(rid, w["lead"], w["purpose"], cur))
                kept_ids.add(rid)
                outcome.append({"group": w["name"], "members": handles, "lead": w["lead"], "done": "updated" if changed else "unchanged"})
                continue
            rid = str(uuid.uuid4())
            calls.append(("groups.create", {"room_id": rid, "name": w["name"], "members": w["roster"]}))
            ctx_call = _lead_context(rid, w["lead"], w["purpose"])
            if ctx_call:
                calls.append(ctx_call)
            if room:
                calls.append(("groups.disband", {"room_id": room["room_id"]}))
            new_ids.append(rid)
            outcome.append({"group": w["name"], "members": handles, "lead": w["lead"], "done": "replaced (members changed)" if room else "created"})
        keep_listed = kept_ids | {by_name[w["name"].lower()]["room_id"] for w in wanted if w["name"].lower() in by_name}
        user_made = {r.get("room_id") for r in rooms if r.get("room_id") not in mine}
        retired = [r for r in rooms if r.get("room_id") in mine and r.get("room_id") not in keep_listed] if args.get("retire_unlisted", True) else []
        for r in retired:
            calls.append(("groups.disband", {"room_id": r["room_id"]}))
        results = _call(calls, tolerant=True) if calls else []
        errors = [x["error"] for x in results if isinstance(x, dict) and "error" in x]
        made = {c[1]["room_id"] for c, res in zip(calls, results) if c[0] == "groups.create" and not (isinstance(res, dict) and "error" in res)}
        gone = {c[1]["room_id"] for c, res in zip(calls, results) if c[0] == "groups.disband" and not (isinstance(res, dict) and "error" in res)}
        _save_arranged(((mine | kept_ids | made) - gone - user_made))
        untouched = [r.get("name") for r in rooms if r.get("room_id") not in mine and r.get("room_id") not in keep_listed]
        return json.dumps({"ok": not errors, "groups": outcome, "retired": [r.get("name") for r in retired if r.get("room_id") in gone],
                           **({"left_as_they_are": untouched} if untouched else {}), **({"errors": errors} if errors else {}),
                           "note": "The groups show in Hermes One's sidebar under Groups."})
    except Exception as exc:
        return _fail(str(exc))


LIST_AGENTS_SCHEMA = {
    "name": "list_agents",
    "description": "See all the agents: every agent with its role and model, every group (members, lead, purpose, whether you arranged it), and which agents aren't in any group yet. Use it before arranging groups.",
    "parameters": {"type": "object", "properties": {}},
}
ARRANGE_SCHEMA = {
    "name": "arrange_groups",
    "description": (
        "Arrange the agents into groups by craft, like a studio's 'Film crew' or 'Research desk'. Give the WHOLE "
        "arrangement each time: groups that don't exist are made, ones whose members, lead or purpose differ are "
        "changed, and groups you arranged before that aren't listed are retired. Groups the user made are left alone. "
        "Each group has 2 to 6 members (agent names, never 'hermes': you already lead everyone) who really do the same "
        "kind of work or hand work to each other. An agent with no partner in its craft stays out of every group; "
        "never pair unrelated agents to fill one. An empty list retires every group you arranged."
    ),
    "parameters": {"type": "object", "properties": {
        "groups": {"type": "array", "minItems": 0, "items": {"type": "object", "properties": {
            "name": {"type": "string", "description": "Short name by craft, e.g. 'Film crew', 'Coding crew', 'Research desk'"},
            "members": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 6},
            "lead": {"type": "string", "description": "The member who takes a message first and shares out the work"},
            "purpose": {"type": "string", "description": "One plain line on what the group does"},
        }, "required": ["name", "members", "lead", "purpose"]}},
        "retire_unlisted": {"type": "boolean", "description": "Retire groups you arranged before that aren't in this arrangement (default true)"},
    }, "required": ["groups"]},
}

CREATE_SCHEMA = {
    "name": "create_group",
    "description": "Create a group: a room where 2 to 6 agents work together on something. Use it when work needs several agents at once. Members are agent names (profiles); include 'hermes' to take part yourself. Optionally pick a lead agent who receives messages first, and a purpose.",
    "parameters": {"type": "object", "properties": {
        "name": {"type": "string", "description": "Short name, e.g. 'Launch video'"},
        "members": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 6, "description": "Agent names (profiles)"},
        "lead": {"type": "string", "description": "Optional: the agent who leads the group"},
        "purpose": {"type": "string", "description": "Optional: what the group is for"},
    }, "required": ["name", "members"]},
}
UPDATE_SCHEMA = {
    "name": "update_group",
    "description": "Change a group: rename it, change its lead or purpose, or change its members (members can't change in place, so this creates a replacement group and retires the old one unless retire_old is false).",
    "parameters": {"type": "object", "properties": {
        "group": {"type": "string", "description": "The group's name or id"},
        "name": {"type": "string"}, "lead": {"type": "string"}, "purpose": {"type": "string"},
        "members": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 6},
        "retire_old": {"type": "boolean", "description": "When members change: disband the old group (default true)"},
    }, "required": ["group"]},
}
LIST_SCHEMA = {
    "name": "list_groups",
    "description": "List the groups (rooms of agents working together) with their members.",
    "parameters": {"type": "object", "properties": {}},
}


def register(ctx, toolset: str) -> None:
    """Registers the agent and group tools on the plugin context (called from __init__.register)."""
    for schema, handler, emoji in ((LIST_AGENTS_SCHEMA, list_agents, "👥"), (ARRANGE_SCHEMA, arrange_groups, "👥"),
                                   (CREATE_SCHEMA, create_group, "👥"), (UPDATE_SCHEMA, update_group, "👥"), (LIST_SCHEMA, list_groups, "👥")):
        ctx.register_tool(schema["name"], toolset, schema, handler, description=schema["description"], emoji=emoji)
