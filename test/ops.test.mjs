import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Remediator, StateStore } from '../lib/core.mjs';
import { Engine, statusOf } from '../lib/engine.mjs';
import { createT } from '../lib/i18n.mjs';
import host, { parseLaunchctlPrint, parseDf } from '../agents/host.mjs';
import { createAgents } from '../agents/index.mjs';
import { builtinCheck, tlsDaysLeft } from '../agents/sites.mjs';

const tmpState = () => new StateStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ops-')));

describe('Remediator', () => {
  it('only acts on allow-listed targets, respects cooldown and dry-run', async () => {
    let t = 0;
    let calls = 0;
    const r = new Remediator({ allow: { kickstart: ['svc.a'] }, cooldownSec: 60, now: () => t });
    const fn = async () => { calls += 1; return { ok: true, stdout: '' }; };
    assert.equal((await r.attempt('kickstart', 'svc.b', fn)).reason, 'not on allow-list');
    assert.equal((await r.attempt('kickstart', 'svc.a', fn)).done, true);
    assert.equal((await r.attempt('kickstart', 'svc.a', fn)).reason, 'cooldown');
    t = 61000;
    assert.equal((await r.attempt('kickstart', 'svc.a', fn)).done, true);
    assert.equal(calls, 2);
    const dry = new Remediator({ allow: { kickstart: ['svc.a'] }, dryRun: true });
    assert.equal((await dry.attempt('kickstart', 'svc.a', fn)).reason, 'dry-run');
    assert.equal(calls, 2);
  });
});

describe('parsers', () => {
  it('reads launchctl print and df output', () => {
    const p = parseLaunchctlPrint('gui/501/x = {\n\tstate = running\n\tpid = 4242\n\tlast exit code = (never exited)\n}');
    assert.deepEqual(p, { state: 'running', pid: 4242, lastExit: '(never exited)' });
    assert.equal(parseLaunchctlPrint('state = not running').state, 'not');
    const df = parseDf('Filesystem 1024-blocks Used Available Capacity\n/dev/disk3s5 239362496 180000000 40000000 82% /System/Volumes/Data');
    assert.equal(df.usedPct, 82);
  });
});

describe('host metrics', () => {
  it('shows uptime and load averages with localized labels', async ({ mock }) => {
    mock.method(os, 'uptime', () => 27 * 3600 + 8 * 60 + 59);
    mock.method(os, 'loadavg', () => [1.2, 0.625, 0]);
    const config = { diskPath: '/' };

    const english = await host.run({ config, t: createT('en') });
    assert.equal(english.metrics.uptime, '27h 8m');
    assert.equal(english.metrics['load (1/5/15 min)'], '1.20 / 0.63 / 0.00');

    const korean = await host.run({ config, t: createT('ko') });
    assert.equal(korean.metrics['가동 시간'], '27시간 8분');
    assert.equal(korean.metrics['부하 (1/5/15분)'], '1.20 / 0.63 / 0.00');
  });
});

describe('Engine', () => {
  function setup(script) {
    let t = Date.parse('2026-11-15T00:00:00Z');
    const alerts = [];
    const diagnoses = [];
    let i = 0;
    const agent = { id: 'x', name: '테스트', playbook: 'p', config: { intervalSec: 60 }, run: async () => script[Math.min(i++, script.length - 1)] };
    const engine = new Engine({
      config: { remediation: {}, webhookUrl: 'http://hook', llm: { enabled: true, escalateAfter: 3, cooldownHours: 6, backends: [{ type: 'openai' }] } },
      agents: [agent],
      state: tmpState(),
      log: { error() {} },
      notify: async (_url, text) => { alerts.push(text); return { sent: true }; },
      diagnose: async args => { diagnoses.push(args); fs.writeFileSync(args.outFile, '## 요약'); return { ok: true }; },
      now: () => t,
      sleep: async () => {},
    });
    return { engine, alerts, diagnoses, advance: ms => { t += ms; } };
  }

  const crit = { findings: [{ key: 'svc', severity: 'crit', title: '서비스 꺼짐', detail: 'd' }], evidence: 'ev' };
  const warn = { findings: [{ key: 'disk', severity: 'warn', title: '디스크 86%' }] };
  const ok = { findings: [] };

  it('computes status from the worst finding', () => {
    assert.equal(statusOf([]), 'ok');
    assert.equal(statusOf(warn.findings), 'warn');
    assert.equal(statusOf([...warn.findings, ...crit.findings]), 'crit');
  });

  it('alerts once when a critical problem starts and once when it recovers', async () => {
    const { engine, alerts } = setup([crit, crit, ok]);
    await engine.runAgent('x');
    await engine.runAgent('x');
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /서비스 꺼짐/);
    const st = await engine.runAgent('x');
    assert.equal(st.status, 'ok');
    assert.equal(alerts.length, 2);
    assert.match(alerts[1], /Recovered/);
  });

  it('does not alert for warnings', async () => {
    const { engine, alerts } = setup([warn, ok]);
    await engine.runAgent('x');
    await engine.runAgent('x');
    assert.equal(alerts.length, 0);
  });

  it('asks the LLM after the problem persists, then waits for the cooldown', async () => {
    const { engine, diagnoses, advance } = setup([crit]);
    await engine.runAgent('x');
    await engine.runAgent('x');
    assert.equal(diagnoses.length, 0);
    await engine.runAgent('x');
    await new Promise(r => setImmediate(r));
    assert.equal(diagnoses.length, 1);
    assert.equal(diagnoses[0].evidence, 'ev');
    await engine.runAgent('x');
    await new Promise(r => setImmediate(r));
    assert.equal(diagnoses.length, 1, 'cooldown');
    advance(7 * 3600 * 1000);
    await engine.runAgent('x');
    await new Promise(r => setImmediate(r));
    assert.equal(diagnoses.length, 2);
  });

  it('turns an agent crash into a critical finding instead of dying', async () => {
    const { engine } = setup([]);
    engine.agents[0].run = async () => { throw new Error('boom'); };
    const st = await engine.runAgent('x');
    assert.equal(st.status, 'crit');
    assert.match(st.findings[0].detail, /boom/);
  });
});

