# Writing an agent type

An agent type is a plain ES module. Point an agent's `type` at the file (relative to the config file, or absolute) and it loads at startup. No registration, no build.

```json
{ "id": "nas", "type": "./agents/synology.mjs", "intervalSec": 600, "url": "http://nas.local:5000" }
```

## The contract

```js
// agents/synology.mjs
export default {
  defaultName: 'NAS',          // or nameKey: 'my.key' when you add strings to lib/i18n.mjs
  defaultIcon: '🗄️',
  // Generic operating notes the LLM reads during diagnosis. Organization-specific
  // notes go in the agent's "playbook" config field and are appended to these.
  playbook: {
    en: '- The NAS web UI should answer on its configured URL.',
    ko: '- NAS 웹 화면은 설정된 주소에서 응답해야 한다.',
  },

  /** Called every intervalSec. Must not throw. If it does, the engine turns the error into a critical finding. */
  async run(ctx) {
    const { config, remediate, sleep, agentState, t } = ctx;
    const r = await probe(config.url);
    const findings = [];
    if (!r.ok) {
      const act = await remediate('kickstart', config.label, () => actions.kickstart(config.label));
      findings.push(finding('nas:down', 'crit', 'NAS is not responding', `${config.url} · ${r.error || r.status}`));
    }
    return {
      findings,                                  // [{ key, severity: 'warn'|'crit', title, detail }]
      actions: [],                               // remediation results to log (optional)
      metrics: { latency: `${r.ms}ms` },         // small key → value pairs for the dashboard
      evidence: `GET ${config.url} -> ${r.status}`, // raw text the LLM may read if this escalates
    };
  },
};
```

Import helpers from the package:

```js
import { probe, run, finding, actions, tailscale } from '../lib/core.mjs';
```

## `ctx`

| Field | Meaning |
|---|---|
| `config` | This agent's config object, merged over the top-level `shared` block |
| `remediate(kind, target, fn)` | Runs `fn` only if `target` is in `remediation.allow[kind]`, it is outside the cooldown, and `dryRun` is off. Returns `{ done, reason?, ok?, detail? }`. **Always use this for anything that changes the machine.** |
| `sleep(ms)` | Wait. Tests replace it with a no-op. |
| `agentState` | A persistent object for this agent, for example timestamps of expensive checks |
| `t(key, vars)` | i18n lookup |

## Findings and incidents

- `key` must be stable across runs. The engine uses it to open and resolve incidents and to decide alerts.
- `crit` opens an alert. After `llm.escalateAfter` consecutive runs it also triggers an LLM report. `warn` is only shown.
- Put enough in `evidence` that a human, or the LLM, can tell *why*. Never put secrets there.

## Testing

Agent types are plain functions, so test them with a fake `ctx`. See `test/fixtures/echo-agent.mjs` and the `createAgents()` tests in `test/ops.test.mjs`.

## Upstreaming

If your type is useful beyond your own setup, open an issue with the **New agent type** template. Built-in types must have no dependencies, use only allow-listed remediation and ship with tests.
