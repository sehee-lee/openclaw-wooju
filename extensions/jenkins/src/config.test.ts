import { describe, it, expect } from "vitest";

import { parseJenkinsConfig, isParameterAllowed } from "./config.js";

describe("config", () => {
  describe("parseJenkinsConfig", () => {
    it("returns defaults for empty input", () => {
      const config = parseJenkinsConfig({});

      expect(config).toEqual({
        baseUrl: undefined,
        account: "default",
        allowedParameters: [],
        timeoutMs: 30000,
        auditLog: true,
      });
    });

    it("parses valid config", () => {
      const config = parseJenkinsConfig({
        baseUrl: "https://jenkins.example.com",
        account: "work",
        allowedParameters: ["APP_VERSION", "BUILD_NUMBER"],
        timeoutMs: 60000,
        auditLog: false,
      });

      expect(config).toEqual({
        baseUrl: "https://jenkins.example.com",
        account: "work",
        allowedParameters: ["APP_VERSION", "BUILD_NUMBER"],
        timeoutMs: 60000,
        auditLog: false,
      });
    });

    it("rejects invalid URL", () => {
      expect(() =>
        parseJenkinsConfig({
          baseUrl: "not-a-url",
        }),
      ).toThrow();
    });

    it("handles null/undefined input", () => {
      expect(parseJenkinsConfig(null)).toBeDefined();
      expect(parseJenkinsConfig(undefined)).toBeDefined();
    });

    it("handles array input", () => {
      expect(parseJenkinsConfig([])).toBeDefined();
    });
  });

  describe("isParameterAllowed", () => {
    it("returns false for empty whitelist", () => {
      expect(isParameterAllowed("APP_VERSION", [])).toBe(false);
    });

    it("returns true for allowed parameter", () => {
      expect(
        isParameterAllowed("APP_VERSION", ["APP_VERSION", "BUILD_NUMBER"]),
      ).toBe(true);
    });

    it("returns false for disallowed parameter", () => {
      expect(
        isParameterAllowed("SECRET_KEY", ["APP_VERSION", "BUILD_NUMBER"]),
      ).toBe(false);
    });

    it("is case-sensitive", () => {
      expect(isParameterAllowed("app_version", ["APP_VERSION"])).toBe(false);
    });
  });
});
