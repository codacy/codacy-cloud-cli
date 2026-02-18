import ansis from "ansis";
import { PullRequestWithAnalysis } from "../api/client/models/PullRequestWithAnalysis";
import { AnalysisResultReason } from "../api/client/models/AnalysisResultReason";

export type GateStatusMap = {
  issues?: boolean;
  security?: boolean;
  coverage?: boolean;
  complexity?: boolean;
  duplication?: boolean;
};

/**
 * Print a bold section header.
 */
export function printSection(title: string): void {
  console.log(ansis.bold(`\n${title}\n`));
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
