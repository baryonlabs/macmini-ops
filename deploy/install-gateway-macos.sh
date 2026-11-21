#!/usr/bin/env bash
# Install the LLM gateway as a launchd agent.
#   ./deploy/install-gateway-macos.sh [CONFIG_FILE] [ENV_FILE]
# ENV_FILE holds API keys (mode 600). It is passed to node --env-file and never copied.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${1:-$ROOT/config.json}"
ENVF="${2:-$HOME/.macmini-ops/gateway.env}"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node not found"; exit 1; }
[ -f "$CONFIG" ] || { echo "config not found: $CONFIG"; exit 1; }
[ -f "$ENVF" ] || { install -m 600 /dev/null "$ENVF"; echo "created empty $ENVF (add API keys)"; }
chmod 600 "$ENVF"
LABEL="io.github.macmini-ops.gateway"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>--env-file=$ENVF</string><string>$ROOT/gateway.mjs</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict><key>OPS_CONFIG</key><string>$CONFIG</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/macmini-ops.gateway.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/macmini-ops.gateway.err.log</string>
</dict></plist>
P
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "gateway running · http://127.0.0.1:$(node -e "console.log((require('$CONFIG').gateway||{}).port||8030)")/v1"
