// sites: reachability and TLS expiry for a list of websites. Report-only.
//
// config:
//   sites: [{ id, name, url, critical? }]       built-in checker
//   checkModule: "/path/to/check.mjs"          or an external checker exporting checkAll() → { sites: [...] }
//   tlsWarnDays (14), tlsCritDays (7)
import net from 'node:net';
import tls from 'node:tls';
import { pathToFileURL } from 'node:url';
import { finding, probe } from '../lib/core.mjs';

export function tlsDaysLeft(hostname, { port = 443, timeoutMs = 8000, now = Date.now() } = {}) {
  return new Promise(resolve => {
    // SNI must be a hostname; Node throws if it is an IP address.
    const sni = net.isIP(hostname) ? {} : { servername: hostname };
    const socket = tls.connect({ host: hostname, port, ...sni, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert?.valid_to ? Math.floor((Date.parse(cert.valid_to) - now) / 86400000) : null);
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
  });
}

export async function builtinCheck(list) {
  const sites = await Promise.all(list.map(async s => {
    const r = await probe(s.url, { timeoutMs: 15000 });
    const u = new URL(s.url);
    const tlsDays = u.protocol === 'https:' ? await tlsDaysLeft(u.hostname, { port: Number(u.port) || 443 }) : null;
    return { id: s.id, name: s.name || s.id, url: s.url, starred: Boolean(s.critical), ok: r.ok, status: r.status, error: r.error || null, tlsDays };
  }));
  return { sites };
}

export default {
  defaultName: '사이트 관리',
  defaultIcon: '🌐',
  playbook: [
    '- critical 로 표시한 사이트가 응답하지 않으면 심각, 그 밖의 사이트는 경고.',
    '- TLS 인증서가 tlsCritDays 안에 만료되면 심각, tlsWarnDays 안이면 경고. 갱신은 호스팅 쪽에서 한다.',
    '- 이 에이전트는 사이트를 고치지 않고 보고만 한다.',
  ].join('\n'),

  async run(ctx) {
    const cfg = ctx.config;
    const warnDays = cfg.tlsWarnDays ?? 14;
    const critDays = cfg.tlsCritDays ?? 7;
    let report;
    if (ctx.siteChecker) report = await ctx.siteChecker.checkAll();
    else if (cfg.checkModule) report = await (await import(pathToFileURL(cfg.checkModule).href)).checkAll();
    else report = await builtinCheck(cfg.sites || []);

    const findings = [];
    const lines = [];
    for (const s of report.sites) {
      lines.push(`${s.id} status=${s.status} ok=${s.ok} tls=${s.tlsDays} err=${s.error || ''}`);
      if (!s.ok) findings.push(finding(`down:${s.id}`, s.starred ? 'crit' : 'warn', `${s.name} 응답 없음`, `${s.url} · ${s.error || `HTTP ${s.status}`}`));
      if (typeof s.tlsDays === 'number') {
        if (s.tlsDays <= critDays) findings.push(finding(`tls:${s.id}`, 'crit', `${s.name} 인증서 ${s.tlsDays}일 남음`, s.url));
        else if (s.tlsDays <= warnDays) findings.push(finding(`tls:${s.id}`, 'warn', `${s.name} 인증서 ${s.tlsDays}일 남음`, s.url));
      }
    }
    return {
      findings,
      metrics: { 사이트: report.sites.length, 정상: report.sites.filter(s => s.ok).length },
      evidence: lines.join('\n'),
    };
  },
};
