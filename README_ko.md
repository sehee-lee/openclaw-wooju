# 🦞 OpenClaw Wooju Edition

개인 AI 어시스턴트 - WhatsApp, Telegram, Slack, Discord, Signal, iMessage 등 다양한 채널에서 사용할 수 있습니다.

> **원본 프로젝트**: [openclaw/openclaw](https://github.com/openclaw/openclaw)
>
> 이 프로젝트는 OpenClaw를 한국 사용자 환경에 맞게 튜닝한 버전입니다.

---

## 특징

### 🇰🇷 한국어 최적화
- 한국어 UI 및 온보딩 마법사
- 한국 사용자 친화적 보안 설정

### 🔒 3단계 보안 프리셋
| 프리셋 | 샌드박스 | 웹 접근 | 용도 |
|--------|---------|---------|------|
| **최고보안** | 읽기전용 | 차단 | 보안 최우선 |
| **중간보안** | 읽기/쓰기 | 허용 | 기본값 |
| **실용성** | 없음 | 허용 | 편의 우선 |


### 🤖 지원 모델
- **z.ai**: GLM-4.7, GLM-4.7-Flash, GLM-5
- **OpenCode Zen**: Claude Opus 4.5, GPT-5.x, Gemini 3
- **직접 연동**: Anthropic, OpenAI, AWS Bedrock

---

## 설치

### 요구사항
- Node.js 22+
- pnpm (권장) 또는 npm/bun
- Docker/Colima (샌드박스용, 선택)

### 빠른 시작

```bash
# 저장소 클론
git clone https://github.com/your-username/openclaw-wooju.git
cd openclaw-wooju

# 의존성 설치
pnpm install

# 빌드
pnpm build

# Wooju 온보딩 마법사 실행
pnpm openclaw wooju
```

---

## 사용법

### 기본 명령어

```bash
# 게이트웨이 시작
pnpm openclaw gateway run

# TUI (터미널 UI)
pnpm openclaw tui

# Web UI
pnpm openclaw dashboard

# 모델 목록 확인
pnpm openclaw models list --all

# 기본 모델 변경
pnpm openclaw models set zai/glm-5
```

### Wooju 온보딩

```bash
pnpm openclaw wooju
```

대화형으로 다음을 설정합니다:
1. 보안 경고 확인
2. Docker 환경 확인
3. 보안 프리셋 선택
4. API 키 설정
5. 채널 연동 (Telegram, Slack 등)
6. 템플릿 선택 (직군 + 스택 + 서비스)
7. 샌드박스 이미지 빌드
8. 게이트웨이 시작

---

## 설정 파일

### 주요 설정 파일 위치
```
~/.openclaw/
├── openclaw.json       # 메인 설정
├── .env                # 환경 변수
├── credentials/        # API 키
└── workspace/          # 에이전트 워크스페이스
    ├── SOUL.md         # 에이전트 핵심 원칙
    ├── IDENTITY.md     # 에이전트 정체성
    └── USER.md         # 사용자 선호
```

### 모델 설정 예시

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "zai/glm-5"
      }
    }
  }
}
```

---

## 개발

```bash
# 타입 체크 + 빌드
pnpm build

# 린트 + 포맷 체크
pnpm check

# 테스트
pnpm test

# 개발 모드로 게이트웨이 실행
pnpm gateway:dev
```

---

## 프로젝트 구조

```
src/
├── commands/           # CLI 명령어
│   ├── wooju.ts        # Wooju 메인 명령어
│   ├── wooju-config.ts # 보안 프리셋 설정
│   └── ...
├── agents/             # 에이전트 코어
├── channels/           # 채널 어댑터
├── gateway/            # 게이트웨이 서버
├── config/             # 설정 스키마
└── ...

docs/reference/templates/wooju/
├── base/               # 공통 템플릿
├── roles/              # 직군별 템플릿
├── stacks/             # 기술 스택별 템플릿
├── services/           # 서비스 도메인별 템플릿
└── examples/           # 조합 예시
```

---

## 라이선스

MIT License

---

## 참고

- [OpenClaw 공식 문서](https://docs.openclaw.ai)
- [원본 저장소](https://github.com/openclaw/openclaw)
- [Discord](https://discord.gg/clawd)
