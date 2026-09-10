import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import {
  fetchIfAccountToken,
  repositoryTokenOption,
  repositoryTokenSkipNote,
  requireAccountToken,
  resolveAuth,
} from "../utils/auth";
import { handleError } from "../utils/error";
import { resolveRepoArgs } from "../utils/resolve-repo-args";
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
  formatRepoCoverageDetail,
  formatPrIssues,
  formatAnalysisStatus,
  prQualityMetric,
} from "../utils/formatting";
import { sanitizeText } from "../utils/sanitize";
import {
  AnalysisStatus,
  pollForAnalysis,
  durationFromStatus,
  snapshotFromOverview,
  diffSnapshots,
  renderReanalyzeReport,
  reanalyzeJson,
} from "../utils/reanalyze-wait";
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
): void {
  printSection("About");
  const repo = data.repository;
  const table = createTable();
  table.push(
    {
      Repository: `${providerDisplayName(repo.provider)} / ${sanitizeText(repo.owner)} / ${sanitizeText(repo.name)}`,
    },
    { Visibility: repo.visibility },
    { "Default Branch": sanitizeText(repo.defaultBranch?.name) || "N/A" },
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
        // The API's own coverage state, so no heuristic is needed here — see
        // `formatAnalysisStatus`. The Metrics section spells the same state
        // out with its dates and commit; this row just names it.
        coverageStatus: data.coverage?.status,
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
    Coverage: formatRepoCoverageDetail(
      data.coverage,
      goals?.minCoveragePercentage,
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

/**
 * Fallbacks for the two dashboard calls a repository token can't make. Used both
 * when we deliberately skip them and when they fail for an account token that
 * lacks access — the rest of the dashboard is worth rendering either way. The
 * explicit `pagination: undefined` keeps `prsResponse.pagination` type-checking
 * across the union with the real response.
 */
function noPullRequests(): { data: PullRequestWithAnalysis[]; pagination: undefined } {
  return { data: [], pagination: undefined };
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
      truncate(sanitizeText(pr.pullRequest.title), 40),
      truncate(sanitizeText(pr.pullRequest.originBranch) || "N/A", 20),
      formatStandards(pr),
      formatPrIssues(pr, gates.issues),
      formatPrCoverage(pr, gates.coverage),
      formatDelta(prQualityMetric(pr, "deltaComplexity"), gates.complexity),
      formatDelta(prQualityMetric(pr, "deltaClonesCount"), gates.duplication),
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
    table.push([sanitizeText(c.name), String(c.total)]);
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
    .argument("[provider]", "git provider (gh, gl, or bb) — auto-detected from git remote if omitted")
    .argument("[organization]", "organization name")
    .argument("[repository]", "repository name")
    .option("-a, --add", "add this repository to Codacy")
    .option("-r, --remove", "remove this repository from Codacy")
    .option("-f, --follow", "follow this repository on Codacy")
    .option("-u, --unfollow", "unfollow this repository on Codacy")
    .option("-R, --reanalyze", "request reanalysis of the HEAD commit")
    .option(
      "-w, --reanalyze-and-wait",
      "request reanalysis of the HEAD commit, wait for it to finish, then show what changed",
    )
    .option("-L, --link-standard <id>", "link a coding standard to this repository (by standard ID)")
    .option("-K, --unlink-standard <id>", "unlink a coding standard from this repository (by standard ID)")
    .addOption(repositoryTokenOption())
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli repository                             # auto-detect from git remote
  $ codacy-cloud-cli repository gh my-org my-repo
  $ codacy-cloud-cli repository gh my-org my-repo --output json
  $ codacy-cloud-cli repository gh my-org my-repo --add
  $ codacy-cloud-cli repository gh my-org my-repo --remove
  $ codacy-cloud-cli repository gh my-org my-repo --follow
  $ codacy-cloud-cli repository gh my-org my-repo --unfollow
  $ codacy-cloud-cli repository gh my-org my-repo --reanalyze
  $ codacy-cloud-cli repository gh my-org my-repo --reanalyze-and-wait
  $ codacy-cloud-cli repository gh my-org my-repo --link-standard 12345
  $ codacy-cloud-cli repository gh my-org my-repo --unlink-standard 12345`,
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

        // A repository (project) token is scoped to one repository's analysis
        // data; every action below reaches an organization- or account-level
        // resource, so Codacy rejects it. Refuse before `resolveRepoArgs`, which
        // shells out to git and prints an auto-detection line — misleading ahead
        // of a refusal.
        const ACCOUNT_ONLY_ACTIONS = [
          { opt: "add", flag: "--add", why: "adding a repository to Codacy is an account-level operation" },
          { opt: "remove", flag: "--remove", why: "removing a repository from Codacy is an account-level operation" },
          { opt: "follow", flag: "--follow", why: "following a repository is tied to your Codacy account" },
          { opt: "unfollow", flag: "--unfollow", why: "following a repository is tied to your Codacy account" },
          { opt: "linkStandard", flag: "--link-standard", why: "coding standards are managed at the organization level" },
          { opt: "unlinkStandard", flag: "--unlink-standard", why: "coding standards are managed at the organization level" },
        ] as const;
        for (const action of ACCOUNT_ONLY_ACTIONS) {
          if (opts[action.opt]) {
            requireAccountToken(auth, `codacy repository ${action.flag}`, action.why);
          }
        }

        const { provider, organization, repository } = resolveRepoArgs(
          [providerArg, organizationArg, repositoryArg],
          0,
          "repository",
          [],
        );

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

        // ── Action: reanalyze-and-wait ───────────────────────────────────
        if (opts.reanalyzeAndWait) {
          const format = getOutputFormat(this);
          const spinner = ora("Preparing reanalysis...").start();
          try {
            // Resolve the HEAD commit to reanalyze + capture baseline issue counts.
            const [commitsResponse, baselineOverview] = await Promise.all([
              AnalysisService.listRepositoryCommits(
                provider,
                organization,
                repository,
                undefined,
                undefined,
                1,
              ),
              AnalysisService.issuesOverview(provider, organization, repository),
            ]);
            const headCommit = commitsResponse.data[0];
            if (!headCommit) {
              spinner.fail("No commits found in this repository.");
              return;
            }
            const before = snapshotFromOverview(baselineOverview.data.counts);

            // Trigger the reanalysis (t0 = now).
            const triggeredAt = Date.now();
            await RepositoryService.reanalyzeCommitById(
              provider,
              organization,
              repository,
              { commitUuid: headCommit.commit.sha },
            );

            // Poll the first commit's analysis timestamps until the new
            // analysis (started after t0) starts and then finishes.
            const getStatus = async (): Promise<AnalysisStatus> => {
              const commits = await AnalysisService.listRepositoryCommits(
                provider,
                organization,
                repository,
                undefined,
                undefined,
                1,
              );
              const commit = commits.data[0]?.commit;
              return {
                startedAnalysis: commit?.startedAnalysis,
                endedAnalysis: commit?.endedAnalysis,
              };
            };
            const { status, timedOut } = await pollForAnalysis(getStatus, {
              triggeredAt,
              spinner,
            });
            if (timedOut) {
              spinner.fail(
                "Analysis didn't finish within 20 minutes. Re-run with --reanalyze-and-wait later, or check the latest status with `codacy repository`.",
              );
              return;
            }

            // Fetch fresh results and compare against the baseline.
            spinner.text = "Analysis done. Fetching results to compare...";
            const afterOverview = await AnalysisService.issuesOverview(
              provider,
              organization,
              repository,
            );
            const after = snapshotFromOverview(afterOverview.data.counts);
            const delta = diffSnapshots(before, after);
            const durationMs =
              durationFromStatus(status) ?? Date.now() - triggeredAt;

            spinner.stop();
            if (format === "json") {
              printJson(reanalyzeJson(before, after, delta, durationMs));
            } else {
              renderReanalyzeReport(delta, durationMs);
            }
          } catch (waitErr) {
            spinner.fail(
              `Failed to reanalyze: ${waitErr instanceof Error ? waitErr.message : waitErr}`,
            );
          }
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

        // Pull requests are outside a repository token's scope — Codacy
        // rejects them as if no token had been sent. Skip the request rather
        // than firing one we know will fail, and keep .catch() on it so an
        // account token that lacks access degrades the same way instead of
        // losing the whole dashboard (its siblings were already guarded).
        let prsUnavailable = auth.kind !== "account-token";
        const [repoResponse, prsResponse, issuesResponse, commitsResponse] = await Promise.all([
          AnalysisService.getRepositoryWithAnalysis(
            provider,
            organization,
            repository,
          ),
          fetchIfAccountToken(auth, noPullRequests(), () =>
            AnalysisService.listRepositoryPullRequests(
              provider,
              organization,
              repository,
            ).catch(() => {
              prsUnavailable = true;
              return noPullRequests();
            }),
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
        ]);

        spinner.stop();

        const data = repoResponse.data;
        const pullRequests = prsResponse.data;
        const issuesCounts = issuesResponse.data.counts;
        const headCommit = (commitsResponse as any).data[0]?.commit ?? null;

        const unavailableSections = prsUnavailable ? ["pullRequests"] : [];

        if (format === "json") {
          printJson(pickDeep({
            repository: {
              ...data,
              fileCount: data.coverage?.numberTotalFiles,
            },
            // Always an array, never null or absent, so `jq '.pullRequests[]'`
            // and `| length` keep working. `unavailable` is what distinguishes
            // "no open pull requests" from "couldn't look"; pickDeep drops
            // undefined, so it stays absent whenever the data is real.
            pullRequests,
            issuesOverview: issuesCounts,
            unavailable: unavailableSections.length ? unavailableSections : undefined,
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
            "repository.fileCount",
            "repository.coverage.coveragePercentage",
            "repository.coverage.status",
            "repository.coverage.lastCommitWithCoverage",
            "repository.coverage.statusUpdatedAt",
            "repository.coverage.valueUpdatedAt",
            "repository.complexFilesPercentage",
            "repository.duplicationPercentage",
            "repository.goals",
            // Pull Requests
            "pullRequests",
            // Issues Overview
            "issuesOverview",
            // Sections that couldn't be fetched with the token in use
            "unavailable",
          ]));
          return;
        }

        printAbout(data, headCommit);
        printSetup(data);
        printMetrics(data);
        if (prsUnavailable) {
          // Keep the section header: a section that silently vanishes reads as a
          // bug, and printPullRequests([]) would claim "No open pull requests",
          // which is a different (and false) statement.
          printSection("Open Pull Requests");
          console.log(
            ansis.dim(
              `  ${
                auth.kind === "account-token"
                  ? "Could not load pull requests."
                  : repositoryTokenSkipNote("pull requests")
              }`,
            ),
          );
        } else {
          printPullRequests(pullRequests);

          printPaginationWarning(
            prsResponse.pagination,
            "Not all pull requests are shown.",
          );
        }

        printIssuesOverview(issuesCounts);
      } catch (err) {
        handleError(err);
      }
    });
}
