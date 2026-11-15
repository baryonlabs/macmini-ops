## What & why

<!-- One or two sentences. Link the issue: Fixes #123 -->

## How I tested

<!-- e.g. npm test, npm run demo, node opsd.mjs once <agent> on macOS 15 -->

## Checklist

- [ ] PR title follows Conventional Commits (`feat:`, `fix:`, `docs:` …)
- [ ] Tests added or updated (`npm test` passes)
- [ ] No new runtime dependencies
- [ ] Machine-changing actions go through `ctx.remediate()` (allow-list + cooldown + dry-run)
- [ ] No organization-specific values or secrets in code, tests or examples
- [ ] User-facing strings added to `lib/i18n.mjs`
- [ ] Docs updated if config or behaviour changed
