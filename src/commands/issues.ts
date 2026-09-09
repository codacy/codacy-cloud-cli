import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import {
  repositoryTokenOption,
  requireAccountToken,
  resolveAuth,
} from "../utils/auth";
import { handleError } from "../utils/error";
import { resolveRepoArgs } from "../utils/resolve-repo-args";
import { confirmAction } from "../utils/prompt";
import {
  createTable,
  getOutputFormat,
  pickDeep,
  printJson,
  printPaginationWarning,
} from "../utils/output";
import {
  printSection,
  printIssueCard,
  printIgnoredIssueCard,
  resolveToolUuids,
  formatCount,
} from "../utils/formatting";
import { sanitizeText } from "../utils/sanitize";
import { parseBooleanOption } from "../utils/options";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { ToolsService } from "../api/client/services/ToolsService";
import { Tool } from "../api/client/models/Tool";
import { AnalysisTool } from "../api/client/models/AnalysisTool";
import { CommitIssue } from "../api/client/models/CommitIssue";
import { IgnoredIssue } from "../api/client/models/IgnoredIssue";
import { SeverityLevel } from "../api/client/models/SeverityLevel";
import { SearchRepositoryIssuesBody } from "../api/client/models/SearchRepositoryIssuesBody";
import { Count } from "../api/client/models/Count";
import { PatternsCount } from "../api/client/models/PatternsCount";

// API allows a maximum of 100 issue IDs per bulk-ignore call
const BULK_BATCH_SIZE = 100;

// A pattern is flagged as "noisy" (and suggested for disabling) when it BOTH
// clears the absolute floors and looks disproportionate relative to its peers.
//
// Absolute floors — keep "reduce noise" advice off repos that aren't actually
// noisy, in absolute terms:
//  - NOISE_MIN_TOTAL: the whole section is suppressed unless the repo has at least
//    this many issues in total. Kept deliberately ABOVE NOISE_MIN_PATTERN so it
//    does independent work — if the two were equal, any pattern big enough to clear
//    the per-pattern floor would already push the repo past the total floor, making
//    it dead code. The effect: a repo needs a substantial issue volume before noise
//    triage is worth suggesting, even when a single rule already has 100+ issues.
//  - NOISE_MIN_PATTERN: an individual pattern must produce at least this many
//    issues on its own. Without it, a repo with a long tail of tiny patterns pulls
//    the median so low that a pattern with only a handful of issues clears the
//    relative bar (e.g. median 3 → a 9-issue pattern is "3x" the median, yet 9
//    issues is nothing worth disabling a rule over).
//
// Relative signals — applied only once BOTH absolute floors pass; either one is
// enough:
//  - share: it alone accounts for at least NOISE_SHARE of all issues. Only applied
//    when there are at least NOISE_MIN_PATTERNS_FOR_SHARE distinct patterns — below
//    that, an even split already puts every pattern at or above the threshold, so
//    the signal is meaningless. The floor is 11 because an even split of N patterns
//    gives each a 1/N share, and 1/N only drops below NOISE_SHARE (10%) once N > 10
//    — with 8, 9, or 10 patterns a perfectly balanced repo (12.5% / 11.1% / 10%
//    each) would otherwise flag every pattern.
//  - multiple: it has at least NOISE_MEDIAN_MULTIPLE times the *median* issues-per-
//    pattern. Using the median (not the mean) keeps one huge pattern from inflating
//    the baseline and masking smaller-but-still-disproportionate patterns.
const NOISE_MIN_TOTAL = 200;
const NOISE_MIN_PATTERN = 100;
const NOISE_SHARE = 0.1;
const NOISE_MIN_PATTERNS_FOR_SHARE = 11;
const NOISE_MEDIAN_MULTIPLE = 3;
// Cap how many disable suggestions we print, to keep the section actionable.
const MAX_NOISE_SUGGESTIONS = 10;

