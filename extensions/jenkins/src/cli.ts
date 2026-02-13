import * as readline from "node:readline";

import type { Command } from "commander";

import type { JenkinsConfig } from "./config.js";
import { createJenkinsClient } from "./client.js";
import {
  deleteJenkinsCredentials,
  hasJenkinsCredentials,
  readJenkinsCredentials,
  writeJenkinsCredentials,
} from "./keychain.js";

type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

type CliContext = {
  config: JenkinsConfig;
  logger: Logger;
};

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.setEncoding("utf8");

    let input = "";

    const onData = (char: string) => {
      if (char === "\n" || char === "\r" || char === "\u0004") {
        stdin.removeListener("data", onData);
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw ?? false);
        }
        stdin.pause();
        process.stdout.write("\n");
        resolve(input);
      } else if (char === "\u0003") {
        // Ctrl+C
        process.exit(1);
      } else if (char === "\u007F" || char === "\b") {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else {
        input += char;
      }
    };

    stdin.on("data", onData);
  });
}

export function registerJenkinsCli(ctx: CliContext, program: Command) {
  const jenkins = program
    .command("jenkins")
    .description("Jenkins integration commands")
    .addHelpText("after", () => "\nDocs: https://docs.openclaw.ai/integrations/jenkins\n");

  jenkins
    .command("setup")
    .description("Setup Jenkins connection (stores credentials in Keychain)")
    .option("--url <url>", "Jenkins server URL")
    .option("--user <user>", "Jenkins username")
    .option("--token <token>", "Jenkins API token")
    .action(async (options: { url?: string; user?: string; token?: string }) => {
      const account = ctx.config.account;

      // Get URL
      let baseUrl = options.url ?? ctx.config.baseUrl;
      if (!baseUrl) {
        baseUrl = await prompt("Jenkins URL: ");
      }
      if (!baseUrl?.trim()) {
        ctx.logger.error("Jenkins URL is required");
        process.exit(1);
      }

      // Validate URL
      try {
        new URL(baseUrl);
      } catch {
        ctx.logger.error(`Invalid URL: ${baseUrl}`);
        process.exit(1);
      }

      // Get username
      let user = options.user;
      if (!user) {
        user = await prompt("Jenkins username: ");
      }
      if (!user?.trim()) {
        ctx.logger.error("Username is required");
        process.exit(1);
      }

      // Get API token
      let token = options.token;
      if (!token) {
        token = await promptHidden("Jenkins API token: ");
      }
      if (!token?.trim()) {
        ctx.logger.error("API token is required");
        process.exit(1);
      }

      // Save to Keychain
      const saved = writeJenkinsCredentials(
        { user: user.trim(), token: token.trim() },
        { account },
      );

      if (!saved) {
        ctx.logger.error("Failed to save credentials to Keychain");
        ctx.logger.info("Note: Keychain storage is only supported on macOS");
        process.exit(1);
      }

      ctx.logger.info(`Credentials saved to Keychain (account: ${account})`);

      // Test connection
      ctx.logger.info("Testing connection...");
      const credentials = readJenkinsCredentials({ account });
      if (!credentials) {
        ctx.logger.error("Failed to read back credentials");
        process.exit(1);
      }

      const client = createJenkinsClient({
        config: { ...ctx.config, baseUrl },
        credentials,
        logger: ctx.logger,
      });

      const result = await client.testConnection();
      if (result.ok) {
        ctx.logger.info(`Connection successful${result.version ? ` (${result.version})` : ""}`);
      } else {
        ctx.logger.warn(`Connection test failed: ${result.error}`);
        ctx.logger.info("Credentials were saved, but you may need to verify them");
      }

      // Remind about config
      if (!ctx.config.baseUrl) {
        ctx.logger.info("");
        ctx.logger.info("Add baseUrl to your openclaw.yaml:");
        ctx.logger.info(`  plugins:`);
        ctx.logger.info(`    jenkins:`);
        ctx.logger.info(`      baseUrl: "${baseUrl}"`);
      }
    });

  jenkins
    .command("logout")
    .description("Remove Jenkins credentials from Keychain")
    .action(async () => {
      const account = ctx.config.account;

      if (!hasJenkinsCredentials({ account })) {
        ctx.logger.info("No credentials found in Keychain");
        return;
      }

      const deleted = deleteJenkinsCredentials({ account });
      if (deleted) {
        ctx.logger.info(`Credentials removed from Keychain (account: ${account})`);
      } else {
        ctx.logger.error("Failed to remove credentials from Keychain");
        process.exit(1);
      }
    });

  jenkins
    .command("test")
    .description("Test Jenkins connection")
    .action(async () => {
      const account = ctx.config.account;

      if (!ctx.config.baseUrl) {
        ctx.logger.error("Jenkins baseUrl not configured in openclaw.yaml");
        ctx.logger.info("");
        ctx.logger.info("Add to your openclaw.yaml:");
        ctx.logger.info(`  plugins:`);
        ctx.logger.info(`    jenkins:`);
        ctx.logger.info(`      baseUrl: "https://jenkins.company.com"`);
        process.exit(1);
      }

      const credentials = readJenkinsCredentials({ account });
      if (!credentials) {
        ctx.logger.error("No credentials found in Keychain");
        ctx.logger.info('Run "openclaw jenkins setup" to configure credentials');
        process.exit(1);
      }

      const client = createJenkinsClient({
        config: ctx.config,
        credentials,
        logger: ctx.logger,
      });

      ctx.logger.info(`Testing connection to ${ctx.config.baseUrl}...`);

      const result = await client.testConnection();
      if (result.ok) {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify(
            {
              status: "ok",
              url: ctx.config.baseUrl,
              account,
              version: result.version,
            },
            null,
            2,
          ),
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify(
            {
              status: "error",
              url: ctx.config.baseUrl,
              account,
              error: result.error,
            },
            null,
            2,
          ),
        );
        process.exit(1);
      }
    });

  jenkins
    .command("status")
    .description("Show Jenkins plugin configuration status")
    .action(async () => {
      const account = ctx.config.account;
      const hasCredentials = hasJenkinsCredentials({ account });

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            configured: Boolean(ctx.config.baseUrl && hasCredentials),
            baseUrl: ctx.config.baseUrl ?? null,
            account,
            credentialsStored: hasCredentials,
            allowedParameters: ctx.config.allowedParameters,
            auditLog: ctx.config.auditLog,
          },
          null,
          2,
        ),
      );
    });
}
