#!/usr/bin/env node
// `npm run demo` — try macmini-ops in one minute, no real services needed.
//
// Starts mock services on 127.0.0.1:18800 (an OpenAI-compatible model server + an app),
// then runs the daemon with examples/demo/config.json. The mock model server goes down
// 25 s after start and comes back 70 s later, so you can watch an incident open, the LLM
// root-cause report appear, and the incident recover — on http://127.0.0.1:8095
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const started = Date.now();
const modelDown = () => {
  const s = (Date.now() - started) / 1000;
  return s > 25 && s < 95;
};

// The mock "LLM" answers with a report built from the findings in the prompt.
function demoDiagnosis(prompt) {
  const problems = (prompt.match(/^- \[(crit|warn)\] .+$/gm) || []).map(l => l.replace(/^- \[\w+\] /, ''));
  return [
    '## Summary',
    `${problems[0] || 'An agent reported a problem'}. (This report comes from the demo's mock LLM.)`,
    'With a real backend, a model reads the collected evidence and writes this section.',
    '',
    '## Likely causes',
    ...problems.map((p, i) => `${i + 1}. **${p}**: see the evidence block in the prompt.`),
    '',
    '## What a human should do',
    '- Check the service logs and restart it if needed (⚠️ confirm shared resources first).',
    '',
    '## How to verify',
    '- The agent card on the dashboard turns green on the next run.',
  ].join('\n');
}

const mock = http.createServer((req, res) => {
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/v1/models') return modelDown() ? json(503, { error: 'model unavailable' }) : json(200, { data: [{ id: 'demo-model' }] });
  if (req.url === '/health') return json(200, { status: 'ok' });
  if (req.url === '/' ) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<h1>demo app</h1>'); }
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const prompt = JSON.parse(body).messages?.[0]?.content || '';
      const isDiagnosis = /evidence|증거/.test(prompt);
      json(200, { choices: [{ message: { role: 'assistant', content: isDiagnosis ? demoDiagnosis(prompt) : 'OK' } }] });
    });
    return;
  }
  json(404, { error: 'not found' });
});

mock.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? 'Port 18800 is already in use — is another demo still running? Stop it and try again.'
    : error.message);
  process.exit(1);
});

mock.listen(18800, '127.0.0.1', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macmini-ops-demo-'));
  console.log('mock services  http://127.0.0.1:18800  (model goes down at +25s, back at +95s)');
  console.log('dashboard      http://127.0.0.1:8095');
  console.log(`state          ${stateDir}\n`);
  const child = spawn(process.execPath, [path.join(HERE, '../../opsd.mjs')], {
    stdio: 'inherit',
    env: { ...process.env, OPS_CONFIG: path.join(HERE, 'config.json'), OPS_STATE_DIR: stateDir, OPS_WEBHOOK_URL: '' },
  });
  const stop = () => { child.kill('SIGTERM'); mock.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', code => { mock.close(); process.exit(code ?? 0); });
});