// Human-friendly labels for the API's false-positive threshold buckets.
// `equalOrAboveThreshold` = FP probability >= threshold (a potential false
// positive); `belowThreshold` = below threshold (treated as a real issue).
const FALSE_POSITIVE_LABELS: Record<string, string> = {
  belowThreshold: "Not a False Positive",
  equalOrAboveThreshold: "Potential False Positive",
};

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

function printIgnoredIssuesList(issues: IgnoredIssue[], total: number): void {
  printSection("Ignored Issues", total, "issue");
  if (issues.length === 0) {
    console.log(ansis.dim("  No ignored issues found."));
    return;
  }
  const sorted = [...issues].sort((a, b) => {
    const aOrder = SEVERITY_ORDER[a.patternInfo.severityLevel] ?? 99;
    const bOrder = SEVERITY_ORDER[b.patternInfo.severityLevel] ?? 99;
    return aOrder - bOrder;
  });
  for (const issue of sorted) {
    printIgnoredIssueCard(issue);
  }
}

function printCountTable(title: string, counts: Count[]): void {
  if (counts.length === 0) return;
  const sorted = [...counts].sort((a, b) => b.total - a.total);
  const table = createTable({ head: [title, "Count"] });
  for (const c of sorted) {
    table.push([sanitizeText(c.name), String(c.total)]);
  }
  console.log(table.toString());
}

function printPatternsTable(patterns: PatternsCount[]): void {
  if (patterns.length === 0) return;
  const sorted = [...patterns].sort((a, b) => b.total - a.total);
  const table = createTable({ head: ["Pattern", "Count"] });
  for (const p of sorted) {
    table.push([`${sanitizeText(p.title)} ${ansis.dim(p.id)}`, String(p.total)]);
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
  potentialFalsePositives: Count[];
}): void {
  printSection("Issues Overview");
  const hasData =
    counts.categories.length > 0 ||
    counts.levels.length > 0 ||
    counts.languages.length > 0 ||
    counts.tags.length > 0 ||
    counts.patterns.length > 0 ||
    counts.authors.length > 0 ||
    counts.potentialFalsePositives.length > 0;

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
  if (counts.authors.length > 0 && counts.potentialFalsePositives.length > 0)
    console.log();
  printCountTable(
    "False Positives",
    relabelFalsePositives(counts.potentialFalsePositives),
  );
}

/** Map the API's threshold-bucket names to human-friendly false-positive labels. */
function relabelFalsePositives(counts: Count[]): Count[] {
  return counts.map((c) => ({
    ...c,
    name: FALSE_POSITIVE_LABELS[c.name] ?? c.name,
  }));
}

/** Median of a numeric list. Returns 0 for an empty list. */
function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Identify "noisy" patterns worth suggesting for disabling. Nothing is suggested
 * unless there are at least NOISE_MIN_TOTAL issues overall. A pattern is noisy
 * when it clears the absolute per-pattern floor (NOISE_MIN_PATTERN) AND shows a
 * relative signal: it accounts for at least NOISE_SHARE of all issues (share
 * rule — only when there are at least NOISE_MIN_PATTERNS_FOR_SHARE patterns) or
 * has at least NOISE_MEDIAN_MULTIPLE times the median issues-per-pattern (multiple
 * rule). Sorted by count desc. See the NOISE_* constants for the rationale.
 */
function detectNoisyPatterns(patterns: PatternsCount[]): PatternsCount[] {
  if (patterns.length === 0) return [];
  const total = patterns.reduce((sum, p) => sum + p.total, 0);
  if (total < NOISE_MIN_TOTAL) return [];
  const shareFloor = NOISE_SHARE * total;
  const medianFloor = NOISE_MEDIAN_MULTIPLE * medianOf(patterns.map((p) => p.total));
  const shareApplies = patterns.length >= NOISE_MIN_PATTERNS_FOR_SHARE;
  return patterns
    .filter(
      (p) =>
        p.total >= NOISE_MIN_PATTERN &&
        ((shareApplies && p.total >= shareFloor) || p.total >= medianFloor),
    )
    .sort((a, b) => b.total - a.total);
}

