---
summary: "Slack 앱 설정 한국어 요약 가이드 (Enterprise Grid)"
read_when: "Slack 앱을 빠르게 설정하고 싶을 때"
title: "Slack 설정 (한국어)"
---

# Slack 앱 설정 가이드 (한국어)

Enterprise Grid 워크스페이스용 Slack 앱 설정 요약입니다.

## 필요한 토큰

| 토큰 | 형식 | 용도 |
|------|------|------|
| Bot Token | `xoxb-...` | 메시지 전송, 채널 읽기 |
| App Token | `xapp-...` | Socket Mode 연결 |

## 설정 순서

### 1. Slack 앱 생성

1. [api.slack.com/apps](https://api.slack.com/apps)에서 **Create New App** 클릭
2. **From an app manifest** 선택
3. 워크스페이스 선택 후 **Next**

### 2. App Manifest 붙여넣기

아래 JSON을 그대로 붙여넣기:

```json
{
  "display_information": {
    "name": "OpenClaw",
    "description": "Slack connector for OpenClaw"
  },
  "features": {
    "bot_user": {
      "display_name": "OpenClaw",
      "always_online": false
    },
    "app_home": {
      "messages_tab_enabled": true,
      "messages_tab_read_only_enabled": false
    },
    "slash_commands": [
      {
        "command": "/openclaw",
        "description": "Send a message to OpenClaw",
        "should_escape": false
      }
    ]
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "chat:write",
        "channels:history",
        "channels:read",
        "groups:history",
        "groups:read",
        "groups:write",
        "im:history",
        "im:read",
        "im:write",
        "mpim:history",
        "mpim:read",
        "mpim:write",
        "users:read",
        "app_mentions:read",
        "reactions:read",
        "reactions:write",
        "pins:read",
        "pins:write",
        "emoji:read",
        "commands",
        "files:read",
        "files:write"
      ]
    }
  },
  "settings": {
    "socket_mode_enabled": true,
    "event_subscriptions": {
      "bot_events": [
        "app_mention",
        "message.channels",
        "message.groups",
        "message.im",
        "message.mpim",
        "reaction_added",
        "reaction_removed",
        "member_joined_channel",
        "member_left_channel",
        "channel_rename",
        "pin_added",
        "pin_removed"
      ]
    }
  }
}
```

4. **Next** → **Create** 클릭

### 3. App Token 생성 (Socket Mode)

1. 좌측 메뉴 **Basic Information** 클릭
2. **App-Level Tokens** 섹션에서 **Generate Token and Scopes** 클릭
3. Token Name: `socket` (아무 이름)
4. **Add Scope** → `connections:write` 선택
5. **Generate** 클릭
6. `xapp-...` 토큰 복사 → **App Token**

### 4. 워크스페이스에 설치 요청

1. 좌측 메뉴 **OAuth & Permissions** 클릭
2. **Request to Workspace Install** 버튼 클릭
3. Enterprise Grid의 경우 관리자 승인 대기

### 5. Bot Token 복사

관리자 승인 후:

1. **OAuth & Permissions** 페이지로 이동
2. **Bot User OAuth Token** (`xoxb-...`) 복사 → **Bot Token**

## 토큰 설정

### 환경변수 (권장)

```bash
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_APP_TOKEN="xapp-..."
```

### 설정 파일

`~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "botToken": "xoxb-...",
      "appToken": "xapp-..."
    }
  }
}
```

## 채널 허용 목록 설정

보안을 위해 특정 채널만 허용:

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "groupPolicy": "allowlist",
      "requireMention": true,
      "channels": {
        "C0123456789": { "allow": true, "requireMention": true }
      }
    }
  }
}
```

채널 ID 확인 방법: Slack에서 채널 이름 우클릭 → **채널 세부정보 보기** → 하단에 채널 ID 표시

## 문제 해결

### "Request to Install" 버튼이 안 보여요

- App Manifest가 제대로 적용되었는지 확인
- **OAuth & Permissions** → **Scopes** 섹션에 Bot Token Scopes가 있는지 확인

### 관리자 승인 후에도 Bot Token이 안 보여요

- 페이지 새로고침
- **OAuth & Permissions** 페이지 다시 방문

### Socket Mode 연결 실패

- App Token (`xapp-...`)이 맞는지 확인
- **Basic Information** → **App-Level Tokens**에서 토큰 재생성

## 다음 단계

1. 봇을 사용할 채널에 초대: `/invite @OpenClaw`
2. 게이트웨이 시작: `openclaw gateway run`
3. 상태 확인: `openclaw channels status --probe`

## 참고

- [전체 영문 가이드](https://docs.openclaw.ai/channels/slack)
- [보안 설정 가이드](https://docs.openclaw.ai/gateway/security)
