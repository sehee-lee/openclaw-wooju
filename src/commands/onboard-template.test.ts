import { describe, expect, it } from "vitest";
import { getTemplateFiles } from "./onboard-template.js";

describe("getTemplateFiles", () => {
  it("returns standard templates", () => {
    const result = getTemplateFiles();

    expect(result.agents).toEqual(["AGENTS.md"]);
    expect(result.soul).toEqual(["SOUL.md"]);
    expect(result.tools).toEqual(["TOOLS.md"]);
    expect(result.identity).toEqual(["IDENTITY.md"]);
    expect(result.user).toEqual(["USER.md"]);
    expect(result.bootstrap).toEqual(["BOOTSTRAP.md"]);
  });
});
