// llm-app: an app (docker compose) that talks to an OpenAI-compatible model server,
// optionally reached through an SSH tunnel kept alive by launchd.
//
// config:
//   model.url            e.g. http://127.0.0.1:8020/v1/models
//   model.name           served model name (used for the chat test)
//   model.tunnelLabel    launchd label of the tunnel (optional, restarted if the model is unreachable)
//   model.tunnelLog      file to include as evidence (optional)
//   model.remote         { ssh, command, aliveRegex } read-only check on the GPU host (optional)
//   app.apiUrl, app.webUrl, app.composeDir, app.composeProject
//   app.chatPath (default /v1/chat/completions), app.chatEverySec, app.chatLatencyWarnMs
import { finding, probe, run, actions } from '../lib/core.mjs';

export default {
  defaultName: 'LLM 앱',
  defaultIcon: '🤖',
  playbook: [
    '- 구조: 웹/API 컨테이너(docker compose) → OpenAI 호환 모델 서버. 모델 서버는 SSH 터널 너머 GPU 서버에 있을 수 있다.',
    '- 자동 복구: 터널 재시작(launchctl kickstart), 앱 컨테이너가 죽었으면 docker compose up -d.',
    '- 원격 GPU 서버의 모델 프로세스는 자동으로 재시작하지 않는다. 사람이 판단할 수 있게 근거를 모아 보고한다.',
  ].join('\n'),

  async run(ctx) {
    const cfg = ctx.config;
    const model = cfg.model || {};
    const app = cfg.app || {};
    const findings = [];
    const actionsTaken = [];
    const evidence = [];
    const docker = args => run(cfg.dockerBin || 'docker', args, {
      env: cfg.dockerContext ? { DOCKER_CONTEXT: cfg.dockerContext } : {}, cwd: app.composeDir, timeoutMs: 120000,
    });
    const metrics = {};

    // 1) model server (through the tunnel if any)
    let m = { ok: true };
    if (model.url) {
      m = await probe(model.url);
      if (!m.ok && model.tunnelLabel) {
        actionsTaken.push(await ctx.remediate('kickstart', model.tunnelLabel, () => actions.kickstart(model.tunnelLabel)));
        await ctx.sleep(6000);
        m = await probe(model.url);
      }
      evidence.push(`model ${model.url}: ${m.status} ${m.error || ''} ${m.text.slice(0, 160)}`);
      metrics['모델'] = m.ok ? `${m.ms}ms` : 'down';
      if (!m.ok) {
        let remoteDown = false;
        if (model.remote?.ssh && model.remote?.command) {
          const r = await run('/usr/bin/ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', model.remote.ssh, model.remote.command], { timeoutMs: 30000 });
          evidence.push(`--- remote ${model.remote.ssh} (ssh ${r.ok ? 'ok' : 'fail'}):\n${r.stdout}${r.stderr}`);
          remoteDown = r.ok && model.remote.aliveRegex && !new RegExp(model.remote.aliveRegex).test(r.stdout);
        }
        if (model.tunnelLog) evidence.push(`--- tunnel log:\n${(await run('/usr/bin/tail', ['-n', '20', model.tunnelLog])).stdout}`);
        findings.push(finding('model:down', 'crit',
          remoteDown ? '원격 모델 서버 프로세스가 꺼져 있음' : '모델 서버 연결 실패',
          remoteDown ? '원격 GPU 서버에서 모델 서버를 다시 띄워야 합니다(자동 복구 안 함).' : `${model.url} · ${m.error || m.status}`));
      }
    }

    // 2) app containers
    let api = app.apiUrl ? await probe(app.apiUrl) : { ok: true, text: '' };
    let web = app.webUrl ? await probe(app.webUrl) : { ok: true, text: '' };
    if ((!api.ok || !web.ok) && app.composeDir) {
      const ps = await docker(['compose', 'ps', '--format', '{{.Name}} {{.State}} {{.Health}}']);
      evidence.push(`--- compose ps:\n${ps.stdout}${ps.stderr}`);
      actionsTaken.push(await ctx.remediate('compose', app.composeProject, () => docker(['compose', 'up', '-d'])));
      await ctx.sleep(10000);
      if (app.apiUrl) api = await probe(app.apiUrl);
      if (app.webUrl) web = await probe(app.webUrl);
    }
    if (app.apiUrl) {
      evidence.push(`api ${app.apiUrl}: ${api.status} ${api.text.slice(0, 200)}`);
      metrics.API = api.ok ? 'ok' : 'down';
      if (!api.ok) findings.push(finding('api:down', 'crit', '앱 API 응답 없음', `${app.apiUrl} · ${api.error || api.status}`));
    }
    if (app.webUrl) {
      evidence.push(`web ${app.webUrl}: ${web.status}`);
      if (!web.ok) findings.push(finding('web:down', 'crit', '앱 웹 화면 응답 없음', `${app.webUrl} · ${web.error || web.status}`));
    }

    // 3) end-to-end chat, every chatEverySec
    const st = ctx.agentState;
    if (app.apiUrl && model.name && api.ok && m.ok && Date.now() - (st.lastChatAt || 0) > (app.chatEverySec || 1800) * 1000) {
      const url = new URL(app.chatPath || '/v1/chat/completions', app.apiUrl).toString();
      const chat = await probe(url, {
        method: 'POST', timeoutMs: 90000, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.name, messages: [{ role: 'user', content: '상태 점검입니다. "정상"이라고만 답하세요.' }] }),
      });
      st.lastChatAt = Date.now();
      const answered = chat.ok && /"type":\s*"token"|"content"/.test(chat.text);
      st.lastChat = { ms: chat.ms, ok: answered };
      evidence.push(`chat: ${chat.status} ${chat.ms}ms answered=${answered}`);
      if (!answered) findings.push(finding('chat:fail', 'crit', '채팅 응답 실패', `HTTP ${chat.status} ${chat.error || ''}`));
      else if (chat.ms > (app.chatLatencyWarnMs || 20000)) findings.push(finding('chat:slow', 'warn', `채팅 응답 느림 ${chat.ms}ms`, `기준 ${app.chatLatencyWarnMs || 20000}ms`));
    }
    if (st.lastChat) metrics['채팅'] = st.lastChat.ok ? `${st.lastChat.ms}ms` : 'fail';

    return { findings, actions: actionsTaken.filter(a => a.done || a.reason === 'cooldown'), metrics, evidence: evidence.join('\n') };
  },
};
