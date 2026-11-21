import assert from 'node:assert/strict';
import http from 'node:http';
import { after, describe, it } from 'node:test';
import { createGateway, upstreamBody } from '../lib/gateway.mjs';

const silent = { info() {}, error() {} };
const servers = [];
after(() => servers.forEach(s => s.close()));

function listen(handler) {
  const s = http.createServer(handler);
  servers.push(s);
  return new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}/v1`)));
}

/** Upstream that records requests and answers per `mode`. */
async function upstream(mode, seen = []) {
  return listen((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push({ headers: req.headers, body: JSON.parse(body) });
      if (mode === '503') { res.writeHead(503); return res.end('busy'); }
      if (mode === 'hang') return; // never answers
      if (mode === 'stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"he"}}]}\n\n');
        setTimeout(() => { res.write('data: {"choices":[{"delta":{"content":"llo"}}]}\n\n'); res.end('data: [DONE]\n\n'); }, 50);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: `from ${mode}` } }] }));
    });
  });
}

async function gateway(cfg, opts) {
  const { server, states, stats } = createGateway(cfg, { log: silent, ...opts });
  servers.push(server);
  const base = await new Promise(r => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));
  return { base, states, stats };
}

const chat = (base, body) => fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('llm gateway', () => {
  it('uses the first backend when it is healthy', async () => {
    const a = await upstream('a');
    const b = await upstream('b');
    const { base } = await gateway({ providers: { a: { baseUrl: a }, b: { baseUrl: b } }, models: { m: [{ provider: 'a', model: 'ma' }, { provider: 'b', model: 'mb' }] } });
    const res = await chat(base, { model: 'm', messages: [] });
    assert.equal(res.headers.get('x-gateway-backend'), 'a');
    assert.equal((await res.json()).choices[0].message.content, 'from a');
  });

  it('falls through on connection refused, 503 and timeout-before-first-byte', async () => {
    const busy = await upstream('503');
    const hang = await upstream('hang');
    const ok = await upstream('ok');
    const { base, stats } = await gateway({
      firstByteMs: 300,
      providers: { dead: { baseUrl: 'http://127.0.0.1:9/v1' }, busy: { baseUrl: busy }, hang: { baseUrl: hang }, ok: { baseUrl: ok } },
      models: { m: ['dead', 'busy', 'hang', 'ok'].map(p => ({ provider: p, model: p })) },
    });
    const res = await chat(base, { model: 'm', messages: [] });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-gateway-backend'), 'ok');
    assert.equal(stats.fallbacks, 1);
  });

  it('skips a backend in cooldown on the next request', async () => {
    let t = 0;
    const seenBusy = [];
    const busy = await upstream('503', seenBusy);
    const ok = await upstream('ok');
    const { base } = await gateway({ cooldownSec: 60, providers: { busy: { baseUrl: busy }, ok: { baseUrl: ok } }, models: { m: [{ provider: 'busy', model: 'x' }, { provider: 'ok', model: 'y' }] } }, { now: () => t });
    await chat(base, { model: 'm', messages: [] });
    await chat(base, { model: 'm', messages: [] });
    assert.equal(seenBusy.length, 1, 'second request skipped the cooling-down backend');
    t = 61000;
    await chat(base, { model: 'm', messages: [] });
    assert.equal(seenBusy.length, 2, 'retried after cooldown');
  });

  it('streams through without buffering', async () => {
    const s = await upstream('stream');
    const { base } = await gateway({ providers: { s: { baseUrl: s } }, models: { m: [{ provider: 's', model: 'x' }] } });
    const res = await chat(base, { model: 'm', stream: true, messages: [] });
    assert.match(res.headers.get('content-type'), /event-stream/);
    const text = await res.text();
    assert.match(text, /"he"[\s\S]*"llo"[\s\S]*\[DONE\]/);
  });

  it('rewrites model, drops fields, adds extra body and auth per provider', async () => {
    const seen = [];
    const a = await upstream('a', seen);
    const { base } = await gateway({
      providers: { a: { baseUrl: a, apiKeyEnv: 'TEST_KEY', dropFields: ['chat_template_kwargs'], extraBody: { reasoning: { enabled: false } } } },
      models: { m: [{ provider: 'a', model: 'vendor/model-x' }] },
    }, { env: { TEST_KEY: 'sk-test' } });
    await chat(base, { model: 'm', messages: [], chat_template_kwargs: { enable_thinking: false } });
    assert.equal(seen[0].body.model, 'vendor/model-x');
    assert.equal(seen[0].body.chat_template_kwargs, undefined);
    assert.deepEqual(seen[0].body.reasoning, { enabled: false });
    assert.equal(seen[0].headers.authorization, 'Bearer sk-test');
  });

  it('skips providers whose API key is missing and reports all failures', async () => {
    const { base } = await gateway({
      providers: { keyed: { baseUrl: 'http://127.0.0.1:9/v1', apiKeyEnv: 'NOPE' }, dead: { baseUrl: 'http://127.0.0.1:9/v1' } },
      models: { m: [{ provider: 'keyed', model: 'x' }, { provider: 'dead', model: 'y' }] },
    }, { env: {} });
    const res = await chat(base, { model: 'm', messages: [] });
    assert.equal(res.status, 502);
    const j = await res.json();
    assert.match(j.error.attempts[0], /missing NOPE/);
    assert.equal(j.error.attempts.length, 2);
  });

  it('lists models and exposes provider health', async () => {
    const { base } = await gateway({ providers: { a: { baseUrl: 'http://127.0.0.1:9/v1' } }, models: { m: [{ provider: 'a', model: 'x' }] } });
    assert.deepEqual((await (await fetch(`${base}/v1/models`)).json()).data.map(d => d.id), ['m']);
    assert.equal((await chat(base, { model: 'unknown', messages: [] })).status, 404);
    const h = await (await fetch(`${base}/health`)).json();
    assert.equal(h.providers[0].name, 'a');
  });

  it('upstreamBody merges route-level extra body last', () => {
    const out = upstreamBody({ model: 'm', a: 1, drop: 2 }, { model: 'x', extraBody: { b: 3 } }, { dropFields: ['drop'], extraBody: { b: 2, c: 4 } });
    assert.deepEqual(out, { model: 'x', a: 1, b: 3, c: 4 });
  });
});

describe('llm-app agent with gateway health', () => {
  it('warns while a fallback serves and goes critical when all backends are down', async () => {
    const { default: llmApp } = await import('../agents/llm-app.mjs');
    const { createT } = await import('../lib/i18n.mjs');
    let health;
    const h = await listen((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(health)); });
    const healthUrl = h.replace(/\/v1$/, '/health');
    const remediated = [];
    const ctx = cfg => ({
      config: { model: { name: 'm', gatewayHealthUrl: healthUrl, tunnelLabel: 'tun' } }, t: createT('en'), agentState: {}, sleep: async () => {},
      remediate: async (kind, target) => { remediated.push(`${kind}:${target}`); return { done: true }; },
    });
    health = { models: { m: ['gpu-a', 'rtx', 'or'] }, providers: [{ name: 'gpu-a', up: false }, { name: 'rtx', up: true }, { name: 'or', up: true }] };
    let out = await llmApp.run(ctx());
    assert.equal(out.findings[0].key, 'gateway:fallback');
    assert.match(out.findings[0].title, /gpu-a is down; serving from rtx/);
    assert.equal(out.metrics.backend, 'rtx');
    assert.deepEqual(remediated, ['kickstart:tun']);
    health = { models: { m: ['gpu-a', 'rtx'] }, providers: [{ name: 'gpu-a', up: false }, { name: 'rtx', up: false }] };
    out = await llmApp.run(ctx());
    assert.equal(out.findings[0].severity, 'crit');
    health = { models: { m: ['gpu-a', 'rtx'] }, providers: [{ name: 'gpu-a', up: true }, { name: 'rtx', up: true }] };
    out = await llmApp.run(ctx());
    assert.equal(out.findings.length, 0);
    assert.equal(out.metrics.backend, 'gpu-a');
  });
});
