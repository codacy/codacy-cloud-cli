import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
import {
  createTable,
  formatFriendlyDate,
  getOutputFormat,
  pickDeep,
  printJson,
  printPaginationWarning,
} from "../utils/output";
import { providerDisplayName } from "../utils/providers";
import {
  printSection,
  truncate,
  buildGateStatus,
  formatStandards,
  colorByGate,
  colorSeverity,
  formatDelta,
  formatPrCoverage,
  formatPrIssues,
  printIssueCard,
  printIssueDetail,
  formatAnalysisStatus,
  GateStatusMap,
} from "../utils/formatting";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { CoverageService } from "../api/client/services/CoverageService";
import { ToolsService } from "../api/client/services/ToolsService";
import { FileService } from "../api/client/services/FileService";
import { PullRequestWithAnalysis } from "../api/client/models/PullRequestWithAnalysis";
import { AnalysisResultReason } from "../api/client/models/AnalysisResultReason";
import { CommitDeltaIssue } from "../api/client/models/CommitDeltaIssue";
import { FileDeltaAnalysis } from "../api/client/models/FileDeltaAnalysis";
import { FileDiffCoverage } from "../api/client/models/FileDiffCoverage";
import { PullRequestIssuesResponse } from "../api/client/models/PullRequestIssuesResponse";
import { FileAnalysisListResponse } from "../api/client/models/FileAnalysisListResponse";
import { parseDiff } from "../utils/diff";
import { RepositoryService } from "../api/client/services/RepositoryService";
import { IssueStateBody } from "../api/client/models/IssueStateBody";

const SEVERITY_ORDER: Record<string, number> = {
  Error: 0,
  High: 1,
  Warning: 2,
  Info: 3,
};

/**
 * Map a gate name to a human-readable description including its threshold.
 */
function formatGateReason(r: AnalysisResultReason): string {
  const gate = r.gate.toLowerCase();
  const t = r.expectedThreshold;
  let desc: string;

  if (gate.includes("security") && gate.includes("issue")) {
    const severity = t.minimumSeverity
      ? ` ${t.minimumSeverity.toLowerCase()}`
      : "";
    desc = `<= ${t.threshold}${severity} security issues`;
  } else if (gate.includes("issue")) {
    const severity = t.minimumSeverity
      ? ` ${t.minimumSeverity.toLowerCase()}`
      : "";
    desc = `<= ${t.threshold}${severity} issues`;
  } else if (gate.includes("coverage")) {
    desc = `>= ${t.threshold}% coverage`;
  } else if (gate.includes("complexity")) {
    desc = `<= ${t.threshold} complexity`;
  } else if (gate.includes("duplication") || gate.includes("clone")) {
    desc = `<= ${t.threshold} duplication`;
  } else {
    desc = `${r.gate} threshold ${t.threshold}`;
  }

  if (!r.isUpToStandards) {
    return ansis.red(`Fails ${desc}`);
  }
  return ansis.green(`Passes ${desc}`);
}

/**
 * Check if a metric has data. Used to determine "To check" hints for gates
 * where the metric value is not yet available.
 */
function metricHasData(
  pr: PullRequestWithAnalysis,
  gateKey: keyof GateStatusMap,
): boolean {
  switch (gateKey) {
    case "issues":
    case "security":
      return pr.newIssues !== undefined;
    case "coverage":
      return (
        pr.coverage?.diffCoverage?.value !== undefined ||
        pr.coverage?.deltaCoverage !== undefined
      );
    case "complexity":
      return pr.deltaComplexity !== undefined;
    case "duplication":
      return pr.deltaClonesCount !== undefined;
    default:
      return true;
  }
}

/**
 * Get the gate key for a result reason based on its gate name.
 */
function gateKeyFromReason(gate: string): keyof GateStatusMap | null {
  const g = gate.toLowerCase();
  if (g.includes("security") && g.includes("issue")) return "security";
  if (g.includes("issue")) return "issues";
  if (g.includes("coverage")) return "coverage";
  if (g.includes("complexity")) return "complexity";
  if (g.includes("duplication") || g.includes("clone")) return "duplication";
  return null;
}

/**
 * Build a "To check" hint for a gate that has a configured threshold
 * but the metric has no data yet.
 */
function formatGateToCheck(r: AnalysisResultReason): string {
  const gate = r.gate.toLowerCase();
  const t = r.expectedThreshold;

  if (gate.includes("security") && gate.includes("issue")) {
    const severity = t.minimumSeverity
      ? ` ${t.minimumSeverity.toLowerCase()}`
      : "";
    return `To check <= ${t.threshold}${severity} security issues`;
  } else if (gate.includes("issue")) {
    const severity = t.minimumSeverity
      ? ` ${t.minimumSeverity.toLowerCase()}`
      : "";
    return `To check <= ${t.threshold}${severity} issues`;
  } else if (gate.includes("coverage")) {
    return `To check >= ${t.threshold}% coverage`;
  } else if (gate.includes("complexity")) {
    return `To check <= ${t.threshold} complexity`;
  } else if (gate.includes("duplication") || gate.includes("clone")) {
    return `To check <= ${t.threshold} duplication`;
  }
  return `To check ${r.gate} threshold ${t.threshold}`;
}

