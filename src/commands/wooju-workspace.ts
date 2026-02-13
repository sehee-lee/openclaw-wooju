import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeEnv } from "../runtime.js";
import type { WoojuTemplateSelection } from "./wooju-types.js";
import { resolveWorkspaceTemplateDir } from "../agents/workspace-templates.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
} from "../agents/workspace.js";
import { resolveSessionTranscriptsDirForAgent } from "../config/sessions.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { resolveUserPath, shortenHomePath } from "../utils.js";

export type WoojuTemplateFiles = {
  agents: string[];
  soul: string[];
  tools: string[];
  identity: string[];
  user: string[];
  bootstrap: string[];
};

function stripFrontMatter(content: string): string {
  if (!content.startsWith("---")) {
    return content;
  }
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) {
    return content;
  }
  const start = endIndex + "\n---".length;
  let trimmed = content.slice(start);
  trimmed = trimmed.replace(/^\s+/, "");
  return trimmed;
}

async function loadTemplate(name: string): Promise<string> {
  const templateDir = await resolveWorkspaceTemplateDir();
  const templatePath = path.join(templateDir, name);
  try {
    const content = await fs.readFile(templatePath, "utf-8");
    return stripFrontMatter(content);
  } catch {
    throw new Error(
      `Missing workspace template: ${name} (${templatePath}). Ensure docs/reference/templates are packaged.`,
    );
  }
}

async function loadTemplateOptional(name: string): Promise<string | null> {
  const templateDir = await resolveWorkspaceTemplateDir();
  const templatePath = path.join(templateDir, name);
  try {
    const content = await fs.readFile(templatePath, "utf-8");
    return stripFrontMatter(content);
  } catch {
    return null;
  }
}

async function loadAndMergeTemplates(
  templatePaths: string[],
  options?: { required?: boolean },
): Promise<string> {
  const contents: string[] = [];
  for (const p of templatePaths) {
    const content = options?.required ? await loadTemplate(p) : await loadTemplateOptional(p);
    if (content) {
      contents.push(content);
    }
  }
  return contents.join("\n\n---\n\n");
}

/**
 * Returns the list of template files to load for a given Wooju template selection.
 * Files are listed in order - they will be merged together.
 */
export function getWoojuTemplateFiles(selection: WoojuTemplateSelection): WoojuTemplateFiles {
  const files: WoojuTemplateFiles = {
    agents: ["wooju/base/AGENTS.base.md"],
    soul: ["wooju/base/SOUL.base.md"],
    tools: [],
    identity: [],
    user: [],
    bootstrap: ["wooju/base/BOOTSTRAP.base.md"],
  };

  // Role layer
  if (selection.role) {
    const roleDir = `wooju/roles/${selection.role}`;
    files.soul.push(`${roleDir}/SOUL.${selection.role}.md`);
    files.identity.push(`${roleDir}/IDENTITY.${selection.role}.md`);
    files.user.push(`${roleDir}/USER.${selection.role}.md`);
  }

  // Stack layer (adds stack-specific SOUL and TOOLS)
  if (selection.stack) {
    const stackDir = `wooju/stacks/${selection.stack}`;
    files.soul.push(`${stackDir}/SOUL.${selection.stack}.md`);
    files.tools.push(`${stackDir}/TOOLS.${selection.stack}.md`);
  }

  // Service layer (adds domain knowledge)
  if (selection.service) {
    files.soul.push(`wooju/services/${selection.service}/DOMAIN.${selection.service}.md`);
  }

  return files;
}

async function writeFileIfMissing(filePath: string, content: string, force = false) {
  if (force) {
    await fs.writeFile(filePath, content, { encoding: "utf-8" });
    return;
  }
  try {
    await fs.writeFile(filePath, content, {
      encoding: "utf-8",
      flag: "wx",
    });
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== "EEXIST") {
      throw err;
    }
  }
}

