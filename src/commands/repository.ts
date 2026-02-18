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
import { AnalysisService } from "../api/client/services/AnalysisService";
import { RepositoryWithAnalysis } from "../api/client/models/RepositoryWithAnalysis";
import { PullRequestWithAnalysis } from "../api/client/models/PullRequestWithAnalysis";
import { AnalysisResultReason } from "../api/client/models/AnalysisResultReason";
import { Count } from "../api/client/models/Count";

/**
 * Color a metric value based on a threshold.
 * "max" thresholds: green if under, red if over.
 * "min" thresholds: green if above, red if under.
 */
function colorMetric(
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

function printSection(title: string): void {
  console.log(ansis.bold(`\n${title}\n`));
}

function printAbout(data: RepositoryWithAnalysis): void {
  printSection("About");
  const repo = data.repository;
  const table = createTable();
  table.push(
    {
      Repository: `${providerDisplayName(repo.provider)} / ${repo.owner} / ${repo.name}`,
    },
    { Visibility: repo.visibility },
    { "Default Branch": repo.defaultBranch?.name || "N/A" },
    {
      "Last Updated": repo.lastUpdated
        ? formatFriendlyDate(repo.lastUpdated)
        : "N/A",
    },
  );
  if (data.lastAnalysedCommit) {
    const commit = data.lastAnalysedCommit;
    const time = commit.endedAnalysis
      ? formatFriendlyDate(commit.endedAnalysis)
      : "N/A";
    table.push({
      "Last Analysis": `${time} (${commit.sha.substring(0, 7)})`,
    });
  } else {
    table.push({ "Last Analysis": ansis.dim("Never") });
  }
  console.log(table.toString());
}

function printSetup(data: RepositoryWithAnalysis): void {
  printSection("Setup");
  const repo = data.repository;
  const table = createTable();
  table.push({
    Languages:
      repo.languages.length > 0 ? repo.languages.join(", ") : ansis.dim("None"),
  });
  table.push({
    "Coding Standards":
      repo.standards.length > 0
        ? repo.standards.map((s) => s.name).join(", ")
        : ansis.dim("None"),
  });
  table.push({
    "Quality Gate": repo.gatePolicyName || ansis.dim("None"),
  });
  if (repo.problems.length > 0) {
    table.push({
      Problems: ansis.yellow(repo.problems.map((p) => p.message).join("; ")),
    });
  } else {
    table.push({ Problems: ansis.green("None") });
  }
  console.log(table.toString());
}

function printMetrics(data: RepositoryWithAnalysis): void {
  printSection("Metrics");
  const goals = data.goals;
  const table = createTable();

  // Issues count + issues per kLoC
  const issuesDisplay =
    data.issuesCount !== undefined ? String(data.issuesCount) : "N/A";
  let issuesKloc = "N/A";
  if (data.issuesCount !== undefined && data.loc && data.loc > 0) {
    issuesKloc = (data.issuesCount / (data.loc / 1000)).toFixed(2);
  }
  table.push({ Issues: `${issuesDisplay} (${issuesKloc} / kLoC)` });
  table.push({
    Coverage: colorMetric(
      data.coverage?.coveragePercentage,
      goals?.minCoveragePercentage,
      "min",
    ),
  });
  table.push({
    "Complex Files": colorMetric(
      data.complexFilesPercentage,
      goals?.maxComplexFilesPercentage,
      "max",
    ),
  });
  table.push({
    Duplication: colorMetric(
      data.duplicationPercentage,
      goals?.maxDuplicatedFilesPercentage,
      "max",
    ),
  });
  console.log(table.toString());
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.substring(0, max - 3) + "..." : text;
}

type GateStatusMap = {
  issues?: boolean;
  coverage?: boolean;
  complexity?: boolean;
  duplication?: boolean;
};

/**
 * Build a map of gate pass/fail from quality and coverage resultReasons.
 * Gate names are matched by keyword to map to metric columns.
 */
function buildGateStatus(pr: PullRequestWithAnalysis): GateStatusMap {
  const status: GateStatusMap = {};
  const reasons: AnalysisResultReason[] = [
    ...(pr.quality?.resultReasons || []),
    ...(pr.coverage?.resultReasons || []),
  ];
  for (const r of reasons) {
    const gate = r.gate.toLowerCase();
    if (gate.includes("issue") && !gate.includes("security")) {
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
function formatStandards(pr: PullRequestWithAnalysis): string {
  const covUp = pr.coverage?.isUpToStandards;
  const qualUp = pr.quality?.isUpToStandards;
  if (covUp === undefined && qualUp === undefined) return ansis.dim("-");
  if (covUp === false || qualUp === false) return ansis.red("✗");
  return ansis.green("✓");
}

/**
 * Color a value string based on gate status (green if passing, red if failing).
 * Falls back to no coloring if gate status is unknown.
 */
function colorByGate(display: string, passing: boolean | undefined): string {
  if (passing === undefined) return display;
  return passing ? ansis.green(display) : ansis.red(display);
}

function formatDelta(
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

function formatPrCoverage(
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

function formatPrIssues(
  pr: PullRequestWithAnalysis,
  passing?: boolean,
): string {
  const newI = pr.newIssues !== undefined ? `+${pr.newIssues}` : "N/A";
  const fixI = pr.fixedIssues !== undefined ? `-${pr.fixedIssues}` : "N/A";
  const display = `${newI} / ${fixI}`;
  return colorByGate(display, passing);
}

function printPullRequests(pullRequests: PullRequestWithAnalysis[]): void {
  printSection("Open Pull Requests");
  const open = pullRequests.filter(
    (pr) =>
      pr.pullRequest.status === "open" || pr.pullRequest.status === "Open",
  );
  if (open.length === 0) {
    console.log(ansis.dim("  No open pull requests."));
    return;
  }

  const table = createTable({
    head: [
      "#",
      "Title",
      "Branch",
      ansis.dim("✓"),
      "Issues",
      "Coverage",
      "Complexity",
      "Duplication",
      "Updated",
    ],
  });
  for (const pr of open) {
    const gates = buildGateStatus(pr);
    table.push([
      String(pr.pullRequest.number),
      truncate(pr.pullRequest.title, 40),
      truncate(pr.pullRequest.originBranch || "N/A", 20),
      formatStandards(pr),
      formatPrIssues(pr, gates.issues),
      formatPrCoverage(pr, gates.coverage),
      formatDelta(pr.deltaComplexity, gates.complexity),
      formatDelta(pr.deltaClonesCount, gates.duplication),
      formatFriendlyDate(pr.pullRequest.updated),
    ]);
  }
  console.log(table.toString());
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

function printIssuesOverview(counts: {
  categories: Count[];
  levels: Count[];
  languages: Count[];
}): void {
  printSection("Issues Overview");
  if (
    counts.categories.length === 0 &&
    counts.levels.length === 0 &&
    counts.languages.length === 0
  ) {
    console.log(ansis.dim("  No issues data available."));
    return;
  }
  printCountTable("Category", counts.categories);
  if (counts.categories.length > 0 && counts.levels.length > 0) console.log();
  printCountTable("Severity", counts.levels);
  if (counts.levels.length > 0 && counts.languages.length > 0) console.log();
  printCountTable("Language", counts.languages);
}

export function registerRepositoryCommand(program: Command) {
  program
    .command("repository")
    .description("Show details, status, and metrics for a specific repository")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .argument("<repository>", "repository name")
    .action(async function (
      this: Command,
      provider: string,
      organization: string,
      repository: string,
    ) {
      try {
        checkApiToken();
        const format = getOutputFormat(this);
        const spinner = ora("Fetching repository details...").start();

        const [repoResponse, prsResponse, issuesResponse] = await Promise.all([
          AnalysisService.getRepositoryWithAnalysis(
            provider,
            organization,
            repository,
          ),
          AnalysisService.listRepositoryPullRequests(
            provider,
            organization,
            repository,
          ),
          AnalysisService.issuesOverview(provider, organization, repository),
        ]);

        spinner.stop();

        const data = repoResponse.data;
        const pullRequests = prsResponse.data;
        const issuesCounts = issuesResponse.data.counts;

        if (format === "json") {
          printJson({
            repository: data,
            pullRequests,
            issuesOverview: issuesCounts,
          });
          return;
        }

        printAbout(data);
        printSetup(data);
        printMetrics(data);
        printPullRequests(pullRequests);

        printPaginationWarning(
          prsResponse.pagination,
          "Not all pull requests are shown.",
        );

        printIssuesOverview(issuesCounts);
      } catch (err) {
        handleError(err);
      }
    });
}