function printAbout(
  pr: PullRequestWithAnalysis,
  provider: string,
  organization: string,
  headCommitTiming: { startedAnalysis?: string; endedAnalysis?: string } | null,
  expectsCoverage: boolean,
  hasCoverageData: boolean,
): void {
  printSection("About");
  const p = pr.pullRequest;
  const table = createTable();
  table.push({
    Repository: `${providerDisplayName(provider)} / ${organization} / ${p.repository}`,
  });
  table.push({ "Pull Request": `#${p.number} — ${p.title}` });
  table.push({ Status: p.status });
  table.push({ Author: p.owner?.name || ansis.dim("N/A") });
  table.push({
    Branches: `${p.originBranch || "N/A"} → ${p.targetBranch || "N/A"}`,
  });
  table.push({ Updated: formatFriendlyDate(p.updated) });

  if (p.headCommitSha) {
    table.push({
      Analysis: formatAnalysisStatus({
        commitSha: p.headCommitSha,
        startedAnalysis: headCommitTiming?.startedAnalysis,
        endedAnalysis: headCommitTiming?.endedAnalysis,
        expectsCoverage,
        hasCoverageData,
      }),
    });
  } else {
    table.push({ Analysis: ansis.dim("N/A") });
  }
  console.log(table.toString());
}

/**
 * Build a map from gate key to the "To check" hint for gates with no data,
 * and the "Fails" reason for gates that failed.
 */
function buildGateHints(pr: PullRequestWithAnalysis): Record<string, string> {
  const hints: Record<string, string> = {};
  const reasons: AnalysisResultReason[] = [
    ...(pr.quality?.resultReasons || []),
    ...(pr.coverage?.resultReasons || []),
  ];
  for (const r of reasons) {
    const key = gateKeyFromReason(r.gate);
    if (!key) continue;
    if (!metricHasData(pr, key)) {
      hints[key] = ansis.dim(formatGateToCheck(r));
    } else if (!r.isUpToStandards) {
      hints[key] = formatGateReason(r);
    }
  }
  return hints;
}

/**
 * Append a gate hint inline if one exists for this metric.
 */
function withHint(value: string, hint: string | undefined): string {
  return hint ? `${value}  ${hint}` : value;
}

function printAnalysis(pr: PullRequestWithAnalysis): void {
  printSection("Analysis");
  const table = createTable();
  const gates = buildGateStatus(pr);
  const hints = buildGateHints(pr);

  // Analyzing status
  table.push({
    Analyzing: pr.isAnalysing ? ansis.yellow("Yes") : "No",
  });

  // Up to standards
  table.push({ "Up to Standards": formatStandards(pr) });

  // Issues — show both regular and security hints
  const issuesValue = formatPrIssues(pr, gates.issues);
  const issuesHint =
    hints["issues"] || hints["security"]
      ? [hints["issues"], hints["security"]].filter(Boolean).join("  ")
      : undefined;
  table.push({ Issues: withHint(issuesValue, issuesHint) });

  // Coverage
  table.push({
    Coverage: withHint(formatPrCoverage(pr, gates.coverage), hints["coverage"]),
  });

  // Complexity
  table.push({
    Complexity: withHint(
      formatDelta(pr.deltaComplexity, gates.complexity),
      hints["complexity"],
    ),
  });

  // Duplication
  table.push({
    Duplication: withHint(
      formatDelta(pr.deltaClonesCount, gates.duplication),
      hints["duplication"],
    ),
  });

  console.log(table.toString());
}

type TaggedIssue = CommitDeltaIssue & { isPotential: boolean };

function printIssuesList(issues: TaggedIssue[]): void {
  printSection("Issues", issues.length, "issue");
  if (issues.length === 0) {
    console.log(ansis.dim("  No issues."));
    return;
  }
  const sorted = [...issues].sort((a, b) => {
    const aOrder =
      SEVERITY_ORDER[a.commitIssue.patternInfo.severityLevel] ?? 99;
    const bOrder =
      SEVERITY_ORDER[b.commitIssue.patternInfo.severityLevel] ?? 99;
    return aOrder - bOrder;
  });
  for (const issue of sorted) {
    printIssueCard(issue.commitIssue, { isPotential: issue.isPotential });
  }
}

