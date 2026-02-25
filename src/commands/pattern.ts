import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { findToolByName } from "../utils/formatting";
import { ConfigureToolBody } from "../api/client/models/ConfigureToolBody";
import { ConfigurePattern } from "../api/client/models/ConfigurePattern";

export function registerPatternCommand(program: Command) {
  program
    .command("pattern")
    .alias("pat")
    .description("Enable, disable, or set parameters for a specific pattern")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .argument("<repository>", "repository name")
    .argument(
      "<toolName>",
      "tool name (use hyphens for spaces, e.g. eslint-(deprecated))",
    )
    .argument("<patternId>", "pattern ID")
    .option("-e, --enable", "enable the pattern")
    .option("-d, --disable", "disable the pattern")
    .option(
      "-p, --parameter <name=value>",
      "set a parameter (name=value format, repeatable)",
      (val: string, acc: string[]) => [...acc, val],
      [] as string[],
    )
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli pattern gh my-org my-repo eslint some-pattern-id --enable
  $ codacy-cloud-cli pattern gh my-org my-repo eslint some-pattern-id --disable
  $ codacy-cloud-cli pattern gh my-org my-repo eslint some-pattern-id --parameter maxParams=3
  $ codacy-cloud-cli pattern gh my-org my-repo eslint some-pattern-id --enable --parameter maxParams=3 --parameter minParams=1`,
    )
    .action(async function (
      this: Command,
      provider: string,
      organization: string,
      repository: string,
      toolName: string,
      patternId: string,
    ) {
      try {
        checkApiToken();
        const opts = this.opts();

        if (!opts.enable && !opts.disable && opts.parameter.length === 0) {
          console.error(
            ansis.red(
              "Error: specify at least one of --enable, --disable, or --parameter.",
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

        // Determine enabled state
        let enabled: boolean;
        if (opts.enable) {
          enabled = true;
        } else if (opts.disable) {
          enabled = false;
        } else {
          // Only parameters are being set — fetch current enabled state
          spinner.text = `Fetching current state of pattern "${patternId}"...`;
          const patternsResponse =
            await AnalysisService.listRepositoryToolPatterns(
              provider,
              organization,
              repository,
              tool.uuid,
              undefined, // languages
              undefined, // categories
              undefined, // severityLevels
              undefined, // tags
              patternId, // search by ID
            );
          const match = patternsResponse.data.find(
            (cp) => cp.patternDefinition.id === patternId,
          );
          if (!match) {
            spinner.fail(
              `Pattern "${patternId}" not found for tool "${toolName}".`,
            );
            process.exit(1);
          }
          enabled = match.enabled;
        }

        // Parse name=value parameters
        const parameters = opts.parameter.map((param: string) => {
          const eqIdx = param.indexOf("=");
          if (eqIdx === -1) {
            throw new Error(
              `Invalid parameter format "${param}". Use name=value format.`,
            );
          }
          return {
            name: param.slice(0, eqIdx),
            value: param.slice(eqIdx + 1),
          };
        });

        const patternConfig: ConfigurePattern = {
          id: patternId,
          enabled,
          ...(parameters.length > 0 && { parameters }),
        };

        const body: ConfigureToolBody = {
          patterns: [patternConfig],
        };

        spinner.text = `Configuring pattern "${patternId}"...`;
        await AnalysisService.configureTool(
          provider,
          organization,
          repository,
          tool.uuid,
          body,
        );
        spinner.stop();

        const actions: string[] = [];
        if (opts.enable) {
          actions.push(`Pattern ${ansis.bold(patternId)} enabled`);
        } else if (opts.disable) {
          actions.push(`Pattern ${ansis.bold(patternId)} disabled`);
        }
        for (const p of parameters) {
          actions.push(
            `Pattern ${ansis.bold(patternId)} parameter ${ansis.bold(p.name)} set to ${ansis.bold(p.value)}`,
          );
        }

        for (const msg of actions) {
          console.log(`${ansis.green("✓")} ${msg}.`);
        }
      } catch (err) {
        handleError(err);
      }
    });
}
