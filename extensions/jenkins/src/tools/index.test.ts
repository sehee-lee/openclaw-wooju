import { describe, it, expect, vi } from "vitest";

import type { JenkinsClient } from "../client.js";
import type { JenkinsConfig } from "../config.js";
import {
  createGetJobInfoTool,
  createListBuildsTool,
  createGetBuildInfoTool,
  createTriggerBuildTool,
  createUpdateParameterTool,
} from "./index.js";

describe("Jenkins tools", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const mockConfig: JenkinsConfig = {
    baseUrl: "https://jenkins.example.com",
    account: "default",
    allowedParameters: ["APP_VERSION", "BUILD_NUMBER"],
    timeoutMs: 30000,
    auditLog: true,
  };

  describe("jenkins_get_job_info", () => {
    it("calls client.getJobInfo", async () => {
      const getJobInfo = vi.fn().mockResolvedValue({
        name: "my-job",
        url: "https://jenkins.example.com/job/my-job/",
        buildable: true,
        inQueue: false,
      });
      const mockClient = { getJobInfo } as unknown as JenkinsClient;

      const tool = createGetJobInfoTool({
        client: mockClient,
        config: mockConfig,
        logger: mockLogger,
      });

      const result = await tool.execute("id", { job: "my-job" });

      expect(getJobInfo).toHaveBeenCalledWith("my-job");
      expect(result.details).toMatchObject({ name: "my-job" });
    });

    it("throws on missing job parameter", async () => {
      const mockClient = { getJobInfo: vi.fn() } as unknown as JenkinsClient;
      const tool = createGetJobInfoTool({
        client: mockClient,
        config: mockConfig,
        logger: mockLogger,
      });

      await expect(tool.execute("id", {})).rejects.toThrow("job parameter is required");
    });

    it("logs when auditLog is enabled", async () => {
      const getJobInfo = vi.fn().mockResolvedValue({ name: "my-job" });
      const mockClient = { getJobInfo } as unknown as JenkinsClient;

      const tool = createGetJobInfoTool({
        client: mockClient,
        config: mockConfig,
        logger: mockLogger,
      });

      await tool.execute("id", { job: "my-job" });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("jenkins_get_job_info"),
      );
    });
  });

  describe("jenkins_list_builds", () => {
    it("calls client.listBuilds with default limit", async () => {
      const listBuilds = vi.fn().mockResolvedValue([{ number: 42 }]);
      const mockClient = { listBuilds } as unknown as JenkinsClient;

      const tool = createListBuildsTool({
        client: mockClient,
        config: mockConfig,
        logger: mockLogger,
      });

      await tool.execute("id", { job: "my-job" });

      expect(listBuilds).toHaveBeenCalledWith("my-job", { limit: 10 });
    });

    it("uses custom limit", async () => {
      const listBuilds = vi.fn().mockResolvedValue([]);
      const mockClient = { listBuilds } as unknown as JenkinsClient;

      const tool = createListBuildsTool({
        client: mockClient,
        config: mockConfig,
        logger: mockLogger,
      });

      await tool.execute("id", { job: "my-job", limit: 5 });

      expect(listBuilds).toHaveBeenCalledWith("my-job", { limit: 5 });
    });
  });

  describe("jenkins_get_build_info", () => {
    it("calls client.getBuildInfo", async () => {
      const getBuildInfo = vi.fn().mockResolvedValue({ number: 42, result: "SUCCESS" });
      const mockClient = { getBuildInfo } as unknown as JenkinsClient;

      const tool = createGetBuildInfoTool({
        client: mockClient,
        config: mockConfig,
        logger: mockLogger,
      });

      await tool.execute("id", { job: "my-job", build: 42 });

      expect(getBuildInfo).toHaveBeenCalledWith("my-job", 42);
    });

    it("throws on missing build parameter", async () => {
      const mockClient = { getBuildInfo: vi.fn() } as unknown as JenkinsClient;
      const tool = createGetBuildInfoTool({
        client: mockClient,
        config: mockConfig,
        logger: mockLogger,
      });

      await expect(tool.execute("id", { job: "my-job" })).rejects.toThrow(
        "build parameter is required",
      );
    });
  });

  describe("jenkins_trigger_build", () => {
    it("calls client.triggerBuild without parameters", async () => {
      const triggerBuild = vi.fn().mockResolvedValue({ queued: true });
      const mockClient = { triggerBuild } as unknown as JenkinsClient;

      const tool = createTriggerBuildTool({
        client: mockClient,
        config: mockConfig,
        logger: mockLogger,
      });

      await tool.execute("id", { job: "my-job" });

      expect(triggerBuild).toHaveBeenCalledWith("my-job", undefined);
    });

    it("validates parameters against whitelist", async () => {
      const mockClient = { triggerBuild: vi.fn() } as unknown as JenkinsClient;
      const tool = createTriggerBuildTool({
        client: mockClient,
        config: mockConfig,
        logger: mockLogger,
      });

      await expect(
        tool.execute("id", {
          job: "my-job",
          parameters: { SECRET_KEY: "bad-param" },
        }),
      ).rejects.toThrow("not in the allowed parameters whitelist");
    });

    it("allows whitelisted parameters", async () => {
      const triggerBuild = vi.fn().mockResolvedValue({ queued: true });
      const mockClient = { triggerBuild } as unknown as JenkinsClient;

      const tool = createTriggerBuildTool({
        client: mockClient,
        config: mockConfig,
        logger: mockLogger,
      });

      await tool.execute("id", {
        job: "my-job",
        parameters: { APP_VERSION: "1.0.0" },
      });

      expect(triggerBuild).toHaveBeenCalledWith("my-job", {
        APP_VERSION: "1.0.0",
      });
    });
  });

  describe("jenkins_update_parameter", () => {
    it("validates parameter against whitelist", async () => {
      const mockClient = { updateParameter: vi.fn() } as unknown as JenkinsClient;
      const tool = createUpdateParameterTool({
        client: mockClient,
        config: mockConfig,
        logger: mockLogger,
      });

      await expect(
        tool.execute("id", {
          job: "my-job",
          parameter: "SECRET_KEY",
          value: "new-value",
        }),
      ).rejects.toThrow("not in the allowed parameters whitelist");
    });

    it("allows whitelisted parameter updates", async () => {
      const updateParameter = vi.fn().mockResolvedValue({ updated: true });
      const mockClient = { updateParameter } as unknown as JenkinsClient;

      const tool = createUpdateParameterTool({
        client: mockClient,
        config: mockConfig,
        logger: mockLogger,
      });

      await tool.execute("id", {
        job: "my-job",
        parameter: "APP_VERSION",
        value: "2.0.0",
      });

      expect(updateParameter).toHaveBeenCalledWith(
        "my-job",
        "APP_VERSION",
        "2.0.0",
      );
    });

    it("denies all updates when whitelist is empty", async () => {
      const mockClient = { updateParameter: vi.fn() } as unknown as JenkinsClient;
      const tool = createUpdateParameterTool({
        client: mockClient,
        config: { ...mockConfig, allowedParameters: [] },
        logger: mockLogger,
      });

      await expect(
        tool.execute("id", {
          job: "my-job",
          parameter: "APP_VERSION",
          value: "2.0.0",
        }),
      ).rejects.toThrow("not in the allowed parameters whitelist");
    });
  });
});
