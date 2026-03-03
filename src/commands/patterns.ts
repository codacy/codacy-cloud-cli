import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
import {
  getOutputFormat,
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
  const enabledIcon = cp.enabled ? "✅" : ansis.dim("⬛");
  const titleText = p.title ?? p.id;
  const titleColored = cp.enabled
    ? ansis.white(titleText)
    : ansis.dim(titleText);
  const idStr = ansis.dim(`(${p.id})`);
  const recommendedStr = p.enabled ? ` | ${ansis.magenta("Recommended")}` : "";

  console.log(separator);
  console.log(`${enabledIcon} ${titleColored} ${idStr}${recommendedStr}`);

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
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli patterns gh my-org my-repo eslint
  $ codacy-cloud-cli patterns gh my-org my-repo eslint --severities Critical,High
  $ codacy-cloud-cli patterns gh my-org my-repo eslint --enabled --categories Security
  $ codacy-cloud-cli patterns gh my-org my-repo eslint --search "sql injection" --recommended`,
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

        spinner.text = `Fetching patterns for ${tool.name}...`;

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

        const patterns = response.data;

        if (format === "json") {
          printJson(patterns);
          return;
        }

        // Sort: severity → recommended → title
        const sorted = [...patterns].sort((a, b) => {
          const aSev = SEVERITY_ORDER[a.patternDefinition.severityLevel] ?? 99;
          const bSev = SEVERITY_ORDER[b.patternDefinition.severityLevel] ?? 99;
          if (aSev !== bSev) return aSev - bSev;

          const aRec = a.patternDefinition.enabled ? 0 : 1;
          const bRec = b.patternDefinition.enabled ? 0 : 1;
          if (aRec !== bRec) return aRec - bRec;

          return (
            a.patternDefinition.title ?? a.patternDefinition.id
          ).localeCompare(b.patternDefinition.title ?? b.patternDefinition.id);
        });

        for (const cp of sorted) {
          printPatternCard(cp);
        }
        if (sorted.length > 0) {
          console.log(ansis.dim("─".repeat(40)));
        } else {
          console.log(ansis.dim("No patterns found."));
        }

        printPaginationWarning(
          response.pagination,
          "Use --severities, --categories, --search, or --enabled/--disabled to filter.",
        );
      } catch (err) {
        handleError(err);
      }
    });
}
