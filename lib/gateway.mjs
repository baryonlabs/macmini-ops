// LLM gateway: one OpenAI-compatible endpoint in front of several model backends.
// Each public model name maps to an ordered list of routes (provider + upstream model).
// A request goes to the first healthy route; on connection error, timeout before the
// first response byte, or a retryable status, it moves on to the next route.
// Once the first byte has been sent to the client (streaming), there is no fallback.
import http from 'node:http';
import https from 'node:https';

const RETRYABLE = new Set([404, 408, 409, 425, 429, 500, 502, 503, 504]);
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'content-encoding']);

export class ProviderState {
  constructor({ cooldownSec = 60, now = () => Date.now() } = {}) {
    this.cooldownMs = cooldownSec * 1000;
    this.now = now;
    this.state = new Map(); // name -> { downUntil, lastError, ok, fail, lastOkAt }
  }

  get(name) {
    if (!this.state.has(name)) this.state.set(name, { downUntil: 0, lastError: '', ok: 0, fail: 0, lastOkAt: null });
    return this.state.get(name);
  }

  isDown(name) {
    return this.get(name).downUntil > this.now();
  }

  markOk(name) {
    const s = this.get(name);
    s.downUntil = 0;
    s.ok += 1;
    s.lastOkAt = new Date(this.now()).toISOString();
  }

  markFail(name, reason, cooldownMs = this.cooldownMs) {
    const s = this.get(name);
    s.downUntil = this.now() + cooldownMs;
    s.fail += 1;
    s.lastError = reason;
  }
}

/** Build the upstream JSON body for one route: swap the model, drop/add provider-specific fields. */
export function upstreamBody(body, route, provider) {
  const out = { ...body, model: route.model };
  for (const f of provider.dropFields || []) delete out[f];
  return { ...out, ...(provider.extraBody || {}), ...(route.extraBody || {}) };
}

function send(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}

/**
 * POST JSON to an upstream and resolve once the response has started (status + headers),
 * or reject on connect error / timeout before the first byte.
 */
function startUpstream(url, { headers, body, firstByteMs }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers } });
    const timer = setTimeout(() => req.destroy(new Error(`no response within ${firstByteMs} ms`)), firstByteMs);
    req.on('response', upstream => {
      // Wait for the first chunk (or end) so "headers sent, then silence" still counts as a timeout.
      const onFirst = chunk => {
        clearTimeout(timer);
        upstream.pause();
        upstream.removeListener('end', onEnd);
        resolve({ upstream, first: chunk });
      };
      const onEnd = () => {
        clearTimeout(timer);
        resolve({ upstream, first: null });
      };
      upstream.once('data', onFirst);
      upstream.once('end', onEnd);
    });
    req.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    req.end(body);
  });
}

