// User-facing strings (findings, metrics, alerts, LLM prompt). English is the default;
// set "locale": "ko" in config for Korean. Missing keys fall back to English.

const en = {
  // host
  'host.name': 'Server',
  'host.svcDown': 'Service down: {label}',
  'host.svcDetail': 'state={state} lastExit={lastExit}{note}',
  'host.noRestart': ' · not restarted ({reason})',
  'host.disk': 'Disk {pct}% used',
  'host.diskDetail': '{gb} GB free',
  'host.memory': 'Free memory {pct}%',
  'host.memoryDetail': 'per memory_pressure',
  'host.docker': 'Docker is not responding',
  'host.dockerDetail': 'Services running in containers are down too.',
  'host.tailscale': 'Tailscale is offline',
  'host.tailscaleDetail': 'Remote access over the tailnet is down.',
  'host.mountMissing': 'Volume not mounted: {mount}',
  'host.mountMissingDetail': 'Anything stored on it, and symlinks pointing to it, is unavailable.',
  'host.linkBroken': 'Broken symlink: {link}',
  'host.notSymlink': 'missing or not a symlink',
  'metric.services': 'services',
  'metric.disk': 'disk',
  'metric.freeMem': 'free mem',
  'metric.uptime': 'uptime',
  'metric.uptimeValue': '{hours}h {minutes}m',
  'metric.load': 'load (1/5/15 min)',
  // llm-app
  'llm.name': 'LLM app',
  'llm.remoteDown': 'Model server process is not running on the remote host',
  'llm.remoteDownDetail': 'Restart the model server on the GPU host (not done automatically).',
  'llm.modelDown': 'Model server unreachable',
  'llm.apiDown': 'App API is not responding',
  'llm.webDown': 'App web UI is not responding',
  'llm.chatFail': 'Chat test failed',
  'llm.chatSlow': 'Chat test slow: {ms} ms',
  'llm.chatSlowDetail': 'threshold {limit} ms',
  'llm.chatPrompt': 'Health check. Reply with the single word "OK".',
  'llm.fallback': 'Primary model backend {primary} is down; serving from {active}',
  'llm.fallbackDetail': 'down: {down}',
  'llm.allDown': 'All model backends are down',
  'metric.backend': 'backend',
  'metric.model': 'model',
  'metric.api': 'API',
  'metric.chat': 'chat',
  // team-portal
  'portal.name': 'Portal',
  'portal.down': 'team-portal is not responding',
  'portal.legacyDown': 'Fallback site is not responding',
  'portal.publicDown': '{url} is unreachable',
  'portal.badLink': 'Broken card link: {title}',
  'metric.cards': 'cards',
  'metric.linksChecked': 'links checked',
  'metric.deadLinks': 'dead links',
  // sites
  'sites.name': 'Websites',
  'sites.down': '{name} is not responding',
  'sites.tls': '{name} certificate expires in {days} days',
  'metric.sites': 'sites',
  'metric.up': 'up',
  // engine
  'alert.open': '🔴 [{agent}] {title}\n{detail}',
  'alert.resolved': '🟢 [{agent}] Recovered: {title}',
  'alert.report': '🧠 [{agent}] Root-cause report: {url}',
  'agent.error': 'Agent crashed',
  // LLM prompt
  'prompt.intro': 'You are "{agent}", an operations agent for a server. Diagnose the incident using ONLY the evidence below.',
  'prompt.rules': 'Do not run commands or change files. Mark anything not supported by the evidence as a guess.',
  'prompt.format': 'Answer in Markdown with these sections: ## Summary (2 lines) / ## Likely causes (with evidence, most likely first) / ## What a human should do (commands; flag risky ones) / ## How to verify',
  'prompt.playbook': '### Operating notes for this agent',
  'prompt.findings': '### Current problems',
  'prompt.evidence': '### Collected evidence',
};

