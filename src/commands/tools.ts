import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
import { createTable, getOutputFormat, pickDeep, printJson } from "../utils/output";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { AnalysisTool } from "../api/client/models/AnalysisTool";

function configFileStatus(tool: AnalysisTool): string {
  if (tool.settings.usesConfigurationFile) return "Applied";
  if (tool.settings.hasConfigurationFile) return "Available";
  return ansis.dim("—");
}

function printToolGroup(tools: AnalysisTool[], enabled: boolean): void {
  const group = tools.filter((t) => t.settings.isEnabled === enabled);
  const title = enabled ? "✅ Enabled tools" : "❌ Disabled tools";
  console.log(ansis.bold(`\n${title} (${group.length})`));

  if (group.length === 0) {
    console.log(ansis.dim("  None."));
    return;
  }

  const table = createTable({ head: ["Tool", "Config File", "Via Standard", "Notes"] });
  for (const tool of group) {
    const standards = tool.settings.enabledBy.map((s) => s.name).join(", ");
    const viaStandard = tool.settings.usesConfigurationFile
      ? ansis.dim("Overwritten by file")
      : standards || ansis.dim("—");
    const notes = tool.isClientSide ? "Client-side tool" : "";
    table.push([
      tool.name,
      configFileStatus(tool),
      viaStandard,
      notes || ansis.dim("—"),
    ]);
  }
  console.log(table.toString());
}

export function registerToolsCommand(program: Command) {
  program
    .command("tools")
    .alias("tls")
    .description("List all tools for a repository and their status")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .argument("<repository>", "repository name")
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli tools gh my-org my-repo
  $ codacy-cloud-cli tools gh my-org my-repo --output json`,
    )
    .action(async function (
      this: Command,
      provider: string,
      organization: string,
      repository: string,
    ) {
      try {
        checkApiToken();
        const format = getOutputFormat(this);
        const spinner = ora("Fetching tools...").start();

        const response = await AnalysisService.listRepositoryTools(
          provider,
          organization,
          repository,
        );
        spinner.stop();

        const tools = response.data;

        if (format === "json") {
          printJson(tools.map((tool: any) => pickDeep(tool, [
            "name",
            "uuid",
            "isClientSide",
            "settings.isEnabled",
            "settings.hasConfigurationFile",
            "settings.usesConfigurationFile",
            "settings.enabledBy",
          ])));
          return;
        }

        printToolGroup(tools, true);
        printToolGroup(tools, false);
      } catch (err) {
        handleError(err);
      }
    });
}
