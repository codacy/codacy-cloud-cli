import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
import {
  createTable,
  formatFriendlyDate,
  getOutputFormat,
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
  formatDelta,
  formatPrCoverage,
  formatPrIssues,
  printIssueCard,
  printIssueDetail,
  GateStatusMap,
} from "../utils/formatting";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { ToolsService } from "../api/client/services/ToolsService";
import { FileService } from "../api/client/services/FileService";
import { PullRequestWithAnalysis } from "../api/client/models/PullRequestWithAnalysis";
import { AnalysisResultReason } from "../api/client/models/AnalysisResultReason";
import { CommitDeltaIssue } from "../api/client/models/CommitDeltaIssue";
import { FileDeltaAnalysis } from "../api/client/models/FileDeltaAnalysis";
import { PullRequestIssuesResponse } from "../api/client/models/PullRequestIssuesResponse";
import { FileAnalysisListResponse } from "../api/client/models/FileAnalysisListResponse";

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
  table.push({
    "Head Commit": p.headCommitSha
      ? p.headCommitSha.substring(0, 7)
      : ansis.dim("N/A"),
  });
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
 */
function formatFileDelta(
  value: number | undefined,
  isPercent: boolean = false,
): string {
  if (value === undefined || value === null) return ansis.dim("N/A");
  if (value === 0) return ansis.dim("0");
  const sign = value > 0 ? "+" : "";
  const suffix = isPercent ? "%" : "";
  const display = `${sign}${isPercent ? value.toFixed(1) : value}${suffix}`;
  if (value > 0) return ansis.red(display);
  return ansis.green(display);
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
      formatFileDelta(c?.deltaCoverage, true),
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
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli pull-request gh my-org my-repo 42
  $ codacy-cloud-cli pull-request gh my-org my-repo 42 --output json
  $ codacy-cloud-cli pull-request gh my-org my-repo 42 --issue 9901`,
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

        const format = getOutputFormat(this);
        const issueIdStr: string | undefined = this.opts().issue;

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
            printJson({ issue, pattern, lines });
            return;
          }

          printIssueDetail(issue, pattern, lines);
          return;
        }

        const spinner = ora("Fetching pull request details...").start();

        const [
          prResponse,
          newIssuesResponse,
          potentialIssuesResponse,
          filesResponse,
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
        ]);

        spinner.stop();

        // getRepositoryPullRequest returns PullRequestWithAnalysis directly
        const prData: PullRequestWithAnalysis = prResponse as any;
        const newIssues: PullRequestIssuesResponse = newIssuesResponse as any;
        const potentialIssues: PullRequestIssuesResponse =
          potentialIssuesResponse as any;
        const filesData: FileAnalysisListResponse = filesResponse as any;

        if (format === "json") {
          printJson({
            pullRequest: prData,
            newIssues: newIssues.data,
            potentialIssues: potentialIssues.data,
            files: filesData.data || [],
          });
          return;
        }

        printAbout(prData, provider, organization);
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
