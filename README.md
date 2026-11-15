# macmini-ops

**사무실 Mac mini(macOS 서버)를 지키는 상시 운영 에이전트.** 정해진 주기로 서버·앱·포탈·사이트를 점검합니다. 미리 허용한 범위에서는 스스로 복구하고, 같은 문제가 계속되면 LLM이 증거를 읽고 원인 분석 보고서를 씁니다.

- Node.js 20+ 하나로 동작합니다. 외부 패키지 0개.
- 점검은 규칙대로 합니다. LLM은 **읽기만** 하고 아무것도 실행하지 않습니다.
- 자동 조치는 설정의 허용 목록에 있는 대상만, 대상별로 정해진 간격(기본 10분)에 한 번만 합니다.
- 진단 LLM은 사내 모델(OpenAI 호환 vLLM·Ollama 등)을 먼저 쓰고, 안 되면 Codex CLI 등 다음 백엔드로 넘어갑니다.

## 에이전트 종류

| type | 점검 | 자동 조치 |
|---|---|---|
| `host` | launchd 서비스, 디스크, 메모리, Docker, Tailscale | 꺼진 서비스 `launchctl kickstart` |
| `llm-app` | OpenAI 호환 모델 서버(SSH 터널 포함), 앱 API·웹, 주기적 실제 채팅 | 터널 재시작, `docker compose up -d` |
| `team-portal` | [team-portal](https://github.com/baryonlabs/team-portal), fallback 사이트, 공개 주소, 카드 링크 | 포탈 재시작, Tailscale serve 재연결 |
| `sites` | 웹사이트 도달성, TLS 인증서 만료일 | 없음 (보고만) |

같은 type을 여러 번 쓸 수 있습니다(예: 모델 서버 두 개면 `llm-app` 두 개).

## 시작하기

```bash
git clone https://github.com/baryonlabs/macmini-ops.git && cd macmini-ops
cp config.example.json config.json      # 회사에 맞게 수정
node opsd.mjs once server               # 한 에이전트만 한 번 돌려 보기
./deploy/install-macos.sh               # launchd 상시 실행, 대시보드 http://127.0.0.1:8095
```

예시 설정은 `remediation.dryRun: true`라 처음에는 **조치 없이 보고만** 합니다. 결과를 확인한 뒤 `false`로 바꾸세요.

## 회사 전용 설정과 비밀 분리

이 저장소에는 **엔진만** 있습니다. 회사마다 다른 것은 모두 저장소 밖에 둡니다.

| 무엇 | 어디에 | 예시 |
|---|---|---|
| 서비스 이름, 주소, 경로, 사이트 목록 | `config.json` (git 무시, 사내 비공개 저장소에서 관리) | launchd 라벨, 모델 서버 주소 |
| 회사 고유의 운영 지식 | 각 에이전트의 `playbook` 설정 (LLM이 읽음) | "GPU 서버는 공유 자원이라 재시작 금지" |
| 비밀 | 환경변수 / 서버의 상태 폴더 | `OPS_WEBHOOK_URL`, `~/.macmini-ops/token` |

- 알림 웹훅 주소는 `OPS_WEBHOOK_URL` 환경변수로만 받습니다. 설치 스크립트가 권한 600인 launchd plist에만 기록합니다.
- 대시보드의 「지금 점검」 토큰은 처음 실행할 때 `~/.macmini-ops/token`(600)에 만들어집니다.
- `config.json`, `config.local.json`은 `.gitignore`에 들어 있습니다.

## 대시보드와 API

| 경로 | 설명 |
|---|---|
| `/` | 에이전트 상태, 발견 사항, 최근 기록, LLM 보고서 |
| `GET /api/agents` | 전체 상태 JSON |
| `GET /agents/<id>/health` | 심각한 문제가 있으면 503. team-portal 카드의 `health`에 넣으면 상태 점으로 보입니다 |
| `POST /api/agents/<id>/run` | 지금 점검 (Bearer 토큰 필요) |

## 알아둘 점

- App Store 판 Tailscale CLI는 launchd에서 실행한 Node가 직접 부르면 GUI를 띄우려다 실패합니다. 그래서 `/bin/sh`를 거쳐 부릅니다.
- 자식 프로세스의 stdin을 바로 닫습니다. 안 닫으면 `codex exec`가 입력을 기다리며 멈춥니다.

## 개발

```bash
npm test
```

MIT License · Baryon Labs