async function readAll(stream, first) {
  const chunks = first ? [first] : [];
  stream.resume();
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param {object} cfg
 * @param {Record<string, {baseUrl:string, apiKey?:string, apiKeyEnv?:string, headers?:object, dropFields?:string[], extraBody?:object, firstByteMs?:number}>} cfg.providers
 * @param {Record<string, Array<{provider:string, model:string, extraBody?:object}>>} cfg.models  public name -> ordered routes
 * @param {number} [cfg.cooldownSec]
 * @param {number} [cfg.firstByteMs]   default time to first byte before falling through
 */
export function createGateway(cfg, { env = process.env, log = console, now = () => Date.now() } = {}) {
  const states = new ProviderState({ cooldownSec: cfg.cooldownSec ?? 60, now });
  const stats = { requests: 0, served: {}, fallbacks: 0, failed: 0 };

  // A provider can override the cooldown, e.g. a shared GPU that is often busy for hours.
  const cooldownFor = p => (p.cooldownSec ?? cfg.cooldownSec ?? 60) * 1000;
  const keyFor = p => p.apiKey || (p.apiKeyEnv ? env[p.apiKeyEnv] : '') || '';

  async function route(req, res, body) {
    const name = body.model;
    const routes = cfg.models[name];
    if (!routes) return send(res, 404, { error: { message: `unknown model "${name}". Known: ${Object.keys(cfg.models).join(', ')}`, type: 'invalid_request_error' } });

    // Healthy routes first (in configured order), then the ones cooling down as a last resort.
    const ordered = [...routes.filter(r => !states.isDown(r.provider)), ...routes.filter(r => states.isDown(r.provider))];
    const attempts = [];
    for (const [i, r] of ordered.entries()) {
      const p = cfg.providers[r.provider];
      if (!p) { attempts.push(`${r.provider}: not configured`); continue; }
      if (p.apiKeyEnv && !keyFor(p)) { attempts.push(`${r.provider}: missing ${p.apiKeyEnv}`); continue; }
      const url = `${p.baseUrl.replace(/\/$/, '')}/chat/completions`;
      const headers = { ...(p.headers || {}), ...(keyFor(p) ? { Authorization: `Bearer ${keyFor(p)}` } : {}) };
      try {
        const { upstream, first } = await startUpstream(url, {
          headers,
          body: JSON.stringify(upstreamBody(body, r, p)),
          firstByteMs: r.firstByteMs || p.firstByteMs || cfg.firstByteMs || 30000,
        });
        if (upstream.statusCode >= 200 && upstream.statusCode < 300) {
          states.markOk(r.provider);
          stats.served[r.provider] = (stats.served[r.provider] || 0) + 1;
          if (i > 0) stats.fallbacks += 1;
          const outHeaders = { 'x-gateway-backend': r.provider, 'x-gateway-model': r.model };
          for (const [k, v] of Object.entries(upstream.headers)) if (!HOP_BY_HOP.has(k)) outHeaders[k] = v;
          res.writeHead(upstream.statusCode, outHeaders);
          if (first) res.write(first);
          upstream.resume();
          upstream.pipe(res);
          log.info?.(`[gateway] ${name} -> ${r.provider}/${r.model}${i > 0 ? ` (fallback #${i})` : ''}`);
          return;
        }
        const text = await readAll(upstream, first);
        attempts.push(`${r.provider}: HTTP ${upstream.statusCode} ${text.slice(0, 160)}`);
        // Retryable statuses mean the backend is unhealthy; other 4xx (e.g. a parameter one
        // backend rejects) still fall through, but do not put the backend into cooldown.
        if (RETRYABLE.has(upstream.statusCode) || upstream.statusCode === 401 || upstream.statusCode === 403) {
          states.markFail(r.provider, `HTTP ${upstream.statusCode}`, cooldownFor(p));
        }
      } catch (error) {
        attempts.push(`${r.provider}: ${error.message}`);
        states.markFail(r.provider, error.message, cooldownFor(p));
      }
    }
    stats.failed += 1;
    log.error?.(`[gateway] ${name}: all backends failed — ${attempts.join(' | ')}`);
    return send(res, 502, { error: { message: 'all backends failed', type: 'upstream_error', attempts } });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://gateway.local');
    try {
      if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
        return send(res, 200, { object: 'list', data: Object.keys(cfg.models).map(id => ({ id, object: 'model', owned_by: 'macmini-ops-gateway' })) });
      }
      if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
        const providers = Object.keys(cfg.providers).map(name => {
          const s = states.get(name);
          return { name, up: !states.isDown(name), ok: s.ok, fail: s.fail, lastError: s.lastError, lastOkAt: s.lastOkAt };
        });
        const models = Object.fromEntries(Object.entries(cfg.models).map(([m, routes]) => [m, routes.map(r => r.provider)]));
        return send(res, 200, { ok: true, providers, models, stats });
      }
      if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions')) {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > 8 * 1024 * 1024) return send(res, 413, { error: { message: 'request too large' } });
          chunks.push(c);
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return send(res, 400, { error: { message: 'invalid JSON' } });
        }
        stats.requests += 1;
        return await route(req, res, body);
      }
      return send(res, 404, { error: { message: 'not found' } });
    } catch (error) {
      log.error?.('[gateway] error', error);
      if (!res.headersSent) send(res, 500, { error: { message: 'internal error' } });
      else res.destroy();
    }
  });

  return { server, states, stats };
}