/**
 * Find the tool that owns a pattern by matching the pattern ID prefix against
 * each tool's `prefix` (the field Codacy uses to keep pattern names unique).
 * Longest matching prefix wins. Tools without a prefix can't be matched.
 */
function resolvePatternTool(
  patternId: string,
  tools: Tool[],
): Tool | undefined {
  let best: Tool | undefined;
  let bestLen = 0;
  for (const tool of tools) {
    if (!tool.prefix) continue;
    // The API prefix normally already carries the trailing underscore (e.g.
    // "ESLint_"), but normalize to "<prefix>_" so we match either way.
    const marker = tool.prefix.endsWith("_") ? tool.prefix : `${tool.prefix}_`;
    if (patternId.startsWith(marker) && marker.length > bestLen) {
      best = tool;
      bestLen = marker.length;
    }
  }
  return best;
}

interface NoiseSuggestion {
  title: string;
  total: number;
  // Exactly one of these is set: `command` is a runnable `codacy pattern …
  // --disable`; `action` is a manual step shown when the pattern can't be
  // disabled through the CLI (config-file-driven tool, or coding-standard
  // enforced).
  command?: string;
  action?: string;
}

/** Match a global tool to its repository-scoped tool by UUID, then by name. */
function findRepoTool(
  repoTools: AnalysisTool[],
  tool: Tool,
): AnalysisTool | undefined {
  return (
    repoTools.find((t) => t.uuid === tool.uuid) ??
    repoTools.find((t) => t.name.toLowerCase() === tool.name.toLowerCase())
  );
}

/**
 * Fetch the coding standards (if any) that enforce a pattern, by searching the
 * repo tool's patterns for an exact ID match and reading its `enabledBy`.
 */
async function fetchPatternStandards(
  ctx: { provider: string; organization: string; repository: string },
  toolUuid: string,
  patternId: string,
): Promise<string[]> {
  const resp = await AnalysisService.listRepositoryToolPatterns(
    ctx.provider,
    ctx.organization,
    ctx.repository,
    toolUuid,
    undefined, // languages
    undefined, // categories
    undefined, // severityLevels
    undefined, // tags
    patternId, // search by ID
  );
  const match = resp.data.find((cp) => cp.patternDefinition.id === patternId);
  return match?.enabledBy?.map((s) => s.name) ?? [];
}

/**
 * Build suggestions for noisy patterns. The owning tool is resolved by prefix;
 * patterns whose tool can't be resolved (no/unknown prefix) are silently
 * discarded. The suggested step depends on how the pattern is managed:
 *  - tool driven by a local config file → manual "update your config file" step
 *  - pattern enforced by a coding standard → manual "update the standard" step
 *  - otherwise → a runnable `codacy pattern … --disable` command
 */
interface NoiseSuggestionsResult {
  suggestions: NoiseSuggestion[];
  /** Resolvable noisy patterns beyond MAX_NOISE_SUGGESTIONS, not detailed. */
  remaining: number;
}

async function buildNoiseSuggestions(
  noisy: PatternsCount[],
  globalTools: Tool[],
  repoTools: AnalysisTool[],
  ctx: { provider: string; organization: string; repository: string },
): Promise<NoiseSuggestionsResult> {
  // Resolve owning tools synchronously and drop patterns we can't identify, then
  // cap to MAX_NOISE_SUGGESTIONS *before* any network calls — only the patterns
  // we actually display need their config-file / coding-standard status checked.
  const resolved = noisy
    .map((pattern) => ({
      pattern,
      tool: resolvePatternTool(pattern.id, globalTools),
    }))
    .filter(
      (r): r is { pattern: PatternsCount; tool: Tool } => r.tool !== undefined,
    );

  const candidates = resolved.slice(0, MAX_NOISE_SUGGESTIONS);

  const suggestions = await Promise.all(
    candidates.map(async ({ pattern, tool }): Promise<NoiseSuggestion> => {
      // The `pattern` command matches the tool by name; hyphenate spaces per its convention.
      const toolToken = tool.name.replace(/\s+/g, "-");
      const repoTool = findRepoTool(repoTools, tool);

      // A local configuration file overrides Codacy-side pattern config, so the
      // pattern must be disabled in that file rather than via the CLI.
      if (repoTool?.settings.usesConfigurationFile) {
        return {
          title: pattern.title,
          total: pattern.total,
          action: `Update your local ${tool.name} configuration file to disable the pattern`,
        };
      }

      // A pattern enforced by a coding standard must be changed in the standard.
      if (repoTool) {
        const standards = await fetchPatternStandards(
          ctx,
          repoTool.uuid,
          pattern.id,
        );
        if (standards.length > 0) {
          return {
            title: pattern.title,
            total: pattern.total,
            action: `Update ${standards.join(", ")} to disable the pattern`,
          };
        }
      }

      return {
        title: pattern.title,
        total: pattern.total,
        command: `codacy pattern ${toolToken} ${pattern.id} --disable`,
      };
    }),
  );

  return { suggestions, remaining: resolved.length - candidates.length };
}