const ko = {
  'host.name': '서버 관리',
  'host.svcDown': '서비스 꺼짐: {label}',
  'host.noRestart': ' · 자동 재시작 안 함({reason})',
  'host.disk': '디스크 {pct}% 사용',
  'host.diskDetail': '남은 공간 {gb}GB',
  'host.memory': '여유 메모리 {pct}%',
  'host.memoryDetail': 'memory_pressure 기준',
  'host.docker': 'Docker 응답 없음',
  'host.dockerDetail': '컨테이너로 돌리는 서비스도 함께 멈춥니다.',
  'host.tailscale': 'Tailscale 오프라인',
  'host.tailscaleDetail': '테일넷으로 하는 원격 접속이 끊깁니다.',
  'host.mountMissing': '외장 볼륨 연결 안 됨: {mount}',
  'host.mountMissingDetail': '그 볼륨에 있는 데이터와, 그곳을 가리키는 링크가 모두 동작하지 않습니다.',
  'host.linkBroken': '깨진 링크: {link}',
  'host.notSymlink': '없거나 링크가 아님',
  'metric.services': '서비스',
  'metric.disk': '디스크',
  'metric.freeMem': '여유 메모리',
  'metric.uptime': '가동 시간',
  'metric.uptimeValue': '{hours}시간 {minutes}분',
  'metric.load': '부하 (1/5/15분)',
  'llm.name': 'LLM 앱',
  'llm.remoteDown': '원격 모델 서버 프로세스가 꺼져 있음',
  'llm.remoteDownDetail': '원격 GPU 서버에서 모델 서버를 다시 띄워야 합니다(자동 복구 안 함).',
  'llm.modelDown': '모델 서버 연결 실패',
  'llm.apiDown': '앱 API 응답 없음',
  'llm.webDown': '앱 웹 화면 응답 없음',
  'llm.chatFail': '채팅 응답 실패',
  'llm.chatSlow': '채팅 응답 느림 {ms}ms',
  'llm.chatSlowDetail': '기준 {limit}ms',
  'llm.chatPrompt': '상태 점검입니다. "정상"이라고만 답하세요.',
  'llm.fallback': '1순위 모델 {primary} 장애 — {active}(으)로 대체 중',
  'llm.fallbackDetail': '중단: {down}',
  'llm.allDown': '모든 모델 백엔드 중단',
  'metric.backend': '백엔드',
  'metric.model': '모델',
  'metric.chat': '채팅',
  'portal.name': '포탈 관리',
  'portal.down': 'team-portal 응답 없음',
  'portal.legacyDown': 'fallback 사이트 응답 없음',
  'portal.publicDown': '{url} 접속 안 됨',
  'portal.badLink': '카드 링크 이상: {title}',
  'metric.cards': '카드',
  'metric.linksChecked': '링크 점검',
  'metric.deadLinks': '죽은 링크',
  'sites.name': '사이트 관리',
  'sites.down': '{name} 응답 없음',
  'sites.tls': '{name} 인증서 {days}일 남음',
  'metric.sites': '사이트',
  'metric.up': '정상',
  'alert.resolved': '🟢 [{agent}] 복구됨: {title}',
  'alert.report': '🧠 [{agent}] 원인 분석 보고서: {url}',
  'agent.error': '에이전트 실행 오류',
  'prompt.intro': '당신은 서버 운영 담당 "{agent}" 에이전트입니다. 아래 증거만 근거로 장애를 분석하세요.',
  'prompt.rules': '명령을 실행하거나 파일을 바꾸지 마세요. 증거에 없는 내용은 "추측"이라고 표시하세요.',
  'prompt.format': '출력 형식 (한국어 마크다운): ## 요약(2줄) / ## 원인 후보(근거와 함께, 가능성 순) / ## 사람이 할 일(명령어 포함, 위험한 것은 표시) / ## 다시 확인할 방법',
  'prompt.playbook': '### 이 에이전트의 운영 지침',
  'prompt.findings': '### 현재 문제',
  'prompt.evidence': '### 수집한 증거',
};

export const LOCALES = { en, ko };

export function createT(locale = 'en') {
  const table = LOCALES[locale] || en;
  return (key, vars = {}) => {
    const template = table[key] ?? en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
  };
}

/** Pick the playbook text for a locale from { en, ko } or a plain string. */
export function localized(value, locale) {
  if (!value || typeof value === 'string') return value || '';
  return value[locale] ?? value.en ?? '';
}
