#!/bin/sh
# Hermes One installer for macOS and Linux:
#   curl -fsSL https://raw.githubusercontent.com/charuldalvi/hermes-one/main/install.sh | sh
#
# 1. Installs the Hermes One plugin into your Hermes (and into each agent's profile) and turns it on.
# 2. Restarts Hermes so the plugin loads, but only when no agent is working.
# 3. On a Mac, downloads the Hermes One app into ~/Applications and opens it.
#
# Options (after `sh -s --`):  --plugin-only   skip the app
#                              --app-only      skip the plugin
#                              --no-restart    don't restart Hermes
#                              --no-open       install the app without opening it
set -eu

REPO="charuldalvi/hermes-one"
APP_NAME="Hermes One"
PLUGIN=1 APP=1 RESTART=1 OPEN=1
for arg in "$@"; do
  case "$arg" in
    --plugin-only) APP=0 ;;
    --app-only) PLUGIN=0; RESTART=0 ;;
    --no-restart) RESTART=0 ;;
    --no-open) OPEN=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m  %s\033[0m\n' "$*"; }

TMP="$(mktemp -d 2>/dev/null || mktemp -d -t hermes-one)"
trap 'rm -rf "${TMP:?}"' EXIT

# ------------------------------------------------------------------------------------------------
# 1. The plugin
# ------------------------------------------------------------------------------------------------
if [ "$PLUGIN" = 1 ]; then
  if ! command -v hermes >/dev/null 2>&1; then
    say "Hermes isn't installed on this computer."
    note "Install Hermes Agent first (https://github.com/NousResearch/hermes-agent), then run this again."
    note "To install only the app, add: sh -s -- --app-only"
    exit 1
  fi
  say "Installing the Hermes One plugin…"
  # Over an existing install too (an update). --enable and --yes-deps keep it from stopping to ask.
  if hermes plugins install "$REPO#plugin" --force --enable --yes-deps </dev/null; then
    note "Installed and switched on."
  else
    warn "Hermes couldn't install the plugin (see above)."
    exit 1
  fi

  # Each agent is its own Hermes profile; agents need the plugin too, to build apps.
  ROOT="${HERMES_HOME:-$HOME/.hermes}"
  case "$ROOT" in */profiles/*) ROOT="${ROOT%/profiles/*}" ;; esac
  SRC="$ROOT/plugins/hermes-one"
  if [ -d "$ROOT/profiles" ] && [ -f "$SRC/plugin.yaml" ]; then
    COUNT=0
    for dir in "$ROOT"/profiles/*/; do
      [ -f "${dir}config.yaml" ] || continue
      name="$(basename "$dir")"
      mkdir -p "${dir}plugins"
      rm -rf "${dir}plugins/hermes-one"
      cp -R "$SRC" "${dir}plugins/hermes-one"
      hermes --profile "$name" plugins enable hermes-one --no-allow-tool-override </dev/null >/dev/null 2>&1 || true
      COUNT=$((COUNT + 1))
    done
    [ "$COUNT" -gt 0 ] && note "Also added for $COUNT agent profile(s)."
  fi
fi

# ------------------------------------------------------------------------------------------------
# 2. Restart Hermes so it loads the plugin (only while no agent is working)
# ------------------------------------------------------------------------------------------------
if [ "$RESTART" = 1 ] && command -v hermes >/dev/null 2>&1; then
  if hermes gateway status 2>/dev/null | grep -q "is running"; then
    say "Restarting Hermes so it loads the plugin…"
    OUT="$(hermes gateway stop </dev/null 2>&1 || true)"
    if printf '%s' "$OUT" | grep -q "Let them finish"; then
      warn "An agent is working right now, so Hermes wasn't restarted."
      note "When your agents are done, run: hermes gateway restart"
    else
      hermes gateway ensure </dev/null >/dev/null 2>&1 || hermes gateway start </dev/null >/dev/null 2>&1 || true
      note "Hermes is back."
    fi
  fi
fi

# ------------------------------------------------------------------------------------------------
# 3. The app (macOS)
# ------------------------------------------------------------------------------------------------
if [ "$APP" = 1 ]; then
  if [ "$(uname -s)" != "Darwin" ]; then
    note "The Hermes One app is for macOS and Windows; on this system you have the plugin."
    note "In Hermes Desktop, turn it on in Capabilities -> Plugins -> Hermes One."
    exit 0
  fi
  case "$(uname -m)" in arm64) ARCH=arm64 ;; *) ARCH=x64 ;; esac
  say "Downloading the Hermes One app…"
  URL="https://github.com/$REPO/releases/latest/download/Hermes-One-mac-$ARCH.zip"
  if ! curl -fL --progress-bar "$URL" -o "$TMP/app.zip"; then
    warn "Couldn't download $URL."
    note "Build it from source instead: https://github.com/$REPO#build-it-yourself"
    exit 1
  fi
  ditto -x -k "$TMP/app.zip" "$TMP/unzipped"
  [ -d "$TMP/unzipped/$APP_NAME.app" ] || { warn "The download didn't contain $APP_NAME.app."; exit 1; }

  DEST="$HOME/Applications/$APP_NAME.app"
  # A running copy is asked to quit first (it would hold its files).
  if pgrep -f "$DEST/Contents/MacOS" >/dev/null 2>&1; then
    osascript -e 'quit app id "com.charuldalvi.hermesone"' >/dev/null 2>&1 || true
    i=0; while pgrep -f "$DEST/Contents/MacOS" >/dev/null 2>&1 && [ $i -lt 20 ]; do sleep 1; i=$((i + 1)); done
  fi
  mkdir -p "$HOME/Applications"
  rm -rf "${DEST:?}"
  ditto "$TMP/unzipped/$APP_NAME.app" "$DEST"
  xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
  if [ "$OPEN" = 1 ]; then
    say "Opening Hermes One…"
    open "$DEST"
  fi
  note "It's in ~/Applications. Pin it to the Dock if you like."
fi

say "Done."
