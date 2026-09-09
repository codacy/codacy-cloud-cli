import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { repositoryTokenOption, resolveAuth } from "../utils/auth";
import { handleError } from "../utils/error";
import { resolveRepoArgs } from "../utils/resolve-repo-args";
import {
  getOutputFormat,
  pickDeep,
  printJson,
  printPaginationWarning,
} from "../utils/output";
import {
  findToolByName,
  printPatternCard,
  configFileNotice,
  CONFIG_FILE_LOCKED_MESSAGE,
  PATTERN_JSON_FIELDS,
} from "../utils/formatting";
import { parseBooleanOption } from "../utils/options";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { ConfiguredPattern } from "../api/client/models/ConfiguredPattern";
import { SeverityLevel } from "../api/client/models/SeverityLevel";

const SEVERITY_ORDER: Record<string, number> = {
  Error: 0,
  High: 1,
  Warning: 2,
  Info: 3,
};

const SEVERITY_NORMALIZE: Record<string, SeverityLevel> = {
  critical: "Error",
  error: "Error",
  high: "High",
  medium: "Warning",
  warning: "Warning",
  minor: "Info",
  info: "Info",
};

function normalizeSeverity(s: string): SeverityLevel {
  return SEVERITY_NORMALIZE[s.toLowerCase().trim()] ?? (s as SeverityLevel);
}

const CATEGORY_NORMALIZE: Record<string, string> = {
  errorprone: "ErrorProne",
  codestyle: "CodeStyle",
  unusedcode: "UnusedCode",
  compatibility: "Compatibility",
  security: "Security",
  performance: "Performance",
  complexity: "Complexity",
  documentation: "Documentation",
  bestpractice: "BestPractice",
  comprehensibility: "Comprehensibility",
};

function normalizeCategory(input: string): string {
  const key = input.toLowerCase().replace(/[\s_-]/g, "");
  return CATEGORY_NORMALIZE[key] ?? input;
}

interface BulkUpdateArgs {
  provider: string;
  organization: string;
  repository: string;
  toolUuid: string;
  toolName: string;
  enabled: boolean;
  languages?: string;
  categories?: string;
  severities?: string;
  tags?: string;
  search?: string;
  recommended?: boolean;
  matchesStack?: boolean;
  spinner: ReturnType<typeof ora>;
}

async function handleBulkUpdate(args: BulkUpdateArgs): Promise<void> {
  const verb = args.enabled ? "Enabling" : "Disabling";
  args.spinner.text = `${verb} matching patterns for ${args.toolName}...`;

  await AnalysisService.updateRepositoryToolPatterns(
    args.provider,
    args.organization,
    args.repository,
    args.toolUuid,
    { enabled: args.enabled },
    args.languages,
    args.categories,
    args.severities,
    args.tags,
    args.search,
    args.recommended,
    args.matchesStack,
  );

  const overview = await AnalysisService.toolPatternsOverview(
    args.provider,
    args.organization,
    args.repository,
    args.toolUuid,
  );
  const { totalEnabled, categories: catCounts } = overview.data.counts;
  const totalPatterns = catCounts.reduce((s, c) => s + c.total, 0);
  const pastVerb = args.enabled ? "Enabled" : "Disabled";
  args.spinner.succeed(
    `${pastVerb} matching ${args.toolName} patterns. ${totalEnabled}/${totalPatterns} patterns now enabled.`,
  );
}

function sortPatterns(patterns: ConfiguredPattern[]): ConfiguredPattern[] {
  return [...patterns].sort((a, b) => {
    const aSev = SEVERITY_ORDER[a.patternDefinition.severityLevel] ?? 99;
    const bSev = SEVERITY_ORDER[b.patternDefinition.severityLevel] ?? 99;
    if (aSev !== bSev) return aSev - bSev;

    const aRec = a.patternDefinition.enabled ? 0 : 1;
    const bRec = b.patternDefinition.enabled ? 0 : 1;
    if (aRec !== bRec) return aRec - bRec;

    return (a.patternDefinition.title ?? a.patternDefinition.id).localeCompare(
      b.patternDefinition.title ?? b.patternDefinition.id,
    );
  });
}

function printPatternCards(patterns: ConfiguredPattern[]): void {
  const sorted = sortPatterns(patterns);
  for (const cp of sorted) {
    printPatternCard(cp);
  }
  if (sorted.length > 0) {
    console.log(ansis.dim("─".repeat(40)));
  } else {
    console.log(ansis.dim("No patterns found."));
  }
}

function parseFilters(opts: Record<string, any>) {
  const severities = opts.severities
    ? opts.severities
        .split(",")
        .map((s: string) => normalizeSeverity(s))
        .join(",")
    : undefined;

  const categories = opts.categories
    ? opts.categories
        .split(",")
        .map((c: string) => normalizeCategory(c.trim()))
        .join(",")
    : undefined;

  return { severities, categories };
}

