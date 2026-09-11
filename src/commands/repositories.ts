import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { repositoryTokenOption, resolveAccountAuth } from "../utils/auth";
import { handleError } from "../utils/error";
import {
  createTable,
  formatFriendlyDate,
  getOutputFormat,
  pickDeep,
  printJson,
  printPaginationWarning,
} from "../utils/output";
import { AnalysisService } from "../api/client/services/AnalysisService";
import {
  colorMetric,
  coverageStatusLegend,
  formatCount,
  formatGrade,
  formatRepoCoverageCell,
} from "../utils/formatting";
import pluralize from "pluralize";

export function registerRepositoriesCommand(program: Command) {
  program
    .command("repositories")
    .alias("repos")
    .description("List repositories for an organization with analysis data")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .option("-s, --search <query>", "filter repositories by name")
    .addOption(repositoryTokenOption())
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli repositories gh my-org
  $ codacy-cloud-cli repositories gh my-org --search my-repo
  $ codacy-cloud-cli repositories gl my-org --output json`,
    )
    .action(async function (
      this: Command,
      provider: string,
      organization: string,
      options: { search?: string },
    ) {
      try {
        resolveAccountAuth(this, "it reads organization-level data (every repository in the organization)");
        const format = getOutputFormat(this);
        const spinner = ora("Fetching repositories...").start();

        const response =
          await AnalysisService.listOrganizationRepositoriesWithAnalysis(
            provider,
            organization,
            undefined, // cursor
            100, // limit
            options.search,
          );

        spinner.stop();

        const repos = response.data;

        if (format === "json") {
          printJson(repos.map((repo: any) => pickDeep(repo, [
            "repository.name",
            "repository.visibility",
            "repository.lastUpdated",
            "gradeLetter",
            "issuesCount",
            "complexFilesPercentage",
            "duplicationPercentage",
            "coverage.coveragePercentage",
            "coverage.status",
            "coverage.lastCommitWithCoverage",
            "coverage.statusUpdatedAt",
            // What tells a consumer the `Waiting` percentage above is stale —
            // the job the ⋯ marker does in the table.
            "coverage.valueUpdatedAt",
            "goals",
          ])));
          return;
        }

        if (repos.length === 0) {
          console.log(ansis.dim("\nNo repositories found."));
          return;
        }

        const repoTotal = response.pagination?.total ?? repos.length;
        const totalSuffix = ` — Found ${formatCount(repoTotal)} ${pluralize("repository", repoTotal)}`;
        console.log(
          ansis.bold(
            `\nRepositories for ${organization} (${provider})${totalSuffix}\n`,
          ),
        );

        const table = createTable({
          head: [
            "Name",
            "Grade",
            "Issues",
            "Complexity",
            "Duplication",
            "Coverage",
            "Last Updated",
          ],
        });

        for (const repo of repos) {
          const goals = repo.goals;
          // ⊙ marks public repositories
          const name =
            repo.repository.visibility === "Public"
              ? `${repo.repository.name} ${ansis.dim("⊙")}`
              : repo.repository.name;
          table.push([
            name,
            formatGrade(repo.gradeLetter),
            repo.issuesCount !== undefined ? String(repo.issuesCount) : "N/A",
            colorMetric(
              repo.complexFilesPercentage,
              goals?.maxComplexFilesPercentage,
              "max",
            ),
            colorMetric(
              repo.duplicationPercentage,
              goals?.maxDuplicatedFilesPercentage,
              "max",
            ),
            formatRepoCoverageCell(
              repo.coverage,
              goals?.minCoveragePercentage,
            ),
            repo.repository.lastUpdated
              ? formatFriendlyDate(repo.repository.lastUpdated)
              : "N/A",
          ]);
        }

        console.log(table.toString());

        // Only the coverage statuses actually present in this listing are
        // explained, so a healthy organization never pays for the legend.
        const legend = coverageStatusLegend(
          repos.map((repo: any) => repo.coverage),
        );
        if (legend.length > 0) console.log(`\n${legend.join("\n")}`);

        printPaginationWarning(
          response.pagination,
          "Use --search <query> to filter by name.",
        );
      } catch (err) {
        handleError(err);
      }
    });
}
