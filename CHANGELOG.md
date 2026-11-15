# Changelog

All notable changes are documented here. Each GitHub release also has notes generated from
merged pull requests. See [MAINTAINING.md](MAINTAINING.md#releasing).

## 0.2.0 (2026-11-16)

### Features
- `npm run demo`: offline mock services with a scripted outage (detect → LLM report → recover in about a minute)
- Plugin agent types: set an agent's `type` to a path to your own module ([docs/writing-agents.md](docs/writing-agents.md))
- i18n: English by default, Korean with `"locale": "ko"` (dashboard, findings, alerts, LLM prompt)

### Fixes
- Dashboard shows intervals under a minute correctly
- The `sites` TLS check no longer crashes on IP-address URLs (`servername` must not be an IP)

### Project
- English README, README.ko.md, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, MAINTAINING, docs/
- Issue forms, PR template, CODEOWNERS, labels, Discussions, private vulnerability reporting
- CI: SHA-pinned actions with least-privilege permissions, demo smoke test, gitleaks, CodeQL, OpenSSF Scorecard, Dependabot, stale; tag-driven releases
- `main` protected by a ruleset (PR + green checks, linear history, no force-push)

## 0.1.0 (2026-11-15)

First public release.

- Config-driven agent types: `host`, `llm-app`, `team-portal`, `sites`
- Allow-listed self-healing with per-target cooldown and dry-run
- Incident tracking with webhook alerts on open and recover
- LLM root-cause reports: OpenAI-compatible local model first, Codex CLI fallback
- Dashboard and JSON API, launchd installer
