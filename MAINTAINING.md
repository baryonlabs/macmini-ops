# Maintaining macmini-ops

This is the playbook for maintainers (`@baryonlabs/macmini-ops-maintainers`).

## Triage (target: first response within 3 business days)

1. New issues arrive with `status: triage`. Reproduce or ask for the missing info from the template.
2. Label the issue with a **type** (`type: bug|feature|agent|docs`) and an **area** if it fits. Change the status to `status: accepted`, or close it with a short reason.
3. Small, well-scoped tasks get `good first issue`, with a pointer to the file and the test to extend. Bigger welcome tasks get `help wanted`.
4. Move questions to Discussions.
5. Security reports go through private advisories only. Never discuss them in public issues.

## Pull requests

- `main` is protected. Every change, including maintainers' own, goes through a PR with green CI: tests on Node 20/22/24, the gitleaks secrets scan and CodeQL.
- Squash merge only. The PR title becomes the commit message, so keep it in Conventional Commit form.
- Label merged PRs (`type: …`). The labels drive the release-note categories in `.github/release.yml`.
- Before merging, check the [PR checklist](.github/PULL_REQUEST_TEMPLATE.md), especially "no new runtime dependencies" and "actions go through `ctx.remediate()`".

## Releasing

```bash
# 1. PR that bumps package.json "version" and adds a CHANGELOG.md entry, then merge it
# 2. tag the merge commit
git checkout main && git pull
git tag -a v0.2.0 -m v0.2.0 && git push origin v0.2.0
```

The `release` workflow checks that the tag matches `package.json`, runs the tests and publishes a GitHub release with notes generated from merged PR titles. Versioning is SemVer. While the version is `0.x`, a minor bump may break config.

## Dependencies and supply chain

- Runtime dependencies: none, and that is deliberate.
- GitHub Actions are pinned to commit SHAs. Dependabot opens grouped weekly PRs to update them. Review the upstream changelog before merging.
- OpenSSF Scorecard runs weekly. Treat a drop in the score as a bug.

## Housekeeping

- The `stale` workflow closes inactive issues and PRs after 60 + 14 days. Use `pinned` to keep something open.
- Keep the README roadmap in sync with issues labelled `roadmap`.
