import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
import {
  createTable,
  getOutputFormat,
  printJson,
  printPaginationWarning,
} from "../utils/output";
import { printSection } from "../utils/formatting";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { CommitIssue } from "../api/client/models/CommitIssue";
import { SeverityLevel } from "../api/client/models/SeverityLevel";
import { SearchRepositoryIssuesBody } from "../api/client/models/SearchRepositoryIssuesBody";
import { Count } from "../api/client/models/Count";
import { PatternsCount } from "../api/client/models/PatternsCount";

const SEVERITY_ORDER: Record<string, number> = {
  Error: 0,
  High: 1,
  Warning: 2,
  Info: 3,
};

/**
 * Map from normalized user input to the API enum value.
 * Accepts both the display label (Critical, Medium, Minor) and the enum value
 * (Error, Warning, Info), case-insensitive.
 *
 * Display label → enum: Critical→Error, High→High, Medium→Warning, Minor→Info
 */
const SEVERITY_NORMALIZE: Record<string, SeverityLevel> = {
  critical: "Error",
  error: "Error",
  high: "High",
  medium: "Warning",
  warning: "Warning",
  minor: "Info",
  info: "Info",
};

/**
 * Map from normalized user input (lowercase, no spaces) to the DB category value.
 * Allows inputs like "security", "code style", "error prone", etc.
 */
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

function normalizeSeverity(input: string): SeverityLevel {
  return (
    SEVERITY_NORMALIZE[input.toLowerCase().trim()] ?? (input as SeverityLevel)
  );
}

/**
 * Normalize a category input to its exact DB value.
 * Strips spaces/underscores/hyphens and lowercases before matching.
 * Falls back to the original input if no match is found.
 */
function normalizeCategory(input: string): string {
  const key = input.toLowerCase().replace(/[\s_-]/g, "");
  return CATEGORY_NORMALIZE[key] ?? input;
}

const SEVERITY_DISPLAY: Record<string, string> = {
  Error: "Critical",
  High: "High",
  Warning: "Medium",
  Info: "Minor",
};

function colorSeverity(level: SeverityLevel): string {
  const label = SEVERITY_DISPLAY[level] ?? level;
  switch (level) {
    case "Error":
      return ansis.red(label);
    case "High":
      return ansis.hex("#FF8C00")(label);
    case "Warning":
      return ansis.yellow(label);
    case "Info":
      return ansis.blue(label);
    default:
      return label;
  }
}

function printIssueCard(issue: CommitIssue): void {
  const pattern = issue.patternInfo;
  const separator = ansis.dim("─".repeat(40));

  console.log();

  // Severity | Category SubCategory?
  const severity = colorSeverity(pattern.severityLevel);
  const subCat = pattern.subCategory ? ` ${pattern.subCategory}` : "";
  console.log(`${severity} ${ansis.dim("|")} ${pattern.category}${subCat}`);

  // Issue message
  console.log(issue.message);
  console.log();

  // File path : line number
  console.log(ansis.dim(`${issue.filePath}:${issue.lineNumber}`));

  // Line content (trimmed)
  if (issue.lineText) {
    console.log(ansis.dim(issue.lineText.trim()));
  }

  // False positive detection
  if (
    issue.falsePositiveProbability !== undefined &&
    issue.falsePositiveProbability >= issue.falsePositiveThreshold
  ) {
    const reason = issue.falsePositiveReason || "No reason provided";
    console.log();
    console.log(ansis.yellow(`Potential false positive: ${reason}`));
  }

  console.log();
  console.log(separator);
}

function printIssuesList(issues: CommitIssue[], total: number): void {
  printSection("Issues", total, "issue");
  if (issues.length === 0) {
    console.log(ansis.dim("  No issues found."));
    return;
  }
  const sorted = [...issues].sort((a, b) => {
    const aOrder = SEVERITY_ORDER[a.patternInfo.severityLevel] ?? 99;
    const bOrder = SEVERITY_ORDER[b.patternInfo.severityLevel] ?? 99;
    return aOrder - bOrder;
  });
  for (const issue of sorted) {
    printIssueCard(issue);
  }
}

function printCountTable(title: string, counts: Count[]): void {
  if (counts.length === 0) return;
  const sorted = [...counts].sort((a, b) => b.total - a.total);
  const table = createTable({ head: [title, "Count"] });
  for (const c of sorted) {
    table.push([c.name, String(c.total)]);
  }
  console.log(table.toString());
}

function printPatternsTable(patterns: PatternsCount[]): void {
  if (patterns.length === 0) return;
  const sorted = [...patterns].sort((a, b) => b.total - a.total);
  const table = createTable({ head: ["Pattern", "Count"] });
  for (const p of sorted) {
    table.push([`${p.title} ${ansis.dim(p.id)}`, String(p.total)]);
  }
  console.log(table.toString());
}

