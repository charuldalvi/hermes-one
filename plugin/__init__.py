"""Hermes One agent tools.

``create_agent`` adds an agent the way Hermes' own CLI does (``hermes profile create
--clone-from default``), so the agent gets Hermes' model, keys and skills, plus its own role
(the profile description) and personality (SOUL.md). Bot Mode creates the agent's single
"Bot Chat" the first time Hermes hands it work with ``message_agent``.

The app tools (``app_guide``, ``list_hermes_apps``, ``publish_app``, ``undo_app``, ``app_logs``,
``use_app``) live in ``apps_tools.py``: any agent can build small live apps that show up in the
Hermes One Mac app.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from .apps_tools import register_apps
from .groups_tools import register as register_groups

_TOOLSET = "hermes_one"
_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{1,30}$")

CREATE_AGENT_SCHEMA = {
    "name": "create_agent",
    "description": (
        "Add a new agent for the user (a Hermes profile that Hermes can hand work to with "
        "message_agent). Use when the user asks for a new specialist, helper or agent. "
        "The agent starts with the default profile's model, keys and skills."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Short lowercase handle, letters, digits and dashes, e.g. 'editor' or 'sound-designer'."},
            "role": {"type": "string", "description": "One or two plain sentences on what this agent is good at. Shown to the user and used to route work."},
            "instructions": {"type": "string", "description": "Optional: how the agent should work and talk (becomes its SOUL.md)."},
        },
        "required": ["name", "role"],
    },
}


def _hermes_bin() -> str:
    found = shutil.which("hermes")
    if found:
        return found
    from .groups_tools import hermes_bin  # also knows where Hermes' Windows installer puts it
    return hermes_bin()


def _root_home() -> Path:
    """The launch home (default profile); profiles live in <root>/profiles/<name>."""
    home = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes")).resolve()
    # A profile's HERMES_HOME is <root>/profiles/<name>: step back up to the root.
    if home.parent.name == "profiles":
        return home.parent.parent
    return home


def _pretty(name: str) -> str:
    return name.replace("-", " ").replace("_", " ").strip().capitalize()


def create_agent_handler(args: dict, **_kwargs) -> str:
    name = str(args.get("name", "")).strip().lower().replace(" ", "-")
    role = " ".join(str(args.get("role", "")).split())
    instructions = str(args.get("instructions", "") or "").strip()
    if not _NAME_RE.match(name) or name in {"default", "hermes"}:
        return json.dumps({"ok": False, "error": "Use a short lowercase handle with letters, digits and dashes, like 'editor'. 'default' and 'hermes' are taken."})
    if not role:
        return json.dumps({"ok": False, "error": "Give the agent a one or two sentence role."})
    root = _root_home()
    target = root / "profiles" / name
    if target.exists():
        return json.dumps({"ok": False, "error": f"An agent called '{name}' already exists."})
    env = dict(os.environ)
    env["HERMES_HOME"] = str(root)
    cmd = [_hermes_bin(), "profile", "create", name, "--clone-from", "default", "--no-alias", "--description", role]
    try:
        done = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=180)
    except Exception as exc:  # noqa: BLE001 - report any failure to the model in plain words
        return json.dumps({"ok": False, "error": f"Couldn't create the agent: {exc}"})
    if done.returncode != 0 or not target.exists():
        tail = (done.stderr or done.stdout or "").strip().splitlines()[-3:]
        return json.dumps({"ok": False, "error": "Couldn't create the agent.", "detail": tail})
    if instructions:
        soul = f"# {_pretty(name)}\n\n{role}\n\n{instructions}\n"
        (target / "SOUL.md").write_text(soul, encoding="utf-8")
    return json.dumps({
        "ok": True,
        "profile": name,
        "message": f"{_pretty(name)} is now one of the user's agents. Hand it work with message_agent (target '{name}'); its chat is created on the first hand-off.",
        "next": "Put it in the right group now: list_agents, then arrange_groups with the whole arrangement.",
    })


_PROMPT = (
    "You are Hermes, the lead of the user's agents (Hermes profiles). The user mostly talks to you, "
    "in one chat (and can also "
    "write to an agent directly). Hand work to an agent with message_agent and bring its answer back here in "
    "plain words. When the user asks for a new agent, add it with the create_agent tool.\n"
    "Call them agents when you talk to the user, never bots or a team.\n"
    "You also keep the agents arranged in groups by craft, the way a studio has a 'Film crew': read "
    "every agent's role with list_agents, then call arrange_groups with the WHOLE arrangement (each "
    "group 2 to 6 agents who really do the same kind of work or hand work to each other, a short name, "
    "a lead and a one-line purpose). An agent with no partner in its craft stays on its own, outside "
    "every group: never pair unrelated agents just to fill a group, and never put yourself in an "
    "arranged group, because you already lead every agent. Having few groups, or none, is fine. "
    "Rearrange whenever an agent is added or removed, and when the user asks. Groups the user made are theirs: arrange_groups leaves them "
    "alone. For a one-off group use create_group; change one with update_group. (Find these tools "
    "with tool_search if they aren't loaded.)"
)


def register(ctx) -> None:
    chief = getattr(ctx, "profile_name", None) in (None, "default")
    # Agent tools are Hermes': it leads the agents, adds them and forms groups.
    if chief:
        ctx.register_tool(
            "create_agent", _TOOLSET, CREATE_AGENT_SCHEMA, create_agent_handler,
            description=CREATE_AGENT_SCHEMA["description"], emoji="🫧",
        )
        register_groups(ctx, _TOOLSET)
    if chief:
        try:
            ctx.register_system_prompt_section("hermes-one-team", _PROMPT, position="after_memory")
        except Exception:  # noqa: BLE001 - optional on older cores
            pass
    # Apps: in every profile, so Hermes and each agent can build and drive them.
    register_apps(ctx)
