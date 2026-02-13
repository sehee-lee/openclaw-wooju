#!/usr/bin/env bash
# One-click secure setup for OpenClaw (Wooju).
# Creates a maximum-security configuration with LLM providers and Slack integration.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
OPENCLAW_DIR="${HOME}/.openclaw"
CONFIG_FILE="${OPENCLAW_DIR}/openclaw.json"
ENV_FILE="${OPENCLAW_DIR}/.env"
WORKSPACE_DIR="${OPENCLAW_DIR}/workspace"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log()      { printf '%s\n' "$*"; }
info()     { printf "${BLUE}INFO:${NC} %s\n" "$*"; }
success()  { printf "${GREEN}OK:${NC} %s\n" "$*"; }
warn()     { printf "${YELLOW}WARN:${NC} %s\n" "$*"; }
fail()     { printf "${RED}ERROR:${NC} %s\n" "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Security warning (Korean)
# ---------------------------------------------------------------------------
print_security_warning() {
  cat << 'EOF'
============================================================
🔒 보안 경고 - 반드시 읽어주세요
============================================================

OpenClaw는 오픈소스이며 아직 베타입니다.
도구가 활성화되면 파일을 읽고 작업을 수행할 수 있습니다.
잘못된 프롬프트가 안전하지 않은 작업을 유발할 수 있습니다.

이 스크립트는 위 위험을 최소화하기 위해 다음 보안 설정과
에이전트 가드레일을 자동으로 적용합니다:

✅ 시스템 보안 설정:
- 채널 허용 목록 (지정한 Slack 채널만 접근 가능)
- @멘션 필수 (봇을 직접 호출해야만 응답)
- 샌드박스 격리 (Docker 컨테이너 내에서 실행)
- 웹 검색/접근 허용 (외부 연동 필요 시)
- 게이트웨이 로컬 전용 (외부 네트워크에서 접근 불가)

📋 에이전트 행동 가이드라인 (워크스페이스 템플릿):
- Prompt Injection 방어 지침
- 민감정보 필터링 및 데이터 분류 정책
- 위험 명령 실행 전 사용자 확인 필수

정기적으로 보안 상태를 확인하세요:
  openclaw security audit --deep

문서: https://docs.openclaw.ai/gateway/security
============================================================
EOF
}

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------
check_dependencies() {
  info "의존성 확인 중..."

  # Node.js 22+
  if ! command -v node &>/dev/null; then
    fail "Node.js가 설치되어 있지 않습니다. https://nodejs.org/ 에서 v22 이상을 설치하세요."
  fi
  local node_version
  node_version="$(node -v | sed 's/v//' | cut -d. -f1)"
  if [[ "${node_version}" -lt 22 ]]; then
    fail "Node.js v22 이상이 필요합니다 (현재: v${node_version}). 업그레이드하세요."
  fi
  success "Node.js v${node_version}"

  # pnpm or npm
  if command -v pnpm &>/dev/null; then
    success "pnpm $(pnpm -v)"
  elif command -v npm &>/dev/null; then
    success "npm $(npm -v)"
  else
    fail "pnpm 또는 npm이 필요합니다."
  fi

  # macOS: brew (for colima)
  if [[ "$(uname -s)" == "Darwin" ]]; then
    if ! command -v brew &>/dev/null; then
      warn "Homebrew가 없습니다. Colima 설치에 필요할 수 있습니다."
    else
      success "Homebrew"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Docker/Colima setup
# ---------------------------------------------------------------------------
setup_docker() {
  info "Docker/Colima 확인 중..."

  if [[ "$(uname -s)" == "Darwin" ]]; then
    # macOS: prefer Colima
    if command -v colima &>/dev/null; then
      if ! colima status &>/dev/null; then
        info "Colima 시작 중..."
        colima start --cpu 2 --memory 4 --disk 20 || fail "Colima 시작 실패. 'colima status'로 확인하세요."
      fi
      success "Colima 실행 중"
    elif command -v docker &>/dev/null; then
      if ! docker info &>/dev/null; then
        warn "Docker가 설치되어 있지만 실행 중이 아닙니다. Docker Desktop을 시작하세요."
      else
        success "Docker 실행 중"
      fi
    else
      info "Colima 설치 중..."
      if command -v brew &>/dev/null; then
        brew install colima docker || fail "Colima 설치 실패"
        colima start --cpu 2 --memory 4 --disk 20 || fail "Colima 시작 실패"
        success "Colima 설치 및 시작 완료"
      else
        fail "Colima를 설치하려면 Homebrew가 필요합니다: https://brew.sh"
      fi
    fi
  else
    # Linux: check Docker
    if ! command -v docker &>/dev/null; then
      fail "Docker가 설치되어 있지 않습니다. https://docs.docker.com/engine/install/ 참조"
    fi
    if ! docker info &>/dev/null; then
      fail "Docker 데몬이 실행 중이 아닙니다. 'sudo systemctl start docker' 실행"
    fi
    success "Docker 실행 중"
  fi
}

# ---------------------------------------------------------------------------
# Load existing config values
# ---------------------------------------------------------------------------
EXISTING_ZAI_KEY=""
EXISTING_BOT_TOKEN=""
EXISTING_APP_TOKEN=""
EXISTING_CHANNEL_IDS=""

load_existing_config() {
  # Load from .env file first (actual API key values)
  if [[ -f "${ENV_FILE}" ]]; then
    info "기존 환경변수 파일 감지됨: ${ENV_FILE}"
    # Source .env to get actual values
    while IFS='=' read -r key value; do
      # Skip comments and empty lines
      [[ -z "${key}" || "${key}" =~ ^# ]] && continue
      case "${key}" in
        ZAI_API_KEY) EXISTING_ZAI_KEY="${value}" ;;
        SLACK_BOT_TOKEN) EXISTING_BOT_TOKEN="${value}" ;;
        SLACK_APP_TOKEN) EXISTING_APP_TOKEN="${value}" ;;
      esac
    done < "${ENV_FILE}"
  fi

  # Load channel IDs from config file
  if [[ -f "${CONFIG_FILE}" ]]; then
    info "기존 설정 파일 감지됨: ${CONFIG_FILE}"

    EXISTING_CHANNEL_IDS="$(node -e "
      const fs = require('fs');
      try {
        const cfg = JSON.parse(fs.readFileSync('${CONFIG_FILE}', 'utf8'));
        const channels = cfg.channels?.slack?.channels || {};
        const ids = Object.keys(channels).filter(k => channels[k]?.allow !== false);
        if (ids.length) process.stdout.write(ids.join(','));
      } catch {}
    " 2>/dev/null || true)"
  fi
}

# Helper to mask sensitive values for display
mask_value() {
  local val="$1"
  local len="${#val}"
  if [[ $len -le 8 ]]; then
    echo "${val:0:2}***"
  else
    echo "${val:0:4}...${val: -4}"
  fi
}

# ---------------------------------------------------------------------------
# Prompt for LLM API key
# ---------------------------------------------------------------------------
prompt_llm_key() {
  info "LLM API 키 설정"
  log ""
  log "Z.AI (GLM 4.7) API 키가 필요합니다."
  log ""
  log "API 키 발급: https://open.bigmodel.cn/usercenter/apikeys"
  log ""

  # Check env vars first, then existing config
  if [[ -n "${ZAI_API_KEY:-}" ]]; then
    success "환경변수에서 ZAI_API_KEY 감지됨"
  elif [[ -n "${EXISTING_ZAI_KEY}" ]]; then
    local masked
    masked="$(mask_value "${EXISTING_ZAI_KEY}")"
    read -rp "기존 Z.AI API Key [${masked}] 재사용? (Y/n): " reuse
    if [[ "${reuse}" != "n" && "${reuse}" != "N" ]]; then
      ZAI_API_KEY="${EXISTING_ZAI_KEY}"
      success "기존 Z.AI API Key 재사용"
    else
      read -rp "Z.AI API Key: " ZAI_API_KEY
    fi
  else
    read -rp "Z.AI API Key: " ZAI_API_KEY
  fi

  if [[ -z "${ZAI_API_KEY:-}" ]]; then
    fail "API 키가 필요합니다."
  fi

  HAS_ZAI=true
}

# ---------------------------------------------------------------------------
# Prompt for Slack tokens (optional)
# ---------------------------------------------------------------------------
HAS_SLACK=false

prompt_slack_tokens() {
  info "Slack 토큰 설정 (선택사항)"
  log ""
  log "Slack 연동을 원하면 토큰을 입력하세요. 없으면 Enter로 건너뛰세요."
  log "  - Bot Token: xoxb-..."
  log "  - App Token: xapp-..."
  log ""
  log "             https://docs.openclaw.ai/channels/slack (영문)"
  log ""

  if [[ -n "${SLACK_BOT_TOKEN:-}" ]]; then
    success "환경변수에서 SLACK_BOT_TOKEN 감지됨"
  elif [[ -n "${EXISTING_BOT_TOKEN}" ]]; then
    local masked
    masked="$(mask_value "${EXISTING_BOT_TOKEN}")"
    read -rp "기존 Bot Token [${masked}] 재사용? (Y/n): " reuse
    if [[ "${reuse}" != "n" && "${reuse}" != "N" ]]; then
      SLACK_BOT_TOKEN="${EXISTING_BOT_TOKEN}"
      success "기존 Bot Token 재사용"
    else
      read -rp "Slack Bot Token (xoxb-..., 없으면 Enter): " SLACK_BOT_TOKEN
    fi
  else
    read -rp "Slack Bot Token (xoxb-..., 없으면 Enter): " SLACK_BOT_TOKEN
  fi

  # Skip App Token prompt if Bot Token is empty
  if [[ -z "${SLACK_BOT_TOKEN:-}" ]]; then
    info "Slack 연동 건너뜀 (WebUI/TUI만 사용)"
    return 0
  fi

  if [[ -n "${SLACK_APP_TOKEN:-}" ]]; then
    success "환경변수에서 SLACK_APP_TOKEN 감지됨"
  elif [[ -n "${EXISTING_APP_TOKEN}" ]]; then
    local masked
    masked="$(mask_value "${EXISTING_APP_TOKEN}")"
    read -rp "기존 App Token [${masked}] 재사용? (Y/n): " reuse
    if [[ "${reuse}" != "n" && "${reuse}" != "N" ]]; then
      SLACK_APP_TOKEN="${EXISTING_APP_TOKEN}"
      success "기존 App Token 재사용"
    else
      read -rp "Slack App Token (xapp-...): " SLACK_APP_TOKEN
    fi
  else
    read -rp "Slack App Token (xapp-...): " SLACK_APP_TOKEN
  fi

  if [[ -z "${SLACK_APP_TOKEN:-}" ]]; then
    warn "App Token이 없어 Slack 연동 건너뜀"
    SLACK_BOT_TOKEN=""
    return 0
  fi

  HAS_SLACK=true
}

# ---------------------------------------------------------------------------
# Prompt for Slack channel IDs
# ---------------------------------------------------------------------------
prompt_slack_channels() {
  # Skip if no Slack tokens
  if [[ "${HAS_SLACK}" != "true" ]]; then
    return 0
  fi

  info "Slack 채널 허용 목록 설정"
  log ""
  log "봇을 허용할 Slack 채널 ID를 입력하세요 (쉼표로 구분)."
  log "예: C0123456789,C9876543210"
  log ""

  if [[ -n "${SLACK_CHANNEL_IDS:-}" ]]; then
    success "환경변수에서 SLACK_CHANNEL_IDS 감지됨: ${SLACK_CHANNEL_IDS}"
  elif [[ -n "${EXISTING_CHANNEL_IDS}" ]]; then
    read -rp "기존 채널 목록 [${EXISTING_CHANNEL_IDS}] 재사용? (Y/n): " reuse
    if [[ "${reuse}" != "n" && "${reuse}" != "N" ]]; then
      SLACK_CHANNEL_IDS="${EXISTING_CHANNEL_IDS}"
      success "기존 채널 목록 재사용"
    else
      read -rp "Slack Channel IDs: " SLACK_CHANNEL_IDS
    fi
  else
    read -rp "Slack Channel IDs: " SLACK_CHANNEL_IDS
  fi

  if [[ -z "${SLACK_CHANNEL_IDS:-}" ]]; then
    warn "채널 ID가 없어 Slack 연동 비활성화"
    HAS_SLACK=false
  fi
}

# ---------------------------------------------------------------------------
# Prompt for team/role template
# ---------------------------------------------------------------------------
TEMPLATE_ROLE=""
TEMPLATE_STACK=""
TEMPLATE_SERVICE=""

prompt_team_template() {
  info "에이전트 워크스페이스 템플릿 설정"
  log ""
  log "팀과 역할에 맞는 에이전트 템플릿을 설정합니다."
  log ""

  # Role selection
  log "역할을 선택하세요:"
  log "  1) developer  - 개발자"
  log "  2) planning   - 기획자"
  log "  3) design     - 디자이너"
  log "  4) data       - 데이터 분석가"
  log ""
  read -rp "역할 선택 (1-4, 기본: 1): " role_choice
  case "${role_choice}" in
    2) TEMPLATE_ROLE="planning" ;;
    3) TEMPLATE_ROLE="design" ;;
    4) TEMPLATE_ROLE="data" ;;
    *) TEMPLATE_ROLE="developer" ;;
  esac
  success "역할: ${TEMPLATE_ROLE}"

  # Stack selection (only for developer)
  if [[ "${TEMPLATE_ROLE}" == "developer" ]]; then
    log ""
    log "기술 스택을 선택하세요 (선택사항):"
    log "  0) none         - 선택 안 함"
    log "  1) ios          - Swift, UIKit, SwiftUI"
    log "  2) android      - Kotlin, Jetpack"
    log "  3) frontend     - TypeScript, React"
    log "  4) backend-java - Spring, Java"
    log "  5) devops       - CI/CD, Infrastructure"
    log ""
    read -rp "스택 선택 (0-5, 기본: 0): " stack_choice
    case "${stack_choice}" in
      1) TEMPLATE_STACK="ios" ;;
      2) TEMPLATE_STACK="android" ;;
      3) TEMPLATE_STACK="frontend" ;;
      4) TEMPLATE_STACK="backend-java" ;;
      5) TEMPLATE_STACK="devops" ;;
      *) TEMPLATE_STACK="" ;;
    esac
    [[ -n "${TEMPLATE_STACK}" ]] && success "스택: ${TEMPLATE_STACK}"
  fi

  # Service selection
  log ""
  log "서비스를 선택하세요 (선택사항):"
  log "  0) none     - 선택 안 함"
  log "  1) maps     - 네이버 지도"
  log "  2) shopping - 네이버 쇼핑"
  log "  3) search   - 네이버 검색"
  log ""
  read -rp "서비스 선택 (0-3, 기본: 0): " service_choice
  case "${service_choice}" in
    1) TEMPLATE_SERVICE="maps" ;;
    2) TEMPLATE_SERVICE="shopping" ;;
    3) TEMPLATE_SERVICE="search" ;;
    *) TEMPLATE_SERVICE="" ;;
  esac
  [[ -n "${TEMPLATE_SERVICE}" ]] && success "서비스: ${TEMPLATE_SERVICE}"
}