/**
 * Format a file delta value: gray for N/A and 0, red for positive, green for negative.
 * If isPercent is true, appends "%" to the display.
 * If invertColors is true, positive is green and negative is red (e.g. coverage).
 */
function formatFileDelta(
  value: number | undefined,
  isPercent: boolean = false,
  invertColors: boolean = false,
): string {
  if (value === undefined || value === null) return ansis.dim("N/A");
  if (value === 0) return ansis.dim("0");
  const sign = value > 0 ? "+" : "";
  const suffix = isPercent ? "%" : "";
  const display = `${sign}${isPercent ? value.toFixed(1) : value}${suffix}`;
  const positiveIsGood = invertColors ? value > 0 : value < 0;
  return positiveIsGood ? ansis.green(display) : ansis.red(display);
}

function printFilesList(files: FileDeltaAnalysis[]): void {
  // Filter to only files with any delta change
  const changed = files.filter((f) => {
    const q = f.quality;
    const c = f.coverage;
    return (
      (q &&
        (q.deltaNewIssues > 0 ||
          q.deltaFixedIssues > 0 ||
          q.deltaComplexity ||
          q.deltaClonesCount)) ||
      (c && c.deltaCoverage)
    );
  });

  printSection("Files", changed.length, "file");

  if (changed.length === 0) {
    console.log(ansis.dim("  No files with metric changes."));
    return;
  }

  const table = createTable({
    head: ["File", "Issues", "Coverage", "Complexity", "Duplication"],
  });

  for (const f of changed) {
    const q = f.quality;
    const c = f.coverage;

    // New issues: red if > 0, gray for 0
    const newI =
      q && q.deltaNewIssues > 0
        ? ansis.red(`+${q.deltaNewIssues}`)
        : ansis.dim("0");
    // Fixed issues: green if > 0, gray for 0
    const fixI =
      q && q.deltaFixedIssues > 0
        ? ansis.green(`-${q.deltaFixedIssues}`)
        : ansis.dim("0");

    table.push([
      truncate(f.file.path, 50),
      `${newI} / ${fixI}`,
      formatFileDelta(c?.deltaCoverage, true, true),
      formatFileDelta(q?.deltaComplexity),
      formatFileDelta(q?.deltaClonesCount),
    ]);
  }

  console.log(table.toString());
}

/**
 * Fetch all issues for a PR by paginating through the API.
 * Used by the --issue option to find a specific issue by resultDataId.
 */
async function fetchAllPrIssues(
  provider: string,
  organization: string,
  repository: string,
  prNumber: number,
  onlyPotential: boolean,
): Promise<CommitDeltaIssue[]> {
  const allIssues: CommitDeltaIssue[] = [];
  let cursor: string | undefined;
  do {
    const response = (await AnalysisService.listPullRequestIssues(
      provider,
      organization,
      repository,
      prNumber,
      "new",
      onlyPotential,
      cursor,
    )) as any;
    allIssues.push(...((response.data as CommitDeltaIssue[]) || []));
    cursor = response.pagination?.cursor;
  } while (cursor);
  return allIssues;
}

// ─── Diff Coverage Summary ─────────────────────────────────────────────────

/**
 * Compress a sorted array of integers into a range string.
 * e.g. [1,2,3,5,6,10] → "1-3,5-6,10"
 */
