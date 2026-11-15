# Architecture

```
opsd.mjs            entry: load config → createAgents() → Engine → HTTP dashboard
agents/index.mjs    config → agent instances (built-in types or plugin files)
agents/*.mjs        built-in types: host, llm-app, team-portal, sites
lib/engine.mjs      scheduler, incident tracking, alerts, LLM escalation
lib/core.mjs        run(), probe(), Remediator, StateStore, notify(), diagnose()
lib/i18n.mjs        English / Korean strings
public/index.html   dashboard (vanilla JS)
```

## One run of an agent

1. The **scheduler** calls `agent.run(ctx)` every `intervalSec`, staggered at boot. Runs of the same agent never overlap.
2. The agent probes things and returns `findings`, `metrics`, `evidence` and the `actions` it attempted.
3. Every action went through the **Remediator**. It checks the target against the allow-list for that kind, enforces the per-target cooldown and honours dry-run.
4. The **incident tracker** compares findings to open incidents by `key`:
   - a new critical finding opens an incident and sends a webhook alert
   - a finding that disappears resolves its incident, and a critical one sends a recovery alert
   - critical incidents seen `escalateAfter` times trigger **LLM diagnosis**, rate-limited per agent
5. State is written atomically to `state.json`. Events are appended to `events.jsonl`.

## LLM diagnosis

The prompt contains:

- the type's generic playbook plus the config `playbook`
- the persistent findings
- the agent's `evidence` text (truncated)

Backends are tried in order until one answers. The answer is saved as a Markdown report and linked from the dashboard and the alert. The model never gets tools. Codex runs with `--sandbox read-only`.

## Failure behaviour

- An agent that throws becomes a critical finding (`agent:error`). The daemon keeps running.
- Child processes get a closed stdin and a timeout, so a hanging CLI cannot block a run forever.
- The Tailscale App Store CLI is invoked through `/bin/sh`. When a launchd-spawned Node process calls it directly, it tries to launch the GUI.

## Why no dependencies

The daemon runs unattended on a machine you care about. Zero dependencies means no supply-chain updates to review, no `npm install` on the server, and the whole codebase is small enough to audit in an afternoon.