describe('shell quoting for the Tailscale wrapper', () => {
  it('passes arguments through /bin/sh unchanged', async () => {
    const { run, shQuote } = await import('../lib/core.mjs');
    const args = ["it's", 'a b', '$(touch /tmp/pwned)', '--http=80'];
    const r = await run('/bin/sh', ['-c', `printf '%s|' ${args.map(shQuote).join(' ')}`]);
    assert.equal(r.stdout, `${args.join('|')}|`);
  });
});

describe('run()', () => {
  it('closes stdin so commands that read it do not hang', async () => {
    const { run } = await import('../lib/core.mjs');
    const r = await run('/bin/cat', [], { timeoutMs: 3000 });
    assert.equal(r.ok, true);
    assert.equal(r.stdout, '');
  });
});

describe('diagnose()', () => {
  it('falls back to the next backend and writes the report', async () => {
    const http = await import('node:http');
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const j = JSON.parse(body);
        assert.equal(j.chat_template_kwargs.enable_thinking, false);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: '## 요약\n터널 끊김' } }] }));
      });
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const { diagnose } = await import('../lib/core.mjs');
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'diag-')), 'r.md');
    try {
      const r = await diagnose({
        backends: [
          { name: 'dead', type: 'openai', baseUrl: 'http://127.0.0.1:9/v1', model: 'x' },
          { name: 'local', type: 'openai', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, model: 'x', disableThinking: true },
        ],
        agentName: 'AX', playbook: 'p', findings: [{ severity: 'crit', title: 't', detail: 'd' }], evidence: 'e', outFile: out, timeoutMs: 5000,
      });
      assert.deepEqual(r, { ok: true, backend: 'local' });
      assert.match(fs.readFileSync(out, 'utf8'), /model: local[\s\S]*터널 끊김/);
    } finally {
      srv.close();
    }
  });
});

describe('createAgents()', () => {
  it('builds instances from config and merges shared settings and playbooks', async () => {
    const agents = await createAgents({
      shared: { dockerBin: '/x/docker' },
      agents: [
        { id: 'srv', type: 'host', services: ['a'], playbook: ['- our own rule'] },
        { id: 'off', type: 'sites', enabled: false },
      ],
    });
    assert.equal(agents.length, 1);
    assert.equal(agents[0].name, 'Server');
    assert.equal(agents[0].config.dockerBin, '/x/docker');
    assert.match(agents[0].playbook, /launchctl kickstart[\s\S]*our own rule/);
    await assert.rejects(createAgents({ agents: [{ id: 'a', type: 'nope' }] }), /unknown type/);
    await assert.rejects(createAgents({ agents: [{ id: 'a', type: 'host' }, { id: 'a', type: 'host' }] }), /duplicated/);
  });

  it('localizes names and playbooks', async () => {
    const [a] = await createAgents({ locale: 'ko', agents: [{ id: 's', type: 'sites' }] });
    assert.equal(a.name, '사이트 관리');
    assert.match(a.playbook, /보고만 한다/);
  });

  it('loads a custom agent type from a file path relative to the config', async () => {
    const baseDir = path.dirname(new URL(import.meta.url).pathname);
    const [a] = await createAgents({ agents: [{ id: 'e', type: './fixtures/echo-agent.mjs', fail: true }] }, { baseDir });
    assert.equal(a.name, 'Echo');
    const out = await a.run({ config: a.config });
    assert.equal(out.findings[0].key, 'echo');
    await assert.rejects(createAgents({ agents: [{ id: 'x', type: './fixtures/nope.mjs' }] }, { baseDir }));
  });

  it('accepts the shipped example and demo configs', async () => {
    for (const f of ['../config.example.json', '../examples/demo/config.json']) {
      const cfg = JSON.parse(fs.readFileSync(new URL(f, import.meta.url), 'utf8'));
      assert.ok((await createAgents(cfg)).length >= 3, f);
    }
  });
});

describe('i18n', () => {
  it('formats messages and falls back to English', async () => {
    const { createT } = await import('../lib/i18n.mjs');
    assert.equal(createT('en')('host.disk', { pct: 90 }), 'Disk 90% used');
    assert.equal(createT('ko')('host.disk', { pct: 90 }), '디스크 90% 사용');
    assert.match(createT('ko')('host.svcDetail', { state: 'x', lastExit: '1', note: '' }), /state=x/);
    assert.equal(createT('fr')('metric.disk'), 'disk');
  });
});

describe('sites built-in checker', () => {
  it('reports reachability and TLS days for an https site', async () => {
    const tlsMod = await import('node:tls');
    const { execFileSync } = await import('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '5', '-subj', '/CN=localhost',
      '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
    const srv = tlsMod.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, s => s.end());
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    try {
      const days = await tlsDaysLeft('127.0.0.1', { port: srv.address().port });
      assert.ok(days >= 4 && days <= 5, `days=${days}`);
      const report = await builtinCheck([{ id: 'dead', url: 'http://127.0.0.1:9/' }]);
      assert.equal(report.sites[0].ok, false);
    } finally {
      srv.close();
    }
  });
});