async function hasGitRepo(dir: string): Promise<boolean> {
  try {
    await fs.stat(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function isGitAvailable(): Promise<boolean> {
  try {
    const result = await runCommandWithTimeout(["git", "--version"], { timeoutMs: 2_000 });
    return result.code === 0;
  } catch {
    return false;
  }
}

async function ensureGitRepo(dir: string, isBrandNewWorkspace: boolean) {
  if (!isBrandNewWorkspace) {
    return;
  }
  if (await hasGitRepo(dir)) {
    return;
  }
  if (!(await isGitAvailable())) {
    return;
  }
  try {
    await runCommandWithTimeout(["git", "init"], { cwd: dir, timeoutMs: 10_000 });
  } catch {
    // Ignore git init failures; workspace creation should still succeed.
  }
}

/**
 * Ensures a workspace directory exists with Wooju template files.
 */
export async function ensureWoojuWorkspace(params: {
  dir: string;
  templateSelection: WoojuTemplateSelection;
  /** Force overwrite existing workspace files with selected template. */
  forceOverwrite?: boolean;
}): Promise<{
  dir: string;
  agentsPath: string;
  soulPath: string;
  toolsPath: string;
  identityPath: string;
  userPath: string;
  heartbeatPath: string;
  bootstrapPath: string;
}> {
  const dir = resolveUserPath(params.dir);
  await fs.mkdir(dir, { recursive: true });

  const agentsPath = path.join(dir, DEFAULT_AGENTS_FILENAME);
  const soulPath = path.join(dir, DEFAULT_SOUL_FILENAME);
  const toolsPath = path.join(dir, DEFAULT_TOOLS_FILENAME);
  const identityPath = path.join(dir, DEFAULT_IDENTITY_FILENAME);
  const userPath = path.join(dir, DEFAULT_USER_FILENAME);
  const heartbeatPath = path.join(dir, DEFAULT_HEARTBEAT_FILENAME);
  const bootstrapPath = path.join(dir, DEFAULT_BOOTSTRAP_FILENAME);

  const isBrandNewWorkspace = await (async () => {
    const paths = [agentsPath, soulPath, toolsPath, identityPath, userPath, heartbeatPath];
    const existing = await Promise.all(
      paths.map(async (p) => {
        try {
          await fs.access(p);
          return true;
        } catch {
          return false;
        }
      }),
    );
    return existing.every((v) => !v);
  })();

  // Get template files based on Wooju selection
  const templateFiles = getWoojuTemplateFiles(params.templateSelection);

  // Load and merge templates
  const agentsContent = await loadAndMergeTemplates(templateFiles.agents, { required: true });
  const soulContent = await loadAndMergeTemplates(templateFiles.soul, { required: true });

  // For tools, identity, user: use merged templates if specified, else fall back to defaults
  // If merged content is empty (files don't exist), fall back to default templates
  const toolsMerged =
    templateFiles.tools.length > 0 ? await loadAndMergeTemplates(templateFiles.tools) : "";
  const toolsContent = toolsMerged.trim() || (await loadTemplate(DEFAULT_TOOLS_FILENAME));

  const identityMerged =
    templateFiles.identity.length > 0 ? await loadAndMergeTemplates(templateFiles.identity) : "";
  const identityContent = identityMerged.trim() || (await loadTemplate(DEFAULT_IDENTITY_FILENAME));

  const userMerged =
    templateFiles.user.length > 0 ? await loadAndMergeTemplates(templateFiles.user) : "";
  const userContent = userMerged.trim() || (await loadTemplate(DEFAULT_USER_FILENAME));

  // Heartbeat always uses standard template
  const heartbeatTemplate = await loadTemplate(DEFAULT_HEARTBEAT_FILENAME);

  // Bootstrap uses template-specific file if available
  const bootstrapMerged =
    templateFiles.bootstrap.length > 0 ? await loadAndMergeTemplates(templateFiles.bootstrap) : "";
  const bootstrapTemplate =
    bootstrapMerged.trim() || (await loadTemplate(DEFAULT_BOOTSTRAP_FILENAME));

  const force = params.forceOverwrite ?? false;
  await writeFileIfMissing(agentsPath, agentsContent, force);
  await writeFileIfMissing(soulPath, soulContent, force);
  await writeFileIfMissing(toolsPath, toolsContent, force);
  await writeFileIfMissing(identityPath, identityContent, force);
  await writeFileIfMissing(userPath, userContent, force);
  await writeFileIfMissing(heartbeatPath, heartbeatTemplate, force);
  if (isBrandNewWorkspace || force) {
    await writeFileIfMissing(bootstrapPath, bootstrapTemplate, force);
  }
  await ensureGitRepo(dir, isBrandNewWorkspace);

  return {
    dir,
    agentsPath,
    soulPath,
    toolsPath,
    identityPath,
    userPath,
    heartbeatPath,
    bootstrapPath,
  };
}

/**
 * Ensures Wooju workspace and sessions directories exist.
 */
export async function ensureWoojuWorkspaceAndSessions(
  workspaceDir: string,
  runtime: RuntimeEnv,
  options: {
    templateSelection: WoojuTemplateSelection;
    forceOverwrite?: boolean;
    agentId?: string;
  },
) {
  const ws = await ensureWoojuWorkspace({
    dir: workspaceDir,
    templateSelection: options.templateSelection,
    forceOverwrite: options.forceOverwrite,
  });
  runtime.log(`Workspace OK: ${shortenHomePath(ws.dir)}`);
  const sessionsDir = resolveSessionTranscriptsDirForAgent(options.agentId);
  await fs.mkdir(sessionsDir, { recursive: true });
  runtime.log(`Sessions OK: ${shortenHomePath(sessionsDir)}`);
}