/** Print the "Suggested actions to reduce noise" section. No-op when empty. */
function printNoiseSuggestions(
  suggestions: NoiseSuggestion[],
  remaining: number,
): void {
  if (suggestions.length === 0) return;

  console.log(ansis.bold("\nSuggested actions to reduce noise\n"));

  for (const s of suggestions) {
    const label = s.total === 1 ? "issue" : "issues";
    const reduction = ansis.green(`(-${formatCount(s.total)} ${label})`);
    console.log(`  Disable ${ansis.bold(`"${sanitizeText(s.title)}"`)} ${reduction}`);
    if (s.command) {
      console.log(`  ${ansis.dim(">")} ${s.command}`);
    } else if (s.action) {
      console.log(`  ${ansis.dim("→")} ${s.action}`);
    }
    console.log();
  }

  if (remaining > 0) {
    console.log(
      ansis.dim(
        `  … (${remaining} more noisy pattern${remaining === 1 ? "" : "s"})`,
      ),
    );
  }
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

/** Paginate through all tools and return the full list. */
async function fetchAllTools(): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const resp = await ToolsService.listTools(cursor, 100);
    tools.push(...resp.data);
    cursor = resp.pagination?.cursor;
  } while (cursor);
  return tools;
}

/**
 * Build the SearchRepositoryIssuesBody from parsed CLI options.
 * Resolves tool names/UUIDs via the Codacy API when --tools is provided.
 */
async function buildFilterBody(
  opts: Record<string, any>,
): Promise<SearchRepositoryIssuesBody> {
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

  if (opts.falsePositives === true) body.potentialFalsePositives = true;
  else if (opts.falsePositives === false) body.potentialFalsePositives = false;

  const toolInputs = parseCommaList(opts.tools);
  if (toolInputs)
    body.toolUuids = await resolveToolUuids(toolInputs, fetchAllTools);

  return body;
}

/**
 * Fetch every false positive issue (all pages) then ignore them in batches of
 * BULK_BATCH_SIZE. Prints progress via spinners and exits when done.
 */
