import { describe, it, expect, vi } from "vitest";

import {
  readJenkinsCredentials,
  writeJenkinsCredentials,
  deleteJenkinsCredentials,
  hasJenkinsCredentials,
} from "./keychain.js";

describe("keychain", () => {
  describe("readJenkinsCredentials", () => {
    it("returns null on non-darwin platforms", () => {
      const result = readJenkinsCredentials({ platform: "linux" });
      expect(result).toBeNull();
    });

    it("reads credentials from keychain on darwin", () => {
      const mockExecSync = vi.fn().mockReturnValue(
        JSON.stringify({ user: "admin", token: "secret123" }),
      );

      const result = readJenkinsCredentials({
        platform: "darwin",
        execSync: mockExecSync,
      });

      expect(result).toEqual({ user: "admin", token: "secret123" });
      expect(mockExecSync).toHaveBeenCalledWith(
        'security find-generic-password -s "OpenClaw Jenkins" -a "default" -w',
        expect.any(Object),
      );
    });

    it("returns null if keychain item not found", () => {
      const mockExecSync = vi.fn().mockImplementation(() => {
        throw new Error("could not be found");
      });

      const result = readJenkinsCredentials({
        platform: "darwin",
        execSync: mockExecSync,
      });

      expect(result).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      const mockExecSync = vi.fn().mockReturnValue("not json");

      const result = readJenkinsCredentials({
        platform: "darwin",
        execSync: mockExecSync,
      });

      expect(result).toBeNull();
    });

    it("returns null if user is missing", () => {
      const mockExecSync = vi.fn().mockReturnValue(
        JSON.stringify({ token: "secret123" }),
      );

      const result = readJenkinsCredentials({
        platform: "darwin",
        execSync: mockExecSync,
      });

      expect(result).toBeNull();
    });

    it("uses custom account name", () => {
      const mockExecSync = vi.fn().mockReturnValue(
        JSON.stringify({ user: "admin", token: "secret123" }),
      );

      readJenkinsCredentials({
        platform: "darwin",
        account: "work",
        execSync: mockExecSync,
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        'security find-generic-password -s "OpenClaw Jenkins" -a "work" -w',
        expect.any(Object),
      );
    });
  });

  describe("writeJenkinsCredentials", () => {
    it("returns false on non-darwin platforms", () => {
      const result = writeJenkinsCredentials(
        { user: "admin", token: "secret" },
        { platform: "linux" },
      );
      expect(result).toBe(false);
    });

    it("writes credentials to keychain on darwin", () => {
      const mockExecSync = vi.fn();

      const result = writeJenkinsCredentials(
        { user: "admin", token: "secret123" },
        { platform: "darwin", execSync: mockExecSync },
      );

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('security add-generic-password -U -s "OpenClaw Jenkins"'),
        expect.any(Object),
      );
    });

    it("returns false on error", () => {
      const mockExecSync = vi.fn().mockImplementation(() => {
        throw new Error("keychain error");
      });

      const result = writeJenkinsCredentials(
        { user: "admin", token: "secret" },
        { platform: "darwin", execSync: mockExecSync },
      );

      expect(result).toBe(false);
    });
  });

  describe("deleteJenkinsCredentials", () => {
    it("returns false on non-darwin platforms", () => {
      const result = deleteJenkinsCredentials({ platform: "linux" });
      expect(result).toBe(false);
    });

    it("deletes credentials from keychain on darwin", () => {
      const mockExecSync = vi.fn();

      const result = deleteJenkinsCredentials({
        platform: "darwin",
        execSync: mockExecSync,
      });

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'security delete-generic-password -s "OpenClaw Jenkins" -a "default"',
        expect.any(Object),
      );
    });

    it("returns true if item does not exist", () => {
      const mockExecSync = vi.fn().mockImplementation(() => {
        throw new Error("could not be found");
      });

      const result = deleteJenkinsCredentials({
        platform: "darwin",
        execSync: mockExecSync,
      });

      expect(result).toBe(true);
    });
  });

  describe("hasJenkinsCredentials", () => {
    it("returns false on non-darwin platforms", () => {
      const result = hasJenkinsCredentials({ platform: "linux" });
      expect(result).toBe(false);
    });

    it("returns true if credentials exist", () => {
      const mockExecSync = vi.fn().mockReturnValue("found");

      const result = hasJenkinsCredentials({
        platform: "darwin",
        execSync: mockExecSync,
      });

      expect(result).toBe(true);
    });

    it("returns false if credentials do not exist", () => {
      const mockExecSync = vi.fn().mockImplementation(() => {
        throw new Error("not found");
      });

      const result = hasJenkinsCredentials({
        platform: "darwin",
        execSync: mockExecSync,
      });

      expect(result).toBe(false);
    });
  });
});
