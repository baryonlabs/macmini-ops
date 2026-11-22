# Configuration reference

The config file is JSON. It is found via `OPS_CONFIG`, falling back to `./config.json`. Start from [`config.example.json`](../config.example.json).

## Top level

| Key | Default | |
|---|---|---|
| `title` | `macmini-ops` | Dashboard title |
| `locale` | `en` | `en` or `ko`. Applies to the dashboard, findings, alerts and the LLM prompt. |
| `host` / `port` | `127.0.0.1` / `8095` | Dashboard bind address. Keep it on loopback or a private network. |
| `publicUrl` | | Base URL used in alert links to reports |
| `shared` | `{}` | Merged into every agent's config (e.g. `dockerBin`, `dockerContext`) |
| `remediation.dryRun` | `false` | `true` = never act, only report |
| `remediation.cooldownSec` | `600` | Minimum time between two actions on the same target |
| `remediation.allow` | `{}` | `{ kickstart: [labels], compose: [projects], serve: [ports] }`. Anything else is refused. |
| `llm.enabled` | `false` | Enable root-cause reports |
| `llm.escalateAfter` | `3` | Consecutive runs with a critical finding before asking the LLM |
| `llm.cooldownHours` | `6` | At most one report per agent per window |
| `llm.backends` | `[]` | Tried in order, see below |
| `agents` | `[]` | Agent instances, see below |

### LLM backends

```json
{ "name": "local vLLM", "type": "openai", "baseUrl": "http://127.0.0.1:8000/v1", "model": "my-model", "apiKey": "", "disableThinking": true }
{ "name": "Codex", "type": "codex", "cli": "/opt/homebrew/bin/codex" }
```

`openai` works with any OpenAI-compatible server (vLLM, Ollama `/v1`, LM Studio, a hosted API). `disableThinking` sends `chat_template_kwargs.enable_thinking=false` for Qwen3-style models. Prefer `apiKey` from a file you don't commit. The evidence sent to the model may contain service output.

### Environment variables

| Variable | |
|---|---|
| `OPS_CONFIG` | Path to the config file |
| `OPS_STATE_DIR` | State, events, reports and token (default `~/.macmini-ops`) |
| `OPS_WEBHOOK_URL` | Discord or Slack incoming webhook. Kept out of config on purpose. |

## Agents

Every agent has `id` (unique), `type`, and optionally `name`, `icon`, `intervalSec` (default 600), `enabled` and `playbook` (a string or array of lines appended to the type's generic notes for the LLM).

### `host`

The host card shows system uptime in hours and minutes and the 1-, 5-, and 15-minute load averages.

| Key | Default | |
|---|---|---|
| `services` | `[]` | launchd labels expected to be running |
| `diskPath` | `/System/Volumes/Data` | Volume to measure |
| `diskWarnPct` / `diskCritPct` | 85 / 92 | |
| `memWarnFreePct` | 10 | |
| `dockerBin`, `dockerContext` | | Set `dockerBin` to check Docker |
| `tailscale` | `false` | Check that Tailscale is online |
| `mounts` | `[]` | Volumes that must be mounted, e.g. an external disk used as extra internal storage |
| `links` | `[]` | Symlinks that must resolve, e.g. app or SDK folders moved to that external disk |

### `llm-app`

| Key | |
|---|---|
| `model.url` | e.g. `http://127.0.0.1:8020/v1/models` |
| `model.name` | Served model name, used for the chat test |
| `model.tunnelLabel` | launchd label of an SSH tunnel to restart when the model is unreachable |
| `model.tunnelLog` | Log file to include as evidence |
| `model.remote` | `{ ssh, command, aliveRegex }`: a read-only check on the GPU host to tell "tunnel down" from "model process down" |
| `app.apiUrl`, `app.webUrl` | Health endpoints of the app |
| `app.composeDir`, `app.composeProject` | For `docker compose up -d` (project must be in `remediation.allow.compose`) |
| `app.chatPath` | Default `/v1/chat/completions` |
| `app.chatEverySec`, `app.chatLatencyWarnMs` | Default 1800 s, 20000 ms |

### `team-portal`

`portalUrl`, `label`, `legacyUrl`, `legacyLabel`, `publicPortalUrl`, `servePort`, `serveTarget`, `linkSkip` (card ids to skip, e.g. links that need a login).

### `sites`

| Key | |
|---|---|
| `sites` | `[{ id, name, url, critical }]`: built-in checker (reachability + TLS days) |
| `checkModule` | Alternatively, a module exporting `checkAll()` that returns `{ sites: [{ id, name, url, ok, status, error, tlsDays, starred }] }` |
| `tlsWarnDays` / `tlsCritDays` | 14 / 7 |