export function registerPatternsCommand(program: Command) {
  program
    .command("patterns")
    .alias("pats")
    .description("List patterns for a specific tool in a repository")
    .argument("[provider]", "git provider (gh, gl, or bb) — auto-detected from git remote if omitted")
    .argument("[organization]", "organization name")
    .argument("[repository]", "repository name")
    .argument("[toolName]", "tool name")
    .option("-l, --languages <languages>", "comma-separated list of languages")
    .option(
      "-C, --categories <categories>",
      "comma-separated list of categories",
    )
    .option(
      "-s, --severities <severities>",
      "comma-separated severity levels: Critical, High, Medium, Minor",
    )
    .option("-t, --tags <tags>", "comma-separated list of tags")
    .option("-q, --search <search>", "search term to filter patterns")
    .option("-e, --enabled", "show only enabled patterns")
    .option("-D, --disabled", "show only disabled patterns")
    .option("-r, --recommended", "show only recommended patterns")
    .option(
      "-k, --matches-stack [value]",
      "filter by whether patterns match the repository stack (true, false, or omit)",
      parseBooleanOption,
    )
    .option("-E, --enable-all", "bulk enable matching patterns")
    .option("-X, --disable-all", "bulk disable matching patterns")
    .addOption(repositoryTokenOption())
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli patterns eslint                          # auto-detect from git remote
  $ codacy-cloud-cli patterns gh my-org my-repo eslint
  $ codacy-cloud-cli patterns gh my-org my-repo eslint --severities Critical,High
  $ codacy-cloud-cli patterns gh my-org my-repo eslint --enabled --categories Security
  $ codacy-cloud-cli patterns gh my-org my-repo eslint --search "sql injection" --recommended
  $ codacy-cloud-cli patterns gh my-org my-repo eslint --matches-stack          # only patterns matching the repo stack
  $ codacy-cloud-cli patterns gh my-org my-repo eslint --matches-stack false    # only patterns that don't
  $ codacy-cloud-cli patterns gh my-org my-repo eslint --enable-all --categories Security
  $ codacy-cloud-cli patterns gh my-org my-repo eslint --disable-all --severities Minor`,
    )
    .action(async function (
      this: Command,
      providerArg?: string,
      organizationArg?: string,
      repositoryArg?: string,
      toolNameArg?: string,
    ) {
      try {
        resolveAuth(this);
        const { provider, organization, repository, trailingArgs } =
          resolveRepoArgs(
            [providerArg, organizationArg, repositoryArg, toolNameArg],
            1,
            "patterns",
            ["toolName"],
          );
        const toolName = trailingArgs[0];
        const format = getOutputFormat(this);
        const opts = this.opts();

        if (opts.enableAll && opts.disableAll) {
          console.error(
            "Error: --enable-all and --disable-all are mutually exclusive.",
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

        // When the tool is driven by a local configuration file, the patterns
        // stored on Codacy are overwritten and can't be listed or changed via
        // the API. Short-circuit before fetching/updating patterns.
        if (tool.settings.usesConfigurationFile) {
          if (opts.enableAll || opts.disableAll) {
            spinner.fail(CONFIG_FILE_LOCKED_MESSAGE);
            process.exit(1);
          }
          spinner.stop();
          if (format === "json") {
            printJson({ tool: tool.name, usesConfigurationFile: true, patterns: [] });
          } else {
            console.log(ansis.yellow(configFileNotice(tool.name)));
          }
          return;
        }

        const { severities, categories } = parseFilters(opts);

        // Tri-state: `--matches-stack`/`--matches-stack true` sends true,
        // `--matches-stack false` sends false, and omitting it sends nothing.
        // Read explicitly rather than by truthiness so an explicit `false`
        // stays distinct from "not requested".
        let matchesStackFilter: boolean | undefined;
        if (opts.matchesStack === true) matchesStackFilter = true;
        else if (opts.matchesStack === false) matchesStackFilter = false;

        if (opts.enableAll || opts.disableAll) {
          await handleBulkUpdate({
            provider,
            organization,
            repository,
            toolUuid: tool.uuid,
            toolName: tool.name,
            enabled: Boolean(opts.enableAll),
            languages: opts.languages,
            categories,
            severities,
            tags: opts.tags,
            search: opts.search,
            recommended: opts.recommended ? true : undefined,
            matchesStack: matchesStackFilter,
            spinner,
          });
          return;
        }

        spinner.text = `Fetching patterns for ${tool.name}...`;

        let enabledFilter: boolean | undefined;
        if (opts.enabled) enabledFilter = true;
        if (opts.disabled) enabledFilter = false;

        const response = await AnalysisService.listRepositoryToolPatterns(
          provider,
          organization,
          repository,
          tool.uuid,
          opts.languages,
          categories,
          severities,
          opts.tags,
          opts.search,
          enabledFilter,
          opts.recommended ? true : undefined,
          matchesStackFilter,
        );
        spinner.stop();

        if (format === "json") {
          printJson(
            response.data.map((cp: any) => pickDeep(cp, PATTERN_JSON_FIELDS)),
          );
          return;
        }

        printPatternCards(response.data);

        printPaginationWarning(
          response.pagination,
          "Use --severities, --categories, --search, or --enabled/--disabled to filter.",
        );
      } catch (err) {
        handleError(err);
      }
    });
}
