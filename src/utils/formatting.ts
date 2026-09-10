import ansis from "ansis";
import numeral from "numeral";
import pluralize from "pluralize";
import { format as dateFnsFormat, parseISO, isValid, differenceInHours } from "date-fns";
import { PullRequestWithAnalysis } from "../api/client/models/PullRequestWithAnalysis";
import { AnalysisResultReason } from "../api/client/models/AnalysisResultReason";
import { CommitIssue } from "../api/client/models/CommitIssue";
import { IgnoredIssue } from "../api/client/models/IgnoredIssue";
import { AdvisoryInformation } from "../api/client/models/AdvisoryInformation";
import { SeverityLevel } from "../api/client/models/SeverityLevel";
import { Pattern } from "../api/client/models/Pattern";
import { ConfiguredPattern } from "../api/client/models/ConfiguredPattern";
import { CodeBlockLine } from "../api/client/models/CodeBlockLine";
import { Coverage } from "../api/client/models/Coverage";
import { CoverageStatus } from "../api/client/models/CoverageStatus";
import { CveRecord } from "./cve";
import { AnalysisTool } from "../api/client/models/AnalysisTool";
import { Tool } from "../api/client/models/Tool";
import { formatFriendlyDate } from "./output";
import { sanitizeText } from "./sanitize";

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

// --- Dependency chains (SCA findings) -------------------------------------
//
// An SCA finding may carry `dependencyChains` (string[][]): each inner array is
// one ordered import chain from a root package down to the vulnerable package
// (the last segment). A finding can have several chains reaching the same
// vulnerable package via different paths. We surface these on both the findings
// list and the finding detail.

// Chains with more than this many packages collapse their middle into "... N more ...".
const CHAIN_FULL_MAX = 3;

/**
 * Join a dependency chain with " → ", collapsing the middle when the chain has
 * more than 3 packages (showing only the first and last, e.g.
 * `a@1 → ... 2 more ... → d@4`). Chains with ≤ 3 packages are shown in full.
 */
export function formatDependencyChain(chain: string[]): string {
  // Package names come from the repository's manifest — sanitize each segment.
  const safe = chain.map((pkg) => sanitizeText(pkg));
  if (safe.length <= CHAIN_FULL_MAX) return safe.join(" → ");
  const hidden = safe.length - 2;
  return `${safe[0]} → ... ${hidden} more ... → ${safe[safe.length - 1]}`;
}

/**
 * Render the body of a single chain line (without the Direct/Transitive label).
 * A single-package chain is a direct dependency and gets actionable update text;
 * longer chains show the (possibly collapsed) import path plus the fixed version.
 */
function dependencyChainBody(chain: string[], fixedVersion?: string[]): string {
  const fixed = fixedVersion?.length
    ? fixedVersion.map((v) => sanitizeText(v)).join(", ")
    : "";
  if (chain.length === 1) {
    // Direct dependency: the package is imported directly, so show how to fix it.
    const pkg = sanitizeText(chain[0]);
    return fixed ? `Update ${pkg} to ${fixed}` : `Update ${pkg}`;
  }
  const suffix = fixed ? ` (Fixed in ${fixed})` : "";
  return `${formatDependencyChain(chain)}${suffix}`;
}

/**
 * Format the "affected → fixed" version segment shown on a finding's status line
 * for SCA findings that have no dependency chains. Returns null when there is no
 * affected version. `includeUpdatePrefix` prepends "Update " (the findings list
 * uses it; the finding detail does not).
 */
export function formatVersionSegment(
  affectedVersion?: string,
  fixedVersion?: string[],
  options?: { includeUpdatePrefix?: boolean },
): string | null {
  if (!affectedVersion) return null;
  // Version strings come from the repository's manifest — sanitize them.
  const fixed = fixedVersion?.length
    ? ` → ${fixedVersion.map((v) => sanitizeText(v)).join(", ")}`
    : "";
  const prefix = options?.includeUpdatePrefix ? "Update " : "";
  return `${prefix}${sanitizeText(affectedVersion)}${fixed}`;
}