# ---------------------------------------------------------------------------
# Setup workspace with templates
# ---------------------------------------------------------------------------
setup_workspace() {
  info "워크스페이스 템플릿 설정 중..."

  mkdir -p "${WORKSPACE_DIR}"

  # Build onboard command with template options
  local onboard_args=("--template" "wooju" "--template-role" "${TEMPLATE_ROLE}" "--force-workspace")
  [[ -n "${TEMPLATE_STACK}" ]] && onboard_args+=("--template-stack" "${TEMPLATE_STACK}")
  [[ -n "${TEMPLATE_SERVICE}" ]] && onboard_args+=("--template-service" "${TEMPLATE_SERVICE}")

  cd "${ROOT_DIR}"
  # Run directly with node to avoid pnpm's noisy ELIFECYCLE output.
  # The command may exit with code 1 due to Doctor warnings, which is expected.
  local onboard_output
  onboard_output="$(node "${ROOT_DIR}/scripts/run-node.mjs" onboard "${onboard_args[@]}" --auth-choice skip --accept-risk --non-interactive 2>&1)" || true

  # Extract only the essential status lines
  local workspace_status session_status
  workspace_status="$(echo "${onboard_output}" | grep "Workspace OK" || true)"
  session_status="$(echo "${onboard_output}" | grep "Sessions OK" || true)"

  if [[ -n "${workspace_status}" ]]; then
    success "${workspace_status}"
  fi
  if [[ -n "${session_status}" ]]; then
    success "${session_status}"
  fi

  if [[ -d "${WORKSPACE_DIR}" ]]; then
    success "워크스페이스 템플릿 적용됨"
  else
    warn "워크스페이스 템플릿 적용 실패 (수동으로 실행: openclaw onboard ${onboard_args[*]})"
  fi
}

