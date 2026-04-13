import ansis from "ansis";
import numeral from "numeral";
import pluralize from "pluralize";
import { format as dateFnsFormat, parseISO, isValid, differenceInHours } from "date-fns";
import { PullRequestWithAnalysis } from "../api/client/models/PullRequestWithAnalysis";
import { AnalysisResultReason } from "../api/client/models/AnalysisResultReason";
import { CommitIssue } from "../api/client/models/CommitIssue";
import { SeverityLevel } from "../api/client/models/SeverityLevel";
import { Pattern } from "../api/client/models/Pattern";
import { CodeBlockLine } from "../api/client/models/CodeBlockLine";
import { CveRecord } from "./cve";
import { AnalysisTool } from "../api/client/models/AnalysisTool";
import { Tool } from "../api/client/models/Tool";
import { formatFriendlyDate } from "./output";

export const SEVERITY_DISPLAY: Record<string, string> = {
  Error: "Critical",
  High: "High",
  Warning: "Medium",
  Info: "Minor",
};

export function colorSeverity(level: SeverityLevel): string {
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

/**
 * Color a security finding priority level.
 * Matches the same palette as colorSeverity (Critical=red, High=orange, Medium=yellow, Low=blue).
 */
export function colorPriority(priority: string): string {
  switch (priority) {
    case "Critical":
      return ansis.red(priority);
    case "High":
      return ansis.hex("#FF8C00")(priority);
    case "Medium":
      return ansis.yellow(priority);
    case "Low":
      return ansis.blue(priority);
    default:
      return priority;
  }
}

/**
 * Color a security finding status.
 * Uses distinct colors that don't clash with severity (magenta/violet/green).
 */
export function colorStatus(status: string): string {
  switch (status) {
    case "Overdue":
      return ansis.magenta(status);
    case "DueSoon":
      return ansis.hex("#8B5CF6")(status);
    case "OnTrack":
      return ansis.green(status);
    default:
      // ClosedOnTime, ClosedLate, Ignored
      return ansis.dim(status);
  }
}

/**
 * Format a due date as YYYY-MM-DD (relative time doesn't make sense for deadlines).
 */
export function formatDueDate(dateStr: string): string {
  const date = parseISO(dateStr);
  if (!isValid(date)) return "N/A";
  return dateFnsFormat(date, "yyyy-MM-dd");
}

/**
 * Print a single issue card shared by the `issues` and `pull-request` commands.
 * The issue ID (resultDataId) is appended at the end of the first line in a
 * very dim color so it doesn't draw attention but is easy to copy.
 */
export function printIssueCard(
  issue: CommitIssue,
  options?: { isPotential?: boolean },
): void {
  const pattern = issue.patternInfo;
  const separator = ansis.dim("─".repeat(40));

  console.log();

  // Line 1: Severity | Category SubCategory? | POTENTIAL?   <dim id>
  const severity = colorSeverity(pattern.severityLevel);
  const subCat = pattern.subCategory ? ` ${pattern.subCategory}` : "";
  const potentialTag = options?.isPotential
    ? ` ${ansis.dim("|")} ${ansis.dim("POTENTIAL")}`
    : "";
  const id = ansis.hex("#555555")(`#${issue.resultDataId}`);
  console.log(
    `${severity} ${ansis.dim("|")} ${pattern.category}${subCat}${potentialTag}  ${id}`,
  );

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

export type GateStatusMap = {
  issues?: boolean;
  security?: boolean;
  coverage?: boolean;
  complexity?: boolean;
  duplication?: boolean;
};

/**
 * Format a count with abbreviated notation for large numbers (e.g. 1200 → "1.2k").
 */
export function formatCount(n: number): string {
  return numeral(n).format("0.[0]a");
}

/**
 * Print a bold section header, optionally with a total count.
 * e.g. printSection("Issues", 45000, "issue") → "Issues — Found 45k issues"
 */
export function printSection(
  title: string,
  total?: number,
  itemLabel?: string,
): void {
  let header = title;
  if (total !== undefined) {
    const label = itemLabel ? ` ${pluralize(itemLabel, total)}` : "";
    header += ` — Found ${formatCount(total)}${label}`;
  }
  console.log(ansis.bold(`\n${header}\n`));
}

/**
 * Truncate a string to a maximum length, appending "..." if truncated.
 */
export function truncate(text: string, max: number): string {
  return text.length > max ? text.substring(0, max - 3) + "..." : text;
}

/**
 * Color a metric value based on a threshold.
 * "max" thresholds: green if under, red if over.
 * "min" thresholds: green if above, red if under.
 */
export function colorMetric(
  value: number | undefined,
  threshold: number | undefined,
  mode: "max" | "min",
): string {
  if (value === undefined || value === null) return ansis.dim("N/A");
  const display = `${value.toFixed(1)}%`;
  if (threshold === undefined) return display;
  if (mode === "max") {
    return value > threshold ? ansis.red(display) : ansis.green(display);
  }
  return value < threshold ? ansis.red(display) : ansis.green(display);
}

/**
 * Color a value string based on gate status (green if passing, red if failing).
 * Falls back to no coloring if gate status is unknown.
 */
export function colorByGate(
  display: string,
  passing: boolean | undefined,
): string {
  if (passing === undefined) return display;
  return passing ? ansis.green(display) : ansis.red(display);
}

/**
 * Format a delta value with +/- sign, optionally colored by gate status.
 */
export function formatDelta(
  value: number | undefined,
  passing?: boolean,
): string {
  if (value === undefined || value === null) return ansis.dim("N/A");
  const sign = value > 0 ? "+" : "";
  const display = `${sign}${value}`;
  if (passing !== undefined) return colorByGate(display, passing);
  if (value > 0) return ansis.red(display);
  if (value < 0) return ansis.green(display);
  return display;
}

/**
 * Build a map of gate pass/fail from quality and coverage resultReasons.
 * Gate names are matched by keyword to map to metric columns.
 */
export function buildGateStatus(pr: PullRequestWithAnalysis): GateStatusMap {
  const status: GateStatusMap = {};
  const reasons: AnalysisResultReason[] = [
    ...(pr.quality?.resultReasons || []),
    ...(pr.coverage?.resultReasons || []),
  ];
  for (const r of reasons) {
    const gate = r.gate.toLowerCase();
    if (gate.includes("security") && gate.includes("issue")) {
      status.security = r.isUpToStandards;
    } else if (gate.includes("issue")) {
      status.issues = r.isUpToStandards;
    } else if (gate.includes("coverage")) {
      status.coverage = r.isUpToStandards;
    } else if (gate.includes("complexity")) {
      status.complexity = r.isUpToStandards;
    } else if (gate.includes("duplication") || gate.includes("clone")) {
      status.duplication = r.isUpToStandards;
    }
  }
  return status;
}

/**
 * Compute up-to-standards from quality and coverage (ignoring the global field).
 * Red ✗ if either is false, green ✓ if all available are true, dim - if no data.
 */
export function formatStandards(pr: PullRequestWithAnalysis): string {
  const covUp = pr.coverage?.isUpToStandards;
  const qualUp = pr.quality?.isUpToStandards;
  if (covUp === undefined && qualUp === undefined) return ansis.dim("-");
  if (covUp === false || qualUp === false) return ansis.red("✗");
  return ansis.green("✓");
}

/**
 * Format PR coverage: diffCoverage% (+/-deltaCoverage%), colored by gate.
 */
export function formatPrCoverage(
  pr: PullRequestWithAnalysis,
  passing?: boolean,
): string {
  const diff = pr.coverage?.diffCoverage?.value;
  const delta = pr.coverage?.deltaCoverage;
  if (diff === undefined && delta === undefined) return ansis.dim("N/A");
  const diffStr = diff !== undefined ? `${diff.toFixed(1)}%` : "N/A";
  const deltaSign = delta !== undefined && delta > 0 ? "+" : "";
  const deltaStr =
    delta !== undefined ? `(${deltaSign}${delta.toFixed(1)}%)` : "";
  const display = deltaStr ? `${diffStr} ${deltaStr}` : diffStr;
  return colorByGate(display, passing);
}

/**
 * Format PR issues: +newIssues / -fixedIssues.
 * New issues colored by gate status (red if failing), fixed issues always gray.
 */
export function formatPrIssues(
  pr: PullRequestWithAnalysis,
  passing?: boolean,
): string {
  const newI = pr.newIssues !== undefined ? `+${pr.newIssues}` : "N/A";
  const fixI = pr.fixedIssues !== undefined ? `-${pr.fixedIssues}` : "N/A";
  const newColored = colorByGate(newI, passing);
  return `${newColored} / ${ansis.dim(fixI)}`;
}

function colorCvssSeverity(severity: string | undefined): string {
  switch (severity?.toLowerCase()) {
    case "critical": return ansis.red(severity!);
    case "high":     return ansis.hex("#FF8C00")(severity!);
    case "medium":   return ansis.yellow(severity!);
    case "low":      return ansis.green(severity!);
    default:         return severity ?? "-";
  }
}

/**
 * Print a CVE enrichment block (title, CVSS, dates, description, references).
 * Shared between the no-issue path in `finding.ts` and injected inside
 * `printIssueCodeContext` for Codacy-source findings with a linked issue.
 */
export function printCveBlock(cve: CveRecord): void {
  const meta = cve.cveMetadata;
  const cna  = cve.containers.cna;
  const adp  = cve.containers.adp ?? [];

  console.log();
  console.log(ansis.bold(`About ${meta.cveId}`));

  // CVSS scores + published/updated on one line
  const infoParts: string[] = [];
  if (cna.metrics?.length) {
    const scoreLabels = cna.metrics.map((m) => {
      const score =
        m.cvssV4_0?.baseScore ??
        m.cvssV3_1?.baseScore ??
        m.cvssV3_0?.baseScore ??
        m.cvssV2_0?.baseScore;
      const severity =
        m.cvssV4_0?.baseSeverity ??
        m.cvssV3_1?.baseSeverity ??
        m.cvssV3_0?.baseSeverity;
      return `${score ?? "-"} | ${colorCvssSeverity(severity)}`;
    });
    infoParts.push(`CVSS: ${scoreLabels.join("  ")}`);
  }
  if (meta.datePublished) infoParts.push(`Published: ${formatDueDate(meta.datePublished)}`);
  if (meta.dateUpdated)   infoParts.push(`Updated: ${formatDueDate(meta.dateUpdated)}`);
  if (infoParts.length)   console.log(ansis.dim(infoParts.join("   ")));

  // Title: prefer cna.title, fall back to first English problem type description
  const title =
    cna.title ??
    cna.problemTypes?.[0]?.descriptions?.find((d) => d.lang === "en")?.description;
  if (title) {
    console.log();
    console.log(title);
  }

  // English description
  const desc = cna.descriptions?.find((d) => d.lang === "en")?.value;
  if (desc) {
    console.log();
    console.log(desc);
  }

  // Deduplicated references from cna and all adp containers
  const seen = new Set<string>();
  const uniqueRefs = [
    ...(cna.references ?? []),
    ...adp.flatMap((a) => a.references ?? []),
  ].filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  if (uniqueRefs.length > 0) {
    console.log();
    console.log(ansis.bold("References:"));
    for (const ref of uniqueRefs) {
      console.log(ansis.dim(`  ${ref.url}`));
    }
  }
}

/**
 * Format and print the ±5 line code context around the issue.
 * The issue line is shown in bold; an optional suggestion is shown
 * in green+bold on the same line number directly below it.
 */
export function printFileContext(
  lines: CodeBlockLine[],
  issueLine: number,
  suggestion: string | undefined,
): void {
  const maxLineNum = Math.max(...lines.map((l) => l.number), issueLine + 5);
  const width = String(maxLineNum).length;

  for (const line of lines) {
    const num = String(line.number).padStart(width, " ");
    const content = line.content;
    if (line.number === issueLine) {
      console.log(ansis.bold(`${num} | ${content}`));
      if (suggestion) {
        console.log(ansis.bold(ansis.green(`${num} | ${suggestion}`)));
      }
    } else {
      console.log(ansis.dim(`${num} | ${content}`));
    }
  }
}

/**
 * Print file path, code context, false positive warning, optional CVE block,
 * and pattern documentation.
 * Extracted so it can be reused by both the `issue` command and Codacy-source `finding` details.
 * When `cveData` is provided it is injected between the code block and the pattern docs.
 */
export function printIssueCodeContext(
  issue: CommitIssue,
  pattern: Pattern | null,
  lines: CodeBlockLine[] | null,
  cveData?: CveRecord | null,
): void {
  console.log();

  // File path : line
  console.log(ansis.dim(`${issue.filePath}:${issue.lineNumber}`));
  console.log();

  // Extended code context (or fall back to single line from issue)
  if (lines && lines.length > 0) {
    printFileContext(lines, issue.lineNumber, issue.suggestion);
  } else {
    // Fallback: just show the lineText we already have
    const num = String(issue.lineNumber).padStart(4, " ");
    console.log(ansis.bold(`${num} | ${issue.lineText}`));
    if (issue.suggestion) {
      console.log(ansis.bold(ansis.green(`${num} | ${issue.suggestion}`)));
    }
  }

  // False positive warning
  if (
    issue.falsePositiveProbability !== undefined &&
    issue.falsePositiveProbability >= issue.falsePositiveThreshold
  ) {
    const reason = issue.falsePositiveReason || "No reason provided";
    console.log();
    console.log(ansis.yellow(`Potential false positive: ${reason}`));
  }

  // CVE enrichment — injected between code context and pattern docs
  if (cveData) {
    printCveBlock(cveData);
  }

  if (!pattern) {
    return;
  }

  // Pattern description
  if (pattern.description) {
    console.log();
    console.log(ansis.bold("About this pattern"));
    console.log(pattern.description);
  }

  // Rationale
  if (pattern.rationale) {
    console.log();
    console.log(ansis.bold("Why is this a problem?"));
    console.log(pattern.rationale);
  }

  // Solution
  if (pattern.solution) {
    console.log();
    console.log(ansis.bold("How to fix it?"));
    console.log(pattern.solution);
  }

  // Tags
  if (pattern.tags && pattern.tags.length > 0) {
    console.log();
    console.log(ansis.dim(`Tags: ${pattern.tags.join(", ")}`));
  }

  // Detected by
  console.log();
  const toolName = issue.toolInfo.name;
  const patternRef = pattern.title
    ? `${pattern.title} (${pattern.id})`
    : pattern.id;
  console.log(ansis.dim(`Detected by: ${toolName}`));
  console.log(ansis.dim(patternRef));
}

/**
 * Print the full detail view for a single quality issue, including code context
 * and pattern documentation. Used by both the `issue` command and the
 * `pull-request --issue` option.
 */
export function printIssueDetail(
  issue: CommitIssue,
  pattern: Pattern | null,
  lines: CodeBlockLine[] | null,
): void {
  const p = issue.patternInfo;

  console.log();

  // Header: Severity | Category SubCategory
  const severity = colorSeverity(p.severityLevel);
  const subCat = p.subCategory ? ` ${ansis.dim(p.subCategory)}` : "";
  console.log(`${severity} ${ansis.dim("|")} ${p.category}${subCat}`);

  // Message
  console.log(issue.message);

  // Code context + pattern info (shared with finding command for Codacy-source findings)
  printIssueCodeContext(issue, pattern, lines);
}

/**
 * Find a tool from a list by name using best-match logic:
 * 1. Exact match (case-insensitive, hyphens treated as spaces)
 * 2. Tool name starts with input + space ("jackson" → "Jackson Linter")
 * 3. Any prefix match — shortest wins
 */
export function findToolByName(
  tools: AnalysisTool[],
  nameInput: string,
): AnalysisTool | undefined {
  const normalized = nameInput.toLowerCase().replace(/-/g, " ");

  const exact = tools.find((t) => t.name.toLowerCase() === normalized);
  if (exact) return exact;

  const wordPrefixMatches = tools.filter((t) =>
    t.name.toLowerCase().startsWith(normalized + " "),
  );
  if (wordPrefixMatches.length > 0) {
    return wordPrefixMatches.sort((a, b) => a.name.length - b.name.length)[0];
  }

  const anyPrefixMatches = tools.filter((t) =>
    t.name.toLowerCase().startsWith(normalized),
  );
  return anyPrefixMatches.sort((a, b) => a.name.length - b.name.length)[0];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a list of tool inputs (UUIDs or name strings) to UUIDs.
 *
 * Resolution order for each non-UUID input:
 * 1. Exact match (case-insensitive) on tool.name
 * 2. Exact match (case-insensitive) on tool.shortName
 * 3. Substring search (case-insensitive) on name, shortName, and prefix — only if exactly one tool matches
 *
 * The fetchTools callback is only called when at least one input is not a UUID.
 */
export async function resolveToolUuids(
  inputs: string[],
  fetchTools: () => Promise<Tool[]>,
): Promise<string[]> {
  let allTools: Tool[] | undefined;

  const uuids: string[] = [];
  for (const input of inputs) {
    if (UUID_RE.test(input)) {
      uuids.push(input);
      continue;
    }

    if (!allTools) {
      allTools = await fetchTools();
    }

    const lower = input.toLowerCase();

    // Exact match on name
    const nameMatch = allTools.find((t) => t.name.toLowerCase() === lower);
    if (nameMatch) {
      uuids.push(nameMatch.uuid);
      continue;
    }

    // Exact match on shortName
    const shortMatch = allTools.find((t) => t.shortName.toLowerCase() === lower);
    if (shortMatch) {
      uuids.push(shortMatch.uuid);
      continue;
    }

    // Substring search on name, shortName, and prefix
    const matches = allTools.filter((t) => {
      return (
        t.name.toLowerCase().includes(lower) ||
        t.shortName.toLowerCase().includes(lower) ||
        (t.prefix && t.prefix.toLowerCase().includes(lower))
      );
    });

    if (matches.length === 1) {
      uuids.push(matches[0].uuid);
    } else if (matches.length === 0) {
      throw new Error(`Tool "${input}" not found.`);
    } else {
      const names = matches.map((t) => t.name).join(", ");
      throw new Error(`Tool "${input}" is ambiguous, matches: ${names}`);
    }
  }

  return [...new Set(uuids)];
}

const COVERAGE_REPORTS_WAIT_HOURS = 3;

/**
 * Format the analysis status string for a commit (used by repository and pull-request commands).
 *
 * Logic:
 * - Being analyzed = startedAnalysis exists and (no endedAnalysis OR startedAnalysis > endedAnalysis)
 * - If being analyzed + has previous endedAnalysis: "Finished {date} ({sha}) — Reanalysis in progress..."
 * - If being analyzed + no previous finish: "In progress... ({sha})"
 * - If finished + expects coverage but no data:
 *   - ≤3h: "Finished {date} ({sha}) — Waiting for coverage reports..."
 *   - >3h: "Finished {date} ({sha}) — Missing coverage reports"
 * - If finished normally: "Finished {date} ({sha})"
 * - No analysis data: dim "Never"
 */
export function formatAnalysisStatus(opts: {
  commitSha: string;
  startedAnalysis?: string;
  endedAnalysis?: string;
  expectsCoverage: boolean;
  hasCoverageData: boolean;
}): string {
  const { commitSha, startedAnalysis, endedAnalysis, expectsCoverage, hasCoverageData } = opts;
  const shortSha = commitSha.substring(0, 7);

  if (!startedAnalysis && !endedAnalysis) {
    return ansis.dim("Never");
  }

  const isBeingAnalyzed =
    !!startedAnalysis &&
    (!endedAnalysis || parseISO(startedAnalysis) > parseISO(endedAnalysis));

  if (isBeingAnalyzed) {
    if (endedAnalysis) {
      const finishedDate = formatFriendlyDate(endedAnalysis);
      return `Finished ${finishedDate} (${shortSha}) — ${ansis.blueBright("Reanalysis in progress...")}`;
    }
    return `${ansis.blueBright("In progress...")} (${shortSha})`;
  }

  // Analysis is finished
  if (endedAnalysis) {
    const finishedDate = formatFriendlyDate(endedAnalysis);
    const base = `Finished ${finishedDate} (${shortSha})`;

    if (expectsCoverage && !hasCoverageData) {
      const hoursSinceFinish = differenceInHours(new Date(), parseISO(endedAnalysis));
      if (hoursSinceFinish <= COVERAGE_REPORTS_WAIT_HOURS) {
        return `${base} — ${ansis.blueBright("Waiting for coverage reports...")}`;
      }
      return `${base} — ${ansis.yellow("Missing coverage reports")}`;
    }

    return base;
  }

  return ansis.dim("Never");
}
