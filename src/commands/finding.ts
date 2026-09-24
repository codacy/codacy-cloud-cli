import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { repositoryTokenOption, resolveAccountAuth } from "../utils/auth";
import { handleError } from "../utils/error";
import { getOutputFormat, pickDeep, printJson } from "../utils/output";
import {
  colorPriority,
  colorStatus,
  formatDueDate,
  formatVersionSegment,
  formatDependencyChainsBlock,
  printCveBlock,
  printAdvisoryBlock,
  printIssueCodeContext,
} from "../utils/formatting";
import { sanitizeText } from "../utils/sanitize";
import { SecurityService } from "../api/client/services/SecurityService";
import { IgnoreSRMItemBody } from "../api/client/models/IgnoreSRMItemBody";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { ToolsService } from "../api/client/services/ToolsService";
import { FileService } from "../api/client/services/FileService";
import { SrmItem } from "../api/client/models/SrmItem";
import { CommitIssue } from "../api/client/models/CommitIssue";
import { Pattern } from "../api/client/models/Pattern";
import { CodeBlockLine } from "../api/client/models/CodeBlockLine";
import { CveRecord } from "../utils/cve";

async function fetchCveData(cveId: string): Promise<CveRecord | null> {
  try {
    const res = await fetch(`https://cveawg.mitre.org/api/cve/${cveId}`);
    if (!res.ok) return null;
    return (await res.json()) as CveRecord;
  } catch {
    return null;
  }
}

