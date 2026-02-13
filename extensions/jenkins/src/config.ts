import { z } from "zod";

/**
 * Zod schema for Jenkins plugin configuration.
 */
export const JenkinsConfigSchema = z.object({
  /** Jenkins server base URL (e.g., https://jenkins.company.com) */
  baseUrl: z.string().url().optional(),

  /** Keychain account name for credential lookup (default: "default") */
  account: z.string().default("default"),

  /** Parameters that agents are allowed to modify (whitelist) */
  allowedParameters: z.array(z.string()).default([]),

  /** Request timeout in milliseconds */
  timeoutMs: z.number().int().positive().default(30000),

  /** Enable audit logging for all Jenkins tool calls */
  auditLog: z.boolean().default(true),
});

export type JenkinsConfig = z.infer<typeof JenkinsConfigSchema>;

/**
 * Parse and validate Jenkins plugin config.
 * Returns a config object with defaults applied.
 */
export function parseJenkinsConfig(raw: unknown): JenkinsConfig {
  const input =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  return JenkinsConfigSchema.parse(input);
}

/**
 * Validate that a parameter name is allowed for modification.
 */
export function isParameterAllowed(
  paramName: string,
  allowedParameters: string[],
): boolean {
  if (allowedParameters.length === 0) {
    // If no whitelist, deny all parameter updates
    return false;
  }
  return allowedParameters.includes(paramName);
}

/**
 * UI hints for configuration fields.
 */
export const jenkinsConfigUiHints = {
  baseUrl: {
    label: "Jenkins URL",
    help: "Base URL of your Jenkins server (e.g., https://jenkins.company.com)",
    placeholder: "https://jenkins.company.com",
  },
  account: {
    label: "Keychain Account",
    help: "Keychain account name for storing credentials",
    advanced: true,
  },
  allowedParameters: {
    label: "Allowed Parameters",
    help: "List of build parameters that agents can modify (whitelist)",
  },
  timeoutMs: {
    label: "Timeout (ms)",
    help: "Request timeout in milliseconds",
    advanced: true,
  },
  auditLog: {
    label: "Audit Logging",
    help: "Log all Jenkins tool calls for security auditing",
    advanced: true,
  },
};
