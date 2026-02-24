import ansis from "ansis";
import numeral from "numeral";
import pluralize from "pluralize";
import { PullRequestWithAnalysis } from "../api/client/models/PullRequestWithAnalysis";
import { AnalysisResultReason } from "../api/client/models/AnalysisResultReason";
import { CommitIssue } from "../api/client/models/CommitIssue";
import { SeverityLevel } from "../api/client/models/SeverityLevel";
import { Pattern } from "../api/client/models/Pattern";
import { CodeBlockLine } from "../api/client/models/CodeBlockLine";

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

  if (!pattern) {
    return;
  }

  // Pattern description
  if (pattern.description) {
    console.log();
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
