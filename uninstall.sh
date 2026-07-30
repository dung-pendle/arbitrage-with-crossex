#!/bin/bash
#
# CrossEx-Boros Terminal — macOS uninstaller.
#
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/mrenoon/crossex-boros-terminal/main/uninstall.sh)"
#
# Removes the background service, the app, and its private Node.js runtime.
# Your API keys (~/.boros-crossex/config) and trade history (~/.boros-crossex/data)
# are KEPT unless you pass --purge:
#
#   /bin/bash -c "$(curl -fsSL …/uninstall.sh)" -- --purge

set -euo pipefail

ROOT="${BOROS_ROOT:-$HOME/.boros-crossex}"
LABEL="com.boros.crossex-terminal"
APP_TITLE="CrossEx-Boros Terminal"
LOG_DIR="$HOME/Library/Logs/boros-crossex"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

# Mirrors install.sh's stop_stale_server. `launchctl bootout` only stops the
# MANAGED service: a wedged instance, one started by hand, or an orphan left by
# a previous crash survives it. `rm -rf "$ROOT/app"` would then merely unlink
# the files of a live process — its modules are already resident, its .env is
# already loaded, and the reconcile loop keeps placing, cancelling and hedging
# REAL orders. Someone uninstalling to stop the bot must actually stop it, so
# this runs before anything is deleted. Matched by the server's own path, so no
# unrelated node process is ever touched.
server_pids() {
  command -v pgrep >/dev/null 2>&1 || return 0
  pgrep -f "$ROOT/app/src/server/index.ts" 2>/dev/null || true
}

stop_stale_server() {
  local pids i
  pids="$(server_pids)"
  [ -n "$pids" ] || return 0
  say "Stopping a server instance that survived the service stop…"
  kill $pids 2>/dev/null || true               # SIGTERM first (clean shutdown)
  for i in 1 2 3 4 5 6; do
    pids="$(server_pids)"
    [ -n "$pids" ] || return 0
    sleep 0.5
  done
  kill -9 $pids 2>/dev/null || true            # SIGKILL anything that ignored it
  sleep 0.5
}

main() {
  say "Stopping the background service…"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  stop_stale_server

  # Never delete the app or the trade journal out from under a live engine: it
  # would keep trading against an unlinked ledger, so the write-ahead order
  # reservations would no longer exist on disk for anyone to reconcile against.
  if [ -n "$(server_pids)" ]; then
    echo
    echo "  The trading server is STILL RUNNING and could not be stopped." >&2
    echo "  Nothing was removed — it would keep trading against deleted files." >&2
    echo "  Stop it manually, then re-run this uninstaller:" >&2
    echo "    pkill -f '$ROOT/app/src/server/index.ts'" >&2
    exit 1
  fi

  say "Removing the app and its private Node.js runtime…"
  rm -rf "$ROOT/app" "$ROOT/app.new" "$ROOT/app.old" "$ROOT/node" "$ROOT"/node-v*-darwin-*
  # Second path is the launcher name from before the CrossEx-Boros rename.
  rm -rf "$HOME/Applications/$APP_TITLE.app" "$HOME/Applications/Boros CrossEx Terminal.app"
  rm -rf "$LOG_DIR"

  if [ "${1:-}" = "--purge" ]; then
    say "Removing API keys and trade history (--purge)…"
    rm -rf "$ROOT"
  else
    rmdir "$ROOT" 2>/dev/null || true # gone entirely if config/data were never created
    if [ -d "$ROOT" ]; then
      echo
      echo "  Kept your API keys and trade history in $ROOT"
      echo "  Remove them too with: rm -rf $ROOT"
    fi
  fi
  echo
  say "Uninstalled. (The entry under System Settings → Login Items may take a re-login to disappear.)"
}

main "$@"
