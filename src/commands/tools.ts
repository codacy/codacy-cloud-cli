import * as path from "path";
import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
import { createTable, getOutputFormat, pickDeep, printJson } from "../utils/output";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { AnalysisTool } from "../api/client/models/AnalysisTool";
import {
  readConfigFile,
  fetchAllTools,
  buildImportPreview,
  printImportPreview,
  executeImport,
} from "../utils/import-config";
import { confirmAction } from "../utils/prompt";

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
    .option("--import [path]", "import tool configuration from a file (default: .codacy/codacy.config.json)")
    .option("-y, --skip-approval", "skip confirmation prompt during import")
    .option("--force", "unlink all coding standards before importing")
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli tools gh my-org my-repo
  $ codacy-cloud-cli tools gh my-org my-repo --output json
  $ codacy-cloud-cli tools gh my-org my-repo --import
  $ codacy-cloud-cli tools gh my-org my-repo --import ./custom-config.json
  $ codacy-cloud-cli tools gh my-org my-repo --import -y
  $ codacy-cloud-cli tools gh my-org my-repo --import --force -y`,
    )
    .action(async function (
      this: Command,
      provider: string,
      organization: string,
      repository: string,
    ) {
      try {
        checkApiToken();
        const opts = this.opts();

        // ── Mode: import ────────────────────────────────────────────────
        if (opts.import !== undefined) {
          const configPath =
            typeof opts.import === "string"
              ? opts.import
              : ".codacy/codacy.config.json";
          const resolvedPath = path.resolve(configPath);

          const spinner = ora("Reading configuration...").start();

          // Read config file
          const config = readConfigFile(resolvedPath);

          // Fetch current state in parallel
          const [repoToolsResponse, allTools, repoResponse] =
            await Promise.all([
              AnalysisService.listRepositoryTools(
                provider,
                organization,
                repository,
              ),
              fetchAllTools(),
              AnalysisService.getRepositoryWithAnalysis(
                provider,
                organization,
                repository,
              ),
            ]);

          spinner.stop();

          // Build and display preview
          const preview = buildImportPreview(
            config,
            repoToolsResponse.data,
            allTools,
            repoResponse.data.repository.standards,
            resolvedPath,
          );

          printImportPreview(preview, repository, Boolean(opts.force));

          // Confirm
          if (!opts.skipApproval) {
            const confirmed = await confirmAction(
              "\nDo you wish to proceed?",
            );
            if (!confirmed) {
              console.log("Import cancelled.");
              return;
            }
          }

          console.log();
          const execSpinner = ora("Applying configuration...").start();
          const result = await executeImport(
            provider,
            organization,
            repository,
            preview,
            config,
            allTools,
            execSpinner,
            Boolean(opts.force),
          );

          execSpinner.stop();

          if (result.failed.length === 0) {
            console.log(
              `${ansis.green("✓")} Configuration imported successfully.`,
            );
          } else {
            console.log(
              ansis.yellow(
                `Import completed with ${result.failed.length} error(s):`,
              ),
            );
            for (const f of result.failed) {
              console.log(ansis.red(`  ✗ ${f.tool}: ${f.error}`));
            }
            if (result.succeeded.length > 0) {
              console.log(
                ansis.green(
                  `  ✓ ${result.succeeded.length} tool(s) configured successfully.`,
                ),
              );
            }
          }
          return;
        }

        // ── Default: list tools ─────────────────────────────────────────
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