/**
 * One-line dependency summary for the findings list: the first chain prefixed
 * with its Direct/Transitive label, plus "... and N more" when there are extra
 * chains. Returns null when there are no chains.
 */
export function formatDependencyChainsLine(
  chains?: string[][],
  fixedVersion?: string[],
): string | null {
  if (!chains?.length) return null;
  const first = chains[0];
  const label = first.length === 1 ? "Direct" : "Transitive";
  let line = `${label} - ${dependencyChainBody(first, fixedVersion)}`;
  if (chains.length > 1) line += ` ... and ${chains.length - 1} more`;
  return line;
}

/**
 * Multi-line dependency block for the finding detail: every chain on its own
 * line. The label (from the first chain) is shown once; continuation lines are
 * indented so the "-" aligns under it. Returns null when there are no chains.
 */
export function formatDependencyChainsBlock(
  chains?: string[][],
  fixedVersion?: string[],
): string | null {
  if (!chains?.length) return null;
  const label = chains[0].length === 1 ? "Direct" : "Transitive";
  const indent = " ".repeat(label.length + 1) + "- ";
  return chains
    .map(
      (chain, i) =>
        `${i === 0 ? `${label} - ` : indent}${dependencyChainBody(chain, fixedVersion)}`,
    )
    .join("\n");
}

/**
 * Print a single issue card shared by the `issues` and `pull-request` commands.
 * The issue ID (resultDataId) is appended at the end of the first line in a
 * very dim color so it doesn't draw attention but is easy to copy.
 */
const CARD_SEPARATOR = ansis.dim("─".repeat(40));

/**
 * Render the part of an issue card shared by active and ignored issues: the
 * `Severity | Category SubCategory? | POTENTIAL?  <id>` header, the message,
 * and the `file:line` + line-content block. Callers append their own trailing
 * section (false-positive warning / ignore metadata) and the separator.
 *
 * `idText` is the already-formatted id string — active cards pass `#<resultDataId>`,
 * ignored cards pass the string `issueId` (which has no numeric resultDataId).
 */
function printIssueCardBody(fields: {
  severityLevel: SeverityLevel;
  category: string;
  subCategory?: string;
  idText: string;
  message: string;
  filePath: string;
  lineNumber?: number;
  lineText?: string;
  isPotential?: boolean;
}): void {
  console.log();

  const severity = colorSeverity(fields.severityLevel);
  const subCat = fields.subCategory
    ? ` ${sanitizeText(fields.subCategory)}`
    : "";
  const potentialTag = fields.isPotential
    ? ` ${ansis.dim("|")} ${ansis.dim("POTENTIAL")}`
    : "";
  const id = ansis.hex("#555555")(fields.idText);
  console.log(
    `${severity} ${ansis.dim("|")} ${sanitizeText(fields.category)}${subCat}${potentialTag}  ${id}`,
  );

  console.log(sanitizeText(fields.message));
  console.log();

  console.log(ansis.dim(`${sanitizeText(fields.filePath)}:${fields.lineNumber}`));
  if (fields.lineText) {
    console.log(ansis.dim(sanitizeText(fields.lineText.trim())));
  }
}

export function printIssueCard(
  issue: CommitIssue,
  options?: { isPotential?: boolean },
): void {
  const pattern = issue.patternInfo;

  printIssueCardBody({
    severityLevel: pattern.severityLevel,
    category: pattern.category,
    subCategory: pattern.subCategory,
    idText: `#${issue.resultDataId}`,
    message: issue.message,
    filePath: issue.filePath,
    lineNumber: issue.lineNumber,
    lineText: issue.lineText,
    isPotential: options?.isPotential,
  });

  // False positive detection
  if (
    issue.falsePositiveProbability !== undefined &&
    issue.falsePositiveProbability >= issue.falsePositiveThreshold
  ) {
    const reason = issue.falsePositiveReason || "No reason provided";
    console.log();
    console.log(ansis.yellow(`Potential false positive: ${reason}`));
  }

  // Vulnerable functions (SCA issues with an OSV-linked advisory), compact form
  if (issue.advisoryInformation?.vulnerableFunctions?.length) {
    console.log();
    console.log(ansis.dim(`Vulnerable functions: ${summarizeFunctions(issue.advisoryInformation.vulnerableFunctions)}`));
  }

  console.log();
  console.log(CARD_SEPARATOR);
}