function compressRanges(nums: number[]): string {
  if (nums.length === 0) return "";
  const ranges: string[] = [];
  let start = nums[0];
  let end = nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === end + 1) {
      end = nums[i];
    } else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`);
      start = end = nums[i];
    }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(",");
}

function printDiffCoverageSummary(fileCoverageList: FileDiffCoverage[]): void {
  const relevant = fileCoverageList.filter((f) => f.diffLineHits.length > 0);
  if (relevant.length === 0) return;

  printSection("Diff Coverage Summary");

  for (const fc of relevant) {
    const covered = fc.diffLineHits.filter((h) => h.hits > 0).length;
    const total = fc.diffLineHits.length;
    const pct = total > 0 ? (covered / total) * 100 : 0;
    const pctStr = `${pct.toFixed(1)}%`;
    const pctColored =
      covered === total
        ? ansis.green(pctStr)
        : covered === 0
          ? ansis.red(pctStr)
          : ansis.yellow(pctStr);

    const uncoveredNums = fc.diffLineHits
      .filter((h) => h.hits === 0)
      .map((h) => parseInt(h.lineNumber, 10))
      .sort((a, b) => a - b);

    const uncoveredPart =
      uncoveredNums.length > 0
        ? ` | Uncovered lines: ${ansis.red(compressRanges(uncoveredNums))}`
        : "";

    console.log(`${fc.fileName} | ${pctColored}${uncoveredPart}`);
  }
}

// ─── Annotated Diff ─────────────────────────────────────────────────────────

const DIFF_CONTEXT = 3;

function severityColorFn(level: string): (s: string) => string {
  switch (level) {
    case "Error":
      return (s) => ansis.red(s);
    case "High":
      return (s) => ansis.hex("#FF8C00")(s);
    case "Warning":
      return (s) => ansis.yellow(s);
    case "Info":
      return (s) => ansis.blue(s);
    default:
      return (s) => s;
  }
}

function printDiffChange(
  change: {
    type: string;
    content: string;
    newLineNumber?: number;
    oldLineNumber?: number;
    lineNumber?: number;
  },
  numWidth: number,
  hitMap: Map<number, number>,
  issueMap: Map<number, TaggedIssue[]>,
): void {
  const isInsert = change.type === "insert";
  const isDelete = change.type === "delete";
  // InsertChange and DeleteChange both use `lineNumber`; NormalChange uses newLineNumber/oldLineNumber
  const newLine: number | undefined = isInsert
    ? change.lineNumber
    : change.newLineNumber;
  const oldLine: number | undefined = isDelete
    ? change.lineNumber
    : change.oldLineNumber;
  const displayNum = newLine ?? oldLine ?? 0;
  const numStr = String(displayNum).padStart(numWidth, " ");
  const changeChar = isInsert ? "+" : isDelete ? "-" : "|";

  const hits = newLine !== undefined ? hitMap.get(newLine) : undefined;
  const isCovered = hits !== undefined && hits > 0;
  const isUncovered = hits !== undefined && hits === 0;
  const lineIssues = newLine !== undefined ? (issueMap.get(newLine) ?? []) : [];
  const hasIssue = lineIssues.length > 0;

  // Left symbol and number+pipe color — coverage takes priority over issue symbol
  let leftSymbol: string;
  let numPipeColor: (s: string) => string;

  if (isCovered) {
    leftSymbol = ansis.green("✓");
    numPipeColor = (s) => ansis.green(s);
  } else if (isUncovered) {
    leftSymbol = ansis.red("✘");
    numPipeColor = (s) => ansis.red(s);
  } else if (hasIssue) {
    const cf = severityColorFn(
      lineIssues[0].commitIssue.patternInfo.severityLevel,
    );
    leftSymbol = cf("┃");
    numPipeColor = cf;
  } else {
    leftSymbol = " ";
    numPipeColor = (s) => ansis.dim(s);
  }

  // Content color: deleted = dark gray, inserted = white, unchanged = gray
  const contentColor: (s: string) => string = isDelete
    ? (s) => ansis.dim(ansis.gray(s))
    : isInsert
      ? (s) => s
      : (s) => ansis.dim(s);

  console.log(
    `${leftSymbol}    ${numPipeColor(`${numStr} ${changeChar}`)} ${contentColor(change.content)}`,
  );

  // Issue annotations below the code line (severity-colored ┃)
  for (const tagged of lineIssues) {
    const issue = tagged.commitIssue;
    const cf = severityColorFn(issue.patternInfo.severityLevel);
    const pipe = cf("┃");
    const subCat = issue.patternInfo.subCategory
      ? ` ${issue.patternInfo.subCategory}`
      : "";
    const potentialTag = tagged.isPotential ? " Potential false positive" : "";
    const header = `${colorSeverity(issue.patternInfo.severityLevel)} | ${issue.patternInfo.category}${subCat}${potentialTag} #${issue.resultDataId}`;
    console.log(`${pipe}     ↳  ${header}`);
    console.log(`${pipe}        ${issue.message}`);
  }
}

