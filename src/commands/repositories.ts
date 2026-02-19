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
import { AnalysisService } from "../api/client/services/AnalysisService";

/**
 * Format a percentage value, coloring it red or green based on a threshold.
 * For "max" thresholds (issues, complexity, duplication): green if under, red if over.
 * For "min" thresholds (coverage): green if over, red if under.
 */
function formatMetric(
  value: number | undefined,
  threshold: number | undefined,
  mode: "max" | "min",
): string {
  if (value === undefined || value === null) return "N/A";
  const display = `${value.toFixed(1)}%`;
  if (threshold === undefined) return display;
  if (mode === "max") {
    return value > threshold ? ansis.red(display) : ansis.green(display);
  }
  // mode === "min"
  return value < threshold ? ansis.red(display) : ansis.green(display);
}

function formatGrade(gradeLetter: string | undefined): string {
  if (!gradeLetter) return "N/A";
  const colors: Record<string, (s: string) => string> = {
    A: ansis.green,
    B: ansis.green,
    C: ansis.yellow,
    D: ansis.red,
    F: ansis.red,
  };
  const colorFn = colors[gradeLetter] || ((s: string) => s);
  return colorFn(gradeLetter);
}

export function registerRepositoriesCommand(program: Command) {
  program
    .command("repositories")
    .description("List repositories for an organization with analysis data")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .option("-s, --search <query>", "filter repositories by name")
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
        checkApiToken();
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
          printJson(repos);
          return;
        }

        if (repos.length === 0) {
          console.log(ansis.dim("\nNo repositories found."));
          return;
        }

        console.log(
          ansis.bold(`\nRepositories for ${organization} (${provider})\n`),
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
            formatMetric(
              repo.complexFilesPercentage,
              goals?.maxComplexFilesPercentage,
              "max",
            ),
            formatMetric(
              repo.duplicationPercentage,
              goals?.maxDuplicatedFilesPercentage,
              "max",
            ),
            formatMetric(
              repo.coverage?.coveragePercentage,
              goals?.minCoveragePercentage,
              "min",
            ),
            repo.repository.lastUpdated
              ? formatFriendlyDate(repo.repository.lastUpdated)
              : "N/A",
          ]);
        }

        console.log(table.toString());

        printPaginationWarning(
          response.pagination,
          "Use --search <query> to filter by name.",
        );
      } catch (err) {
        handleError(err);
      }
    });
}