# ---------------------------------------------------------------------------
# Create config file
# ---------------------------------------------------------------------------
create_config() {
  info "설정 파일 생성 중..."

  mkdir -p "${OPENCLAW_DIR}"
  mkdir -p "${WORKSPACE_DIR}"

  # Build providers JSON (Z.AI / GLM)
  local providers_json='"zai": {
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
      "apiKey": "${ZAI_API_KEY}",
      "api": "openai-completions",
      "models": [
        {
          "id": "glm-4.7",
          "name": "GLM 4.7",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 4096,
          "cost": { "input": 0.5, "output": 0.5, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }'

  # Primary model
  local primary_model="zai/glm-4.7"

  # Build channel config (only if Slack is enabled)
  local channels_json=""
  if [[ "${HAS_SLACK}" == "true" ]]; then
    local channels_config=""
    IFS=',' read -ra CHANNEL_ARRAY <<< "${SLACK_CHANNEL_IDS}"
    for ch in "${CHANNEL_ARRAY[@]}"; do
      ch="$(echo "${ch}" | xargs)" # trim whitespace
      [[ -z "${ch}" ]] && continue
      [[ -n "${channels_config}" ]] && channels_config+=","
      channels_config+="\"${ch}\": { \"allow\": true, \"requireMention\": true }"
    done
    channels_json='"channels": {
    "slack": {
      "enabled": true,
      "botToken": "\${SLACK_BOT_TOKEN}",
      "appToken": "\${SLACK_APP_TOKEN}",
      "groupPolicy": "allowlist",
      "requireMention": true,
      "channels": {
        '"${channels_config}"'
      }
    }
  },'
  else
    channels_json='"channels": {},'
  fi

  # Write config (web enabled for external communication)
  cat > "${CONFIG_FILE}" << EOF
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
        "allow": ["*"]
      }
    }
  },
  "models": {
    "mode": "replace",
    "providers": {
      ${providers_json}
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "${primary_model}"
      },
      "models": {
        "${primary_model}": {
          "alias": "GLM"
        }
      },
      "workspace": "${WORKSPACE_DIR}",
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
  ${channels_json}
  "gateway": {
    "mode": "local",
    "bind": "loopback",
    "port": 18789
  },
  "logging": {
    "redactSensitive": "tools"
  }
}
EOF

  success "설정 파일 생성됨: ${CONFIG_FILE}"
}

