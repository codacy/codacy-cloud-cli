import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
import { getOutputFormat, printJson } from "../utils/output";
import { printIssueDetail } from "../utils/formatting";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { ToolsService } from "../api/client/services/ToolsService";
import { FileService } from "../api/client/services/FileService";
import { IssueStateBody } from "../api/client/models/IssueStateBody";

export function registerIssueCommand(program: Command) {
  program
    .command("issue")
    .alias("iss")
    .description("Show full details of a single quality issue")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .argument("<repository>", "repository name")
    .argument("<issueId>", "issue ID (shown at the bottom of each issue card)")
    .option("-I, --ignore", "ignore this issue")
    .option(
      "-R, --ignore-reason <reason>",
      "reason for ignoring (AcceptedUse|FalsePositive|NotExploitable|TestCode|ExternalCode)",
      "AcceptedUse",
    )
    .option("-m, --ignore-comment <comment>", "optional comment for the ignore action", "")
    .option("-U, --unignore", "unignore this issue")
    .addHelpText(
      "after",
      `
Examples:
  $ codacy issue gh my-org my-repo 12345
  $ codacy issue gh my-org my-repo 12345 --output json
  $ codacy issue gh my-org my-repo 12345 --ignore
  $ codacy issue gh my-org my-repo 12345 --ignore --ignore-reason FalsePositive --ignore-comment "Not applicable here"
  $ codacy issue gh my-org my-repo 12345 --unignore`,
    )
    .action(async function (
      this: Command,
      provider: string,
      organization: string,
      repository: string,
      issueIdStr: string,
    ) {
      try {
        checkApiToken();
        const format = getOutputFormat(this);
        const issueId = parseInt(issueIdStr, 10);
        const shouldIgnore: boolean = !!this.opts().ignore;
        const shouldUnignore: boolean = !!this.opts().unignore;
        const ignoreReason = this.opts().ignoreReason as IssueStateBody["reason"];
        const ignoreComment: string = this.opts().ignoreComment;

        if (isNaN(issueId)) {
          console.error(ansis.red(`Invalid issue ID: ${issueIdStr}`));
          process.exit(1);
        }

        const spinner = ora("Fetching issue details...").start();

        const issueResponse = await AnalysisService.getIssue(
          provider,
          organization,
          repository,
          issueId,
        );
        const issue = issueResponse.data;

        // Fetch pattern info and file context in parallel
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
          ).catch((e) => {
            console.log("File path: ", issue.filePath);
            console.error(ansis.red(`Error fetching file content: ${e}`));
            return null;
          }),
        ]);

        spinner.stop();

        const pattern = patternResponse?.data ?? null;
        const lines = fileContentResponse?.data ?? null;

        if (format === "json") {
          printJson({ issue, pattern, lines });
          return;
        }

        if (!shouldIgnore && !shouldUnignore) {
          printIssueDetail(issue, pattern, lines);
        }

        if (shouldIgnore) {
          const ignoreSpinner = ora("Ignoring issue...").start();
          await AnalysisService.updateIssueState(
            provider,
            organization,
            repository,
            issue.issueId,
            {
              ignored: true,
              reason: ignoreReason,
              comment: ignoreComment || undefined,
            },
          );
          ignoreSpinner.succeed(
            `Issue #${issueId} ignored (reason: ${ignoreReason}).`,
          );
        }

        if (shouldUnignore) {
          const unignoreSpinner = ora("Unignoring issue...").start();
          await AnalysisService.updateIssueState(
            provider,
            organization,
            repository,
            issue.issueId,
            { ignored: false },
          );
          unignoreSpinner.succeed(`Issue #${issueId} unignored.`);
        }
      } catch (err) {
        handleError(err);
      }
    });
}
