import { Command } from "commander";
import ansis from "ansis";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
import Table from "cli-table3";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import ora from "ora";
dayjs.extend(relativeTime);

export function registerReposCommand(program: Command) {
  program
    .command("repos <provider> <organization>")
    .description(
      "List repositories with analysis and metrics inside an organization (provider: gh|gl|bb)"
    )
    .action(async (provider: string, organization: string) => {
      try {
        checkApiToken();
        if (!provider || !organization) {
          console.error(
            ansis.red("Both provider and organization are required.")
          );
          process.exit(1);
        }
        const PAGE_SIZE = 20;
        let cursor: string | undefined = undefined;
        let printedHeader = false;
        const table = new Table({
          head: [
            "",
            ansis.bold("Name"),
            ansis.bold("Issues"),
            ansis.bold("Duplication"),
            ansis.bold("Complexity"),
            ansis.bold("Coverage"),
            ansis.bold("Languages"),
            ansis.bold("Standards"),
            ansis.bold("Policy"),
            ansis.bold("Updated"),
          ],
          colWidths: [5, 20, 20, 14, 14, 14, 30, 16, 16, 16],
          wordWrap: true,
          style: { head: [], border: [] },
        });
        // Helper for grade color (background, white text, centered)
        function colorGradeBg(gradeLetter: string | undefined) {
          if (!gradeLetter) return "-";
          let bg;
          switch (gradeLetter) {
            case "A":
              bg = ansis.bgGreen;
              break;
            case "B":
              bg = ansis.bgGreenBright;
              break;
            case "C":
              bg = ansis.bgYellow;
              break;
            case "D":
              bg = ansis.bgMagenta;
              break; // orange not in ansis, magenta as alternative
            case "E":
              bg = ansis.bgMagentaBright;
              break;
            case "F":
              bg = ansis.bgRed;
              break;
            default:
              return gradeLetter;
          }
          // Center the letter in a 3-char wide cell
          const centered = ` ${gradeLetter} `;
          return bg(ansis.white(centered));
        }
        // Helper for metric color
        function colorMetric(
          value: number | string | undefined,
          goal: number | undefined,
          compare: (v: number, g: number) => boolean,
          colorizePercent = false
        ) {
          if (value === undefined || value === "-") return ansis.gray("-");
          if (goal === undefined)
            return ansis.gray(value.toString() + (colorizePercent ? "%" : ""));
          const v = typeof value === "string" ? parseFloat(value) : value;
          if (isNaN(v))
            return ansis.gray(value.toString() + (colorizePercent ? "%" : ""));
          const colorFn = compare(v, goal) ? ansis.green : ansis.red;
          return colorFn(value.toString() + (colorizePercent ? "%" : ""));
        }
        async function promptContinue() {
          return new Promise<void>((resolve) => {
            process.stdout.write(ansis.bold("Press Enter to show more... "));
            process.stdin.resume();
            process.stdin.once("data", () => {
              process.stdin.pause();
              process.stdout.write("\n");
              resolve();
            });
          });
        }
        do {
          const spinner = ora("Fetching repositories...").start();
          let response;
          try {
            response =
              await AnalysisService.listOrganizationRepositoriesWithAnalysis(
                provider,
                organization,
                cursor,
                PAGE_SIZE
              );
            spinner.succeed("Repositories fetched.");
          } catch (apiErr) {
            spinner.fail("Failed to fetch repositories.");
            throw apiErr;
          }
          const repos = response.data;
          if (!repos.length && !printedHeader) {
            console.log(ansis.yellow("No repositories found."));
            return;
          }
          if (!printedHeader) {
            // Print header (first three lines: border, header row, border below header)
            const tableLines = table.toString().split("\n");
            console.log(tableLines[0]); // top border
            console.log(tableLines[1]); // header row
            console.log(tableLines[2]); // border below header
            printedHeader = true;
          }
          const tempTable = new Table(table.options);
          for (const repoAnalysis of repos) {
            const repo = repoAnalysis.repository;
            const goals = (repoAnalysis as any).goals ?? {};
            // Grade
            const grade = colorGradeBg(repoAnalysis.gradeLetter);
            // Issues per 1000 lines of code
            let issuesColored = ansis.gray("-");
            if (repoAnalysis.issuesCount !== undefined && repoAnalysis.loc) {
              const perKloc = (
                repoAnalysis.issuesCount /
                (repoAnalysis.loc / 1000)
              ).toFixed(2);
              const perKlocColored = colorMetric(
                perKloc,
                goals.maxIssuePercentage,
                (v, g) => v <= g
              );
              issuesColored = `${perKlocColored} ${ansis.gray(
                `(${repoAnalysis.issuesCount})`
              )}`;
            } else if (repoAnalysis.issuesCount !== undefined) {
              // No KLOC, just show count in gray
              issuesColored = ansis.gray(repoAnalysis.issuesCount.toString());
            }
            // Friendly last updated
            let lastUpdated = "-";
            if (repo.lastUpdated) {
              const d = dayjs(repo.lastUpdated);
              lastUpdated = d.isValid()
                ? d.fromNow()
                : repo.lastUpdated.split("T")[0];
            }
            // Color metrics
            const duplicationValue =
              repoAnalysis.duplicationPercentage !== undefined
                ? repoAnalysis.duplicationPercentage
                : undefined;
            const duplicationColored =
              duplicationValue !== undefined
                ? colorMetric(
                    duplicationValue,
                    goals.maxDuplicatedFilesPercentage,
                    (v, g) => v <= g,
                    true
                  )
                : ansis.gray("-");
            const complexityValue =
              repoAnalysis.complexFilesPercentage !== undefined
                ? repoAnalysis.complexFilesPercentage
                : undefined;
            const complexityColored =
              complexityValue !== undefined
                ? colorMetric(
                    complexityValue,
                    goals.maxComplexFilesPercentage,
                    (v, g) => v <= g,
                    true
                  )
                : ansis.gray("-");
            const coverageValue =
              repoAnalysis.coverage &&
              repoAnalysis.coverage.coveragePercentageWithDecimals !== undefined
                ? repoAnalysis.coverage.coveragePercentageWithDecimals
                : undefined;
            const coverageColored =
              coverageValue !== undefined
                ? colorMetric(
                    coverageValue,
                    goals.minCoveragePercentage,
                    (v, g) => v >= g,
                    true
                  )
                : ansis.gray("-");
            tempTable.push([
              grade,
              repo.name,
              issuesColored,
              duplicationColored,
              complexityColored,
              coverageColored,
              repo.languages && repo.languages.length
                ? repo.languages.join(", ")
                : "-",
              repo.standards && repo.standards.length
                ? repo.standards.map((s) => s.name).join(", ")
                : "-",
              repo.gatePolicyName || "-",
              lastUpdated,
            ]);
          }
          if (repos.length > 0) {
            if (cursor) {
              // Move cursor up three lines and clear (prompt and possible empty lines)
              process.stdout.write(
                "\u001b[1A\u001b[2K\u001b[1A\u001b[2K\u001b[1A\u001b[2K\u001b[1A\u001b[2K"
              );
            } else {
              process.stdout.write("\u001b[1A\u001b[2K");
            }

            // remove the first 2 lines (the header and the border)
            const tableLines = tempTable.toString().split("\n");
            const tableToPrint = tableLines.slice(2).join("\n");

            console.log(tableToPrint);
          }
          cursor =
            (response.pagination && response.pagination.cursor) || undefined;
          if (cursor && repos.length > 0) {
            await promptContinue();
          }
        } while (cursor);
      } catch (err) {
        handleError(err);
      }
    });
}
