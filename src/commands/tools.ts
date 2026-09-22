import * as path from "path";
import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import {
  RemoteAuth,
  repositoryTokenOption,
  requireAccountToken,
  resolveAuth,
} from "../utils/auth";
import { handleError } from "../utils/error";
import { resolveRepoArgs } from "../utils/resolve-repo-args";
import { createTable, getOutputFormat, pickDeep, printJson } from "../utils/output";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { AnalysisTool } from "../api/client/models/AnalysisTool";
import {
  readConfigFile,
  fetchAllTools,
  getLocalSupportedToolIds,
  buildImportPreview,
  printImportPreview,
  executeImport,
  ImportFailure,
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

const MAX_ERROR_DETAILS = 5;

function printImportErrors(failures: ImportFailure[]): void {
  for (const f of failures) {
    const status = f.status ? ` (${f.status})` : "";
    console.log(ansis.red(`✗ ${f.tool}: ${f.error}${status}`));

    if (f.details.length === 0) continue;

    const shown = f.details.slice(0, MAX_ERROR_DETAILS);
    for (const detail of shown) {
      console.log(ansis.dim(`  ${detail}`));
    }
    const remaining = f.details.length - shown.length;
    if (remaining > 0) {
      console.log(ansis.dim(`  ... and ${remaining} more`));
    }
  }
  console.log();
}

/**
 * Enforces that `--force` can actually do what its preview promises.
 *
 * Unlinking coding standards is organization-level, so `--force` can't run under
 * a repository token. This must be called *before* the preview is printed and
 * approved: otherwise the user confirms a plan that says "will stop following 1
 * coding standard" and cannot execute it, landing in exactly the state `--force`
 * exists to prevent — tools reconfigured while a standard still overrides them.
 *
 * Only refuses when it would actually do something, though. With no standards to
 * unlink, `--force` iterates an empty list and its preview block is skipped
 * entirely; refusing a genuine no-op would break anyone with `--force` baked
 * into a CI script.
 */
const guardForceUnlink = (
  auth: RemoteAuth,
  standardsToUnlink: number,
  force: boolean,
): void => {
  if (!force || auth.kind === "account-token") return;

  if (standardsToUnlink > 0) {
    requireAccountToken(
      auth,
      "codacy tools --import --force",
      "unlinking coding standards is an organization-level operation. " +
        "Re-run without --force to import anyway — the coding standard will " +
        "keep overriding the imported configuration — or unlink it in Codacy first",
    );
  }

  console.error(
    ansis.yellow(
      "⚠ --force ignored — this repository follows no coding standards to unlink.",
    ),
  );
};

export function registerToolsCommand(program: Command) {
  program
    .command("tools")
    .alias("tls")
    .description("List all tools for a repository and their status")
    .argument("[provider]", "git provider (gh, gl, or bb) — auto-detected from git remote if omitted")
    .argument("[organization]", "organization name")
    .argument("[repository]", "repository name")
    .option("--import [path]", "import tool configuration from a file (default: .codacy/codacy.config.json)")
    .option("-y, --skip-approval", "skip confirmation prompt during import")
    .option("--force", "unlink all coding standards before importing")
    .addOption(repositoryTokenOption())
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli tools                                   # auto-detect from git remote
  $ codacy-cloud-cli tools gh my-org my-repo
  $ codacy-cloud-cli tools gh my-org my-repo --output json
  $ codacy-cloud-cli tools gh my-org my-repo --import
  $ codacy-cloud-cli tools gh my-org my-repo --import ./custom-config.json
  $ codacy-cloud-cli tools gh my-org my-repo --import -y
  $ codacy-cloud-cli tools gh my-org my-repo --import --force -y`,
    )
    .action(async function (
      this: Command,
      providerArg?: string,
      organizationArg?: string,
      repositoryArg?: string,
    ) {
      try {
        const auth = resolveAuth(this);
        const { provider, organization, repository } = resolveRepoArgs(
          [providerArg, organizationArg, repositoryArg],
          0,
          "tools",
          [],
        );
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

          // Fetch current state and local CLI info in parallel
          const [repoToolsResponse, allTools, repoResponse, localToolIds] =
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
              getLocalSupportedToolIds(),
            ]);

          spinner.stop();

          const isJson = getOutputFormat(this) === "json";

          // Build and display preview
          const preview = await buildImportPreview(
            provider,
            organization,
            repository,
            config,
            repoToolsResponse.data,
            allTools,
            repoResponse.data.repository.standards,
            resolvedPath,
            localToolIds,
            Boolean(opts.force),
          );

          guardForceUnlink(auth, preview.standards.length, Boolean(opts.force));

          printImportPreview(
            preview,
            repository,
            Boolean(opts.force),
            { canUnlinkStandards: auth.kind === "account-token" },
            isJson ? console.error : console.log,
          );

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

          if (!isJson) console.log();
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

          if (isJson) {
            printJson(result);
            return;
          }

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
            printImportErrors(result.failed);
            if (result.succeeded.length > 0) {
              console.log(
                ansis.green(
                  `  ✓ ${result.succeeded.length} tool(s) configured successfully.`,
                ),
              );
            }
          }
          if (result.skipped.length > 0) {
            console.log(ansis.dim(`  ${result.skipped.length} skipped.`));
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