# ---------------------------------------------------------------------------
# Create .env file
# ---------------------------------------------------------------------------
create_env() {
  info "환경변수 파일 생성 중..."

  local env_content=""
  [[ -n "${ZAI_API_KEY:-}" ]] && env_content+="ZAI_API_KEY=${ZAI_API_KEY}\n"
  if [[ "${HAS_SLACK}" == "true" ]]; then
    env_content+="SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}\n"
    env_content+="SLACK_APP_TOKEN=${SLACK_APP_TOKEN}\n"
  fi

  printf "%b" "${env_content}" > "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"

  success "환경변수 파일 생성됨: ${ENV_FILE}"
}

# ---------------------------------------------------------------------------
# Build sandbox image
# ---------------------------------------------------------------------------
SANDBOX_IMAGE="openclaw-sandbox:bookworm-slim"

build_sandbox_image() {
  info "샌드박스 Docker 이미지 확인 중..."

  # Check if image already exists
  if docker image inspect "${SANDBOX_IMAGE}" &>/dev/null; then
    success "샌드박스 이미지 이미 존재함: ${SANDBOX_IMAGE}"
    read -rp "이미지를 다시 빌드하시겠습니까? (y/N): " rebuild
    if [[ "${rebuild}" != "y" && "${rebuild}" != "Y" ]]; then
      return 0
    fi
    info "샌드박스 Docker 이미지 재빌드 중..."
  else
    info "샌드박스 Docker 이미지 빌드 중..."
  fi

  if [[ -f "${ROOT_DIR}/scripts/sandbox-setup.sh" ]]; then
    if bash "${ROOT_DIR}/scripts/sandbox-setup.sh"; then
      success "샌드박스 이미지 빌드 완료"
    else
      warn "샌드박스 이미지 빌드 실패 (계속 진행)"
    fi
  elif [[ -f "${ROOT_DIR}/Dockerfile.sandbox" ]]; then
    if docker build -t "${SANDBOX_IMAGE}" -f "${ROOT_DIR}/Dockerfile.sandbox" "${ROOT_DIR}"; then
      success "샌드박스 이미지 빌드 완료"
    else
      warn "샌드박스 이미지 빌드 실패 (계속 진행)"
    fi
  else
    warn "sandbox-setup.sh 또는 Dockerfile.sandbox를 찾을 수 없습니다"
  fi
}

