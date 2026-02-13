export type TemplateFiles = {
  agents: string[];
  soul: string[];
  tools: string[];
  identity: string[];
  user: string[];
  bootstrap: string[];
};

/**
 * Returns the list of standard template files to load.
 * Files are listed in order - they will be merged together.
 */
export function getTemplateFiles(): TemplateFiles {
  return {
    agents: ["AGENTS.md"],
    soul: ["SOUL.md"],
    tools: ["TOOLS.md"],
    identity: ["IDENTITY.md"],
    user: ["USER.md"],
    bootstrap: ["BOOTSTRAP.md"],
  };
}
