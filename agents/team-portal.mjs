// team-portal: watches a team-portal instance (https://github.com/baryonlabs/team-portal),
// an optional legacy site behind its fallbackProxy, the public (tailnet) URL and every card link.
//
// config: portalUrl, label, legacyUrl?, legacyLabel?, publicPortalUrl?, servePort?, serveTarget?, linkSkip?[]
import { finding, probe, actions, tailscale } from '../lib/core.mjs';

export default {
  defaultName: '포탈 관리',
  defaultIcon: '🧭',
  playbook: [
    '- team-portal 이 응답하지 않으면 launchd 서비스를 재시작한다. fallbackProxy 뒤의 기존 사이트도 같은 방식으로 다룬다.',
    '- 공개 주소(Tailscale serve 등)로 접속이 안 되면 serve 설정을 확인하고 허용된 경우 다시 연결한다.',
    '- 카드 링크가 404이거나 응답이 없으면 경고로 보고만 한다. 로그인이 필요한 링크는 linkSkip 에 카드 id를 넣어 제외한다.',
  ].join('\n'),

  async run(ctx) {
    const cfg = ctx.config;
    const findings = [];
    const actionsTaken = [];
    const evidence = [];

    const restartIfDown = async (url, label, key, title) => {
      let r = await probe(url);
      evidence.push(`${url}: ${r.status} ${r.error || ''}`);
      if (!r.ok && label) {
        actionsTaken.push(await ctx.remediate('kickstart', label, () => actions.kickstart(label)));
        await ctx.sleep(3000);
        r = await probe(url);
      }
      if (!r.ok) findings.push(finding(key, 'crit', title, `${url} · ${r.error || r.status}`));
      return r;
    };

    const health = await restartIfDown(`${cfg.portalUrl}/healthz`, cfg.label, 'portal:down', 'team-portal 응답 없음');
    if (cfg.legacyUrl) await restartIfDown(cfg.legacyUrl, cfg.legacyLabel, 'legacy:down', 'fallback 사이트 응답 없음');

    if (cfg.publicPortalUrl) {
      const reaches = r => r.ok && /"cards"/.test(r.text);
      const via = await probe(`${cfg.publicPortalUrl}/healthz`);
      evidence.push(`${cfg.publicPortalUrl}/healthz: ${via.status} ${via.error || ''}`);
      if (!reaches(via)) {
        let proxyTarget = null;
        if (cfg.servePort) {
          const serve = await tailscale(['serve', 'status', '--json']);
          try {
            const web = JSON.parse(serve.stdout).Web || {};
            const key = Object.keys(web).find(k => k.endsWith(`:${cfg.servePort}`));
            proxyTarget = key ? web[key].Handlers?.['/']?.Proxy : null;
          } catch { /* tailscale stopped or no serve config */ }
          evidence.push(`tailscale serve :${cfg.servePort} -> ${proxyTarget}`);
          if (cfg.serveTarget && proxyTarget !== cfg.serveTarget) {
            actionsTaken.push(await ctx.remediate('serve', cfg.servePort, () => tailscale(['serve', '--bg', `--http=${cfg.servePort}`, cfg.serveTarget])));
          }
          await ctx.sleep(3000);
        }
        const again = await probe(`${cfg.publicPortalUrl}/healthz`);
        if (!reaches(again)) findings.push(finding('public:down', 'crit', `${cfg.publicPortalUrl} 접속 안 됨`, `${proxyTarget ? `serve → ${proxyTarget} · ` : ''}${again.error || `HTTP ${again.status}`}`));
      }
    }

    let cards = [];
    if (health.ok) {
      const res = await probe(`${cfg.portalUrl}/api/portal`);
      try { cards = JSON.parse(res.text).cards || []; } catch { cards = []; }
    }
    const skip = new Set(cfg.linkSkip || []);
    const targets = cards.filter(c => !skip.has(c.id)).map(c => {
      if (c.url?.startsWith('/')) return [c, `${cfg.portalUrl}${c.url}`];
      if (c.url) return [c, c.url];
      if (c.port) return [c, `http://127.0.0.1:${c.port}${c.path || '/'}`];
      return null;
    }).filter(Boolean);
    const results = await Promise.all(targets.map(async ([c, url]) => [c, url, await probe(url, { timeoutMs: 10000 })]));
    let dead = 0;
    for (const [c, url, r] of results) {
      if (r.status === 404 || r.status === 0 || r.status >= 500) {
        dead += 1;
        findings.push(finding(`link:${c.id}`, 'warn', `카드 링크 이상: ${c.title}`, `${url} · ${r.error || `HTTP ${r.status}`}`));
      }
      evidence.push(`link ${c.id} ${url} -> ${r.status} ${r.error || ''}`);
    }

    return {
      findings,
      actions: actionsTaken.filter(a => a.done || a.reason === 'cooldown'),
      metrics: { 카드: cards.length, '링크 점검': targets.length, '죽은 링크': dead },
      evidence: evidence.join('\n'),
    };
  },
};