# ---------------------------------------------------------------------------
# Start gateway
# ---------------------------------------------------------------------------
start_gateway() {
  info "게이트웨이 확인 중..."

  # Check if gateway is already running
  if lsof -iTCP:18789 -sTCP:LISTEN &>/dev/null; then
    success "게이트웨이가 이미 실행 중입니다 (포트 18789)"
    read -rp "게이트웨이를 재시작하시겠습니까? (y/N): " restart_confirm
    if [[ "${restart_confirm}" != "y" && "${restart_confirm}" != "Y" ]]; then
      return 0
    fi
    info "게이트웨이 재시작 중..."
    pkill -9 -f "openclaw-gateway" 2>/dev/null || true
    pkill -9 -f "openclaw gateway run" 2>/dev/null || true
    sleep 2
  else
    info "게이트웨이 시작 중..."
  fi

  # Start gateway
  cd "${ROOT_DIR}"
  if command -v pnpm &>/dev/null; then
    nohup pnpm openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &
  else
    nohup npx openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &
  fi

  sleep 3

  # Verify
  if lsof -iTCP:18789 -sTCP:LISTEN &>/dev/null; then
    success "게이트웨이 시작됨 (포트 18789)"
  else
    warn "게이트웨이 시작 실패. 로그 확인: /tmp/openclaw-gateway.log"
  fi
}

