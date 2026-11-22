// host: launchd services, disk, memory, Docker Desktop and Tailscale on a macOS server.
import fs from 'node:fs';
import os from 'node:os';
import { finding, run, actions, uid, tailscale } from '../lib/core.mjs';

export function parseLaunchctlPrint(text) {
  const state = /^\s*state = (\S+)/m.exec(text)?.[1] || 'unknown';
  const pid = Number(/^\s*pid = (\d+)/m.exec(text)?.[1] || 0);
  const lastExit = /last exit code = (.+)$/m.exec(text)?.[1]?.trim() || '';
  return { state, pid, lastExit };
}

export function parseDf(text) {
  const line = text.trim().split('\n').pop().split(/\s+/);
  const used = Number(line[2]);
  const avail = Number(line[3]);
  return { usedPct: Math.round((used / (used + avail)) * 100), availGb: Math.round(avail / 1024 / 1024) };
}

export default {
  nameKey: 'host.name',
  defaultIcon: '🖥️',
  playbook: {
    en: [
      '- If a watched launchd service is down, restart it with launchctl kickstart -k only when it is on remediation.allow.kickstart.',
      '- Disk usage >= diskWarnPct is a warning, >= diskCritPct is critical. Cleanup candidates: docker system df, ~/Library/Caches.',
      '- Docker Desktop and Tailscale are reported, never restarted automatically.',
    ].join('\n'),
    ko: [
      '- 감시 대상 launchd 서비스가 꺼져 있으면, 허용 목록(remediation.allow.kickstart)에 있는 것만 launchctl kickstart -k 로 다시 띄운다.',
      '- 디스크 사용률이 diskWarnPct 이상이면 경고, diskCritPct 이상이면 심각. 정리 후보: docker system df, ~/Library/Caches.',
      '- Docker Desktop과 Tailscale은 자동으로 재시작하지 않고 보고만 한다.',
    ].join('\n'),
  },

  async run(ctx) {
    const cfg = ctx.config;
    const t = ctx.t;
    const findings = [];
    const actionsTaken = [];
    const evidence = [];
    const services = cfg.services || [];

    let running = 0;
    for (const label of services) {
      let info = parseLaunchctlPrint((await run('/bin/launchctl', ['print', `gui/${uid()}/${label}`])).stdout);
      if (info.state !== 'running') {
        const act = await ctx.remediate('kickstart', label, () => actions.kickstart(label));
        actionsTaken.push(act);
        if (act.done) {
          await ctx.sleep(3000);
          info = parseLaunchctlPrint((await run('/bin/launchctl', ['print', `gui/${uid()}/${label}`])).stdout);
        }
        if (info.state !== 'running') {
          findings.push(finding(`svc:${label}`, 'crit', t('host.svcDown', { label }),
            t('host.svcDetail', { state: info.state, lastExit: info.lastExit, note: act.done ? '' : t('host.noRestart', { reason: act.reason }) })));
        }
      }
      if (info.state === 'running') running += 1;
      evidence.push(`${label}: state=${info.state} pid=${info.pid} lastExit=${info.lastExit}`);
    }

    const df = parseDf((await run('/bin/df', ['-k', cfg.diskPath || '/System/Volumes/Data'])).stdout);
    evidence.push(`disk: ${df.usedPct}% used, ${df.availGb}GB free`);
    const diskTitle = t('host.disk', { pct: df.usedPct });
    const diskDetail = t('host.diskDetail', { gb: df.availGb });
    if (df.usedPct >= (cfg.diskCritPct ?? 92)) findings.push(finding('disk', 'crit', diskTitle, diskDetail));
    else if (df.usedPct >= (cfg.diskWarnPct ?? 85)) findings.push(finding('disk', 'warn', diskTitle, diskDetail));

    const mem = (await run('/usr/bin/memory_pressure', ['-Q'])).stdout;
    const freePct = Number(/free percentage: (\d+)%/.exec(mem)?.[1] ?? -1);
    evidence.push(`memory free: ${freePct}%`);
    if (freePct >= 0 && freePct < (cfg.memWarnFreePct ?? 10)) findings.push(finding('memory', 'warn', t('host.memory', { pct: freePct }), t('host.memoryDetail')));

    if (cfg.dockerBin) {
      const docker = await run(cfg.dockerBin, ['info', '--format', '{{.ServerVersion}}'], { env: cfg.dockerContext ? { DOCKER_CONTEXT: cfg.dockerContext } : {} });
      evidence.push(`docker: ${docker.ok ? docker.stdout.trim() : docker.stderr.trim().slice(0, 200)}`);
      if (!docker.ok) findings.push(finding('docker', 'crit', t('host.docker'), t('host.dockerDetail')));
    }

    if (cfg.tailscale) {
      let online = false;
      try {
        const st = JSON.parse((await tailscale(['status', '--json'])).stdout);
        online = st.BackendState === 'Running' && st.Self?.Online === true;
      } catch { online = false; }
      evidence.push(`tailscale online: ${online}`);
      if (!online) findings.push(finding('tailscale', 'crit', t('host.tailscale'), t('host.tailscaleDetail')));
    }

    // External volumes that must stay mounted, and symlinks that point onto them.
    for (const mount of cfg.mounts || []) {
      const out = (await run('/sbin/mount', [])).stdout;
      const mounted = out.split('\n').some(l => l.includes(` on ${mount} (`));
      evidence.push(`mount ${mount}: ${mounted ? 'ok' : 'MISSING'}`);
      if (!mounted) findings.push(finding(`mount:${mount}`, 'crit', t('host.mountMissing', { mount }), t('host.mountMissingDetail')));
    }
    for (const link of cfg.links || []) {
      let target = '';
      let ok = false;
      try {
        target = fs.readlinkSync(link);
        ok = fs.existsSync(link);
      } catch { /* not a symlink or missing */ }
      evidence.push(`link ${link} -> ${target || '(not a symlink)'}: ${ok ? 'ok' : 'BROKEN'}`);
      if (!ok) findings.push(finding(`link:${link}`, 'crit', t('host.linkBroken', { link }), target ? `→ ${target}` : t('host.notSymlink')));
    }

    const uptimeMinutes = Math.floor(os.uptime() / 60);
    const metrics = {
      [t('metric.disk')]: `${df.usedPct}%`,
      [t('metric.freeMem')]: `${freePct}%`,
      [t('metric.uptime')]: t('metric.uptimeValue', { hours: Math.floor(uptimeMinutes / 60), minutes: uptimeMinutes % 60 }),
      [t('metric.load')]: os.loadavg().map(value => value.toFixed(2)).join(' / '),
    };
    if (services.length) metrics[t('metric.services')] = `${running}/${services.length}`;
    return { findings, actions: actionsTaken.filter(a => a.done || a.reason === 'cooldown'), metrics, evidence: evidence.join('\n') };
  },
};
