# Changelog

All notable changes are documented here. Each GitHub release also has notes generated from
merged pull requests. See [MAINTAINING.md](MAINTAINING.md#releasing).

## 0.1.0 (2026-11-15)

First public release.

- Config-driven agent types: `host`, `llm-app`, `team-portal`, `sites`
- Allow-listed self-healing with per-target cooldown and dry-run
- Incident tracking with webhook alerts on open and recover
- LLM root-cause reports: OpenAI-compatible local model first, Codex CLI fallback
- Dashboard and JSON API, launchd installer
