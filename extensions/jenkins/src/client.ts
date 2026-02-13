import type { JenkinsConfig } from "./config.js";
import type { JenkinsCredentials } from "./keychain.js";

/** Safely convert unknown value to string */
function toStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return fallback;
  return fallback;
}

export type JenkinsJobInfo = {
  name: string;
  url: string;
  description?: string;
  buildable: boolean;
  inQueue: boolean;
  lastBuild?: { number: number; url: string };
  lastSuccessfulBuild?: { number: number; url: string };
  lastFailedBuild?: { number: number; url: string };
  parameters?: JenkinsParameter[];
};

export type JenkinsParameter = {
  name: string;
  type: string;
  description?: string;
  defaultValue?: string;
  choices?: string[];
};

export type JenkinsBuildInfo = {
  number: number;
  url: string;
  result?: string;
  building: boolean;
  timestamp: number;
  duration: number;
  displayName?: string;
  description?: string;
  parameters?: Array<{ name: string; value: string }>;
};

export type JenkinsBuildListItem = {
  number: number;
  url: string;
  result?: string;
  timestamp: number;
  duration: number;
};

export type JenkinsJobListItem = {
  name: string;
  url: string;
  color?: string;
  /** "job" for regular jobs, "folder" for folders */
  type: "job" | "folder";
};

