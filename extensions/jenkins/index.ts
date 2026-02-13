import type { OpenClawPluginApi } from "../../src/plugins/types.js";

import { parseJenkinsConfig, jenkinsConfigUiHints, type JenkinsConfig } from "./src/config.js";
import { createJenkinsClient } from "./src/client.js";
import { readJenkinsCredentials } from "./src/keychain.js";
import { createJenkinsTools } from "./src/tools/index.js";
import { registerJenkinsCli } from "./src/cli.js";

const jenkinsPlugin = {
  id: "jenkins",
  name: "Jenkins",
  description: "Jenkins CI/CD integration with secure Keychain credential storage",
  configSchema: {
    parse: parseJenkinsConfig,
    uiHints: jenkinsConfigUiHints,
  },

  register(api: OpenClawPluginApi) {
    const config = parseJenkinsConfig(api.pluginConfig) as JenkinsConfig;

    // Register CLI commands (always available for setup)
    api.registerCli(
      ({ program }) => {
        registerJenkinsCli({ config, logger: api.logger }, program);
      },
      { commands: ["jenkins"] },
    );

    // Register tools only if credentials are available
    api.registerTool(
      (ctx) => {
        // Note: Jenkins tools are allowed in sandbox mode since they only interact
        // with Jenkins API (not local filesystem) and are protected by parameter whitelist

        // Check if baseUrl is configured
        if (!config.baseUrl) {
          api.logger.warn(
            "[jenkins] baseUrl not configured - tools disabled. Run 'openclaw jenkins setup'",
          );
          return null;
        }

        // Read credentials from Keychain
        const credentials = readJenkinsCredentials({ account: config.account });
        if (!credentials) {
          api.logger.warn(
            "[jenkins] No credentials in Keychain - tools disabled. Run 'openclaw jenkins setup'",
          );
          return null;
        }

        // Create client
        const client = createJenkinsClient({
          config,
          credentials,
          logger: api.logger,
        });

        // Return all tools
        return createJenkinsTools({
          client,
          config,
          logger: api.logger,
        });
      },
      {
        names: [
          "jenkins_list_jobs",
          "jenkins_get_job_info",
          "jenkins_list_builds",
          "jenkins_get_build_info",
          "jenkins_trigger_build",
          "jenkins_update_parameter",
        ],
        optional: true,
      },
    );
  },
};

export default jenkinsPlugin;