function printFindingDetail(
  item: SrmItem,
  issue: CommitIssue | null,
  pattern: Pattern | null,
  lines: CodeBlockLine[] | null,
  cveData: CveRecord | null,
): void {
  const pipe = ` ${ansis.dim("|")} `;

  console.log();

  // Line 1: Priority | SecurityCategory ScanType | Likelihood EffortToFix | Repository  <id>
  const line1Parts: string[] = [colorPriority(item.priority)];

  const catParts = [
    sanitizeText(item.securityCategory),
    item.scanType ? ansis.dim(sanitizeText(item.scanType)) : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  if (catParts) line1Parts.push(catParts);

  const penTestParts = [item.likelihood, item.effortToFix].filter(
    (v) => v && v !== "not_applicable",
  ) as string[];
  if (penTestParts.length > 0) line1Parts.push(penTestParts.join(" "));

  if (item.repository) line1Parts.push(ansis.dim(sanitizeText(item.repository)));

  const idLabel = ansis.hex("#555555")(item.id);
  console.log(line1Parts.join(pipe) + `  ${idLabel}`);

  // Title
  console.log(sanitizeText(item.title));
  console.log();

  // Line 2: Status DueAt | CVE/CWE | AffectedVersion → FixedVersion | Application | AffectedTargets
  const line2Parts: string[] = [
    `${colorStatus(item.status)} ${ansis.dim(formatDueDate(item.dueAt))}`,
  ];

  if (item.cve) line2Parts.push(ansis.dim(item.cve));
  else if (item.cwe) line2Parts.push(ansis.dim(`CWE-${item.cwe}`));

  // When dependency chains are present they carry the vulnerable package and
  // fixed version on their own line, so the redundant version segment is dropped.
  const hasChains = !!item.dependencyChains?.length;
  if (!hasChains) {
    const versionSegment = formatVersionSegment(
      item.affectedVersion,
      item.fixedVersion,
    );
    if (versionSegment) line2Parts.push(ansis.dim(versionSegment));
  }

  if (item.application) line2Parts.push(ansis.dim(sanitizeText(item.application)));
  if (item.affectedTargets) line2Parts.push(ansis.dim(sanitizeText(item.affectedTargets)));

  console.log(line2Parts.join(pipe));

  // Dependency import chains (SCA findings with dependencyChains): skipped when the linked
  // Codacy issue carries its own chains — printIssueCodeContext renders those instead
  // (passed item.fixedVersion, since CommitIssue has no fixed-version field).
  if (hasChains && !issue?.dependencyChains?.length) {
    const chainBlock = formatDependencyChainsBlock(
      item.dependencyChains,
      item.fixedVersion,
    );
    if (chainBlock) console.log(ansis.dim(chainBlock));
  }

  // Ignored section
  if (item.ignored) {
    const ig = item.ignored;
    console.log();
    console.log(
      ansis.dim(`Ignored by ${sanitizeText(ig.authorName)} on ${formatDueDate(ig.at)}`),
    );
    if (ig.reason) console.log(ansis.dim(sanitizeText(ig.reason)));
  }

  // CVE block: shown here only when there is no linked Codacy issue.
  // When there IS a linked issue, cveData is passed into printIssueCodeContext
  // and injected between the code context and the pattern documentation.
  if (cveData && !issue) {
    printCveBlock(cveData);
  }

  // Advisory block (vulnerable functions): shown here only when there is no linked
  // Codacy issue — when there IS one, printIssueCodeContext already renders the same
  // enrichment from issue.advisoryInformation. This covers SCA/dependency findings
  // (and any other non-Codacy-source finding), which have no linked issue at all.
  if (item.advisoryInformation && !issue) {
    printAdvisoryBlock(item.advisoryInformation);
  }

  // Optional prose fields
  if (item.summary) {
    console.log();
    console.log(sanitizeText(item.summary));
  }

  if (item.additionalInfo) {
    console.log();
    console.log(sanitizeText(item.additionalInfo));
  }

  if (item.remediation) {
    console.log();
    console.log(ansis.bold("Remediation:"));
    console.log(sanitizeText(item.remediation));
  }

  // Codacy source: show linked quality issue context + pattern info.
  // cveData is passed through so it can be injected between code context and pattern docs.
  if (issue) {
    printIssueCodeContext(issue, pattern, lines, cveData, item.fixedVersion);
  }
}

export function registerFindingCommand(program: Command) {
  program
    .command("finding")
    .alias("fin")
    .description("Show full details of a single security finding")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .argument(
      "<findingId>",
      "finding ID (shown at the end of each finding card)",
    )
    .option("-I, --ignore", "ignore this finding")
    .option(
      "-R, --ignore-reason <reason>",
      "reason for ignoring (AcceptedUse|FalsePositive|NotExploitable|TestCode|ExternalCode)",
      "AcceptedUse",
    )
    .option("-m, --ignore-comment <comment>", "optional comment for the ignore action", "")
    .option("-U, --unignore", "unignore this finding")
    .addOption(repositoryTokenOption())
    .addHelpText(
      "after",
      `
Examples:
  $ codacy finding gh my-org abc123-uuid
  $ codacy finding gh my-org abc123-uuid --output json
  $ codacy finding gh my-org abc123-uuid --ignore
  $ codacy finding gh my-org abc123-uuid --ignore --ignore-reason FalsePositive --ignore-comment "Verified safe"
  $ codacy finding gh my-org abc123-uuid --unignore`,
    )
    .action(async function (
      this: Command,
      provider: string,
      organization: string,
      findingId: string,
    ) {
      try {
        resolveAccountAuth(this, "Codacy does not accept repository tokens on the security findings endpoints");
        const format = getOutputFormat(this);
        const shouldIgnore: boolean = !!this.opts().ignore;
        const shouldUnignore: boolean = !!this.opts().unignore;
        const ignoreReason: string = this.opts().ignoreReason;
        const ignoreComment: string = this.opts().ignoreComment;
        const spinner = ora("Fetching finding details...").start();

        const findingResponse = await SecurityService.getSecurityItem(
          provider,
          organization,
          findingId,
        );
        const item = findingResponse.data;

        // Start CVE fetch immediately in parallel with the Codacy issue chain below
        const cvePromise = item.cve ? fetchCveData(item.cve) : Promise.resolve(null);

        // For Codacy-source findings, fetch the linked quality issue + pattern + file context
        let qualityIssue: CommitIssue | null = null;
        let pattern: Pattern | null = null;
        let fileLines: CodeBlockLine[] | null = null;

        if (item.itemSource === "Codacy" && item.repository && item.itemSourceId) {
          const resultDataId = parseInt(item.itemSourceId, 10);
          if (!isNaN(resultDataId)) {
            const issueResponse = await AnalysisService.getIssue(
              provider,
              organization,
              item.repository,
              resultDataId,
            ).catch(() => null);

            if (issueResponse) {
              qualityIssue = issueResponse.data;
              const lineNumber = qualityIssue.lineNumber;
              const startLine = Math.max(1, lineNumber - 5);
              const endLine = lineNumber + 5;

              const [patternResponse, fileContentResponse] = await Promise.all([
                ToolsService.getPattern(
                  qualityIssue.toolInfo.uuid,
                  qualityIssue.patternInfo.id,
                ).catch(() => null),
                FileService.getFileContent(
                  provider,
                  organization,
                  item.repository,
                  encodeURIComponent(qualityIssue.filePath),
                  startLine,
                  endLine,
                ).catch(() => null),
              ]);

              pattern = patternResponse?.data ?? null;
              fileLines = fileContentResponse?.data ?? null;
            }
          }
        }

        const cveData = await cvePromise;

        spinner.stop();

        if (format === "json") {
          printJson(pickDeep({ finding: item, issue: qualityIssue, pattern, lines: fileLines, cve: cveData }, [
            // Finding
            "finding.id",
            "finding.title",
            "finding.priority",
            "finding.securityCategory",
            "finding.scanType",
            "finding.likelihood",
            "finding.effortToFix",
            "finding.repository",
            "finding.status",
            "finding.dueAt",
            "finding.cve",
            "finding.cwe",
            "finding.affectedVersion",
            "finding.fixedVersion",
            "finding.application",
            "finding.affectedTargets",
            "finding.dependencyChains",
            "finding.ignored",
            "finding.summary",
            "finding.additionalInfo",
            "finding.remediation",
            "finding.itemSource",
            "finding.itemSourceId",
            "finding.advisoryInformation.advisoryId",
            "finding.advisoryInformation.vulnerableFunctions",
            "finding.advisoryInformation.publishedAt",
            // Issue (Codacy source)
            "issue.patternInfo.severityLevel",
            "issue.patternInfo.category",
            "issue.patternInfo.subCategory",
            "issue.patternInfo.id",
            "issue.message",
            "issue.filePath",
            "issue.lineNumber",
            "issue.lineText",
            "issue.suggestion",
            "issue.resultDataId",
            "issue.toolInfo.name",
            "issue.dependencyChains",
            // Pattern
            "pattern.id",
            "pattern.title",
            "pattern.description",
            "pattern.rationale",
            "pattern.solution",
            "pattern.tags",
            // Code lines
            "lines",
            // CVE
            "cve",
          ]));
          return;
        }

        if (!shouldIgnore && !shouldUnignore) {
          printFindingDetail(item, qualityIssue, pattern, fileLines, cveData);
        }

        if (shouldIgnore) {
          const ignoreSpinner = ora("Ignoring finding...").start();
          await SecurityService.ignoreSecurityItem(
            provider,
            organization,
            findingId,
            { reason: ignoreReason, comment: ignoreComment || undefined },
          );
          ignoreSpinner.succeed(
            `Finding ${findingId} ignored (reason: ${ignoreReason}).`,
          );
        }

        if (shouldUnignore) {
          const unignoreSpinner = ora("Unignoring finding...").start();
          await SecurityService.unignoreSecurityItem(
            provider,
            organization,
            findingId,
          );
          unignoreSpinner.succeed(`Finding ${findingId} unignored.`);
        }
      } catch (err) {
        handleError(err);
      }
    });
}
