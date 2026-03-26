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
  colorMetric,
  printSection,
  truncate,
  buildGateStatus,
  formatStandards,
  colorByGate,
  formatDelta,
  formatPrCoverage,
  formatPrIssues,
  formatAnalysisStatus,
} from "../utils/formatting";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { RepositoryService } from "../api/client/services/RepositoryService";
import { CodingStandardsService } from "../api/client/services/CodingStandardsService";
import { RepositoryWithAnalysis } from "../api/client/models/RepositoryWithAnalysis";
import { PullRequestWithAnalysis } from "../api/client/models/PullRequestWithAnalysis";
import { Commit } from "../api/client/models/Commit";
import { Count } from "../api/client/models/Count";

function printAbout(
  data: RepositoryWithAnalysis,
  headCommit: Commit | null,
  expectsCoverage: boolean,
  hasCoverageData: boolean,
): void {
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

  // Use head commit for analysis status; fall back to lastAnalysedCommit
  const commit = headCommit ?? data.lastAnalysedCommit;
  if (commit) {
    table.push({
      Analysis: formatAnalysisStatus({
        commitSha: commit.sha,
        startedAnalysis: commit.startedAnalysis,
        endedAnalysis: commit.endedAnalysis,
        expectsCoverage,
        hasCoverageData,
      }),
    });
  } else {
    table.push({ Analysis: ansis.dim("Never") });
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
        ? repo.standards.map((s) => `${s.name} (#${s.id})`).join(", ")
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

function printPullRequests(pullRequests: PullRequestWithAnalysis[]): void {
  const open = pullRequests.filter(
    (pr) =>
      pr.pullRequest.status === "open" || pr.pullRequest.status === "Open",
  );
  printSection("Open Pull Requests", open.length, "open pull request");
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
    .alias("repo")
    .description("Show details, status, and metrics for a specific repository")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .argument("<repository>", "repository name")
    .option("-a, --add", "add this repository to Codacy")
    .option("-r, --remove", "remove this repository from Codacy")
    .option("-f, --follow", "follow this repository on Codacy")
    .option("-u, --unfollow", "unfollow this repository on Codacy")
    .option("-R, --reanalyze", "request reanalysis of the HEAD commit")
    .option("-L, --link-standard <id>", "link a coding standard to this repository (by standard ID)")
    .option("-K, --unlink-standard <id>", "unlink a coding standard from this repository (by standard ID)")
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli repository gh my-org my-repo
  $ codacy-cloud-cli repository gh my-org my-repo --output json
  $ codacy-cloud-cli repository gh my-org my-repo --add
  $ codacy-cloud-cli repository gh my-org my-repo --remove
  $ codacy-cloud-cli repository gh my-org my-repo --follow
  $ codacy-cloud-cli repository gh my-org my-repo --unfollow
  $ codacy-cloud-cli repository gh my-org my-repo --reanalyze
  $ codacy-cloud-cli repository gh my-org my-repo --link-standard 12345
  $ codacy-cloud-cli repository gh my-org my-repo --unlink-standard 12345`,
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

        // ── Action: add ──────────────────────────────────────────────────
        if (opts.add) {
          const spinner = ora(`Adding ${repository} to Codacy...`).start();
          await RepositoryService.addRepository({
            repositoryFullPath: `${organization}/${repository}`,
            provider,
          });
          spinner.stop();
          console.log(
            `${ansis.green("✓")} Repository ${ansis.bold(repository)} added to Codacy.`,
          );
          console.log(
            ansis.dim(
              "Note: the repository will be available after a few minutes, once the initial cloning and analysis is complete.",
            ),
          );
          return;
        }

        // ── Action: remove ───────────────────────────────────────────────
        if (opts.remove) {
          const spinner = ora(`Removing ${repository} from Codacy...`).start();
          await RepositoryService.deleteRepository(
            provider,
            organization,
            repository,
          );
          spinner.stop();
          console.log(
            `${ansis.green("✓")} Repository ${ansis.bold(repository)} removed from Codacy.`,
          );
          return;
        }

        // ── Action: follow ───────────────────────────────────────────────
        if (opts.follow) {
          const spinner = ora(`Following ${repository}...`).start();
          await RepositoryService.followAddedRepository(
            provider,
            organization,
            repository,
          );
          spinner.stop();
          console.log(
            `${ansis.green("✓")} Now following ${ansis.bold(repository)}.`,
          );
          return;
        }

        // ── Action: unfollow ─────────────────────────────────────────────
        if (opts.unfollow) {
          const spinner = ora(`Unfollowing ${repository}...`).start();
          await RepositoryService.unfollowRepository(
            provider,
            organization,
            repository,
          );
          spinner.stop();
          console.log(`${ansis.green("✓")} Unfollowed ${ansis.bold(repository)}.`);
          return;
        }

        // ── Action: reanalyze ────────────────────────────────────────────
        if (opts.reanalyze) {
          const spinner = ora("Requesting reanalysis...").start();
          try {
            const commitsResponse = await AnalysisService.listRepositoryCommits(
              provider,
              organization,
              repository,
              undefined,
              undefined,
              1,
            );
            const headCommit = commitsResponse.data[0];
            if (!headCommit) {
              spinner.fail("No commits found in this repository.");
              return;
            }
            await RepositoryService.reanalyzeCommitById(
              provider,
              organization,
              repository,
              { commitUuid: headCommit.commit.sha },
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

        // ── Action: link-standard ─────────────────────────────────────────
        if (opts.linkStandard) {
          const spinner = ora(`Linking coding standard #${opts.linkStandard} to ${repository}...`).start();
          await CodingStandardsService.applyCodingStandardToRepositories(
            provider,
            organization,
            Number(opts.linkStandard),
            { link: [repository], unlink: [] },
          );
          spinner.stop();
          console.log(
            `${ansis.green("✓")} Coding standard #${opts.linkStandard} linked to ${ansis.bold(repository)}.`,
          );
          return;
        }

        // ── Action: unlink-standard ───────────────────────────────────────
        if (opts.unlinkStandard) {
          const spinner = ora(`Unlinking coding standard #${opts.unlinkStandard} from ${repository}...`).start();
          await CodingStandardsService.applyCodingStandardToRepositories(
            provider,
            organization,
            Number(opts.unlinkStandard),
            { link: [], unlink: [repository] },
          );
          spinner.stop();
          console.log(
            `${ansis.green("✓")} Coding standard #${opts.unlinkStandard} unlinked from ${ansis.bold(repository)}.`,
          );
          return;
        }

        // ── Default: dashboard view ──────────────────────────────────────
        const format = getOutputFormat(this);
        const spinner = ora("Fetching repository details...").start();

        const [repoResponse, prsResponse, issuesResponse, commitsResponse, coverageReportsResponse] = await Promise.all([
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
          AnalysisService.listRepositoryCommits(
            provider,
            organization,
            repository,
            undefined,
            undefined,
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

        const data = repoResponse.data;
        const pullRequests = prsResponse.data;
        const issuesCounts = issuesResponse.data.counts;
        const headCommit = (commitsResponse as any).data[0]?.commit ?? null;
        const expectsCoverage = !!(coverageReportsResponse as any).data?.hasCoverageOverview;
        const hasCoverageData = data.coverage?.coveragePercentage !== undefined;

        if (format === "json") {
          printJson(pickDeep({
            repository: data,
            pullRequests,
            issuesOverview: issuesCounts,
          }, [
            // About
            "repository.repository.provider",
            "repository.repository.owner",
            "repository.repository.name",
            "repository.repository.visibility",
            "repository.repository.defaultBranch.name",
            "repository.repository.lastUpdated",
            "repository.lastAnalysedCommit.sha",
            "repository.lastAnalysedCommit.startedAnalysis",
            "repository.lastAnalysedCommit.endedAnalysis",
            // Setup
            "repository.repository.languages",
            "repository.repository.standards",
            "repository.repository.gatePolicyName",
            "repository.repository.problems",
            // Metrics
            "repository.issuesCount",
            "repository.loc",
            "repository.coverage.coveragePercentage",
            "repository.complexFilesPercentage",
            "repository.duplicationPercentage",
            "repository.goals",
            // Pull Requests
            "pullRequests",
            // Issues Overview
            "issuesOverview",
          ]));
          return;
        }

        printAbout(data, headCommit, expectsCoverage, hasCoverageData);
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
