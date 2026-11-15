# Security Policy

macmini-ops runs with your user's permissions and can restart services, so we take security reports seriously.

## Supported versions

| Version | Supported |
|---|---|
| latest `0.x` release | ✅ |
| older releases | ❌ (please upgrade) |

## Reporting a vulnerability

**Please do not open a public issue.** Report privately via
[GitHub Security Advisories → "Report a vulnerability"](https://github.com/baryonlabs/macmini-ops/security/advisories/new).

Include:

- what an attacker can do and under which preconditions (network position, config)
- steps or a proof of concept
- affected version / commit

What to expect:

- We acknowledge your report within **3 business days**.
- We aim to send an assessment within **10 business days**.
- We fix the issue, publish an advisory and credit you if you wish.

## Security model, in brief

- **Remediation**: only actions listed in `remediation.allow` run, at most once per target per `cooldownSec`. `dryRun: true` disables them all.
- **LLM**: the model reads collected evidence and returns text. It never executes commands. Codex runs with `--sandbox read-only`.
- **HTTP**: the dashboard binds to `127.0.0.1` by default. The only state-changing endpoint, `POST /api/agents/:id/run`, needs the bearer token from `~/.macmini-ops/token` (mode 600). That endpoint runs checks and allow-listed fixes only. The read endpoints (`/`, `/api/agents`, `/reports/*`) are **unauthenticated** and show service names, findings and LLM reports. Expose the port only to networks you trust, such as loopback, a VPN or a tailnet, or put an authenticating proxy in front.
- **Secrets**: the webhook URL comes from the environment and is never stored in the repository. Evidence sent to an LLM can contain service output, so prefer a local model for sensitive environments.

Issues in these guarantees are in scope. So is anything that lets a remote party trigger actions, read reports, or inject commands through config values or service output.
