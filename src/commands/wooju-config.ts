import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import type { WoojuSecurityPreset } from "./wooju-prompts.js";
import type { WoojuTemplateSelection } from "./wooju-types.js";
import { CONFIG_PATH, STATE_DIR, DEFAULT_GATEWAY_PORT } from "../config/paths.js";
import { resolveUserPath } from "../utils.js";
import { randomToken } from "./onboard-helpers.js";

/**
 * Security preset configuration type.
 */
export type SecurityPresetConfig = {
  web: { search: boolean; fetch: boolean };
  sandbox: {
    mode: "all" | "off";
    workspaceAccess?: "ro" | "rw";
    tools?: { allow: string[] };
  };
};

/**
 * Security presets defined in SECURITY-PRESETS.md.
 */
export const SECURITY_PRESETS: Record<WoojuSecurityPreset, SecurityPresetConfig> = {
  high: {
    web: { search: false, fetch: false },
    sandbox: {
      mode: "all",
      workspaceAccess: "ro",
      tools: { allow: ["slack", "message"] },
    },
  },
  medium: {
    web: { search: true, fetch: true },
    sandbox: {
      mode: "all",
      workspaceAccess: "rw",
      tools: { allow: ["group:plugins", "slack", "message", "jenkins", "exec", "process", "web_search", "web_fetch"] },
    },
  },
  low: {
    web: { search: true, fetch: true },
    sandbox: { mode: "off" },
  },
};

export type WoojuConfigParams = {
  template: WoojuTemplateSelection;
  workspaceDir?: string;
  gatewayToken?: string;
  securityPreset?: WoojuSecurityPreset;
  /** Existing config to merge with (preserves all LLM providers). */
  baseConfig?: OpenClawConfig;
};

export type WoojuConfigResult = {
  config: OpenClawConfig;
  gatewayToken: string;
};

/**
 * Build the OpenClaw config for Wooju team setup.
 */
export function buildWoojuConfig(params: WoojuConfigParams): WoojuConfigResult {
  const { template } = params;
  const workspaceDir = params.workspaceDir ?? "~/.openclaw/workspace";
  const gatewayToken = params.gatewayToken ?? randomToken();
  const preset = params.securityPreset ?? "high";
  const presetConfig = SECURITY_PRESETS[preset];

  // Build sandbox tools allow list from preset (channels are configured later via setupChannels)
  let sandboxToolsAllow: string[] = [];
  if (presetConfig.sandbox.tools?.allow) {
    sandboxToolsAllow = [...presetConfig.sandbox.tools.allow];
  }

  const base = params.baseConfig ?? {};
  let config: OpenClawConfig = {
    ...base,
    tools: {
      ...base.tools,
      web: {
        search: { enabled: presetConfig.web.search },
        fetch: { enabled: presetConfig.web.fetch },
      },
      sandbox: {
        ...base.tools?.sandbox,
        tools: {
          allow: sandboxToolsAllow,
        },
      },
    },
    agents: {
      ...base.agents,
      defaults: {
        ...base.agents?.defaults,
        workspace: workspaceDir,
        sandbox:
          presetConfig.sandbox.mode === "off"
            ? { mode: "off" }
            : {
                mode: "all",
                workspaceAccess: presetConfig.sandbox.workspaceAccess ?? "ro",
                scope: "session",
                docker: { network: "bridge" },
              },
      },
    },
    gateway: {
      ...base.gateway,
      mode: "local",
      bind: "loopback",
      port: DEFAULT_GATEWAY_PORT,
      auth: {
        mode: "token",
        token: gatewayToken,
      },
    },
  };

  // Store template selection in config for reference
  config.template = {
    type: "wooju",
    role: template.role,
    stack: template.stack,
    service: template.service,
  };

  return { config, gatewayToken };
}

/**
 * Write environment variables to ~/.openclaw/.env.
 * Channel tokens (Slack, Telegram, etc.) are written by each channel adapter during setupChannels.
 */
export async function writeWoojuEnvFile(): Promise<string> {
  const lines: string[] = [];

  const envPath = path.join(STATE_DIR, ".env");
  const envDir = path.dirname(envPath);

  // Ensure directory exists with secure permissions
  await fs.mkdir(envDir, { recursive: true, mode: 0o700 });

  // Read existing .env if present and merge
  let existingContent = "";
  try {
    existingContent = await fs.readFile(envPath, "utf8");
  } catch {
    // File doesn't exist, that's fine
  }

  const existingLines = existingContent.split("\n").filter((line) => line.trim());
  const newKeys = new Set(lines.map((line) => line.split("=")[0]));

  // Keep existing lines that aren't being overwritten
  const mergedLines = existingLines.filter((line) => {
    const key = line.split("=")[0];
    return !newKeys.has(key);
  });

  // Add new lines
  mergedLines.push(...lines);

  const content = mergedLines.join("\n") + "\n";

  // Write with secure permissions
  await fs.writeFile(envPath, content, { encoding: "utf8", mode: 0o600 });

  return envPath;
}

/**
 * Get the config file path.
 */
export function getConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Get the workspace directory path.
 */
export function getWorkspaceDir(workspaceDir?: string): string {
  return resolveUserPath(workspaceDir ?? "~/.openclaw/workspace");
}