async function executeBulkIgnore(
  provider: string,
  organization: string,
  repository: string,
  body: SearchRepositoryIssuesBody,
  reason: string,
  skipConfirmation: boolean,
  comment?: string,
): Promise<void> {
  const fetchSpinner = ora("Fetching issues...").start();
  const allIssues: CommitIssue[] = [];
  let cursor: string | undefined;

  do {
    const resp = await AnalysisService.searchRepositoryIssues(
      provider,
      organization,
      repository,
      cursor,
      100,
      body,
    );
    allIssues.push(...resp.data);
    cursor = resp.pagination?.cursor;
  } while (cursor);

  fetchSpinner.stop();

  if (allIssues.length === 0) {
    console.log(ansis.green("No issues found matching the current filters."));
    return;
  }

  const count = allIssues.length;
  const plural = count === 1 ? "" : "s";
  console.log(`Found ${ansis.bold(String(count))} issue${plural}.`);

  // Bulk-ignore is destructive and applies to every matching issue, so confirm
  // before proceeding — this guards against a mistyped or too-broad filter.
  // --skip-confirmation (-y) bypasses the prompt for CI/scripts; in a
  // non-interactive shell without that flag, confirmAction returns false and we
  // abort rather than ignore by accident.
  if (!skipConfirmation) {
    const confirmed = await confirmAction(
      `Ignore all ${count} matching issue${plural}? This marks them as ignored on Codacy.`,
    );
    if (!confirmed) {
      console.log(
        ansis.dim(
          "Aborted — no issues were ignored. Pass --skip-confirmation (-y) to bypass this prompt in CI or scripts.",
        ),
      );
      return;
    }
  }

  const ignoreSpinner = ora(`Ignoring ${count} issue${plural}...`).start();
  const issueIds = allIssues.map((i) => i.issueId);

  for (let i = 0; i < issueIds.length; i += BULK_BATCH_SIZE) {
    await AnalysisService.bulkIgnoreIssues(provider, organization, repository, {
      issueIds: issueIds.slice(i, i + BULK_BATCH_SIZE),
      reason,
      comment,
    });
  }

  ignoreSpinner.succeed(`Ignored ${ansis.bold(String(count))} issue${plural}.`);
  console.log(
    ansis.dim(`Run a new analysis to see changes reflected: codacy repository ${provider} ${organization} ${repository} --reanalyze`),
  );
}

