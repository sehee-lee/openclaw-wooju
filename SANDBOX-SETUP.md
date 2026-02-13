# 샌드박스 설정 가이드

도구 실행을 Docker 컨테이너로 격리하여 보안을 강화합니다.

---

## 목차

- [Colima 설치](#colima-설치-docker-desktop-대안)
- [샌드박스 이미지 빌드](#샌드박스-이미지-빌드)
- [샌드박스 설정](#샌드박스-설정)
  - [workspaceAccess 옵션](#workspaceaccess-옵션)
- [Plugin/Extensions 사용](#pluginextensions-사용)
  - [Plugin 설정 구조](#plugin-설정-구조)
  - [자동 활성화](#자동-활성화)
- [네트워크 연결 설정](#네트워크-연결-설정-선택사항)
- [상태 확인](#샌드박스-상태-확인)

---

## Colima 설치 (Docker Desktop 대안)

Docker Desktop 대신 오픈소스 도구인 Colima를 사용합니다.

```bash
# Colima 및 Docker CLI 설치
brew install colima docker docker-compose

# Colima 시작
colima start --cpu 4 --memory 8

# 자동 시작 설정 (선택사항)
brew services start colima

# 동작 확인
docker ps
```

---

## 샌드박스 이미지 빌드

```bash
./scripts/sandbox-setup.sh
```

---

## 샌드박스 설정

`~/.openclaw/openclaw.json`에 추가:

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "scope": "session",
        "workspaceAccess": "none"
      }
    }
  }
}
```

### workspaceAccess 옵션

에이전트 워크스페이스(작업 디렉토리)를 샌드박스 컨테이너에 어떻게 마운트할지 설정합니다:

| 옵션 | 설명 | 사용 시나리오 |
|------|------|---------------|
| `none` | 워크스페이스 마운트 안 함 | 최고 보안, 샌드박스 전용 작업공간 사용 |
| `ro` | 읽기 전용 마운트 | 코드 분석, 리뷰 작업 (write/edit 도구 비활성화) |
| `rw` | 읽기/쓰기 마운트 | 코드 수정이 필요한 개발 작업 |

**예시: 읽기 전용으로 코드 분석**

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "workspaceAccess": "ro"
      }
    }
  }
}
```

---

## Plugin/Extensions 사용

### Plugin 설정 구조

`~/.openclaw/openclaw.json`에서 plugin을 설정합니다:

```json
{
  "plugins": {
    "enabled": true,
    "allow": ["slack", "jenkins"],
    "deny": [],
    "entries": {
      "slack": {
        "enabled": true
      },
      "jenkins": {
        "enabled": true,
        "config": {
          "baseUrl": "https://jenkins.example.com"
        }
      }
    }
  }
}
```

| 설정 | 설명 |
|------|------|
| `enabled` | 플러그인 로딩 활성화 |
| `allow` | 허용할 플러그인 목록 (allowlist) |
| `deny` | 차단할 플러그인 목록 (denylist) |
| `entries` | 개별 플러그인 설정 |

### 자동 활성화

채널이 설정되면 해당 플러그인이 **자동으로 활성화**됩니다:

- `channels.slack` 설정 → `slack` 플러그인 자동 활성화
- `SLACK_BOT_TOKEN` 환경변수 → `slack` 플러그인 자동 활성화

### 샌드박스에서 Extensions 디렉토리 마운트

샌드박스 환경에서 plugin을 사용하려면 `docker.binds` 옵션으로 extensions 디렉토리를 마운트합니다:

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "workspaceAccess": "rw",
        "docker": {
          "binds": [
            "/path/to/openclaw/extensions:/workspace/extensions:ro"
          ]
        }
      }
    }
  }
}
```

### 홈 디렉토리 설정 마운트

사용자 설정 파일(`.openclaw/`)이 필요한 경우:

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "workspaceAccess": "rw",
        "docker": {
          "binds": [
            "~/.openclaw:/home/sandbox/.openclaw:ro"
          ]
        }
      }
    }
  }
}
```

> **보안 참고:** `binds`로 마운트하는 디렉토리는 최소한으로 유지하고, 가능하면 `:ro` (읽기 전용)로 마운트하세요.

---

## 네트워크 연결 설정 (선택사항)

샌드박스 컨테이너에서 외부 API 호출이 필요한 경우 (예: NAMC API, 패키지 설치 등), Docker 네트워크 모드를 `bridge`로 설정합니다:

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "scope": "session",
        "workspaceAccess": "none",
        "docker": {
          "network": "bridge"
        }
      }
    }
  }
}
```

### 네트워크 모드 옵션

| 모드 | 설명 | 사용 시나리오 |
|------|------|---------------|
| `none` | 완전한 네트워크 격리 | 최고 보안, 외부 통신 불필요 시 |
| `bridge` | Docker NAT를 통한 외부 네트워크 접근 | API 호출, 패키지 설치 필요 시 |

> **보안 참고:** `bridge` 모드는 Docker의 기본 네트워크 모드로, 컨테이너가 NAT를 통해 외부 네트워크에 접근할 수 있습니다. 이는 `host` 모드와 달리 호스트의 전체 네트워크 스택에 직접 접근하지 않으므로, 적절한 수준의 격리를 유지합니다. 외부 통신 자체가 우려되는 경우 `none`을 사용하거나, 호스트 방화벽 규칙으로 추가 제어할 수 있습니다.

---

## 샌드박스 상태 확인

```bash
openclaw sandbox explain
```
