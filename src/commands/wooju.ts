import fs from "node:fs";
import path from "node:path";
import type { RuntimeEnv } from "../runtime.js";
import type { WoojuCommandOptions, WoojuTemplateSelection } from "./wooju-types.js";
import { formatCliCommand } from "../cli/command-format.js";
import { loadConfig, writeConfigFile } from "../config/io.js";
import { DEFAULT_GATEWAY_PORT } from "../config/paths.js";
import { resolveGatewayService } from "../daemon/service.js";
import { ensureControlUiAssetsBuilt } from "../infra/control-ui-assets.js";
import { resolveOpenClawPackageRoot } from "../infra/openclaw-root.js";
import { runExec } from "../process/exec.js";
import { note } from "../terminal/note.js";
import { runTui } from "../tui/tui.js";
import { resolveUserPath, shortenHomePath } from "../utils.js";
import { createClackPrompter } from "../wizard/clack-prompter.js";
import { WizardCancelledError } from "../wizard/prompts.js";
import { buildGatewayInstallPlan } from "./daemon-install-helpers.js";
import { DEFAULT_GATEWAY_DAEMON_RUNTIME } from "./daemon-runtime.js";
import { promptAuthConfig } from "./configure.gateway-auth.js";
import {
  buildWoojuConfig,
  getConfigPath,
  getWorkspaceDir,
  writeWoojuEnvFile,
} from "./wooju-config.js";
import { setupChannels } from "./onboard-channels.js";
import { setupSkills } from "./onboard-skills.js";
import {
  promptSecurityPreset,
  requireRiskAcknowledgementKorean,
} from "./wooju-prompts.js";
import { ensureWoojuWorkspaceAndSessions } from "./wooju-workspace.js";
import {
  openUrlInBackground,
  probeGatewayReachable,
  resolveControlUiLinks,
  waitForGatewayReachable,
} from "./onboard-helpers.js";

// Re-export types for external use
export type { WoojuCommandOptions } from "./wooju-types.js";

/**
 * Check if Docker or Colima is available.
 */
async function checkDockerAvailable(): Promise<{ available: boolean; error?: string }> {
  try {
    await runExec("docker", ["version", "--format", "{{.Server.Version}}"], {
      timeoutMs: 5_000,
    });
    return { available: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Cannot connect to the Docker daemon")) {
      return {
        available: false,
        error: "Docker daemon is not running. Start Docker Desktop or Colima first.",
      };
    }
    if (message.includes("command not found") || message.includes("not found")) {
      return {
        available: false,
        error: "Docker is not installed. Install Docker Desktop or Colima.",
      };
    }
    return { available: false, error: message };
  }
}

/**
 * Check if the sandbox Docker image already exists.
 */
