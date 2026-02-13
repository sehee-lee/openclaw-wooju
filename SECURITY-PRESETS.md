# 보안 프리셋 가이드

OpenClaw Wooju 배포판의 보안 수준을 선택할 수 있는 3단계 프리셋입니다.

---

## 프리셋 비교

| 설정 항목 | 최고보안 | 중간보안 | 실용성 |
|-----------|:-------:|:-------:|:------:|
| **샌드박스** | ✅ readonly | ✅ readwrite | ❌ 없음 |
| **샌드박스 도구 허용** | 최소한 | 플러그인 + 웹 포함 | N/A |
| **WebSearch/WebFetch** | ❌ 비활성화 | ✅ 허용 | ✅ 허용 |

### 공통 설정 (모든 프리셋)

| 설정 항목 | 값 | 설명 |
|-----------|-----|------|
| channels.slack.groupPolicy | `"allowlist"` | 허용된 채널만 접근 |
| gateway.bind | `"loopback"` | 로컬 접근만 허용 |
| logging.redactSensitive | `"tools"` | 로그 내 민감정보 마스킹 |

---

## 프리셋별 상세 설명

### 1. 최고보안

**적합한 사용자:** 기밀 코드 작업, 보안이 최우선인 환경

- 샌드박스로 호스트 파일시스템 격리 (읽기 전용)
- 외부 웹 접근 완전 차단
- 샌드박스 내 최소한의 도구만 허용

**설정 (`~/.openclaw/openclaw.json`):**

```json
{
  "tools": {
    "web": {
      "search": {
        "enabled": false
      },
      "fetch": {
        "enabled": false
      }
    },
    "sandbox": {
      "tools": {
        "allow": ["slack"]
      }
    }
  },
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "workspaceAccess": "ro",
        "scope": "session",
        "docker": {
          "network": "bridge"
        }
      }
    }
  },
  "channels": {
    "slack": {
      "groupPolicy": "allowlist"
    }
  },
  "gateway": {
    "bind": "loopback"
  },
  "logging": {
    "redactSensitive": "tools"
  }
}
```

---

### 2. 중간보안

**적합한 사용자:** 일반 개발 작업, 웹 검색이 필요한 경우

- 샌드박스로 호스트 파일시스템 격리 (읽기/쓰기)
- 외부 웹 검색 허용 (정보 수집용)
- 플러그인 도구 사용 가능

**설정 (`~/.openclaw/openclaw.json`):**

```json
{
  "tools": {
    "web": {
      "search": {
        "enabled": true
      },
      "fetch": {
        "enabled": true
      }
    },
    "sandbox": {
      "tools": {
        "allow": ["group:plugins", "slack", "jenkins", "exec", "process"]
      }
    }
  },
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "workspaceAccess": "rw",
        "scope": "session",
        "docker": {
          "network": "bridge"
        }
      }
    }
  },
  "channels": {
    "slack": {
      "groupPolicy": "allowlist"
    }
  },
  "gateway": {
    "bind": "loopback"
  },
  "logging": {
    "redactSensitive": "tools"
  }
}
```

---

### 3. 실용성

**적합한 사용자:** 빠른 작업이 필요한 경우, 개인 개발 환경

- 샌드박스 없이 직접 호스트에서 실행
- 모든 웹 도구 사용 가능
- 가장 빠른 실행 속도

> ⚠️ **주의:** 이 프리셋은 편의성을 위해 일부 보안 기능을 비활성화합니다. 기밀 코드 작업 시에는 최고보안 또는 중간보안을 권장합니다.

**설정 (`~/.openclaw/openclaw.json`):**

```json
{
  "tools": {
    "web": {
      "search": {
        "enabled": true
      },
      "fetch": {
        "enabled": true
      }
    }
  },
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "off"
      }
    }
  },
  "channels": {
    "slack": {
      "groupPolicy": "allowlist"
    }
  },
  "gateway": {
    "bind": "loopback"
  },
  "logging": {
    "redactSensitive": "tools"
  }
}
```

---

## 보안 수준별 위협 방어

| 위협 | 최고보안 | 중간보안 | 실용성 |
|------|:-------:|:-------:|:------:|
| 외부 데이터 유출 (웹) | ✅ 차단 | ⚠️ 가능 | ⚠️ 가능 |
| 호스트 파일시스템 변조 | ✅ 차단 | ⚠️ 샌드박스 내 | ❌ 가능 |
| Prompt Injection 피해 | ✅ 최소화 | ⚠️ 제한적 | ❌ 위험 |
| 악성 코드 실행 | ✅ 격리됨 | ✅ 격리됨 | ❌ 호스트 영향 |

---

## 프리셋 적용 방법

### 수동 적용

1. `~/.openclaw/openclaw.json` 파일 열기
2. 원하는 프리셋의 설정값 복사
3. 기존 설정에 병합 (기존 `models`, `agents.list` 등은 유지)
4. 게이트웨이 재시작

### CLI로 적용 (예정)

```bash
# 프리셋 목록 확인
openclaw security preset --list

# 프리셋 적용
openclaw security preset --apply maximum
openclaw security preset --apply moderate
openclaw security preset --apply practical

# 현재 설정 검증
openclaw security audit --deep
```

---

## 권장 사항

1. **처음 사용자:** 중간보안으로 시작
2. **기밀 프로젝트:** 최고보안 필수
3. **빠른 프로토타이핑:** 실용성 (단, 기밀 코드 주의)

설정 후 `openclaw security audit --deep`으로 보안 상태를 확인하세요.

---

## 관련 문서

- [보안 가이드](./SECURITY-GUIDE.md)
- [샌드박스 설정 가이드](./SANDBOX-SETUP.md)
