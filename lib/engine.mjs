// Runs agents on their schedules, tracks incidents across runs, sends alerts on state changes
// and asks the LLM for a diagnosis when a critical problem persists.
import path from 'node:path';
import { Remediator, notify as defaultNotify, diagnose as defaultDiagnose } from './core.mjs';
import { createT } from './i18n.mjs';

const SEV_RANK = { ok: 0, warn: 1, crit: 2 };

export function statusOf(findings) {
  if (findings.some(f => f.severity === 'crit')) return 'crit';
  if (findings.some(f => f.severity === 'warn')) return 'warn';
  return 'ok';
}

export class Engine {
  constructor({ config, agents, state, log = console, notify = defaultNotify, diagnose = defaultDiagnose, sleep, now = () => Date.now(), siteChecker }) {
    this.config = config;
    this.agents = agents;
    this.state = state;
    this.log = log;
    this.notify = notify;
    this.diagnose = diagnose;
    this.now = now;
    this.sleep = sleep || (ms => new Promise(r => setTimeout(r, ms)));
    this.siteChecker = siteChecker;
    this.locale = config.locale || 'en';
    this.t = createT(this.locale);
    this.remediator = new Remediator({ ...config.remediation, now });
    this.running = new Map();
    this.diagnosing = new Set();
  }

  /** Run one agent now. Concurrent calls for the same agent share the in-flight run. */
  runAgent(id) {
    if (this.running.has(id)) return this.running.get(id);
    const p = this.#run(id).finally(() => this.running.delete(id));
    this.running.set(id, p);
    return p;
  }

  async #run(id) {
    const agent = this.agents.find(a => a.id === id);
    if (!agent) throw new Error(`unknown agent ${id}`);
    const st = this.state.agent(id);
    const started = this.now();
    let result;
    try {
      result = await agent.run({
        config: agent.config,
        t: this.t,
        agentState: st,
        remediate: (kind, target, fn) => this.remediator.attempt(kind, target, fn),
        sleep: this.sleep,
        siteChecker: this.siteChecker,
      });
    } catch (error) {
      result = { findings: [{ key: 'agent:error', severity: 'crit', title: this.t('agent.error'), detail: String(error.message || error).slice(0, 300) }], evidence: String(error.stack || error) };
    }
    const findings = result.findings || [];
    const status = statusOf(findings);
    for (const a of result.actions || []) {
      this.state.event({ agent: id, type: 'action', id: a.id, done: a.done, ok: a.ok, reason: a.reason, detail: a.detail });
    }
    await this.#trackIncidents(agent, st, findings, result.evidence);
    Object.assign(st, {
      lastRun: new Date(started).toISOString(),
      durationMs: this.now() - started,
      status,
      findings,
      metrics: result.metrics || {},
      lastActions: result.actions || [],
    });
    this.state.save();
    return st;
  }

  async #trackIncidents(agent, st, findings, evidence) {
    const open = st.incidents;
    const seen = new Set();
    for (const f of findings) {
      seen.add(f.key);
      const inc = open[f.key];
      if (!inc) {
        open[f.key] = { ...f, since: new Date(this.now()).toISOString(), count: 1 };
        this.state.event({ agent: agent.id, type: 'open', key: f.key, severity: f.severity, title: f.title, detail: f.detail });
        if (f.severity === 'crit') await this.#alert(this.t('alert.open', { agent: agent.name, title: f.title, detail: f.detail }));
      } else {
        const escalated = SEV_RANK[f.severity] > SEV_RANK[inc.severity];
        Object.assign(inc, { ...f, count: inc.count + 1 });
        if (escalated && f.severity === 'crit') await this.#alert(this.t('alert.open', { agent: agent.name, title: f.title, detail: f.detail }));
      }
    }
    for (const [key, inc] of Object.entries(open)) {
      if (seen.has(key)) continue;
      delete open[key];
      this.state.event({ agent: agent.id, type: 'resolved', key, title: inc.title });
      if (inc.severity === 'crit') await this.#alert(this.t('alert.resolved', { agent: agent.name, title: inc.title }));
    }
    this.#maybeDiagnose(agent, st, evidence);
  }

  #maybeDiagnose(agent, st, evidence) {
    const llm = this.config.llm || {};
    if (!llm.enabled || this.diagnosing.has(agent.id)) return;
    const persistent = Object.values(st.incidents).filter(i => i.severity === 'crit' && i.count >= (llm.escalateAfter || 3));
    if (!persistent.length) return;
    const last = st.lastDiagnosisAt ? Date.parse(st.lastDiagnosisAt) : 0;
    if (this.now() - last < (llm.cooldownHours || 6) * 3600 * 1000) return;

    st.lastDiagnosisAt = new Date(this.now()).toISOString();
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
    const file = `${stamp}-${agent.id}.md`;
    const outFile = path.join(this.state.dir, 'reports', file);
    this.diagnosing.add(agent.id);
    this.state.event({ agent: agent.id, type: 'diagnose', status: 'started', keys: persistent.map(i => i.key) });
    this.diagnose({ backends: llm.backends, locale: this.locale, agentName: agent.name, playbook: agent.playbook, findings: persistent, evidence, outFile })
      .then(async r => {
        this.state.event({ agent: agent.id, type: 'diagnose', status: r.ok ? 'done' : 'failed', report: r.ok ? file : undefined, detail: r.ok ? `model: ${r.backend}` : r.error });
        if (r.ok) {
          st.lastReport = file;
          this.state.save();
          await this.#alert(this.t('alert.report', { agent: agent.name, url: `${this.config.publicUrl || ''}/reports/${file}` }));
        }
      })
      .catch(error => this.log.error?.('[ops] diagnose failed', error))
      .finally(() => this.diagnosing.delete(agent.id));
  }

  async #alert(text) {
    try {
      const r = await this.notify(this.config.webhookUrl, text);
      if (r.sent === false && this.config.webhookUrl) this.log.error?.(`[ops] webhook failed: ${r.status}`);
    } catch (error) {
      this.log.error?.('[ops] notify error', error);
    }
  }

  /** Start the schedule. Agents are staggered so they do not all fire at boot. */
  start() {
    this.timers = this.agents.map((agent, i) => {
      const interval = (agent.config.intervalSec || 600) * 1000;
      const tick = () => this.runAgent(agent.id).catch(e => this.log.error?.(`[ops] ${agent.id}`, e));
      const first = setTimeout(tick, 2000 + i * 5000);
      const every = setInterval(tick, interval);
      return [first, every];
    });
  }

  stop() {
    for (const [a, b] of this.timers || []) {
      clearTimeout(a);
      clearInterval(b);
    }
  }
}
