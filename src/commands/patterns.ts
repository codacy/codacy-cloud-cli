import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
import {
  getOutputFormat,
  pickDeep,
  printJson,
  printPaginationWarning,
} from "../utils/output";
import { colorSeverity, findToolByName } from "../utils/formatting";
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

function printPatternCard(cp: ConfiguredPattern): void {
  const p = cp.patternDefinition;
  const separator = ansis.dim("─".repeat(40));
  const enforcedByStandard = cp.enabledBy && cp.enabledBy.length > 0;
  const enabled = cp.enabled || enforcedByStandard; // enabled should be enough, but there is a bug in the API
  const enabledIcon = enabled
    ? enforcedByStandard
      ? "☑️"
      : "✅"
    : ansis.dim("⬛");
  const titleText = p.title ?? p.id;
  const titleColored = enabled ? ansis.white(titleText) : ansis.dim(titleText);
  const idStr = ansis.dim(`(${p.id})`);
  const recommendedStr = p.enabled ? ` | ${ansis.magenta("Recommended")}` : "";

  console.log(separator);
  console.log(`${enabledIcon} ${titleColored} ${idStr}${recommendedStr}`);

  if (enforcedByStandard) {
    const names = cp.enabledBy.map((s) => s.name).join(", ");
    console.log(`   ${ansis.dim(`Enforced by: ${names}`)}`);
  }

  // Metadata line: severity | category subcategory | languages | tags
  const meta: string[] = [colorSeverity(p.severityLevel)];
  meta.push(p.category + (p.subCategory ? ` ${ansis.dim(p.subCategory)}` : ""));
  if (p.languages && p.languages.length > 0) meta.push(p.languages.join(", "));
  if (p.tags && p.tags.length > 0) meta.push(p.tags.join(", "));
  console.log(`   ${meta.join(" | ")}`);

  if (p.description) {
    console.log(`   ${ansis.dim(p.description)}`);
  }

  if (p.rationale) {
    console.log();
    console.log(`   ${ansis.white("Why?")} ${ansis.dim(p.rationale)}`);
  }

  if (p.solution) {
    console.log(`   ${ansis.white("How to fix?")} ${ansis.dim(p.solution)}`);
  }

  // Parameters — only shown when enabled and parameters are set
  if (cp.enabled && cp.parameters && cp.parameters.length > 0) {
    console.log();
    console.log("   Parameters:");
    for (const param of cp.parameters) {
      console.log(`     - ${param.name} = ${param.value}`);
    }
  }
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

const JSON_FIELDS = [
  "enabled",
  "parameters",
  "patternDefinition.id",
  "patternDefinition.title",
  "patternDefinition.severityLevel",
  "patternDefinition.category",
  "patternDefinition.subCategory",
  "patternDefinition.languages",
  "patternDefinition.tags",
  "patternDefinition.enabled",
  "patternDefinition.description",
  "patternDefinition.rationale",
  "patternDefinition.solution",
  "enabledBy",
];

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
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .argument("<repository>", "repository name")
    .argument("<toolName>", "tool name")
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
    .option("-E, --enable-all", "bulk enable matching patterns")
    .option("-X, --disable-all", "bulk disable matching patterns")
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli patterns gh my-org my-repo eslint
  $ codacy-cloud-cli patterns gh my-org my-repo eslint --severities Critical,High
  $ codacy-cloud-cli patterns gh my-org my-repo eslint --enabled --categories Security
  $ codacy-cloud-cli patterns gh my-org my-repo eslint --search "sql injection" --recommended
  $ codacy-cloud-cli patterns gh my-org my-repo eslint --enable-all --categories Security
  $ codacy-cloud-cli patterns gh my-org my-repo eslint --disable-all --severities Minor`,
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

        const { severities, categories } = parseFilters(opts);

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
        );
        spinner.stop();

        if (format === "json") {
          printJson(response.data.map((cp: any) => pickDeep(cp, JSON_FIELDS)));
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
