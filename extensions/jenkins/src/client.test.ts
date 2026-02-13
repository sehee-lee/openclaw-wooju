import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { JenkinsClient } from "./client.js";
import type { JenkinsConfig } from "./config.js";

describe("JenkinsClient", () => {
  const mockConfig: JenkinsConfig = {
    baseUrl: "https://jenkins.example.com",
    account: "default",
    allowedParameters: [],
    timeoutMs: 5000,
    auditLog: true,
  };

  const mockCredentials = {
    user: "admin",
    token: "api-token",
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("constructor", () => {
    it("throws if baseUrl is missing", () => {
      expect(
        () =>
          new JenkinsClient({
            config: { ...mockConfig, baseUrl: undefined },
            credentials: mockCredentials,
          }),
      ).toThrow("baseUrl is required");
    });

    it("creates client with valid config", () => {
      const client = new JenkinsClient({
        config: mockConfig,
        credentials: mockCredentials,
      });
      expect(client).toBeInstanceOf(JenkinsClient);
    });
  });

  describe("getJobInfo", () => {
    it("fetches job information", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({
          name: "my-job",
          url: "https://jenkins.example.com/job/my-job/",
          buildable: true,
          inQueue: false,
          lastBuild: { number: 42, url: "https://jenkins.example.com/job/my-job/42/" },
        }),
      });

      const client = new JenkinsClient({
        config: mockConfig,
        credentials: mockCredentials,
      });

      const info = await client.getJobInfo("my-job");

      expect(info.name).toBe("my-job");
      expect(info.buildable).toBe(true);
      expect(info.lastBuild?.number).toBe(42);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/job/my-job/api/json"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Basic"),
          }),
        }),
      );
    });

    it("handles folder/job paths", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({
          name: "my-job",
          url: "https://jenkins.example.com/job/folder/job/my-job/",
          buildable: true,
          inQueue: false,
        }),
      });

      const client = new JenkinsClient({
        config: mockConfig,
        credentials: mockCredentials,
      });

      await client.getJobInfo("folder/my-job");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/job/folder/job/my-job/api/json"),
        expect.any(Object),
      );
    });
  });

  describe("listBuilds", () => {
    it("fetches build list", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({
          builds: [
            { number: 42, url: "...", result: "SUCCESS", timestamp: 1234567890, duration: 60000 },
            { number: 41, url: "...", result: "FAILURE", timestamp: 1234567000, duration: 30000 },
          ],
        }),
      });

      const client = new JenkinsClient({
        config: mockConfig,
        credentials: mockCredentials,
      });

      const builds = await client.listBuilds("my-job", { limit: 5 });

      expect(builds).toHaveLength(2);
      expect(builds[0]?.number).toBe(42);
      expect(builds[0]?.result).toBe("SUCCESS");
    });
  });

  describe("getBuildInfo", () => {
    it("fetches build details", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({
          number: 42,
          url: "https://jenkins.example.com/job/my-job/42/",
          result: "SUCCESS",
          building: false,
          timestamp: 1234567890,
          duration: 60000,
          actions: [
            {
              parameters: [
                { name: "APP_VERSION", value: "1.0.0" },
              ],
            },
          ],
        }),
      });

      const client = new JenkinsClient({
        config: mockConfig,
        credentials: mockCredentials,
      });

      const build = await client.getBuildInfo("my-job", 42);

      expect(build.number).toBe(42);
      expect(build.result).toBe("SUCCESS");
      expect(build.parameters).toEqual([{ name: "APP_VERSION", value: "1.0.0" }]);
    });
  });

  describe("triggerBuild", () => {
    it("triggers a build without parameters", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({}),
      });

      const client = new JenkinsClient({
        config: mockConfig,
        credentials: mockCredentials,
      });

      const result = await client.triggerBuild("my-job");

      expect(result.queued).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/job/my-job/build"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("triggers a build with parameters", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({}),
      });

      const client = new JenkinsClient({
        config: mockConfig,
        credentials: mockCredentials,
      });

      await client.triggerBuild("my-job", { APP_VERSION: "1.0.0" });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/job/my-job/buildWithParameters"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("testConnection", () => {
    it("returns ok on success with /me/api/json", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ fullName: "admin" }),
      });

      const client = new JenkinsClient({
        config: mockConfig,
        credentials: mockCredentials,
      });

      const result = await client.testConnection();

      expect(result.ok).toBe(true);
      expect(result.version).toBe("Authenticated as admin");
    });

    it("falls back to /api/json on /me failure", async () => {
      // First call to /me/api/json fails
      fetchMock.mockRejectedValueOnce(new Error("Unauthorized"));
      // Second call to /api/json succeeds
      fetchMock.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ nodeDescription: "Jenkins 2.400" }),
      });

      const client = new JenkinsClient({
        config: mockConfig,
        credentials: mockCredentials,
      });

      const result = await client.testConnection();

      expect(result.ok).toBe(true);
      expect(result.version).toBe("Jenkins 2.400");
    });

    it("returns error on failure", async () => {
      // Both calls fail
      fetchMock.mockRejectedValueOnce(new Error("Connection refused"));
      fetchMock.mockRejectedValueOnce(new Error("Connection refused"));

      const client = new JenkinsClient({
        config: mockConfig,
        credentials: mockCredentials,
      });

      const result = await client.testConnection();

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Connection refused");
    });
  });

  describe("error handling", () => {
    it("throws on non-ok response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Invalid credentials",
      });

      const client = new JenkinsClient({
        config: mockConfig,
        credentials: mockCredentials,
      });

      await expect(client.getJobInfo("my-job")).rejects.toThrow("401 Unauthorized");
    });
  });
});