export type JenkinsClientOptions = {
  config: JenkinsConfig;
  credentials: JenkinsCredentials;
  logger?: {
    debug?: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

/**
 * Jenkins API client.
 * Uses Basic Auth with user/token credentials.
 */
export class JenkinsClient {
  private baseUrl: string;
  private auth: string;
  private timeoutMs: number;
  private logger?: JenkinsClientOptions["logger"];

  constructor(options: JenkinsClientOptions) {
    const url = options.config.baseUrl;
    if (!url) {
      throw new Error("Jenkins baseUrl is required");
    }
    this.baseUrl = url.replace(/\/$/, "");
    this.auth = Buffer.from(
      `${options.credentials.user}:${options.credentials.token}`,
    ).toString("base64");
    this.timeoutMs = options.config.timeoutMs;
    this.logger = options.logger;
  }

  private async request<T>(
    path: string,
    options?: { method?: string; body?: unknown },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const method = options?.method ?? "GET";

    this.logger?.debug?.(`Jenkins API: ${method} ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        Authorization: `Basic ${this.auth}`,
        Accept: "application/json",
      };

      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (options?.body) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        init.body =
          typeof options.body === "string"
            ? options.body
            : new URLSearchParams(options.body as Record<string, string>).toString();
      }

      const response = await fetch(url, init);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Jenkins API error: ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 200)}` : ""}`,
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        return (await response.json()) as T;
      }

      // Some Jenkins endpoints return empty or non-JSON responses
      return {} as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * List jobs in a folder (or root if no path specified).
   */
  async listJobs(folderPath?: string): Promise<JenkinsJobListItem[]> {
    const basePath = folderPath ? this.normalizeJobPath(folderPath) : "";
    const data = await this.request<Record<string, unknown>>(
      `${basePath}/api/json?tree=jobs[name,url,color,_class]`,
    );

    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    return jobs.map((j: Record<string, unknown>) => {
      const cls = toStr(j._class);
      const isFolder =
        cls.includes("Folder") ||
        cls.includes("OrganizationFolder") ||
        cls.includes("WorkflowMultiBranchProject");
      return {
        name: toStr(j.name),
        url: toStr(j.url),
        color: typeof j.color === "string" ? j.color : undefined,
        type: isFolder ? "folder" : "job",
      } as JenkinsJobListItem;
    });
  }

  /**
   * Get job information including parameters.
   */
  async getJobInfo(jobPath: string): Promise<JenkinsJobInfo> {
    const normalizedPath = this.normalizeJobPath(jobPath);
    const data = await this.request<Record<string, unknown>>(
      `${normalizedPath}/api/json?tree=name,url,description,buildable,inQueue,lastBuild[number,url],lastSuccessfulBuild[number,url],lastFailedBuild[number,url],property[parameterDefinitions[name,type,description,defaultParameterValue[value],choices]]`,
    );

    const parameters = this.extractParameters(data);

    return {
      name: toStr(data.name),
      url: toStr(data.url),
      description: typeof data.description === "string" ? data.description : undefined,
      buildable: Boolean(data.buildable),
      inQueue: Boolean(data.inQueue),
      lastBuild: this.extractBuildRef(data.lastBuild),
      lastSuccessfulBuild: this.extractBuildRef(data.lastSuccessfulBuild),
      lastFailedBuild: this.extractBuildRef(data.lastFailedBuild),
      parameters,
    };
  }

  /**
   * List recent builds for a job.
   */
  async listBuilds(
    jobPath: string,
    options?: { limit?: number },
  ): Promise<JenkinsBuildListItem[]> {
    const limit = options?.limit ?? 10;
    const normalizedPath = this.normalizeJobPath(jobPath);
    const data = await this.request<Record<string, unknown>>(
      `${normalizedPath}/api/json?tree=builds[number,url,result,timestamp,duration]{0,${limit}}`,
    );

    const builds = Array.isArray(data.builds) ? data.builds : [];
    return builds.map((b: Record<string, unknown>) => ({
      number: Number(b.number ?? 0),
      url: toStr(b.url),
      result: typeof b.result === "string" ? b.result : undefined,
      timestamp: Number(b.timestamp ?? 0),
      duration: Number(b.duration ?? 0),
    }));
  }

  /**
   * Get detailed build information.
   */
  async getBuildInfo(jobPath: string, buildNumber: number): Promise<JenkinsBuildInfo> {
    const normalizedPath = this.normalizeJobPath(jobPath);
    const data = await this.request<Record<string, unknown>>(
      `${normalizedPath}/${buildNumber}/api/json?tree=number,url,result,building,timestamp,duration,displayName,description,actions[parameters[name,value]]`,
    );

    const parameters = this.extractBuildParameters(data);

    return {
      number: Number(data.number ?? buildNumber),
      url: toStr(data.url),
      result: typeof data.result === "string" ? data.result : undefined,
      building: Boolean(data.building),
      timestamp: Number(data.timestamp ?? 0),
      duration: Number(data.duration ?? 0),
      displayName: typeof data.displayName === "string" ? data.displayName : undefined,
      description: typeof data.description === "string" ? data.description : undefined,
      parameters,
    };
  }

  /**
   * Trigger a new build with optional parameters.
   */
  async triggerBuild(
    jobPath: string,
    parameters?: Record<string, string>,
  ): Promise<{ queued: boolean; queueUrl?: string }> {
    const normalizedPath = this.normalizeJobPath(jobPath);
    const endpoint = parameters && Object.keys(parameters).length > 0
      ? `${normalizedPath}/buildWithParameters`
      : `${normalizedPath}/build`;

    const response = await this.request<Record<string, unknown>>(endpoint, {
      method: "POST",
      body: parameters,
    });

    return {
      queued: true,
      queueUrl: typeof response.queueUrl === "string" ? response.queueUrl : undefined,
    };
  }

  /**
   * Update a job's default parameter value.
   * This requires config.xml manipulation.
   */
  async updateParameter(
    jobPath: string,
    paramName: string,
    newValue: string,
  ): Promise<{ updated: boolean }> {
    const normalizedPath = this.normalizeJobPath(jobPath);

    // Fetch current config.xml
    const configUrl = `${normalizedPath}/config.xml`;
    const configResponse = await fetch(`${this.baseUrl}${configUrl}`, {
      headers: { Authorization: `Basic ${this.auth}` },
    });

    if (!configResponse.ok) {
      throw new Error(`Failed to fetch job config: ${configResponse.status}`);
    }

    let configXml = await configResponse.text();

    // Find and update the parameter's default value
    // This is a simplified approach - in production you'd want proper XML parsing
    const paramPattern = new RegExp(
      `(<hudson\\.model\\.StringParameterDefinition>\\s*<name>${this.escapeRegex(paramName)}</name>.*?<defaultValue>)(.*?)(</defaultValue>)`,
      "s",
    );

    if (!paramPattern.test(configXml)) {
      throw new Error(`Parameter "${paramName}" not found in job config`);
    }

    configXml = configXml.replace(paramPattern, `$1${this.escapeXml(newValue)}$3`);

    // POST updated config
    const updateResponse = await fetch(`${this.baseUrl}${configUrl}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.auth}`,
        "Content-Type": "application/xml",
      },
      body: configXml,
    });

    if (!updateResponse.ok) {
      throw new Error(`Failed to update job config: ${updateResponse.status}`);
    }

    return { updated: true };
  }

  /**
   * Test connection to Jenkins server.
   */
  async testConnection(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      // Try /me/api/json first (requires auth), then fall back to /api/json
      try {
        const meData = await this.request<Record<string, unknown>>("/me/api/json");
        const fullName = typeof meData.fullName === "string" ? meData.fullName : undefined;
        return { ok: true, version: fullName ? `Authenticated as ${fullName}` : "Authenticated" };
      } catch {
        // Fall back to basic API check
        const data = await this.request<Record<string, unknown>>("/api/json?tree=nodeDescription");
        return { ok: true, version: typeof data.nodeDescription === "string" ? data.nodeDescription : undefined };
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private normalizeJobPath(jobPath: string): string {
    // Convert "folder/job" or "folder/subfolder/job" to Jenkins URL path
    // e.g., "my-folder/my-job" -> "/job/my-folder/job/my-job"
    const parts = jobPath.split("/").filter(Boolean);
    return parts.map((p) => `/job/${encodeURIComponent(p)}`).join("");
  }

  private extractBuildRef(
    data: unknown,
  ): { number: number; url: string } | undefined {
    if (!data || typeof data !== "object") return undefined;
    const obj = data as Record<string, unknown>;
    if (typeof obj.number !== "number") return undefined;
    return {
      number: obj.number,
      url: toStr(obj.url),
    };
  }

  private extractParameters(data: Record<string, unknown>): JenkinsParameter[] | undefined {
    const property = data.property;
    if (!Array.isArray(property)) return undefined;

    const params: JenkinsParameter[] = [];
    for (const prop of property) {
      if (!prop || typeof prop !== "object") continue;
      const defs = (prop as Record<string, unknown>).parameterDefinitions;
      if (!Array.isArray(defs)) continue;

      for (const def of defs) {
        if (!def || typeof def !== "object") continue;
        const d = def as Record<string, unknown>;
        const defaultVal = d.defaultParameterValue as Record<string, unknown> | undefined;
        params.push({
          name: toStr(d.name),
          type: toStr(d.type).replace(/.*\./, ""),
          description: typeof d.description === "string" ? d.description : undefined,
          defaultValue: defaultVal?.value !== undefined ? toStr(defaultVal.value) : undefined,
          choices: Array.isArray(d.choices) ? d.choices.map((c) => toStr(c)) : undefined,
        });
      }
    }

    return params.length > 0 ? params : undefined;
  }

  private extractBuildParameters(
    data: Record<string, unknown>,
  ): Array<{ name: string; value: string }> | undefined {
    const actions = data.actions;
    if (!Array.isArray(actions)) return undefined;

    for (const action of actions) {
      if (!action || typeof action !== "object") continue;
      const params = (action as Record<string, unknown>).parameters;
      if (!Array.isArray(params)) continue;

      return params
        .filter((p): p is Record<string, unknown> => p && typeof p === "object")
        .map((p) => ({
          name: toStr(p.name),
          value: toStr(p.value),
        }));
    }

    return undefined;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}

/**
 * Create a Jenkins client from config and credentials.
 */
export function createJenkinsClient(
  options: JenkinsClientOptions,
): JenkinsClient {
  return new JenkinsClient(options);
}