function printAnnotatedDiff(
  diffText: string,
  fileCoverageList: FileDiffCoverage[],
  issues: TaggedIssue[],
): void {
  // Build coverage maps: fileName → Map<newLineNumber, hits>
  const coverageByFile = new Map<string, Map<number, number>>();
  for (const fc of fileCoverageList) {
    const hitMap = new Map<number, number>();
    for (const hit of fc.diffLineHits) {
      hitMap.set(parseInt(hit.lineNumber, 10), hit.hits);
    }
    coverageByFile.set(fc.fileName, hitMap);
  }

  // Build issue maps: filePath → Map<newLineNumber, TaggedIssue[]>
  const issuesByFile = new Map<string, Map<number, TaggedIssue[]>>();
  for (const tagged of issues) {
    const fp = tagged.commitIssue.filePath;
    const ln = tagged.commitIssue.lineNumber;
    if (!issuesByFile.has(fp)) issuesByFile.set(fp, new Map());
    const m = issuesByFile.get(fp)!;
    if (!m.has(ln)) m.set(ln, []);
    m.get(ln)!.push(tagged);
  }

  const { files } = parseDiff(diffText, true);
  const sep = ansis.dim("─".repeat(79));

  for (const file of files) {
    const hitMap = coverageByFile.get(file.path) ?? new Map<number, number>();
    const issueMap =
      issuesByFile.get(file.path) ?? new Map<number, TaggedIssue[]>();

    // Skip files with no relevant content (no coverage hits/misses, no issues)
    const hasRelevant = file.hunks.some((hunk) =>
      hunk.changes.some((c) => {
        const newLine: number | undefined =
          c.type === "insert"
            ? (c as any).lineNumber
            : c.type === "normal"
              ? (c as any).newLineNumber
              : undefined;
        return (
          newLine !== undefined &&
          (hitMap.has(newLine) || issueMap.has(newLine))
        );
      }),
    );
    if (!hasRelevant) continue;

    console.log(sep);
    console.log(ansis.bold(file.path));

    for (const hunk of file.hunks) {
      const changes = hunk.changes;

      // Determine max line number for consistent number-column width
      let maxLine = 0;
      for (const c of changes) {
        const n =
          (c as any).newLineNumber ??
          (c as any).oldLineNumber ??
          (c as any).lineNumber ??
          0;
        if (n > maxLine) maxLine = n;
      }
      const numWidth = Math.max(String(maxLine).length, 3);

      // Find change indices that are "interesting" (have coverage or issues) + context
      const interestingIdx = new Set<number>();
      for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        const newLine: number | undefined =
          c.type === "insert"
            ? (c as any).lineNumber
            : c.type === "normal"
              ? (c as any).newLineNumber
              : undefined;
        if (
          newLine !== undefined &&
          (hitMap.has(newLine) || issueMap.has(newLine))
        ) {
          for (
            let j = Math.max(0, i - DIFF_CONTEXT);
            j <= Math.min(changes.length - 1, i + DIFF_CONTEXT);
            j++
          ) {
            interestingIdx.add(j);
          }
        }
      }

      if (interestingIdx.size === 0) continue;

      console.log(ansis.dim(hunk.content)); // @@ -x,y +a,b @@ context line

      // Print changes with "..." for skipped stretches
      let skipped = false;
      for (let i = 0; i < changes.length; i++) {
        if (!interestingIdx.has(i)) {
          skipped = true;
          continue;
        }
        if (skipped) {
          console.log(ansis.dim("..."));
          skipped = false;
        }
        printDiffChange(changes[i], numWidth, hitMap, issueMap);
      }
    }
  }

  console.log(sep);
}

