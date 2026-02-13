import fs from "node:fs/promises";
import path from "node:path";
import type { WizardPrompter } from "../wizard/prompts.js";
import type {
  WoojuCommandOptions,
  WoojuSecurityPreset,
  WoojuSlackSetup,
} from "./wooju-types.js";
import { STATE_DIR } from "../config/paths.js";
import { WizardCancelledError } from "../wizard/prompts.js";

// Re-export types for convenience
export type {
  WoojuSecurityPreset,
  WoojuSlackSetup,
} from "./wooju-types.js";

/**
 * Read a key from .env file.
 */
async function readEnvKey(key: string): Promise<string | undefined> {
  try {
    const envPath = path.join(STATE_DIR, ".env");
    const content = await fs.readFile(envPath, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith(`${key}=`)) {
        const value = trimmed.slice(key.length + 1).trim();
        return value || undefined;
      }
    }
  } catch {
    // File doesn't exist or can't be read
  }
  return undefined;
}

/**
 * Format API key preview (show first 8 chars and last 4 chars).
 */
function formatApiKeyPreview(key: string): string {
  if (key.length <= 12) {
    return key;
  }
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

/**
 * Display Korean security warning and require acknowledgement.
 */
export async function requireRiskAcknowledgementKorean(params: {
  opts: WoojuCommandOptions;
  prompter: WizardPrompter;
}): Promise<void> {
  const { opts, prompter } = params;

  // Skip if already accepted via CLI flag or env
  if (opts.acceptRisk || process.env.OPENCLAW_ACCEPT_RISK === "1") {
    return;
  }

  await prompter.note(
    [
      "OpenClaw는 오픈소스이며 아직 베타입니다.",
      "도구가 활성화되면 파일을 읽고 작업을 수행할 수 있습니다.",
      "잘못된 프롬프트가 안전하지 않은 작업을 유발할 수 있습니다.",
      "",
      "이 명령어는 위 위험을 최소화하기 위해 다음 보안 설정과",
      "에이전트 가드레일을 자동으로 적용합니다:",
      "",
      "✅ 시스템 보안 설정 (강제):",
      "- 채널 허용 목록 (지정한 채널만 접근 가능)",
      "- @멘션 필수 (봇을 직접 호출해야만 응답, 지원 채널에서)",
      "- 샌드박스 격리 (Docker 컨테이너 내에서 실행)",
      "- 웹 검색/접근 차단 (보안 프리셋에 따라 다름)",
      "- 게이트웨이 로컬 전용 (외부 네트워크에서 접근 불가)",
      "",
      "📋 에이전트 행동 가이드라인 (워크스페이스 템플릿):",
      "- Prompt Injection 방어 지침",
      "- 민감정보 필터링 및 데이터 분류 정책",
      "- 위험 명령 실행 전 사용자 확인 필수",
      "",
      "정기적으로 보안 상태를 확인하세요:",
      "  openclaw security audit --deep",
      "",
      "문서: https://docs.openclaw.ai/gateway/security",
    ].join("\n"),
    "🔒 보안 경고",
  );

  const ok = await prompter.confirm({
    message: "위 내용을 이해했으며 계속 진행하시겠습니까?",
    initialValue: false,
  });

  if (!ok) {
    throw new WizardCancelledError("보안 경고 동의 안 함");
  }
}

/**
 * Prompt for security preset selection.
 */
export async function promptSecurityPreset(params: {
  prompter: WizardPrompter;
  opts: WoojuCommandOptions;
}): Promise<WoojuSecurityPreset> {
  const { prompter, opts } = params;

  // Non-interactive: use CLI option or default to high
  if (opts.nonInteractive) {
    return opts.securityPreset ?? "high";
  }

  // CLI option already specified, skip prompt
  if (opts.securityPreset) {
    return opts.securityPreset;
  }

  await prompter.note(
    [
      "보안 수준에 따라 3가지 프리셋 중 하나를 선택할 수 있습니다.",
      "",
      "📋 프리셋 비교:",
      "",
      "• High: 샌드박스 readonly, 웹 검색 비활성화",
      "• Medium: 샌드박스 readwrite, 웹 검색 허용",
      "• Low: 샌드박스 없음, 웹 검색 허용",
      "",
      "자세한 내용: SECURITY-PRESETS.md",
    ].join("\n"),
    "🔐 보안 프리셋",
  );

  const selectPreset = async (): Promise<WoojuSecurityPreset> => {
    const preset = (await prompter.select({
      message: "보안 프리셋 선택",
      options: [
        { value: "high", label: "High (최고보안)", hint: "기밀 코드 작업 권장" },
        { value: "medium", label: "Medium (중간보안)", hint: "일반 개발 작업" },
        { value: "low", label: "Low (실용성)", hint: "빠른 작업, 보안 일부 비활성화" },
      ],
      initialValue: "high",
    })) as WoojuSecurityPreset;

    // Warn and confirm if low preset is selected
    if (preset === "low") {
      await prompter.note(
        [
          "⚠️  실용성 프리셋은 샌드박스를 비활성화합니다.",
          "",
          "이 설정은 호스트 시스템에서 직접 코드가 실행되며,",
          "Prompt Injection 공격에 취약할 수 있습니다.",
          "",
          "기밀 코드 작업 시에는 최고보안 또는 중간보안을 권장합니다.",
        ].join("\n"),
        "⚠️ 보안 경고",
      );

      const confirmed = await prompter.confirm({
        message: "실용성 프리셋을 사용하시겠습니까?",
        initialValue: false,
      });

      if (!confirmed) {
        // User declined, re-prompt
        return selectPreset();
      }
    }

    return preset;
  };

  return selectPreset();
}

/**
 * Prompt for Slack configuration (optional).
 */
export async function promptSlackConfig(params: {
  prompter: WizardPrompter;
  opts: WoojuCommandOptions;
}): Promise<WoojuSlackSetup | null> {
  const { prompter, opts } = params;

  // Non-interactive mode: use environment variables
  if (opts.nonInteractive) {
    const botToken = process.env.SLACK_BOT_TOKEN?.trim();
    const appToken = process.env.SLACK_APP_TOKEN?.trim();
    const channelIds = process.env.SLACK_CHANNEL_IDS?.split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (!botToken || !appToken) {
      return null;
    }

    return {
      botToken,
      appToken,
      channelIds: channelIds ?? [],
    };
  }

  const wantsSlack = await prompter.confirm({
    message: "Slack 연동을 설정하시겠습니까?",
    initialValue: true,
  });

  if (!wantsSlack) {
    return null;
  }

  // Check for existing tokens: environment variables + .env file
  const envBotToken = process.env.SLACK_BOT_TOKEN?.trim();
  const envAppToken = process.env.SLACK_APP_TOKEN?.trim();
  const fileBotToken = await readEnvKey("SLACK_BOT_TOKEN");
  const fileAppToken = await readEnvKey("SLACK_APP_TOKEN");

  // Prefer environment variables over .env file
  const existingBotToken = envBotToken || fileBotToken;
  const existingAppToken = envAppToken || fileAppToken;

  await prompter.note(
    [
      "Slack 앱 설정이 필요합니다.",
      "",
      "1. https://api.slack.com/apps 에서 앱 생성",
      "2. Socket Mode 활성화",
      "3. Bot Token Scopes: chat:write, app_mentions:read, channels:history",
      "4. Event Subscriptions: app_mention, message.channels",
      "",
      "💡 Tip: SLACK_BOT_TOKEN, SLACK_APP_TOKEN 환경변수로도 설정 가능",
      "",
      "📚 가이드: https://docs.openclaw.ai/channels/slack",
    ].join("\n"),
    "Slack 설정",
  );

  let botToken: string;
  let appToken: string;

  // Prompt for Bot Token
  if (existingBotToken) {
    const source = envBotToken ? "환경변수" : ".env 파일";
    const useExisting = await prompter.confirm({
      message: `기존 Slack Bot Token 사용 (${source}: ${formatApiKeyPreview(existingBotToken)})?`,
      initialValue: true,
    });
    if (useExisting) {
      botToken = existingBotToken;
    } else {
      const newBotToken = await prompter.text({
        message: "새로운 Slack Bot Token (xoxb-...)",
        placeholder: "xoxb-...",
        validate: (value) => {
          if (!value.trim()) {
            return "Bot Token이 필요합니다";
          }
          if (!value.startsWith("xoxb-")) {
            return "Bot Token은 'xoxb-'로 시작해야 합니다";
          }
          return undefined;
        },
      });
      botToken = newBotToken;
    }
  } else {
    botToken = await prompter.text({
      message: "Slack Bot Token (xoxb-...)",
      placeholder: "xoxb-...",
      validate: (value) => {
        if (!value.trim()) {
          return "Bot Token이 필요합니다";
        }
        if (!value.startsWith("xoxb-")) {
          return "Bot Token은 'xoxb-'로 시작해야 합니다";
        }
        return undefined;
      },
    });
  }

  // Prompt for App Token
  if (existingAppToken) {
    const source = envAppToken ? "환경변수" : ".env 파일";
    const useExisting = await prompter.confirm({
      message: `기존 Slack App Token 사용 (${source}: ${formatApiKeyPreview(existingAppToken)})?`,
      initialValue: true,
    });
    if (useExisting) {
      appToken = existingAppToken;
    } else {
      const newAppToken = await prompter.text({
        message: "새로운 Slack App Token (xapp-...)",
        placeholder: "xapp-...",
        validate: (value) => {
          if (!value.trim()) {
            return "App Token이 필요합니다";
          }
          if (!value.startsWith("xapp-")) {
            return "App Token은 'xapp-'로 시작해야 합니다";
          }
          return undefined;
        },
      });
      appToken = newAppToken;
    }
  } else {
    appToken = await prompter.text({
      message: "Slack App Token (xapp-...)",
      placeholder: "xapp-...",
      validate: (value) => {
        if (!value.trim()) {
          return "App Token이 필요합니다";
        }
        if (!value.startsWith("xapp-")) {
          return "App Token은 'xapp-'로 시작해야 합니다";
        }
        return undefined;
      },
    });
  }

  const channelIdsRaw = await prompter.text({
    message: "허용할 Slack 채널 ID (쉼표로 구분, 예: C123,C456)",
    placeholder: "C0123456789,C9876543210",
    validate: (value) => {
      if (!value.trim()) {
        return undefined;
      }
      const ids = value.split(",").map((id) => id.trim());
      const invalid = ids.find((id) => !id.match(/^[A-Z0-9]+$/));
      if (invalid) {
        return `잘못된 채널 ID: ${invalid}`;
      }
      return undefined;
    },
  });

  const channelIds = channelIdsRaw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const trimmedBotToken = botToken.trim();

  return {
    botToken: trimmedBotToken,
    appToken: appToken.trim(),
    channelIds,
  };
}
