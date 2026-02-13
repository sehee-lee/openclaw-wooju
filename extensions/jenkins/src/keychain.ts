import { execSync } from "node:child_process";

const KEYCHAIN_SERVICE = "OpenClaw Jenkins";

export type JenkinsCredentials = {
  user: string;
  token: string;
};

type ExecSyncFn = typeof execSync;

/**
 * Read Jenkins credentials from environment variables.
 * Returns null if JENKINS_USER or JENKINS_TOKEN is not set.
 */
function readCredentialsFromEnv(): JenkinsCredentials | null {
  const user = process.env.JENKINS_USER?.trim();
  const token = process.env.JENKINS_TOKEN?.trim();

  if (user && token) {
    return { user, token };
  }
  return null;
}

/**
 * Read Jenkins credentials from macOS Keychain.
 * Returns null if not found or on non-macOS platforms.
 */
function readCredentialsFromKeychain(options?: {
  account?: string;
  platform?: NodeJS.Platform;
  execSync?: ExecSyncFn;
}): JenkinsCredentials | null {
  const platform = options?.platform ?? process.platform;
  if (platform !== "darwin") return null;

  const account = options?.account ?? "default";
  const execSyncImpl = options?.execSync ?? execSync;

  try {
    const result = execSyncImpl(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${account}" -w`,
      { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    );

    const data = JSON.parse(result.trim());
    const user = data?.user;
    const token = data?.token;

    if (typeof user !== "string" || !user) return null;
    if (typeof token !== "string" || !token) return null;

    return { user, token };
  } catch {
    return null;
  }
}

/**
 * Read Jenkins credentials.
 * Priority: 1) Environment variables (JENKINS_USER, JENKINS_TOKEN)
 *           2) macOS Keychain (darwin only)
 */
export function readJenkinsCredentials(options?: {
  account?: string;
  platform?: NodeJS.Platform;
  execSync?: ExecSyncFn;
}): JenkinsCredentials | null {
  // Try environment variables first (works on all platforms including sandbox)
  const envCredentials = readCredentialsFromEnv();
  if (envCredentials) {
    return envCredentials;
  }

  // Fall back to Keychain (macOS only)
  return readCredentialsFromKeychain(options);
}

/**
 * Write Jenkins credentials to macOS Keychain.
 * Uses -U flag to update if exists, otherwise creates new entry.
 * Returns true on success, false on failure.
 */
export function writeJenkinsCredentials(
  credentials: JenkinsCredentials,
  options?: {
    account?: string;
    platform?: NodeJS.Platform;
    execSync?: ExecSyncFn;
  },
): boolean {
  const platform = options?.platform ?? process.platform;
  if (platform !== "darwin") return false;

  const account = options?.account ?? "default";
  const execSyncImpl = options?.execSync ?? execSync;

  try {
    const value = JSON.stringify({ user: credentials.user, token: credentials.token });
    // Escape single quotes in the JSON value for shell safety
    const escapedValue = value.replace(/'/g, "'\"'\"'");

    execSyncImpl(
      `security add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${account}" -w '${escapedValue}'`,
      { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * Delete Jenkins credentials from macOS Keychain.
 * Returns true if deleted (or already absent), false on error.
 */
export function deleteJenkinsCredentials(options?: {
  account?: string;
  platform?: NodeJS.Platform;
  execSync?: ExecSyncFn;
}): boolean {
  const platform = options?.platform ?? process.platform;
  if (platform !== "darwin") return false;

  const account = options?.account ?? "default";
  const execSyncImpl = options?.execSync ?? execSync;

  try {
    execSyncImpl(
      `security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${account}"`,
      { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    );
    return true;
  } catch (err) {
    // If the error indicates the item doesn't exist, treat as success
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("could not be found") || message.includes("SecKeychainSearchCopyNext")) {
      return true;
    }
    return false;
  }
}

/**
 * Check if Jenkins credentials exist (env vars or Keychain).
 */
export function hasJenkinsCredentials(options?: {
  account?: string;
  platform?: NodeJS.Platform;
  execSync?: ExecSyncFn;
}): boolean {
  // Check environment variables first
  if (readCredentialsFromEnv()) {
    return true;
  }

  // Check Keychain (macOS only)
  const platform = options?.platform ?? process.platform;
  if (platform !== "darwin") return false;

  const account = options?.account ?? "default";
  const execSyncImpl = options?.execSync ?? execSync;

  try {
    // Use -g flag to check existence (will prompt, but we suppress output)
    execSyncImpl(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${account}"`,
      { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    );
    return true;
  } catch {
    return false;
  }
}