export function registerPullRequestCommand(program: Command) {
  program
    .command("pull-request")
    .alias("pr")
    .description("Show details and analysis for a specific pull request")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .argument("<repository>", "repository name")
    .argument("<prNumber>", "pull request number")
    .option(
      "-i, --issue <issueId>",
      "show full details for a specific issue in this PR (use the #id shown on issue cards)",
    )
    .option(
      "-d, --diff",
      "show annotated git diff with coverage hits/misses and new issues",
    )
    .option(
      "-I, --ignore-issue <issueId>",
      "ignore a specific issue in this PR (use the #id shown on issue cards)",
    )
    .option(
      "-F, --ignore-all-false-positives",
      "ignore all potential false positive issues in this PR with reason FalsePositive",
    )
    .option(
      "-R, --ignore-reason <reason>",
      "reason for ignoring (AcceptedUse|FalsePositive|NotExploitable|TestCode|ExternalCode)",
      "AcceptedUse",
    )
    .option("-m, --ignore-comment <comment>", "optional comment for the ignore action", "")
    .option(
      "-U, --unignore-issue <issueId>",
      "unignore a specific issue in this PR (use the #id shown on issue cards)",
    )
    .option(
      "-A, --reanalyze",
      "request reanalysis of the HEAD commit of this pull request",
    )
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli pull-request gh my-org my-repo 42
  $ codacy-cloud-cli pull-request gh my-org my-repo 42 --output json
  $ codacy-cloud-cli pull-request gh my-org my-repo 42 --issue 9901
  $ codacy-cloud-cli pull-request gh my-org my-repo 42 --diff
  $ codacy-cloud-cli pull-request gh my-org my-repo 42 --ignore-issue 9901
  $ codacy-cloud-cli pull-request gh my-org my-repo 42 --ignore-issue 9901 --ignore-reason FalsePositive
  $ codacy-cloud-cli pull-request gh my-org my-repo 42 --ignore-all-false-positives
  $ codacy-cloud-cli pull-request gh my-org my-repo 42 --unignore-issue 9901
  $ codacy-cloud-cli pull-request gh my-org my-repo 42 --reanalyze`,
    )
    .action(async function (
      this: Command,
      provider: string,
      organization: string,
      repository: string,
      prNumberStr: string,
    ) {
      try {
        checkApiToken();
        const prNumber = parseInt(prNumberStr, 10);
        if (isNaN(prNumber)) {
          console.error(ansis.red("Error: prNumber must be a number."));
          process.exit(1);
        }

        // --reanalyze: request reanalysis of the HEAD commit
        if (this.opts().reanalyze) {
          const spinner = ora("Requesting reanalysis...").start();
          try {
            const prResponse = await AnalysisService.getRepositoryPullRequest(
              provider,
              organization,
              repository,
              prNumber,
            );
            const headSha = (prResponse as any).pullRequest?.headCommitSha;
            if (!headSha) {
              spinner.fail("No HEAD commit found for this pull request.");
              return;
            }
            await RepositoryService.reanalyzeCommitById(
              provider,
              organization,
              repository,
              { commitUuid: headSha },
            );
            spinner.succeed(
              "Reanalysis requested successfully, new results will be available in a few minutes.",
            );
          } catch (reanalyzeErr) {
            spinner.fail(
              `Failed to request reanalysis: ${reanalyzeErr instanceof Error ? reanalyzeErr.message : reanalyzeErr}`,
            );
          }
          return;
        }

        const format = getOutputFormat(this);
        const issueIdStr: string | undefined = this.opts().issue;
        const showDiff: boolean = !!this.opts().diff;
        const ignoreIssueIdStr: string | undefined = this.opts().ignoreIssue;
        const ignoreAllFalsePositives: boolean = !!this.opts().ignoreAllFalsePositives;
        const ignoreReason = this.opts().ignoreReason as IssueStateBody["reason"];
        const ignoreComment: string = this.opts().ignoreComment;
        const unignoreIssueIdStr: string | undefined = this.opts().unignoreIssue;

        // --ignore-issue <id>: find and ignore a specific PR issue by resultDataId
        if (ignoreIssueIdStr !== undefined) {
          const ignoreIssueId = parseInt(ignoreIssueIdStr, 10);
          if (isNaN(ignoreIssueId)) {
            console.error(ansis.red("Error: --ignore-issue must be a number."));
            process.exit(1);
          }

          const spinner = ora("Fetching PR issues...").start();

          const [allNew, allPotential] = await Promise.all([
            fetchAllPrIssues(provider, organization, repository, prNumber, false),
            fetchAllPrIssues(provider, organization, repository, prNumber, true),
          ]);

          const found = [...allNew, ...allPotential]
            .filter((i) => i.deltaType === "Added")
            .find((i) => i.commitIssue.resultDataId === ignoreIssueId);

          if (!found) {
            spinner.fail(`Issue #${ignoreIssueId} not found in this pull request.`);
            process.exit(1);
          }

          spinner.text = "Ignoring issue...";
          await AnalysisService.updateIssueState(
            provider,
            organization,
            repository,
            found.commitIssue.issueId,
            {
              ignored: true,
              reason: ignoreReason,
              comment: ignoreComment || undefined,
            },
          );
          spinner.succeed(
            `Issue #${ignoreIssueId} ignored (reason: ${ignoreReason}).`,
          );
          return;
        }

        // --ignore-all-false-positives: fetch all potential false positives and ignore them
        if (ignoreAllFalsePositives) {
          const spinner = ora("Fetching potential false positive issues...").start();

          const allPotential = await fetchAllPrIssues(
            provider,
            organization,
            repository,
            prNumber,
            true,
          );

          const toIgnore = allPotential.filter((i) => i.deltaType === "Added");

          if (toIgnore.length === 0) {
            spinner.info("No potential false positive issues found in this pull request.");
            return;
          }

          spinner.text = `Ignoring ${toIgnore.length} potential false positive issue(s)...`;
          await Promise.all(
            toIgnore.map((i) =>
              AnalysisService.updateIssueState(
                provider,
                organization,
                repository,
                i.commitIssue.issueId,
                {
                  ignored: true,
                  reason: "FalsePositive",
                  comment: ignoreComment || undefined,
                },
              ),
            ),
          );
          spinner.succeed(
            `Ignored ${toIgnore.length} potential false positive issue(s) (reason: FalsePositive).`,
          );
          return;
        }

        // --unignore-issue <id>: find and unignore a specific PR issue by resultDataId
        if (unignoreIssueIdStr !== undefined) {
          const unignoreIssueId = parseInt(unignoreIssueIdStr, 10);
          if (isNaN(unignoreIssueId)) {
            console.error(ansis.red("Error: --unignore-issue must be a number."));
            process.exit(1);
          }

          const spinner = ora("Fetching PR issues...").start();

          const [allNew, allPotential] = await Promise.all([
            fetchAllPrIssues(provider, organization, repository, prNumber, false),
            fetchAllPrIssues(provider, organization, repository, prNumber, true),
          ]);

          const found = [...allNew, ...allPotential]
            .filter((i) => i.deltaType === "Added")
            .find((i) => i.commitIssue.resultDataId === unignoreIssueId);

          if (!found) {
            spinner.fail(`Issue #${unignoreIssueId} not found in this pull request.`);
            process.exit(1);
          }

          spinner.text = "Unignoring issue...";
          await AnalysisService.updateIssueState(
            provider,
            organization,
            repository,
            found.commitIssue.issueId,
            { ignored: false },
          );
          spinner.succeed(`Issue #${unignoreIssueId} unignored.`);
          return;
        }

        // --issue <id>: fetch all PR issues, find by resultDataId, show detail
        if (issueIdStr !== undefined) {
          const issueId = parseInt(issueIdStr, 10);
          if (isNaN(issueId)) {
            console.error(ansis.red("Error: --issue must be a number."));
            process.exit(1);
          }

          const spinner = ora("Fetching issue details...").start();

          const [allNew, allPotential] = await Promise.all([
            fetchAllPrIssues(
              provider,
              organization,
              repository,
              prNumber,
              false,
            ),
            fetchAllPrIssues(
              provider,
              organization,
              repository,
              prNumber,
              true,
            ),
          ]);

          const found = [...allNew, ...allPotential]
            .filter((i) => i.deltaType === "Added")
            .find((i) => i.commitIssue.resultDataId === issueId);

          if (!found) {
            spinner.fail(`Issue #${issueId} not found in this pull request.`);
            process.exit(1);
          }

          const issue = found.commitIssue;
          const lineNumber = issue.lineNumber;
          const startLine = Math.max(1, lineNumber - 5);
          const endLine = lineNumber + 5;

          const [patternResponse, fileContentResponse] = await Promise.all([
            ToolsService.getPattern(
              issue.toolInfo.uuid,
              issue.patternInfo.id,
            ).catch(() => null),
            FileService.getFileContent(
              provider,
              organization,
              repository,
              encodeURIComponent(issue.filePath),
              startLine,
              endLine,
              issue.commitInfo?.sha,
            ).catch(() => null),
          ]);

          spinner.stop();

          const pattern = patternResponse?.data ?? null;
          const lines = fileContentResponse?.data ?? null;

          if (format === "json") {
            printJson(pickDeep({ issue, pattern, lines }, [
              // Issue header
              "issue.patternInfo.severityLevel",
              "issue.patternInfo.category",
              "issue.patternInfo.subCategory",
              "issue.message",
              "issue.filePath",
              "issue.lineNumber",
              "issue.lineText",
              "issue.suggestion",
              "issue.resultDataId",
              "issue.issueId",
              "issue.toolInfo.name",
              "issue.toolInfo.uuid",
              "issue.patternInfo.id",
              "issue.falsePositiveProbability",
              "issue.falsePositiveThreshold",
              "issue.falsePositiveReason",
              "issue.commitInfo.sha",
              // Pattern
              "pattern.id",
              "pattern.title",
              "pattern.description",
              "pattern.rationale",
              "pattern.solution",
              "pattern.tags",
              // Code lines
              "lines",
            ]));
            return;
          }

          printIssueDetail(issue, pattern, lines);
          return;
        }

        // --diff: annotated git diff with coverage hits and new issues
        if (showDiff) {
          const spinner = ora("Fetching pull request diff...").start();

          const [
            diffResponse,
            coverageResponse,
            diffNewIssues,
            diffPotentialIssues,
          ] = await Promise.all([
            RepositoryService.getPullRequestDiff(
              provider,
              organization,
              repository,
              prNumber,
            ).catch(() => null),
            CoverageService.getRepositoryPullRequestFilesCoverage(
              provider,
              organization,
              repository,
              prNumber,
            ).catch(() => ({ data: [] as FileDiffCoverage[] })),
            fetchAllPrIssues(
              provider,
              organization,
              repository,
              prNumber,
              false,
            ),
            fetchAllPrIssues(
              provider,
              organization,
              repository,
              prNumber,
              true,
            ),
          ]);

          spinner.stop();

          const diffText = (diffResponse as any)?.diff ?? "";
          const diffCoverageList: FileDiffCoverage[] =
            (coverageResponse as any)?.data ?? [];

          const diffTaggedIssues: TaggedIssue[] = [
            ...diffNewIssues
              .filter((i) => i.deltaType === "Added")
              .map((i) => ({ ...i, isPotential: false })),
            ...diffPotentialIssues
              .filter((i) => i.deltaType === "Added")
              .map((i) => ({ ...i, isPotential: true })),
          ];

          if (format === "json") {
            printJson({
              diff: diffText,
              coverage: diffCoverageList,
              issues: diffTaggedIssues,
            });
            return;
          }

          if (!diffText) {
            console.log(ansis.dim("No diff available for this pull request."));
            return;
          }

          printAnnotatedDiff(diffText, diffCoverageList, diffTaggedIssues);
          return;
        }

        const spinner = ora("Fetching pull request details...").start();

        const [
          prResponse,
          newIssuesResponse,
          potentialIssuesResponse,
          filesResponse,
          coverageResponse,
          prCommitsResponse,
          coverageReportsResponse,
        ] = await Promise.all([
          AnalysisService.getRepositoryPullRequest(
            provider,
            organization,
            repository,
            prNumber,
          ),
          AnalysisService.listPullRequestIssues(
            provider,
            organization,
            repository,
            prNumber,
            "new",
            false,
          ),
          AnalysisService.listPullRequestIssues(
            provider,
            organization,
            repository,
            prNumber,
            "new",
            true,
          ),
          AnalysisService.listPullRequestFiles(
            provider,
            organization,
            repository,
            prNumber,
          ),
          CoverageService.getRepositoryPullRequestFilesCoverage(
            provider,
            organization,
            repository,
            prNumber,
          ).catch(() => ({ data: [] as FileDiffCoverage[] })),
          AnalysisService.getPullRequestCommits(
            provider,
            organization,
            repository,
            prNumber,
            1,
          ).catch(() => ({ data: [] })),
          RepositoryService.listCoverageReports(
            provider,
            organization,
            repository,
            1,
          ).catch(() => ({ data: { hasCoverageOverview: false } })),
        ]);

        spinner.stop();

        // getRepositoryPullRequest returns PullRequestWithAnalysis directly
        const prData: PullRequestWithAnalysis = prResponse as any;
        const newIssues: PullRequestIssuesResponse = newIssuesResponse as any;
        const potentialIssues: PullRequestIssuesResponse =
          potentialIssuesResponse as any;
        const filesData: FileAnalysisListResponse = filesResponse as any;

        // Head commit timing for analysis status
        const prHeadCommit = (prCommitsResponse as any).data?.[0]?.commit ?? null;
        const prExpectsCoverage = !!(coverageReportsResponse as any).data?.hasCoverageOverview;
        const prHasCoverageData =
          prData.coverage?.diffCoverage?.value !== undefined ||
          prData.coverage?.deltaCoverage !== undefined;

        if (format === "json") {
          printJson(pickDeep({
            pullRequest: prData,
            newIssues: newIssues.data,
            potentialIssues: potentialIssues.data,
            files: filesData.data || [],
          }, [
            // About
            "pullRequest.pullRequest.repository",
            "pullRequest.pullRequest.number",
            "pullRequest.pullRequest.title",
            "pullRequest.pullRequest.status",
            "pullRequest.pullRequest.owner.name",
            "pullRequest.pullRequest.originBranch",
            "pullRequest.pullRequest.targetBranch",
            "pullRequest.pullRequest.updated",
            "pullRequest.pullRequest.headCommitSha",
            // Analysis
            "pullRequest.isAnalysing",
            "pullRequest.isUpToStandards",
            "pullRequest.newIssues",
            "pullRequest.fixedIssues",
            "pullRequest.coverage",
            "pullRequest.quality",
            "pullRequest.deltaComplexity",
            "pullRequest.deltaClonesCount",
            // Issues
            "newIssues",
            "potentialIssues",
            // Files
            "files",
          ]));
          return;
        }

        printAbout(prData, provider, organization, prHeadCommit, prExpectsCoverage, prHasCoverageData);
        printAnalysis(prData);

        // Merge new issues and potential issues into a single list
        const addedIssues: TaggedIssue[] = newIssues.data
          .filter((i) => i.deltaType === "Added")
          .map((i) => ({ ...i, isPotential: false }));
        const addedPotential: TaggedIssue[] = potentialIssues.data
          .filter((i) => i.deltaType === "Added")
          .map((i) => ({ ...i, isPotential: true }));
        const allIssues = [...addedIssues, ...addedPotential];

        printIssuesList(allIssues);
        printPaginationWarning(
          newIssues.pagination,
          "Not all issues are shown.",
        );
        printPaginationWarning(
          potentialIssues.pagination,
          "Not all issues are shown.",
        );

        // Diff Coverage Summary (only when coverage data is available)
        const fileCoverageList: FileDiffCoverage[] =
          (coverageResponse as any)?.data ?? [];
        printDiffCoverageSummary(fileCoverageList);

        // Files
        printFilesList(filesData.data || []);
        printPaginationWarning(
          filesData.pagination,
          "Not all files are shown.",
        );
      } catch (err) {
        handleError(err);
      }
    });
}