# ---------------------------------------------------------------------------
# Open TUI with wake message + Web UI
# ---------------------------------------------------------------------------
BOOTSTRAP_FILE="${WORKSPACE_DIR}/bootstrap.md"

open_tui_and_webui() {
  # Get token from config for authenticated URL
  local dashboard_url="http://127.0.0.1:18789"
  local token=""
  if [[ -f "${CONFIG_FILE}" ]]; then
    token="$(node -e "
      const fs = require('fs');
      try {
        const cfg = JSON.parse(fs.readFileSync('${CONFIG_FILE}', 'utf8'));
        if (cfg.gateway?.auth?.token) process.stdout.write(cfg.gateway.auth.token);
      } catch {}
    " 2>/dev/null || true)"
  fi

  if [[ -n "${token}" ]]; then
    dashboard_url="${dashboard_url}?token=${token}"
  fi

  # Open Web UI FIRST (in background) before starting TUI
  info "Web UI 열기..."
  if [[ "$(uname -s)" == "Darwin" ]]; then
    open "${dashboard_url}" 2>/dev/null && success "Web UI가 브라우저에서 열렸습니다" || true
  elif command -v xdg-open &>/dev/null; then
    xdg-open "${dashboard_url}" 2>/dev/null && success "Web UI가 브라우저에서 열렸습니다" || true
  else
    log "Web UI: ${dashboard_url}"
  fi

  # Check if bootstrap file exists (like onboarding wizard does)
  local tui_args=()
  if [[ -f "${BOOTSTRAP_FILE}" ]]; then
    log ""
    log "============================================================"
    log "🐣 에이전트 첫 대화"
    log "============================================================"
    log ""
    log "이것은 에이전트를 우리 팀의 동료로 만드는 중요한 순간입니다."
    log "천천히 진행하세요."
    log "에이전트에게 많이 알려줄수록 우리 팀에게 더 큰 도움이 됩니다."
    log ""
    log "메시지: \"안녕! 우리 팀의 새 동료로 온 걸 환영해. 넌 어떤 존재야?\""
    log ""
    tui_args+=("--message" "안녕! 우리 팀의 새 동료로 온 걸 환영해. 넌 어떤 존재야?")
  fi

  info "TUI 열기..."
  cd "${ROOT_DIR}"
  if command -v pnpm &>/dev/null; then
    pnpm openclaw tui "${tui_args[@]}"
  else
    npx openclaw tui "${tui_args[@]}"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  log ""
  print_security_warning
  log ""

  # Check for non-interactive mode
  if [[ "${OPENCLAW_ACCEPT_RISK:-}" == "1" ]]; then
    info "OPENCLAW_ACCEPT_RISK=1 설정됨, 보안 경고 동의함"
  else
    read -rp "위 보안 경고를 읽었으며 위험을 이해합니다. 계속하시겠습니까? (y/N): " confirm
    if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
      log "설정이 취소되었습니다."
      exit 0
    fi
  fi

  log ""
  check_dependencies
  log ""
  load_existing_config
  log ""
  setup_docker
  log ""
  prompt_llm_key
  log ""
  prompt_slack_tokens
  log ""
  prompt_slack_channels
  log ""
  prompt_team_template
  log ""
  create_config
  log ""
  create_env
  log ""
  setup_workspace
  log ""
  build_sandbox_image
  log ""
  start_gateway
  log ""

  log "============================================================"
  success "설정 완료!"
  log ""
  log "설정 파일: ${CONFIG_FILE}"
  log "환경변수:  ${ENV_FILE}"
  log "워크스페이스: ${WORKSPACE_DIR}"
  log ""
  log "다음 명령어로 상태를 확인하세요:"
  log "  openclaw channels status --probe"
  log "  openclaw security audit --deep"
  log ""
  log "문서: https://docs.openclaw.ai/gateway/security"
  log "============================================================"
  log ""

  read -rp "TUI를 열어 에이전트와 첫 대화를 시작하시겠습니까? (Y/n): " launch_confirm
  if [[ "${launch_confirm}" != "n" && "${launch_confirm}" != "N" ]]; then
    open_tui_and_webui
  fi
}

main "$@"
