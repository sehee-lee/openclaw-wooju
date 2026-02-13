import type { Command } from "commander";
import type {
  WoojuSecurityPreset,
  WoojuTemplateRole,
  WoojuTemplateService,
  WoojuTemplateStack,
} from "../../commands/wooju-types.js";
import { woojuCommand } from "../../commands/wooju.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";

export function registerWoojuCommand(program: Command) {
  program
    .command("wooju")
    .description("Wooju용 안전한 에이전트 설정")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/wooju", "docs.openclaw.ai/cli/wooju")}\n`,
    )
    .option("--non-interactive", "환경변수로 자동 설정", false)
    .option("--accept-risk", "보안 경고 동의 (--non-interactive 필수)", false)
    .option("--skip-slack", "Slack 연동 건너뛰기", false)
    .option("--skip-sandbox", "샌드박스 빌드 건너뛰기", false)
    .option("--skip-gateway", "게이트웨이 시작 건너뛰기", false)
    .option("--security-preset <preset>", "보안 프리셋: high|medium|low (기본: high)")
    .option("--role <role>", "템플릿 역할: developer|planning|design|data")
    .option("--stack <stack>", "템플릿 스택: ios|android|frontend|backend-java|devops")
    .option("--service <service>", "템플릿 서비스: maps|shopping|search")
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        // Validate non-interactive mode requires accept-risk
        if (opts.nonInteractive && !opts.acceptRisk && process.env.OPENCLAW_ACCEPT_RISK !== "1") {
          defaultRuntime.error(
            [
              "Non-interactive 모드는 --accept-risk 플래그가 필요합니다.",
              "",
              "사용법:",
              "  OPENCLAW_ACCEPT_RISK=1 openclaw wooju --non-interactive ...",
              "  또는",
              "  openclaw wooju --non-interactive --accept-risk ...",
            ].join("\n"),
          );
          defaultRuntime.exit(1);
          return;
        }

        await woojuCommand(
          {
            nonInteractive: Boolean(opts.nonInteractive),
            acceptRisk: Boolean(opts.acceptRisk),
            skipSlack: Boolean(opts.skipSlack),
            skipSandbox: Boolean(opts.skipSandbox),
            skipGateway: Boolean(opts.skipGateway),
            securityPreset: opts.securityPreset as WoojuSecurityPreset | undefined,
            role: opts.role as WoojuTemplateRole | undefined,
            stack: opts.stack as WoojuTemplateStack | undefined,
            service: opts.service as WoojuTemplateService | undefined,
          },
          defaultRuntime,
        );
      });
    });
}