export function registerIssuesCommand(program: Command) {
  program
    .command("issues")
    .alias("is")
    .description("Search for issues in a repository")
    .argument("[provider]", "git provider (gh, gl, or bb) — auto-detected from git remote if omitted")
    .argument("[organization]", "organization name")
    .argument("[repository]", "repository name")
    .option(
      "-b, --branch <branch>",
      "branch name (defaults to the main branch)",
    )
    .option("-p, --patterns <patterns>", "comma-separated list of pattern IDs")
    .option(
      "-T, --tools <tools>",
      "comma-separated tool UUIDs or names to filter by",
    )
    .option(
      "-s, --severities <severities>",
      "comma-separated severity levels: Critical, High, Medium, Minor (or Error, Warning, Info)",
    )
    .option(
      "-c, --categories <categories>",
      "comma-separated category names (e.g. Security, CodeStyle, ErrorProne)",
    )
    .option(
      "-l, --languages <languages>",
      "comma-separated list of language names",
    )
    .option("-t, --tags <tags>", "comma-separated list of tag names")
    .option("-a, --authors <authors>", "comma-separated list of author emails")
    .option(
      "-n, --limit <n>",
      "maximum number of issues to return (default: 100, max: 1000)",
      "100",
    )
    .option(
      "-O, --overview",
      "show issue count totals instead of the issues list",
    )
    .option(
      "-i, --ignored",
      "list issues that were marked as ignored instead of active ones",
    )
    .option(
      "-F, --false-positives [value]",
      "filter by potential false positives (true, false, or omit)",
      parseBooleanOption,
    )
    .option("-I, --ignore", "ignore all issues matching the current filters")
    .option(
      "-R, --ignore-reason <reason>",
      "reason for ignoring (AcceptedUse|FalsePositive|NotExploitable|TestCode|ExternalCode)",
      "AcceptedUse",
    )
    .option(
      "-m, --ignore-comment <comment>",
      "optional comment when using --ignore",
    )
    .option(
      "-y, --skip-confirmation",
      "skip the confirmation prompt when using --ignore (for CI/scripts)",
    )
    .addOption(repositoryTokenOption())
    .addHelpText(
      "after",
      `
Examples:
  $ codacy issues                                    # auto-detect from git remote
  $ codacy issues gh my-org my-repo
  $ codacy issues gh my-org my-repo --branch main --severities Critical,Medium
  $ codacy issues gh my-org my-repo --categories Security --overview
  $ codacy issues gh my-org my-repo --tools eslint,semgrep
  $ codacy issues gh my-org my-repo --limit 500
  $ codacy issues gh my-org my-repo --false-positives
  $ codacy issues gh my-org my-repo --false-positives false
  $ codacy issues gh my-org my-repo --ignored
  $ codacy issues gh my-org my-repo --ignored --severities Critical
  $ codacy issues gh my-org my-repo --ignore --branch main
  $ codacy issues gh my-org my-repo --false-positives --ignore --ignore-reason FalsePositive
  $ codacy issues gh my-org my-repo --ignore --ignore-reason NotExploitable --ignore-comment "Reviewed"
  $ codacy issues gh my-org my-repo --ignore --skip-confirmation   # no prompt (CI/scripts)
  $ codacy issues gh my-org my-repo --output json`,
    )
    .action(async function (
      this: Command,
      providerArg?: string,
      organizationArg?: string,
      repositoryArg?: string,
    ) {
      try {
        const auth = resolveAuth(this);
        const opts = this.opts();

        // Searching and the overview both accept a repository token; the ignore
        // endpoints don't. Refuse before `buildFilterBody` (which can hit the
        // network to resolve tool names) and before the fetch-all + confirmation
        // prompt inside `executeBulkIgnore`. This also lands ahead of the
        // flag-combination checks below, which is the right precedence: "your
        // token can't do this at all" beats "these two flags conflict".
        if (opts.ignored) {
          requireAccountToken(
            auth,
            "codacy issues --ignored",
            "listing ignored issues is not available to repository tokens",
          );
        }
        if (opts.ignore) {
          requireAccountToken(
            auth,
            "codacy issues --ignore",
            "ignoring issues is not available to repository tokens",
          );
        }

        const { provider, organization, repository } = resolveRepoArgs(
          [providerArg, organizationArg, repositoryArg],
          0,
          "issues",
          [],
        );
        const format = getOutputFormat(this);
        const isOverview = !!opts.overview;
        const listIgnored = !!opts.ignored;

        const body = await buildFilterBody(opts);
        const limit = Math.min(
          Math.max(parseInt(opts.limit, 10) || 100, 1),
          1000,
        );

        // Ignored issues are served by a dedicated endpoint that accepts the same
        // filter body. It's a read-only listing, so the mutating/aggregating modes
        // don't apply. --false-positives is intentionally NOT blocked: it's part of
        // the shared filter body, so "ignored issues that are potential false
        // positives" is a legitimate query.
        if (listIgnored) {
          if (isOverview) {
            this.error(
              "--overview cannot be used with --ignored; there is no ignored-issues overview",
            );
          }
          if (opts.ignore) {
            this.error(
              "--ignore cannot be used with --ignored; those issues are already ignored (unignore via `codacy issue <id> --unignore`)",
            );
          }

          const spinner = ora("Fetching ignored issues...").start();
          const pageSize = Math.min(limit, 100);
          let ignored: IgnoredIssue[] = [];
          let cursor: string | undefined;
          let total: number | undefined;

          do {
            const resp =
              await AnalysisService.searchRepositoryIgnoredIssues(
                provider,
                organization,
                repository,
                cursor,
                pageSize,
                body,
              );
            ignored = ignored.concat(resp.data);
            total ??= resp.pagination?.total;
            cursor = resp.pagination?.cursor;
          } while (cursor && ignored.length < limit);

          if (ignored.length > limit) ignored = ignored.slice(0, limit);
          total ??= ignored.length;
          spinner.stop();

          if (format === "json") {
            printJson({
              ignoredIssues: ignored.map((issue: any) =>
                pickDeep(issue, [
                  "issueId",
                  "reason",
                  "comment",
                  "ignoredByName",
                  "ignoredTimestamp",
                  "patternInfo.id",
                  "patternInfo.severityLevel",
                  "patternInfo.category",
                  "patternInfo.subCategory",
                  "message",
                  "filePath",
                  "lineNumber",
                  "lineText",
                  "falsePositiveProbability",
                  "falsePositiveThreshold",
                  "falsePositiveReason",
                ]),
              ),
            });
            return;
          }

          printIgnoredIssuesList(ignored, total);
          if (total > ignored.length) {
            printPaginationWarning(
              { cursor: "more", limit: ignored.length },
              "Use --limit <n> (max 1000) to fetch more, or --severities, --categories, --languages to filter.",
            );
          }
          return;
        }

        if (opts.ignore) {
          if (isOverview) {
            this.error(
              "--overview cannot be used with --ignore; --overview is a read-only display mode",
            );
          }
          if (this.getOptionValueSource("limit") === "cli") {
            this.error(
              "--limit cannot be used with --ignore; the ignore path always processes all matching issues",
            );
          }
          await executeBulkIgnore(
            provider,
            organization,
            repository,
            body,
            opts.ignoreReason,
            !!opts.skipConfirmation,
            opts.ignoreComment,
          );
          return;
        }

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

          const counts = overviewResponse.data.counts;

          if (format === "json") {
            spinner.stop();
            printJson(
              pickDeep({ overview: counts }, [
                "overview.categories",
                "overview.levels",
                "overview.languages",
                "overview.tags",
                "overview.patterns",
                "overview.authors",
                "overview.potentialFalsePositives",
              ]),
            );
            return;
          }

          // Resolve disable suggestions for noisy patterns. The extra tools fetch
          // only happens when there's something to suggest, and stays under the
          // spinner so the user sees progress rather than a stall.
          const noisy = detectNoisyPatterns(counts.patterns);
          let suggestions: NoiseSuggestion[] = [];
          let moreNoisy = 0;
          if (noisy.length > 0) {
            spinner.text = "Checking for noisy patterns...";
            // Global tools give each pattern's owning tool (via prefix); repo
            // tools tell us which ones are config-file-driven and let us check
            // coding-standard enforcement per pattern.
            const [globalTools, repoToolsResponse] = await Promise.all([
              fetchAllTools(),
              AnalysisService.listRepositoryTools(
                provider,
                organization,
                repository,
              ),
            ]);
            const built = await buildNoiseSuggestions(
              noisy,
              globalTools,
              repoToolsResponse.data,
              { provider, organization, repository },
            );
            suggestions = built.suggestions;
            moreNoisy = built.remaining;
          }
          spinner.stop();

          printOverview({
            categories: counts.categories,
            levels: counts.levels,
            languages: counts.languages,
            tags: counts.tags,
            patterns: counts.patterns,
            authors: counts.authors,
            potentialFalsePositives: counts.potentialFalsePositives,
          });
          printNoiseSuggestions(suggestions, moreNoisy);
        } else {
          const pageSize = Math.min(limit, 100);
          let issues: CommitIssue[] = [];
          let cursor: string | undefined;
          let total: number | undefined;

          do {
            const issuesResponse = await AnalysisService.searchRepositoryIssues(
              provider,
              organization,
              repository,
              cursor,
              pageSize,
              body,
            );
            issues = issues.concat(issuesResponse.data);
            total ??= issuesResponse.pagination?.total;
            cursor = issuesResponse.pagination?.cursor;
          } while (cursor && issues.length < limit);

          // Trim to exact limit
          if (issues.length > limit) issues = issues.slice(0, limit);
          total ??= issues.length;
          spinner.stop();

          if (format === "json") {
            printJson({
              issues: issues.map((issue: any) =>
                pickDeep(issue, [
                  "patternInfo.id",
                  "patternInfo.severityLevel",
                  "patternInfo.category",
                  "patternInfo.subCategory",
                  "message",
                  "filePath",
                  "lineNumber",
                  "lineText",
                  "resultDataId",
                  "falsePositiveProbability",
                  "falsePositiveThreshold",
                  "falsePositiveReason",
                  "advisoryInformation.advisoryId",
                  "advisoryInformation.vulnerableFunctions",
                  "advisoryInformation.publishedAt",
                ]),
              ),
            });
            return;
          }

          printIssuesList(issues, total);
          if (total > issues.length) {
            printPaginationWarning(
              { cursor: "more", limit: issues.length },
              "Use --limit <n> (max 1000) to fetch more, or --severities, --categories, --languages to filter.",
            );
          }
        }
      } catch (err) {
        handleError(err);
      }
    });
}
