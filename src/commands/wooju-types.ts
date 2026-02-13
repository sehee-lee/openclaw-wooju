// Template types for Wooju team templates
export type WoojuTemplateRole = "developer" | "planning" | "design" | "data";
export type WoojuTemplateService = "maps" | "shopping" | "search";
export type WoojuTemplateStack = "ios" | "android" | "frontend" | "backend-java" | "devops";

export type WoojuTemplateSelection = {
  type: "wooju";
  role?: WoojuTemplateRole;
  stack?: WoojuTemplateStack;
  service?: WoojuTemplateService;
};

export type WoojuSecurityPreset = "high" | "medium" | "low";

export type WoojuCommandOptions = {
  nonInteractive?: boolean;
  acceptRisk?: boolean;
  skipSlack?: boolean;
  skipSandbox?: boolean;
  skipGateway?: boolean;
  securityPreset?: WoojuSecurityPreset;
  role?: WoojuTemplateRole;
  stack?: WoojuTemplateStack;
  service?: WoojuTemplateService;
};

export type WoojuSlackSetup = {
  botToken: string;
  appToken: string;
  channelIds: string[];
};
