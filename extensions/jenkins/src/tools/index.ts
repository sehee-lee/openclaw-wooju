import { Type } from "@sinclair/typebox";

import type { JenkinsClient } from "../client.js";
import type { JenkinsConfig } from "../config.js";
import { isParameterAllowed } from "../config.js";

/** Safely convert unknown value to string */
function toStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return fallback;
  return fallback;
}

type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

type ToolContext = {
  client: JenkinsClient;
  config: JenkinsConfig;
  logger: Logger;
};

function json(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function auditLog(logger: Logger, config: JenkinsConfig, tool: string, params: unknown) {
  if (!config.auditLog) return;
  logger.info(`[jenkins] ${tool}: ${JSON.stringify(params)}`);
}

/**
 * Create the jenkins_list_jobs tool.
 */
export function createListJobsTool(ctx: ToolContext) {
  return {
    name: "jenkins_list_jobs",
    description:
      "List all jobs in a Jenkins folder (or root if no folder specified). Returns job names, URLs, status colors, and whether each item is a job or folder.",
    parameters: Type.Object({
      folder: Type.Optional(
        Type.String({
          description:
            "Folder path to list jobs from (e.g., 'my-folder' or 'parent/child'). Leave empty for root.",
        }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const folder = typeof params.folder === "string" ? params.folder.trim() : undefined;

      auditLog(ctx.logger, ctx.config, "jenkins_list_jobs", { folder: folder ?? "(root)" });

      const jobs = await ctx.client.listJobs(folder || undefined);
      return json({ folder: folder ?? "(root)", jobs, count: jobs.length });
    },
  };
}

/**
 * Create the jenkins_get_job_info tool.
 */
export function createGetJobInfoTool(ctx: ToolContext) {
  return {
    name: "jenkins_get_job_info",
    description:
      "Get information about a Jenkins job including its parameters, last build status, and configuration.",
    parameters: Type.Object({
      job: Type.String({
        description: "Job path (e.g., 'my-project' or 'folder/my-project')",
      }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const job = toStr(params.job).trim();
      if (!job) throw new Error("job parameter is required");

      auditLog(ctx.logger, ctx.config, "jenkins_get_job_info", { job });

      const info = await ctx.client.getJobInfo(job);
      return json(info);
    },
  };
}

/**
 * Create the jenkins_list_builds tool.
 */
export function createListBuildsTool(ctx: ToolContext) {
  return {
    name: "jenkins_list_builds",
    description: "List recent builds for a Jenkins job with their status and timestamps.",
    parameters: Type.Object({
      job: Type.String({
        description: "Job path (e.g., 'my-project' or 'folder/my-project')",
      }),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum number of builds to return (default: 10)",
        }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const job = toStr(params.job).trim();
      if (!job) throw new Error("job parameter is required");

      const limit = typeof params.limit === "number" ? params.limit : 10;

      auditLog(ctx.logger, ctx.config, "jenkins_list_builds", { job, limit });

      const builds = await ctx.client.listBuilds(job, { limit });
      return json({ job, builds });
    },
  };
}

/**
 * Create the jenkins_get_build_info tool.
 */
export function createGetBuildInfoTool(ctx: ToolContext) {
  return {
    name: "jenkins_get_build_info",
    description:
      "Get detailed information about a specific Jenkins build including parameters used and result.",
    parameters: Type.Object({
      job: Type.String({
        description: "Job path (e.g., 'my-project' or 'folder/my-project')",
      }),
      build: Type.Number({
        description: "Build number",
      }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const job = toStr(params.job).trim();
      if (!job) throw new Error("job parameter is required");

      const build = params.build;
      if (typeof build !== "number") throw new Error("build parameter is required");

      auditLog(ctx.logger, ctx.config, "jenkins_get_build_info", { job, build });

      const info = await ctx.client.getBuildInfo(job, build);
      return json(info);
    },
  };
}

/**
 * Create the jenkins_trigger_build tool.
 */
export function createTriggerBuildTool(ctx: ToolContext) {
  return {
    name: "jenkins_trigger_build",
    description:
      "Trigger a new build for a Jenkins job. Parameters can only use values from the allowed whitelist.",
    parameters: Type.Object({
      job: Type.String({
        description: "Job path (e.g., 'my-project' or 'folder/my-project')",
      }),
      parameters: Type.Optional(
        Type.Record(Type.String(), Type.String(), {
          description: "Build parameters as key-value pairs",
        }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const job = toStr(params.job).trim();
      if (!job) throw new Error("job parameter is required");

      const buildParams = params.parameters as Record<string, string> | undefined;

      // Validate parameters against whitelist
      if (buildParams) {
        for (const paramName of Object.keys(buildParams)) {
          if (!isParameterAllowed(paramName, ctx.config.allowedParameters)) {
            throw new Error(
              `Parameter "${paramName}" is not in the allowed parameters whitelist. ` +
                `Allowed: ${ctx.config.allowedParameters.join(", ") || "(none)"}`,
            );
          }
        }
      }

      auditLog(ctx.logger, ctx.config, "jenkins_trigger_build", { job, parameters: buildParams });

      const result = await ctx.client.triggerBuild(job, buildParams);
      return json({ job, ...result });
    },
  };
}

/**
 * Create the jenkins_update_parameter tool.
 */
export function createUpdateParameterTool(ctx: ToolContext) {
  return {
    name: "jenkins_update_parameter",
    description:
      "Update a job's default parameter value. Only parameters in the whitelist can be modified.",
    parameters: Type.Object({
      job: Type.String({
        description: "Job path (e.g., 'my-project' or 'folder/my-project')",
      }),
      parameter: Type.String({
        description: "Parameter name to update",
      }),
      value: Type.String({
        description: "New default value for the parameter",
      }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const job = toStr(params.job).trim();
      if (!job) throw new Error("job parameter is required");

      const paramName = toStr(params.parameter).trim();
      if (!paramName) throw new Error("parameter name is required");

      const value = toStr(params.value);

      // Validate parameter against whitelist
      if (!isParameterAllowed(paramName, ctx.config.allowedParameters)) {
        throw new Error(
          `Parameter "${paramName}" is not in the allowed parameters whitelist. ` +
            `Allowed: ${ctx.config.allowedParameters.join(", ") || "(none)"}`,
        );
      }

      auditLog(ctx.logger, ctx.config, "jenkins_update_parameter", {
        job,
        parameter: paramName,
        value,
      });

      const result = await ctx.client.updateParameter(job, paramName, value);
      return json({ job, parameter: paramName, value, ...result });
    },
  };
}

/**
 * Create all Jenkins tools.
 */
export function createJenkinsTools(ctx: ToolContext) {
  return [
    createListJobsTool(ctx),
    createGetJobInfoTool(ctx),
    createListBuildsTool(ctx),
    createGetBuildInfoTool(ctx),
    createTriggerBuildTool(ctx),
    createUpdateParameterTool(ctx),
  ];
}