async function checkSandboxImageExists(): Promise<boolean> {
  try {
    await runExec("docker", ["image", "inspect", "openclaw-sandbox:latest"], {
      timeoutMs: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the sandbox Docker image.
 * Finds the Dockerfile.sandbox in the package root and builds it directly.
 */
async function buildSandboxImage(runtime: RuntimeEnv): Promise<boolean> {
  const IMAGE_NAME = "openclaw-sandbox:bookworm-slim";
  runtime.log(`Building sandbox Docker image: ${IMAGE_NAME}...`);

  // Find package root (works for both dev and npm install)
  const packageRoot = await resolveOpenClawPackageRoot({
    argv1: process.argv[1],
    cwd: process.cwd(),
  });

  if (!packageRoot) {
    runtime.error("Could not find OpenClaw package root");
    return false;
  }

  const dockerfilePath = path.join(packageRoot, "Dockerfile.sandbox");
  if (!fs.existsSync(dockerfilePath)) {
    runtime.error(`Dockerfile not found at ${dockerfilePath}`);
    return false;
  }

  try {
    await runExec("docker", ["build", "-t", IMAGE_NAME, "-f", dockerfilePath, packageRoot], {
      timeoutMs: 10 * 60 * 1000, // 10 minutes for image build
    });

    runtime.log(`Sandbox image ready: ${IMAGE_NAME}`);
    return true;
  } catch (err) {
    runtime.error(`Failed to build sandbox image: ${err}`);
    return false;
  }
}

/**
 * Check if Homebrew is installed.
 */
async function checkHomebrewInstalled(): Promise<boolean> {
  try {
    await runExec("brew", ["--version"], { timeoutMs: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install Colima (lightweight Docker runtime).
 */
async function installColima(
  prompter: ReturnType<typeof createClackPrompter>,
  runtime: RuntimeEnv,
): Promise<void> {
  const hasHomebrew = await checkHomebrewInstalled();

  if (!hasHomebrew) {
    await prompter.note(
      [
        "Homebrew가 설치되어 있지 않습니다.",
        "",
        "Homebrew 설치:",
        '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
        "",
        "설치 후 다시 실행해주세요.",
      ].join("\n"),
      "⚠️ Homebrew 필요",
    );
    throw new WizardCancelledError("Homebrew 필요");
  }

  const progress = prompter.progress("Colima 설치 중...");

  try {
    // Install Colima and Docker CLI
    progress.update("Colima 설치 중...");
    await runExec("brew", ["install", "colima", "docker"], {
      timeoutMs: 10 * 60 * 1000, // 10 minutes
    });

    progress.update("Colima 시작 중...");
    await runExec("colima", ["start"], {
      timeoutMs: 5 * 60 * 1000, // 5 minutes
    });

    progress.stop("✅ Colima 설치 완료");
    runtime.log("Colima가 성공적으로 설치되고 시작되었습니다.");
  } catch (err) {
    progress.stop("❌ Colima 설치 실패");
    const message = err instanceof Error ? err.message : String(err);
    runtime.error(`Colima 설치 실패: ${message}`);
    throw new WizardCancelledError("Colima 설치 실패");
  }
}

/**
 * Main wooju command implementation.
 */
export async function woojuCommand(opts: WoojuCommandOptions, runtime: RuntimeEnv): Promise<void> {
  const prompter = createClackPrompter();

  try {
    await prompter.intro("🦞 OpenClaw Wooju 설정");

    // 1. Security warning (Korean)
    await requireRiskAcknowledgementKorean({ opts, prompter });

    // 2. Check Docker/Colima
    let dockerCheck = await checkDockerAvailable();
    if (!dockerCheck.available) {
      await prompter.note(
        [
          "Docker가 필요합니다 (샌드박스 보안을 위해).",
          "",
          dockerCheck.error ?? "Docker를 설치하고 실행해주세요.",
        ].join("\n"),
        "⚠️ Docker 필요",
      );

      if (opts.nonInteractive) {
        throw new Error("Docker is required for sandbox security");
      }

      type DockerAction = "install-colima" | "continue" | "cancel";
      const action = (await prompter.select({
        message: "어떻게 하시겠습니까?",
        options: [
          { value: "install-colima", label: "Colima 설치 (권장)", hint: "경량 Docker 런타임" },
          { value: "continue", label: "Docker 없이 계속", hint: "샌드박스 비활성화" },
          { value: "cancel", label: "취소", hint: "수동 설치 후 다시 실행" },
        ],
        initialValue: "install-colima",
      })) as DockerAction;

      if (action === "cancel") {
        throw new WizardCancelledError("Docker 필요");
      }

      if (action === "install-colima") {
        await installColima(prompter, runtime);
        // Re-check Docker availability after installation
        dockerCheck = await checkDockerAvailable();
        if (!dockerCheck.available) {
          await prompter.note(
            [
              "Colima 설치 후에도 Docker를 사용할 수 없습니다.",
              "",
              "다음 명령어로 Colima를 시작하세요:",
              "  colima start",
              "",
              "그 후 다시 실행해주세요.",
            ].join("\n"),
            "⚠️ Colima 시작 필요",
          );
          throw new WizardCancelledError("Colima 시작 필요");
        }
      }

      if (action === "continue") {
        // Warn about security risks when running without sandbox
        await prompter.note(
          [
            "⚠️  경고: 샌드박스 없이 실행하면 보안 위험이 있습니다.",
            "",
            "위험 사항:",
            "• AI 에이전트가 호스트 시스템의 파일에 직접 접근 가능",
            "• 시스템 설정 변경 가능 (원격 코드 실행 위험)",
            "• 파괴적인 명령(rm -rf 등) 실행 가능",
            "",
            "권장: 테스트 환경 또는 격리된 VM에서만 사용하세요.",
          ].join("\n"),
          "🔒 보안 위험",
        );

        if (!opts.nonInteractive) {
          const confirmRisk = await prompter.confirm({
            message: "위험을 이해했으며 샌드박스 없이 계속하시겠습니까?",
            initialValue: false,
          });

          if (!confirmRisk) {
            throw new WizardCancelledError("샌드박스 필수");
          }
        }
        // Continue with dockerCheck.available = false
      }
    }

    // 3. Security preset selection
    const securityPreset = await promptSecurityPreset({ prompter, opts });

    // Load existing config so we merge with it (keeps all LLM providers)
    let baseConfig: ReturnType<typeof loadConfig> | undefined;
    try {
      baseConfig = loadConfig();
    } catch {
      baseConfig = undefined;
    }

    // 4. Build initial config (no model yet)
    const template: WoojuTemplateSelection = { type: "wooju" };
    let { config, gatewayToken } = buildWoojuConfig({
      template,
      securityPreset,
      baseConfig,
    });

    // 5. Model + API key setup (provider 선택, API 키 입력, 기본 모델 설정 — 기존 configure와 동일)
    config = await promptAuthConfig(config, runtime, prompter);

    // 6. Channel setup (Telegram, Discord, Slack, WhatsApp 등 — 기존 온보딩과 동일)
    config = await setupChannels(config, runtime, prompter, {
      skipConfirm: true,
      allowDisable: true,
      allowSignalInstall: true,
      skipStatusNote: false,
    });

    // 7. Disable sandbox if Docker not available (unless low preset which already has it off)
    if (!dockerCheck.available && securityPreset !== "low") {
      config.agents!.defaults!.sandbox = { mode: "off" };
      runtime.log("⚠️  샌드박스가 비활성화되었습니다 (Docker 없음). 보안 위험에 주의하세요.");
    }

    // 8. Setup workspace with template (must exist before skills setup)
    const workspaceDir = resolveUserPath(getWorkspaceDir());
    await ensureWoojuWorkspaceAndSessions(workspaceDir, runtime, {
      templateSelection: template,
      forceOverwrite: true,
    });

    // 9. Skills setup (same as standard onboarding — install/enable workspace skills)
    config = await setupSkills(config, workspaceDir, runtime, prompter);

    // 10. Write config file (includes channel + skills from steps above)
    const configPath = getConfigPath();
    await writeConfigFile(config);
    runtime.log(`Config saved: ${shortenHomePath(configPath)}`);

    // 11. Write environment file (channel tokens are handled by each adapter)
    const envPath = await writeWoojuEnvFile();
    runtime.log(`Environment saved: ${shortenHomePath(envPath)}`);

    // 12. Build sandbox image (optional, skip for low preset)
    const skipSandboxBuild = opts.skipSandbox || securityPreset === "low";
    if (!skipSandboxBuild && dockerCheck.available) {
      const imageExists = await checkSandboxImageExists();

      if (imageExists) {
        runtime.log("✅ 샌드박스 이미지가 이미 존재합니다: openclaw-sandbox:latest");
      } else {
        const shouldBuild = opts.nonInteractive
          ? true
          : await prompter.confirm({
              message: "샌드박스 Docker 이미지를 빌드하시겠습니까? (보안을 위해 권장)",
              initialValue: true,
            });

        if (shouldBuild) {
          await buildSandboxImage(runtime);
        }
      }
    }

    // 13. Summary
    note(
      [
        "✅ 설정 완료!",
        "",
        `📁 설정 파일: ${shortenHomePath(configPath)}`,
        `📁 환경 파일: ${shortenHomePath(envPath)}`,
        `📁 워크스페이스: ${shortenHomePath(workspaceDir)}`,
      ].join("\n"),
      "🎉 Wooju 에이전트 설정 완료",
    );

    // 14. Gateway start and TUI/WebUI launch
    if (opts.skipGateway) {
      await prompter.note(
        [
          "게이트웨이 시작을 건너뛰었습니다.",
          "",
          "다음 명령어로 게이트웨이를 시작하세요:",
          `  ${formatCliCommand("openclaw gateway run")}`,
        ].join("\n"),
        "게이트웨이",
      );
      await prompter.outro("설정이 완료되었습니다!");
      return;
    }

    // Start or restart gateway service
    const service = resolveGatewayService();
    const gatewayPort = config.gateway?.port ?? DEFAULT_GATEWAY_PORT;

    const progress = prompter.progress("게이트웨이 시작 중...");
    let installError: string | null = null;
    try {
      // Always restart to pick up new config with new token
      const loaded = await service.isLoaded({ env: process.env });
      if (loaded) {
        progress.update("게이트웨이 재시작 중...");
        // Unload first to ensure clean restart with new config
        await service.uninstall({ env: process.env, stdout: process.stdout });
      }

      progress.update("게이트웨이 서비스 준비 중...");
      const { programArguments, workingDirectory, environment } = await buildGatewayInstallPlan({
        env: process.env,
        port: gatewayPort,
        token: gatewayToken,
        runtime: DEFAULT_GATEWAY_DAEMON_RUNTIME,
        warn: (message, title) => prompter.note(message, title),
        config,
      });

      // Add --force to kill any existing gateway process on this port
      const argsWithForce = [...programArguments, "--force"];

      progress.update("게이트웨이 서비스 설치 중...");
      await service.install({
        env: process.env,
        stdout: process.stdout,
        programArguments: argsWithForce,
        workingDirectory,
        environment,
      });
    } catch (err) {
      installError = err instanceof Error ? err.message : String(err);
    }
    progress.stop(installError ? "게이트웨이 시작 실패" : "게이트웨이 시작됨");

    if (installError) {
      runtime.error(`게이트웨이 시작 실패: ${installError}`);
      await prompter.note(
        ["게이트웨이를 수동으로 시작하세요:", `  ${formatCliCommand("openclaw gateway run")}`].join(
          "\n",
        ),
        "게이트웨이",
      );
      await prompter.outro("설정이 완료되었습니다!");
      return;
    }

    // Wait for gateway to be reachable (give it more time after fresh install)
    const links = resolveControlUiLinks({
      bind: config.gateway?.bind ?? "loopback",
      port: gatewayPort,
      customBindHost: undefined,
      basePath: undefined,
    });

    const reachable = await waitForGatewayReachable({
      url: links.wsUrl,
      token: gatewayToken,
      deadlineMs: 20_000,
    });

    if (!reachable) {
      await prompter.note(
        [
          "게이트웨이 연결 대기 시간 초과",
          "",
          "상태 확인:",
          `  ${formatCliCommand("openclaw status")}`,
        ].join("\n"),
        "⚠️ 게이트웨이",
      );
      await prompter.outro("설정이 완료되었습니다!");
      return;
    }

    // Probe gateway
    const gatewayProbe = await probeGatewayReachable({
      url: links.wsUrl,
      token: gatewayToken,
    });

    if (!gatewayProbe.ok) {
      await prompter.note(
        [
          "게이트웨이에 연결할 수 없습니다.",
          gatewayProbe.detail ? `원인: ${gatewayProbe.detail}` : "",
          "",
          "상태 확인:",
          `  ${formatCliCommand("openclaw status")}`,
        ]
          .filter(Boolean)
          .join("\n"),
        "⚠️ 게이트웨이",
      );
      await prompter.outro("설정이 완료되었습니다!");
      return;
    }

    // Ensure Control UI assets are built
    const controlUiAssets = await ensureControlUiAssetsBuilt(runtime);
    if (!controlUiAssets.ok && controlUiAssets.message) {
      runtime.error(controlUiAssets.message);
    }

    // Auto-start TUI and WebUI
    const tokenParam = gatewayToken ? `?token=${encodeURIComponent(gatewayToken)}` : "";
    const authedUrl = `${links.httpUrl}${tokenParam}`;

    if (opts.nonInteractive) {
      // Non-interactive mode: show instructions only
      await prompter.note(
        [
          "다음 명령어로 시작하세요:",
          `  ${formatCliCommand("openclaw tui")}      # TUI`,
          `  ${formatCliCommand("openclaw dashboard")}  # Web UI`,
          "",
          "설정한 채널(Telegram, Slack 등)에서 봇을 멘션하여 대화를 시작할 수 있습니다.",
        ]
          .filter(Boolean)
          .join("\n"),
        "시작 방법",
      );
      await prompter.outro("설정이 완료되었습니다!");
    } else {
      // Interactive mode: auto-start TUI and seed WebUI in background
      await prompter.outro("TUI를 시작합니다...");
      await runTui({
        url: links.wsUrl,
        token: gatewayToken,
        deliver: false,
        message: "안녕! 우리 팀에 합류한 걸 환영해!",
      });
      // Seed WebUI in background after TUI exits
      if (gatewayToken) {
        const seededInBackground = await openUrlInBackground(authedUrl);
        if (seededInBackground) {
          note(
            [
              "Web UI가 백그라운드에서 열렸습니다.",
              `나중에 열기: ${formatCliCommand("openclaw dashboard")}`,
            ].join("\n"),
            "Web UI",
          );
        }
      }
    }
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      runtime.log(`\n설정이 취소되었습니다: ${err.message}`);
      runtime.exit(0);
    }
    throw err;
  }
}
