import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { findToolByName } from "../utils/formatting";
import { ConfigureToolBody } from "../api/client/models/ConfigureToolBody";

export function registerToolCommand(program: Command) {
  program
    .command("tool")
    .alias("tl")
    .description("Enable, disable, or configure a tool for a repository")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .argument("<repository>", "repository name")
    .argument(
      "<toolName>",
      "tool name (use hyphens for spaces, e.g. eslint-(deprecated))",
    )
    .option("-e, --enable", "enable the tool")
    .option("-d, --disable", "disable the tool")
    .option(
      "-c, --configuration-file <true/false>",
      "use a configuration file (true or false)",
    )
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli tool gh my-org my-repo eslint --enable
  $ codacy-cloud-cli tool gh my-org my-repo eslint --disable
  $ codacy-cloud-cli tool gh my-org my-repo eslint --configuration-file true
  $ codacy-cloud-cli tool gh my-org my-repo eslint --enable --configuration-file true`,
    )
    .action(async function (
      this: Command,
      provider: string,
      organization: string,
      repository: string,
      toolName: string,
    ) {
      try {
        checkApiToken();
        const opts = this.opts();

        if (
          !opts.enable &&
          !opts.disable &&
          opts.configurationFile === undefined
        ) {
          console.error(
            ansis.red(
              "Error: specify at least one of --enable, --disable, or --configuration-file.",
            ),
          );
          process.exit(1);
        }

        const spinner = ora(`Looking up tool "${toolName}"...`).start();

        const toolsResponse = await AnalysisService.listRepositoryTools(
          provider,
          organization,
          repository,
        );
        const tool = findToolByName(toolsResponse.data, toolName);

        if (!tool) {
          spinner.fail(`Tool "${toolName}" not found in this repository.`);
          process.exit(1);
        }

        const body: ConfigureToolBody = {};
        const actions: string[] = [];

        if (opts.enable) {
          body.enabled = true;
          actions.push(`${ansis.bold(tool.name)} enabled`);
        } else if (opts.disable) {
          body.enabled = false;
          actions.push(`${ansis.bold(tool.name)} disabled`);
        }

        if (opts.configurationFile !== undefined) {
          const useFile = opts.configurationFile === "true";
          body.useConfigurationFile = useFile;
          actions.push(
            `${ansis.bold(tool.name)} ${useFile ? "now uses" : "no longer uses"} a configuration file`,
          );
        }

        spinner.text = `Configuring ${tool.name}...`;
        await AnalysisService.configureTool(
          provider,
          organization,
          repository,
          tool.uuid,
          body,
        );
        spinner.stop();

        for (const msg of actions) {
          console.log(`${ansis.green("✓")} ${msg}.`);
        }
      } catch (err) {
        handleError(err);
      }
    });
}
