// host: launchd services, disk, memory, Docker Desktop and Tailscale on a macOS server.
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
  defaultName: '서버 관리',
  defaultIcon: '🖥️',
  playbook: [
    '- 감시 대상 launchd 서비스가 꺼져 있으면, 허용 목록(remediation.allow.kickstart)에 있는 것만 launchctl kickstart -k 로 다시 띄운다.',
    '- 디스크 사용률이 diskWarnPct 이상이면 경고, diskCritPct 이상이면 심각. 정리 후보: docker system df, ~/Library/Caches.',
    '- Docker Desktop과 Tailscale은 자동으로 재시작하지 않고 보고만 한다.',
  ].join('\n'),

  async run(ctx) {
    const cfg = ctx.config;
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
          findings.push(finding(`svc:${label}`, 'crit', `서비스 꺼짐: ${label}`, `state=${info.state} lastExit=${info.lastExit}${act.done ? '' : ` · 자동 재시작 안 함(${act.reason})`}`));
        }
      }
      if (info.state === 'running') running += 1;
      evidence.push(`${label}: state=${info.state} pid=${info.pid} lastExit=${info.lastExit}`);
    }

    const df = parseDf((await run('/bin/df', ['-k', cfg.diskPath || '/System/Volumes/Data'])).stdout);
    evidence.push(`disk: ${df.usedPct}% used, ${df.availGb}GB free`);
    if (df.usedPct >= (cfg.diskCritPct ?? 92)) findings.push(finding('disk', 'crit', `디스크 ${df.usedPct}% 사용`, `남은 공간 ${df.availGb}GB`));
    else if (df.usedPct >= (cfg.diskWarnPct ?? 85)) findings.push(finding('disk', 'warn', `디스크 ${df.usedPct}% 사용`, `남은 공간 ${df.availGb}GB`));

    const mem = (await run('/usr/bin/memory_pressure', ['-Q'])).stdout;
    const freePct = Number(/free percentage: (\d+)%/.exec(mem)?.[1] ?? -1);
    evidence.push(`memory free: ${freePct}%`);
    if (freePct >= 0 && freePct < (cfg.memWarnFreePct ?? 10)) findings.push(finding('memory', 'warn', `여유 메모리 ${freePct}%`, 'memory_pressure 기준'));

    if (cfg.dockerBin) {
      const docker = await run(cfg.dockerBin, ['info', '--format', '{{.ServerVersion}}'], { env: cfg.dockerContext ? { DOCKER_CONTEXT: cfg.dockerContext } : {} });
      evidence.push(`docker: ${docker.ok ? docker.stdout.trim() : docker.stderr.trim().slice(0, 200)}`);
      if (!docker.ok) findings.push(finding('docker', 'crit', 'Docker 응답 없음', '컨테이너로 돌리는 서비스도 함께 멈춥니다.'));
    }

    if (cfg.tailscale) {
      let online = false;
      try {
        const st = JSON.parse((await tailscale(['status', '--json'])).stdout);
        online = st.BackendState === 'Running' && st.Self?.Online === true;
      } catch { online = false; }
      evidence.push(`tailscale online: ${online}`);
      if (!online) findings.push(finding('tailscale', 'crit', 'Tailscale 오프라인', '테일넷으로 하는 원격 접속이 끊깁니다.'));
    }

    const metrics = { 디스크: `${df.usedPct}%`, '여유 메모리': `${freePct}%` };
    if (services.length) metrics['서비스'] = `${running}/${services.length}`;
    return { findings, actions: actionsTaken.filter(a => a.done || a.reason === 'cooldown'), metrics, evidence: evidence.join('\n') };
  },
};
