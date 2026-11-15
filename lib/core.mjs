// Shared helpers for the Mac mini ops agents: command execution, HTTP probes,
// remediation guard rails, persistent state, notifications and LLM diagnosis.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Run a command without a shell. Never throws; returns { ok, code, stdout, stderr }. */
export function run(cmd, args = [], { timeoutMs = 20000, env, cwd } = {}) {
  return new Promise(resolve => {
    const child = execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...env }, cwd }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || '') + (error && error.killed ? '\n[timeout]' : ''),
      });
    });
    // Close stdin right away: tools like `codex exec` otherwise wait for more input forever.
    child.stdin?.end();
  });
}

/** HTTP GET probe. ok = status 1..499. */
export async function probe(url, { timeoutMs = 8000, method = 'GET', body, headers } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, body, headers, signal: controller.signal, redirect: 'manual' });
    const text = await res.text().catch(() => '');
    return { ok: res.status > 0 && res.status < 500, status: res.status, ms: Date.now() - started, text };
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, text: '', error: error.name === 'AbortError' ? 'timeout' : (error.cause?.code || error.message) };
  } finally {
    clearTimeout(timer);
  }
}

export const finding = (key, severity, title, detail = '') => ({ key, severity, title, detail });

/**
 * Remediation guard: an action runs only if its target is on the allow-list in config,
 * at most once per cooldown window, and never in dry-run mode.
 */
export class Remediator {
  constructor({ allow = {}, cooldownSec = 600, dryRun = false, now = () => Date.now() } = {}) {
    this.allow = allow;
    this.cooldownMs = cooldownSec * 1000;
    this.dryRun = dryRun;
    this.now = now;
    this.last = new Map();
  }

  async attempt(kind, target, fn) {
    const allowed = (this.allow[kind] || []).includes(target);
    const id = `${kind}:${target}`;
    if (!allowed) return { id, done: false, reason: 'not on allow-list' };
    const prev = this.last.get(id);
    if (prev !== undefined && this.now() - prev < this.cooldownMs) return { id, done: false, reason: 'cooldown' };
    this.last.set(id, this.now());
    if (this.dryRun) return { id, done: false, reason: 'dry-run' };
    const result = await fn();
    return { id, done: true, ok: result.ok !== false, detail: (result.stderr || result.stdout || '').trim().slice(0, 300) };
  }
}

export function uid() {
  return process.getuid ? process.getuid() : 501;
}

const TAILSCALE = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
export const shQuote = v => `'${String(v).replace(/'/g, `'\\''`)}'`;

/**
 * The App Store build of the Tailscale CLI tries to launch its GUI when a launchd-spawned
 * Node process calls it directly ("The Tailscale GUI failed to start"). Going through
 * /bin/sh avoids that, so every Tailscale CLI call uses this wrapper.
 */
export function tailscale(args, opts) {
  return run('/bin/sh', ['-c', `${TAILSCALE} ${args.map(shQuote).join(' ')} 2>&1`], opts);
}

export const actions = {
  kickstart: label => run('/bin/launchctl', ['kickstart', '-k', `gui/${uid()}/${label}`]),
};

/** JSON state + append-only event log under one directory. */
export class StateStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
    this.file = path.join(dir, 'state.json');
    this.eventsFile = path.join(dir, 'events.jsonl');
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.data = { agents: {} };
    }
  }

  agent(id) {
    this.data.agents[id] ??= { incidents: {}, lastRun: null };
    return this.data.agents[id];
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  event(e) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...e });
    fs.appendFileSync(this.eventsFile, line + '\n');
  }

  recentEvents(limit = 50) {
    try {
      const lines = fs.readFileSync(this.eventsFile, 'utf8').trim().split('\n');
      return lines.slice(-limit).reverse().map(l => JSON.parse(l));
    } catch {
      return [];
    }
  }

  reports(limit = 20) {
    const dir = path.join(this.dir, 'reports');
    return fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, limit);
  }
}

/** Optional chat webhook (Discord or Slack incoming webhook). Silently skipped when unset. */
export async function notify(webhookUrl, text) {
  if (!webhookUrl) return { sent: false };
  const body = JSON.stringify({ content: text.slice(0, 1900), text: text.slice(0, 3900) });
  const res = await probe(webhookUrl, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, timeoutMs: 10000 });
  return { sent: res.ok, status: res.status };
}

export function buildDiagnosisPrompt({ agentName, playbook, findings, evidence }) {
  return [
    `당신은 서버 운영 담당 "${agentName}" 에이전트입니다. 아래 증거만 근거로 장애를 분석하세요.`,
    '명령을 실행하거나 파일을 바꾸지 마세요. 증거에 없는 내용은 "추측"이라고 표시하세요.',
    '출력 형식 (한국어 마크다운): ## 요약(2줄) / ## 원인 후보(근거와 함께, 가능성 순) / ## 사람이 할 일(명령어 포함, 위험한 것은 표시) / ## 다시 확인할 방법',
    '',
    '### 이 에이전트의 운영 지침',
    playbook,
    '',
    '### 현재 문제',
    ...findings.map(f => `- [${f.severity}] ${f.title}: ${f.detail}`),
    '',
    '### 수집한 증거',
    '```',
    String(evidence || '').slice(0, 12000),
    '```',
  ].join('\n');
}

async function viaOpenAI(backend, prompt, timeoutMs) {
  const res = await probe(`${backend.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    timeoutMs,
    headers: { 'Content-Type': 'application/json', ...(backend.apiKey ? { Authorization: `Bearer ${backend.apiKey}` } : {}) },
    body: JSON.stringify({
      model: backend.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1500,
      ...(backend.disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    }),
  });
  if (res.status !== 200) return { ok: false, error: `HTTP ${res.status} ${res.error || res.text.slice(0, 200)}` };
  try {
    const text = JSON.parse(res.text).choices?.[0]?.message?.content?.trim();
    return text ? { ok: true, text } : { ok: false, error: 'empty answer' };
  } catch {
    return { ok: false, error: 'bad JSON from model server' };
  }
}

async function viaCodex(backend, prompt, timeoutMs, outFile) {
  const tmp = `${outFile}.codex`;
  const res = await run(backend.cli, ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-o', tmp, prompt], { timeoutMs });
  const text = fs.existsSync(tmp) ? fs.readFileSync(tmp, 'utf8').trim() : '';
  fs.rmSync(tmp, { force: true });
  return text ? { ok: true, text } : { ok: false, error: (res.stderr || res.stdout).trim().split('\n').slice(-2).join(' ').slice(0, 300) };
}

/**
 * Ask an LLM for a diagnosis, trying each backend in order. The model only reads the
 * evidence we collected; the result is a report, never an action.
 */
export async function diagnose({ backends = [], agentName, playbook, findings, evidence, outFile, timeoutMs = 240000 }) {
  const prompt = buildDiagnosisPrompt({ agentName, playbook, findings, evidence });
  const errors = [];
  for (const backend of backends) {
    const r = backend.type === 'codex'
      ? await viaCodex(backend, prompt, timeoutMs, outFile)
      : await viaOpenAI(backend, prompt, timeoutMs);
    if (r.ok) {
      const header = `<!-- ${new Date().toISOString()} · ${agentName} · model: ${backend.name || backend.type} -->\n\n`;
      fs.writeFileSync(outFile, header + r.text + '\n');
      return { ok: true, backend: backend.name || backend.type };
    }
    errors.push(`${backend.name || backend.type}: ${r.error}`);
  }
  return { ok: false, error: errors.join(' | ') || 'no LLM backend configured' };
}
