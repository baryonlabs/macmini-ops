#!/usr/bin/env node
// macmini-ops: always-on operations agents for a macOS server (Mac mini).
//
//   node opsd.mjs                 # daemon (scheduler + http://127.0.0.1:8095)
//   node opsd.mjs once <agent>    # run one agent once and print the result
//
// Config: OPS_CONFIG or ./config.json (start from config.example.json). State: OPS_STATE_DIR or ~/.macmini-ops
// Secrets never go in config: the webhook URL comes from OPS_WEBHOOK_URL, the API token is generated
// into the state directory.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StateStore } from './lib/core.mjs';
import { Engine } from './lib/engine.mjs';
import { createAgents } from './agents/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.OPS_CONFIG || path.join(HERE, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error(`config not found: ${configPath}\ncopy config.example.json to config.json (or set OPS_CONFIG) and edit it.`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.webhookUrl = process.env.OPS_WEBHOOK_URL || config.webhookUrl || '';
const stateDir = process.env.OPS_STATE_DIR || path.join(os.homedir(), '.macmini-ops');
const state = new StateStore(stateDir);
const agents = createAgents(config);
const engine = new Engine({ config, agents, state });

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'once') {
  const result = await engine.runAgent(arg);
  console.log(JSON.stringify({ status: result.status, metrics: result.metrics, findings: result.findings, actions: result.lastActions }, null, 2));
  process.exit(0);
}

const tokenFile = path.join(stateDir, 'token');
if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(16).toString('hex') + '\n', { mode: 0o600 });
const token = fs.readFileSync(tokenFile, 'utf8').trim();

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const authorized = req => {
  const h = String(req.headers.authorization || '');
  const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7).trim() : '');
  const want = Buffer.from(token);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
};

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://ops.local');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, fs.readFileSync(path.join(HERE, 'public/index.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/api/agents') {
      return send(res, 200, {
        title: config.title || 'Mac mini 운영 에이전트',
        agents: agents.map(a => ({ id: a.id, type: a.type, name: a.name, icon: a.icon, intervalSec: a.config.intervalSec || 600, running: engine.running.has(a.id), ...state.agent(a.id) })),
        events: state.recentEvents(60),
        reports: state.reports(20),
        webhook: Boolean(config.webhookUrl),
        llm: config.llm?.enabled ? (config.llm.backends || []).map(b => b.name || b.type).join(' → ') : null,
      });
    }
    // /agents/<id>/health — 503 only for critical problems, so the portal dot turns red.
    if (req.method === 'GET' && parts[0] === 'agents' && parts[2] === 'health') {
      const st = state.data.agents[parts[1]];
      if (!st) return send(res, 404, { error: 'unknown agent' });
      return send(res, st.status === 'crit' ? 503 : 200, { status: st.status || 'pending', lastRun: st.lastRun });
    }
    if (req.method === 'GET' && parts[0] === 'reports' && parts[1]) {
      const name = path.basename(decodeURIComponent(parts[1]));
      const file = path.join(stateDir, 'reports', name);
      if (!name.endsWith('.md') || !fs.existsSync(file)) return send(res, 404, { error: 'not found' });
      return send(res, 200, fs.readFileSync(file, 'utf8'), 'text/plain; charset=utf-8');
    }
    if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'agents' && parts[3] === 'run') {
      if (!authorized(req)) return send(res, 401, { error: 'token required (~/.macmini-ops/token)' });
      if (!agents.some(a => a.id === parts[2])) return send(res, 404, { error: 'unknown agent' });
      const st = await engine.runAgent(parts[2]);
      return send(res, 200, { status: st.status, findings: st.findings });
    }
    return send(res, 404, { error: 'not found' });
  } catch (error) {
    console.error('[ops] http error', error);
    return send(res, 500, { error: 'internal error' });
  }
});

const host = config.host || '127.0.0.1';
const port = config.port || 8095;
httpServer.listen(port, host, () => {
  console.log(`[ops] http://${host}:${port}  agents=${agents.map(a => a.id).join(',')}  state=${stateDir}`);
  console.log(`[ops] webhook=${config.webhookUrl ? 'on' : 'off'}  llm=${config.llm?.enabled ? (config.llm.backends || []).map(b => b.name || b.type).join(' -> ') : 'off'}`);
  engine.start();
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { engine.stop(); httpServer.close(() => process.exit(0)); });