function printOverview(counts: {
  categories: Count[];
  levels: Count[];
  languages: Count[];
  tags: Count[];
  patterns: PatternsCount[];
  authors: Count[];
}): void {
  printSection("Issues Overview");
  const hasData =
    counts.categories.length > 0 ||
    counts.levels.length > 0 ||
    counts.languages.length > 0 ||
    counts.tags.length > 0 ||
    counts.patterns.length > 0 ||
    counts.authors.length > 0;

  if (!hasData) {
    console.log(ansis.dim("  No issues data available."));
    return;
  }

  printCountTable("Category", counts.categories);
  if (counts.categories.length > 0 && counts.levels.length > 0) console.log();
  printCountTable("Severity", counts.levels);
  if (counts.levels.length > 0 && counts.languages.length > 0) console.log();
  printCountTable("Language", counts.languages);
  if (counts.languages.length > 0 && counts.tags.length > 0) console.log();
  printCountTable("Tag", counts.tags);
  if (counts.tags.length > 0 && counts.patterns.length > 0) console.log();
  printPatternsTable(counts.patterns);
  if (counts.patterns.length > 0 && counts.authors.length > 0) console.log();
  printCountTable("Author", counts.authors);
}

/**
 * Split a comma-separated CLI option into a trimmed array.
 * Returns undefined if the value is not set.
 */
function parseCommaList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function registerIssuesCommand(program: Command) {
  program
    .command("issues")
    .alias("is")
    .description("Search for issues in a repository")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .argument("<repository>", "repository name")
    .option("-b, --branch <branch>", "branch name (defaults to the main branch)")
    .option("-p, --patterns <patterns>", "comma-separated list of pattern IDs")
    .option(
      "-s, --severities <severities>",
      "comma-separated severity levels: Critical, High, Medium, Minor (or Error, Warning, Info)",
    )
    .option(
      "-c, --categories <categories>",
      "comma-separated category names (e.g. Security, CodeStyle, ErrorProne)",
    )
    .option("-l, --languages <languages>", "comma-separated list of language names")
    .option("-t, --tags <tags>", "comma-separated list of tag names")
    .option("-a, --authors <authors>", "comma-separated list of author emails")
    .option("-O, --overview", "show issue count totals instead of the issues list")
    .addHelpText(
      "after",
      `
Examples:
  $ codacy issues gh my-org my-repo
  $ codacy issues gh my-org my-repo --branch main --severities Critical,Medium
  $ codacy issues gh my-org my-repo --categories Security --overview
  $ codacy issues gh my-org my-repo --output json`,
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
        const format = getOutputFormat(this);
        const isOverview = !!opts.overview;

        // Build the shared filter body from CLI options
        const body: SearchRepositoryIssuesBody = {};
        if (opts.branch) body.branchName = opts.branch;
        const patterns = parseCommaList(opts.patterns);
        if (patterns) body.patternIds = patterns;
        const severity = parseCommaList(opts.severities);
        if (severity) body.levels = severity.map(normalizeSeverity);
        const category = parseCommaList(opts.categories);
        if (category) body.categories = category.map(normalizeCategory);
        const language = parseCommaList(opts.languages);
        if (language) body.languages = language;
        const tags = parseCommaList(opts.tags);
        if (tags) body.tags = tags;
        const author = parseCommaList(opts.authors);
        if (author) body.authorEmails = author;

        const spinner = ora(
          isOverview ? "Fetching issues overview..." : "Fetching issues...",
        ).start();

        if (isOverview) {
          const overviewResponse = await AnalysisService.issuesOverview(
            provider,
            organization,
            repository,
            body,
          );
          spinner.stop();

          const counts = overviewResponse.data.counts;

          if (format === "json") {
            printJson({ overview: counts });
            return;
          }

          printOverview({
            categories: counts.categories,
            levels: counts.levels,
            languages: counts.languages,
            tags: counts.tags,
            patterns: counts.patterns,
            authors: counts.authors,
          });
        } else {
          const issuesResponse = await AnalysisService.searchRepositoryIssues(
            provider,
            organization,
            repository,
            undefined,
            100,
            body,
          );
          spinner.stop();

          const issues = issuesResponse.data;
          const total = issuesResponse.pagination?.total ?? issues.length;

          if (format === "json") {
            printJson({ issues });
            return;
          }

          printIssuesList(issues, total);
          printPaginationWarning(
            issuesResponse.pagination,
            "Use --severities, --categories, or --languages to filter issues.",
          );
        }
      } catch (err) {
        handleError(err);
      }
    });
}
