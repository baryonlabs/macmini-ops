#!/usr/bin/env bash
# Install macmini-ops as a launchd agent (starts at login, restarts on crash).
#   ./deploy/install-macos.sh [CONFIG_FILE]
# The webhook URL (a secret) is read from OPS_WEBHOOK_URL at install time and stored only in the
# launchd plist (mode 600), never in the repository.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${1:-$ROOT/config.json}"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node not found (install Node.js 20+)"; exit 1; }
[ -f "$CONFIG" ] || { echo "config not found: $CONFIG (copy config.example.json)"; exit 1; }
LABEL="io.github.macmini-ops"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$ROOT/opsd.mjs</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>OPS_CONFIG</key><string>$CONFIG</string>
    <key>OPS_WEBHOOK_URL</key><string>${OPS_WEBHOOK_URL:-}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/macmini-ops.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/macmini-ops.err.log</string>
</dict></plist>
P
chmod 600 "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "macmini-ops running · dashboard http://127.0.0.1:$(node -e "console.log(require('$CONFIG').port||8095)")"
