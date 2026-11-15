# Contributing to macmini-ops

Thanks for helping! This project stays small on purpose. Please read this short guide before opening a PR.

## Ground rules

1. **Zero runtime dependencies.** Use the Node.js standard library only. If you think a dependency is unavoidable, open a discussion first.
2. **Safety first.** Every action that changes the machine goes through `ctx.remediate(kind, target, fn)`, so it respects the allow-list, the cooldown and dry-run. The LLM path stays read-only.
3. **No organization-specific values in code.** Hostnames, labels, paths and company knowledge belong in config (`playbook` for knowledge). The example config must use made-up values.
4. **User-facing strings go through i18n.** Add English to `lib/i18n.mjs`, and Korean if you can. English is the fallback.

## Development

```bash
npm test            # node:test, no install needed
npm run demo        # dashboard on http://127.0.0.1:8095 with mock services
node opsd.mjs once <agent-id>   # with your own config.json
```

Node.js 20, 22 and 24 run in CI on macOS.

## Pull requests

- Keep PRs focused, one change per PR.
- Add or update tests. A bug fix should come with a test that fails without it.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for the PR title (`feat:`, `fix:`, `docs:`, `chore:`). Releases and the changelog are generated from them.
- Update docs (`README.md`, `docs/`) when behaviour or config changes.
- CI must pass: tests, CodeQL and the gitleaks secret scan.

## Adding an agent type

See [docs/writing-agents.md](docs/writing-agents.md). Start it as a plugin file in your own config. If it is generally useful, propose it upstream using the "New agent type" issue template.

## Reporting bugs and asking questions

- Bugs: use the bug report template and include `node opsd.mjs once <agent>` output with secrets removed.
- Questions and ideas: [Discussions](https://github.com/baryonlabs/macmini-ops/discussions).
- Security issues: **do not** open a public issue. See [SECURITY.md](SECURITY.md).

By contributing you agree that your contributions are licensed under the MIT License and that you follow our [Code of Conduct](CODE_OF_CONDUCT.md).