/**
 * Summarize a list of vulnerable function names for compact card display,
 * capping at 3 entries with a "+N more" suffix for longer lists.
 */
export function summarizeFunctions(fns: string[], limit = 3): string {
  const shown = fns.slice(0, limit).map(sanitizeText).join(", ");
  const more = fns.length > limit ? ` (+${fns.length - limit} more)` : "";
  return `${shown}${more}`;
}

/**
 * Card renderer for an ignored issue. Reuses `printIssueCardBody` for the shared
 * layout, then appends the ignore metadata line (reason / who / when) and an
 * optional comment. `IgnoredIssue` has no numeric `resultDataId`, so the header
 * shows the string `issueId`.
 */
export function printIgnoredIssueCard(issue: IgnoredIssue): void {
  const pattern = issue.patternInfo;

  printIssueCardBody({
    severityLevel: pattern.severityLevel,
    category: pattern.category,
    subCategory: pattern.subCategory,
    idText: issue.issueId,
    message: issue.message,
    filePath: issue.filePath,
    lineNumber: issue.lineNumber,
    lineText: issue.lineText,
  });

  // Ignore metadata: "Ignored as <reason> by <name> · <friendly date>"
  console.log();
  const reason = issue.reason ? ` as ${sanitizeText(issue.reason)}` : "";
  const by = issue.ignoredByName
    ? ` by ${sanitizeText(issue.ignoredByName)}`
    : "";
  const parts = [`Ignored${reason}${by}`];
  if (issue.ignoredTimestamp) {
    parts.push(formatFriendlyDate(issue.ignoredTimestamp));
  }
  console.log(ansis.dim(parts.join(" · ")));
  if (issue.comment) {
    console.log(ansis.dim(`Comment: ${sanitizeText(issue.comment)}`));
  }

  console.log();
  console.log(CARD_SEPARATOR);
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
 * Color a quality grade letter: A/B green, C yellow, D/E/F red, anything else
 * uncolored. Returns "N/A" when no grade is available. Codacy folder/file
 * grades can be E (not just A–D/F), so it is colored red like D/F.
 */
export function formatGrade(gradeLetter: string | undefined): string {
  if (!gradeLetter) return "N/A";
  const colors: Record<string, (s: string) => string> = {
    A: ansis.green,
    B: ansis.green,
    C: ansis.yellow,
    D: ansis.red,
    E: ansis.red,
    F: ansis.red,
  };
  const colorFn = colors[gradeLetter] || ((s: string) => s);
  return colorFn(gradeLetter);
}

/**
 * Render a numeric metric as a table cell: abbreviated via `formatCount`
 * ("1.2k"), or a dim "-" when the value is absent (e.g. complexity/duplication
 * that Codacy didn't compute for a file or folder). Handles both `undefined`
 * and `null` — the API may return either for an uncomputed metric.
 */
export function formatCountCell(n: number | undefined | null): string {
  return n === undefined || n === null ? ansis.dim("-") : formatCount(n);
}

/**
 * Render a coverage percentage as a table cell ("76.3%"), or a dim "-" when no
 * coverage data is available (`undefined` or `null`).
 */
export function formatCoverageCell(pct: number | undefined | null): string {
  return pct === undefined || pct === null ? ansis.dim("-") : `${pct.toFixed(1)}%`;
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
 * Format a duration in milliseconds as a compact human string.
 * e.g. 45000 → "45s", 94000 → "1m 34s", 7380000 → "2h 3m"
 * Sub-minute durations show seconds only; hour+ durations drop the seconds.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Whether a commit is currently being analyzed, based on its analysis timestamps.
 * True when an analysis has started and either hasn't finished yet, or started
 * more recently than the last finish (i.e. a fresh reanalysis is running).
 */
export function isBeingAnalyzed(
  startedAnalysis?: string,
  endedAnalysis?: string,
): boolean {
  return (
    !!startedAnalysis &&
    (!endedAnalysis || parseISO(startedAnalysis) > parseISO(endedAnalysis))
  );
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

// ── Repository coverage status (`Coverage.status`) ───────────────────────────
//
// Only `Waiting` and `Stopped` are decorated — the same two the SPA flags.
// `UpToDate`, `None`, an undefined `status` and an absent `coverage` object all
// render exactly as they did before this field existed (the API leaves `status`
// undefined on a large share of repositories, so that path is the common one,
// not an edge case).
//
// Markers are dim glyphs, no emojis: `⋯` is already this CLI's "not final yet"
// marker in `formatStandards`, and `⊘` (U+2298) is in the same Mathematical
// Operators block as the `⊙` public-repository marker, which renders reliably
// across terminals (see `commands/tree-view.ts`).
const COVERAGE_WAITING_GLYPH = "⋯";
const COVERAGE_STOPPED_GLYPH = "⊘";

/** Dim table glyph for a coverage status, or undefined when there's nothing to flag. */
export function coverageStatusGlyph(coverage?: Coverage): string | undefined {
  switch (coverage?.status) {
    case "Waiting":
      return ansis.dim(COVERAGE_WAITING_GLYPH);
    case "Stopped":
      return ansis.dim(COVERAGE_STOPPED_GLYPH);
    default:
      return undefined; // UpToDate | None | undefined
  }
}

/**
 * Coverage cell for the `repositories` table: the threshold-colored percentage
 * as before, plus a dim glyph when the value is stale (`Waiting` — the number
 * comes from `lastCommitWithCoverage`, not the latest commit).
 *
 * `Stopped` shows the glyph alone. The API sends no percentage in that state,
 * and suppressing it unconditionally means a future payload that *does* carry
 * a stale value can't reintroduce a number nobody should read.
 */
export function formatRepoCoverageCell(
  coverage: Coverage | undefined,
  threshold: number | undefined,
): string {
  const glyph = coverageStatusGlyph(coverage);
  if (coverage?.status === "Stopped") return glyph!;
  const value = colorMetric(coverage?.coveragePercentage, threshold, "min");
  return glyph ? `${value} ${glyph}` : value;
}

/**
 * Legend lines explaining the glyphs, for only the statuses actually present in
 * a listing — an organization with healthy coverage everywhere pays nothing.
 * Returns an empty array when there is nothing to explain.
 */
export function coverageStatusLegend(
  coverages: Array<Coverage | undefined>,
): string[] {
  const present = new Set(coverages.map((c) => c?.status));
  const lines: string[] = [];
  if (present.has("Waiting")) {
    lines.push(
      ansis.dim(
        `${COVERAGE_WAITING_GLYPH} no coverage report for the latest commit yet — showing the last known value`,
      ),
    );
  }
  if (present.has("Stopped")) {
    lines.push(
      ansis.dim(`${COVERAGE_STOPPED_GLYPH} stopped receiving coverage reports`),
    );
  }
  return lines;
}

/**
 * The coverage status spelled out in words, for the `repository` dashboard's
 * Metrics section where there is room for a sentence. Returns undefined when
 * there is nothing to say (`UpToDate`, undefined status, absent coverage).
 *
 * Colors follow `formatAnalysisStatus`: blueBright = transient/in-flight,
 * yellow = needs attention, dim = nothing there.
 *
 * `gateConfigured` adds the consequence of a stopped repository — a red
 * coverage number on a repository whose coverage gate is no longer enforced is
 * actively misleading.
 */
export function coverageStatusNote(
  coverage: Coverage | undefined,
  opts: { gateConfigured?: boolean } = {},
): string | undefined {
  // Commit SHAs come from the API but are repository-derived, so sanitize
  // before slicing — a slice must not be able to end mid-escape-sequence.
  const shortSha = (sha?: string) => sanitizeText(sha ?? "").substring(0, 7);

  switch (coverage?.status) {
    case "Waiting": {
      // The values are present but stale: they come from the last commit that
      // did receive a report, not from the latest commit.
      const commit = coverage.lastCommitWithCoverage
        ? ` (${shortSha(coverage.lastCommitWithCoverage)})`
        : "";
      const from = coverage.valueUpdatedAt
        ? ` — value from ${formatFriendlyDate(coverage.valueUpdatedAt)}${commit}`
        : "";
      return ansis.blueBright(`Not reported yet for the latest commit${from}`);
    }
    case "Stopped": {
      const when = coverage.statusUpdatedAt
        ? ` ${formatFriendlyDate(coverage.statusUpdatedAt)}`
        : "";
      const last = coverage.lastCommitWithCoverage
        ? ` — last report ${shortSha(coverage.lastCommitWithCoverage)}`
        : "";
      const gate = opts.gateConfigured
        ? " — coverage gate no longer enforced"
        : "";
      return ansis.yellow(`Stopped receiving reports${when}${last}${gate}`);
    }
    case "None":
      // Distinguishable from a metric Codacy simply didn't compute, which is
      // all a bare "N/A" could ever say.
      return ansis.dim("Not set up");
    default:
      return undefined; // UpToDate | undefined
  }
}

/**
 * Coverage row for the `repository` dashboard's Metrics section: the
 * threshold-colored percentage followed by the status note, or the note alone
 * for the two states that have no percentage to show.
 */
export function formatRepoCoverageDetail(
  coverage: Coverage | undefined,
  threshold: number | undefined,
): string {
  const note = coverageStatusNote(coverage, {
    gateConfigured: threshold !== undefined,
  });
  // `Stopped` carries no percentage and `None` never had one; in both cases the
  // note says strictly more than a bare "N/A" would.
  if (coverage?.status === "Stopped" || coverage?.status === "None") {
    return note!;
  }
  const value = colorMetric(coverage?.coveragePercentage, threshold, "min");
  return note ? `${value}  ${note}` : value;
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
  if (value === undefined || value === null) return ansis.dim("-");
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
  if (pr.isAnalysing) return ansis.dim("⋯");
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
  if (diff === undefined && delta === undefined) return ansis.dim("-");
  const diffStr = diff !== undefined ? `${diff.toFixed(1)}%` : "-";
  const deltaSign = delta !== undefined && delta > 0 ? "+" : "";
  const deltaStr =
    delta !== undefined ? `(${deltaSign}${delta.toFixed(1)}%)` : "";
  const display = deltaStr ? `${diffStr} ${deltaStr}` : diffStr;
  return colorByGate(display, passing);
}

/**
 * True when at least one PR carries a coverage value. Repositories with no
 * coverage set up return `diffCoverage.cause` (e.g. "MissingRequirements") and
 * no numbers at all, so callers listing many PRs use this to drop the Coverage
 * column entirely rather than print a full column of "-".
 *
 * Kept next to `formatPrCoverage` so both agree on what counts as "has data".
 */
export function hasAnyPrCoverage(prs: PullRequestWithAnalysis[]): boolean {
  return prs.some(
    (pr) =>
      pr.coverage?.diffCoverage?.value !== undefined ||
      pr.coverage?.deltaCoverage !== undefined,
  );
}

/**
 * Read a PR quality metric, preferring the nested `quality` object over the
 * flat top-level field.
 *
 * The API populates the two inconsistently: the pull-request endpoints return
 * `quality.deltaComplexity` but omit the top-level `deltaComplexity` (while
 * still sending a top-level `deltaClonesCount`), so reading only the flat field
 * made every PR's complexity render as "no data". `quality` is the newer,
 * structured shape — same direction as `coverage` vs. the deprecated top-level
 * coverage fields — so it wins, with the flat field as fallback.
 */
export function prQualityMetric(
  pr: PullRequestWithAnalysis,
  key: "newIssues" | "fixedIssues" | "deltaComplexity" | "deltaClonesCount",
): number | undefined {
  return pr.quality?.[key] ?? pr[key];
}

/**
 * Format an issue count for the `+new / -fixed` pair: dim `-` when absent,
 * a bare `0` (no sign — nothing was added or fixed), else the signed count.
 */
function formatIssueCount(value: number | undefined, sign: "+" | "-"): string {
  if (value === undefined) return "-";
  if (value === 0) return "0";
  return `${sign}${value}`;
}

/**
 * Format PR issues: +newIssues / -fixedIssues.
 * New issues colored by gate status (red if failing), fixed issues always gray.
 */
export function formatPrIssues(
  pr: PullRequestWithAnalysis,
  passing?: boolean,
): string {
  const newI = formatIssueCount(prQualityMetric(pr, "newIssues"), "+");
  const fixI = formatIssueCount(prQualityMetric(pr, "fixedIssues"), "-");
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
    console.log(sanitizeText(title));
  }

  // English description
  const desc = cna.descriptions?.find((d) => d.lang === "en")?.value;
  if (desc) {
    console.log();
    console.log(sanitizeText(desc));
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
      console.log(ansis.dim(`  ${sanitizeText(ref.url)}`));
    }
  }
}

/**
 * Print an advisory enrichment block: the vulnerable functions and published
 * date for the OSV advisory linked to an SCA issue. Shown inside
 * `printIssueCodeContext` whenever `CommitIssue.advisoryInformation` is present.
 */
export function printAdvisoryBlock(advisory: AdvisoryInformation): void {
  console.log();
  console.log(ansis.bold(`Vulnerable Functions (${sanitizeText(advisory.advisoryId)})`));
  if (advisory.publishedAt) {
    console.log(ansis.dim(`Published: ${formatDueDate(advisory.publishedAt)}`));
  }
  if (advisory.vulnerableFunctions.length > 0) {
    console.log();
    for (const fn of advisory.vulnerableFunctions) {
      console.log(`  • ${sanitizeText(fn)}`);
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
    // File content is attacker-controllable — neutralize before printing.
    const content = sanitizeText(line.content);
    if (line.number === issueLine) {
      console.log(ansis.bold(`${num} | ${content}`));
      if (suggestion) {
        console.log(ansis.bold(ansis.green(`${num} | ${sanitizeText(suggestion)}`)));
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
  console.log(ansis.dim(`${sanitizeText(issue.filePath)}:${issue.lineNumber}`));
  console.log();

  // Extended code context (or fall back to single line from issue)
  if (lines && lines.length > 0) {
    printFileContext(lines, issue.lineNumber, issue.suggestion);
  } else {
    // Fallback: just show the lineText we already have
    const num = String(issue.lineNumber).padStart(4, " ");
    console.log(ansis.bold(`${num} | ${sanitizeText(issue.lineText)}`));
    if (issue.suggestion) {
      console.log(ansis.bold(ansis.green(`${num} | ${sanitizeText(issue.suggestion)}`)));
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

  // Advisory enrichment — vulnerable functions for SCA issues with an OSV-linked advisory
  if (issue.advisoryInformation) {
    printAdvisoryBlock(issue.advisoryInformation);
  }

  if (!pattern) {
    return;
  }

  // Pattern description
  if (pattern.description) {
    console.log();
    console.log(ansis.bold("About this pattern"));
    console.log(sanitizeText(pattern.description));
  }

  // Rationale
  if (pattern.rationale) {
    console.log();
    console.log(ansis.bold("Why is this a problem?"));
    console.log(sanitizeText(pattern.rationale));
  }

  // Solution
  if (pattern.solution) {
    console.log();
    console.log(ansis.bold("How to fix it?"));
    console.log(sanitizeText(pattern.solution));
  }

  // Tags
  if (pattern.tags && pattern.tags.length > 0) {
    console.log();
    console.log(ansis.dim(`Tags: ${pattern.tags.map((t) => sanitizeText(t)).join(", ")}`));
  }

  // Detected by
  console.log();
  const toolName = sanitizeText(issue.toolInfo.name);
  const patternRef = pattern.title
    ? `${sanitizeText(pattern.title)} (${sanitizeText(pattern.id)})`
    : sanitizeText(pattern.id);
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
  const subCat = p.subCategory ? ` ${ansis.dim(sanitizeText(p.subCategory))}` : "";
  console.log(`${severity} ${ansis.dim("|")} ${sanitizeText(p.category)}${subCat}`);

  // Message
  console.log(sanitizeText(issue.message));

  // Code context + pattern info (shared with finding command for Codacy-source findings)
  printIssueCodeContext(issue, pattern, lines);
}

/**
 * pickDeep paths for the JSON projection of a ConfiguredPattern. Shared by the
 * `patterns` (list) and `pattern` (single info) commands so both emit the same
 * shape. Mirrors the fields rendered by `printPatternCard`.
 */
export const PATTERN_JSON_FIELDS = [
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

/**
 * Header: enabled icon (☑️ enforced by a standard, ✅ enabled directly, dim ⬛
 * disabled), title, id, "Recommended" tag, and an "Enforced by" line.
 */
/** Status icon: ☑️ standard-enforced, ✅ enabled directly, dim ⬛ disabled. */
function patternIcon(enabled: boolean, enforcedByStandard: boolean): string {
  if (!enabled) return ansis.dim("⬛");
  return enforcedByStandard ? "☑️" : "✅";
}

function printPatternHeader(
  cp: ConfiguredPattern,
  enabled: boolean,
  enforcedByStandard: boolean,
): void {
  const p = cp.patternDefinition;
  const enabledIcon = patternIcon(enabled, enforcedByStandard);
  const titleText = p.title ?? p.id;
  const titleColored = enabled ? ansis.white(titleText) : ansis.dim(titleText);
  const recommendedStr = p.enabled ? ` | ${ansis.magenta("Recommended")}` : "";

  console.log(ansis.dim("─".repeat(40)));
  console.log(
    `${enabledIcon} ${titleColored} ${ansis.dim(`(${p.id})`)}${recommendedStr}`,
  );

  if (enforcedByStandard) {
    const names = cp.enabledBy.map((s) => s.name).join(", ");
    console.log(`   ${ansis.dim(`Enforced by: ${names}`)}`);
  }
}

/** Metadata line (severity | category subcategory | languages | tags) + description. */
function printPatternMeta(p: Pattern): void {
  const meta: string[] = [colorSeverity(p.severityLevel)];
  meta.push(p.category + (p.subCategory ? ` ${ansis.dim(p.subCategory)}` : ""));
  if (p.languages && p.languages.length > 0) meta.push(p.languages.join(", "));
  if (p.tags && p.tags.length > 0) meta.push(p.tags.join(", "));
  console.log(`   ${meta.join(" | ")}`);

  if (p.description) {
    console.log(`   ${ansis.dim(p.description)}`);
  }
}

/** "Why?" / "How to fix?" documentation lines. */
function printPatternDocs(p: Pattern): void {
  if (p.rationale) {
    console.log();
    console.log(`   ${ansis.white("Why?")} ${ansis.dim(p.rationale)}`);
  }
  if (p.solution) {
    console.log(`   ${ansis.white("How to fix?")} ${ansis.dim(p.solution)}`);
  }
}

/** Configured parameters — only shown when the pattern is enabled and has some. */
function printPatternParams(cp: ConfiguredPattern): void {
  if (!cp.enabled || !cp.parameters || cp.parameters.length === 0) return;
  console.log();
  console.log("   Parameters:");
  for (const param of cp.parameters) {
    console.log(`     - ${param.name} = ${param.value}`);
  }
}

/**
 * Print a single configured-pattern card. Shared by the `patterns` (list) and
 * `pattern` (single info) commands so both render identically.
 *
 * (`enabled` is OR'd with `enabledBy` to work around an API quirk where a
 * standard-enforced pattern can report `enabled: false`.)
 */
export function printPatternCard(cp: ConfiguredPattern): void {
  const enforcedByStandard = !!(cp.enabledBy && cp.enabledBy.length > 0);
  const enabled = cp.enabled || enforcedByStandard;
  printPatternHeader(cp, enabled, enforcedByStandard);
  printPatternMeta(cp.patternDefinition);
  printPatternDocs(cp.patternDefinition);
  printPatternParams(cp);
}

/**
 * Whether a configured pattern is enforced by one or more coding standards.
 * Such patterns can't be enabled/disabled/customized directly at the repo level.
 */
export function patternEnforcedBy(cp: ConfiguredPattern): string[] {
  return cp.enabledBy?.map((s) => s.name) ?? [];
}

/**
 * Shared messaging for tools whose patterns are managed by a local config file.
 * Centralized so the `pattern` and `patterns` commands stay consistent.
 */
// Read paths (listing / showing a pattern): patterns can't be fetched.
export const configFileNotice = (toolName: string): string =>
  `${toolName} is using a local configuration file.`;
// Write paths (enable/disable/customize): the update is refused.
export const CONFIG_FILE_LOCKED_MESSAGE =
  "Tool uses a local configuration file, can't be updated.";

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
 * The coverage half of the analysis status: which coverage state, if any, to
 * append after a finished analysis.
 *
 * Two sources, in priority order:
 *
 * 1. `coverageStatus` — the API's own `Coverage.status`, available on the
 *    repository endpoints. Authoritative, so it wins outright.
 * 2. The heuristic below — "a coverage overview exists but this commit has no
 *    coverage number", with a 3-hour grace period. Only pull requests still
 *    need it: `PullRequestCoverage`/`DiffCoverage` carry no status field.
 *
 * The heuristic is wrong for `Waiting`, which is why (1) exists: a waiting
 * repository still reports a percentage (a stale one, from the last commit that
 * did receive a report), so `hasCoverageData` is true and the heuristic reads
 * the repository as healthy.
 */
function coverageAnalysisSuffix(opts: {
  coverageStatus?: CoverageStatus;
  expectsCoverage?: boolean;
  hasCoverageData?: boolean;
  endedAnalysis: string;
}): string | undefined {
  const { coverageStatus, expectsCoverage, hasCoverageData, endedAnalysis } = opts;

  if (coverageStatus) {
    if (coverageStatus === "Waiting") {
      return ansis.blueBright("Waiting for coverage reports...");
    }
    if (coverageStatus === "Stopped") {
      return ansis.yellow("Stopped receiving coverage reports");
    }
    return undefined; // UpToDate | None
  }

  if (!expectsCoverage || hasCoverageData) return undefined;

  const hoursSinceFinish = differenceInHours(new Date(), parseISO(endedAnalysis));
  return hoursSinceFinish <= COVERAGE_REPORTS_WAIT_HOURS
    ? ansis.blueBright("Waiting for coverage reports...")
    : ansis.yellow("Missing coverage reports");
}

/**
 * Format the analysis status string for a commit (used by repository and pull-request commands).
 *
 * Logic:
 * - Being analyzed = startedAnalysis exists and (no endedAnalysis OR startedAnalysis > endedAnalysis)
 * - If being analyzed + has previous endedAnalysis: "Finished {date} ({sha}) — Reanalysis in progress..."
 * - If being analyzed + no previous finish: "In progress... ({sha})"
 * - If finished, a coverage state may be appended — see `coverageAnalysisSuffix`
 * - If finished normally: "Finished {date} ({sha})"
 * - No analysis data: dim "Never"
 */
export function formatAnalysisStatus(opts: {
  commitSha: string;
  startedAnalysis?: string;
  endedAnalysis?: string;
  /**
   * Authoritative `Coverage.status` — repository endpoints only. Takes
   * precedence over the `expectsCoverage`/`hasCoverageData` heuristic below.
   */
  coverageStatus?: CoverageStatus;
  /** Heuristic fallback, pull requests only. See `coverageAnalysisSuffix`. */
  expectsCoverage?: boolean;
  hasCoverageData?: boolean;
}): string {
  const {
    commitSha,
    startedAnalysis,
    endedAnalysis,
    coverageStatus,
    expectsCoverage,
    hasCoverageData,
  } = opts;
  const shortSha = commitSha.substring(0, 7);

  if (!startedAnalysis && !endedAnalysis) {
    return ansis.dim("Never");
  }

  if (isBeingAnalyzed(startedAnalysis, endedAnalysis)) {
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

    const coverageSuffix = coverageAnalysisSuffix({
      coverageStatus,
      expectsCoverage,
      hasCoverageData,
      endedAnalysis,
    });

    return coverageSuffix ? `${base} — ${coverageSuffix}` : base;
  }

  return ansis.dim("Never");
}
