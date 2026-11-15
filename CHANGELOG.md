# Changelog

All notable changes are documented here. From 0.2.0 on this file is maintained by
[release-please](https://github.com/googleapis/release-please) from Conventional Commit titles.

## [0.2.0](https://github.com/baryonlabs/macmini-ops/compare/macmini-ops-v0.1.0...macmini-ops-v0.2.0) (2026-11-15)


### Features

* demo mode, plugin agent types and i18n; OSS governance and CI hardening ([#1](https://github.com/baryonlabs/macmini-ops/issues/1)) ([0a8994b](https://github.com/baryonlabs/macmini-ops/commit/0a8994b4c9eba0168c79ca00e27ce27556e84ba7))

## 0.1.0 (2026-11-15)

First public release.

- Config-driven agent types: `host`, `llm-app`, `team-portal`, `sites`
- Allow-listed self-healing with per-target cooldown and dry-run
- Incident tracking with webhook alerts on open and recover
- LLM root-cause reports: OpenAI-compatible local model first, Codex CLI fallback
- Dashboard and JSON API, launchd installer
