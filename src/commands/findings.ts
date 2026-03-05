import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
import {
  getOutputFormat,
  pickDeep,
  printJson,
  printPaginationWarning,
} from "../utils/output";
import {
  printSection,
  colorPriority,
  colorStatus,
  formatDueDate,
} from "../utils/formatting";
import { SecurityService } from "../api/client/services/SecurityService";
import { SrmItem } from "../api/client/models/SrmItem";
import { SearchSRMItems } from "../api/client/models/SearchSRMItems";

const PRIORITY_ORDER: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

const PRIORITY_NORMALIZE: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const STATUS_NORMALIZE: Record<string, string> = {
  overdue: "Overdue",
  ontrack: "OnTrack",
  duesoon: "DueSoon",
  closedontime: "ClosedOnTime",
  closedlate: "ClosedLate",
  ignored: "Ignored",
};

/**
 * Valid scan type keys — must match the API enum exactly.
 * Normalized by stripping spaces/hyphens/underscores and lowercasing.
 */
const SCAN_TYPE_NORMALIZE: Record<string, string> = {
  sast: "SAST",
  secrets: "Secrets",
  sca: "SCA",
  cicd: "CICD",
  iac: "IaC",
  dast: "DAST",
  pentesting: "PenTesting",
  license: "License",
  cspm: "CSPM",
};

function normalizePriority(input: string): string {
  return PRIORITY_NORMALIZE[input.toLowerCase().trim()] ?? input;
}

function normalizeStatus(input: string): string {
  return STATUS_NORMALIZE[input.toLowerCase().replace(/[\s_-]/g, "")] ?? input;
}

function normalizeScanType(input: string): string {
  return (
    SCAN_TYPE_NORMALIZE[input.toLowerCase().replace(/[\s_-]/g, "")] ?? input
  );
}

function printFindingCard(item: SrmItem, showRepo: boolean): void {
  const separator = ansis.dim("─".repeat(40));
  const pipe = ` ${ansis.dim("|")} `;

  console.log();

  // Line 1: Priority | SecurityCategory ScanType | Likelihood EffortToFix | Repository
  const line1Parts: string[] = [colorPriority(item.priority)];

  const catParts = [item.securityCategory, ansis.dim(item.scanType)]
    .filter(Boolean)
    .join(" ");
  if (catParts) line1Parts.push(catParts);

  const penTestParts = [item.likelihood, item.effortToFix].filter(
    (v) => v && v !== "not_applicable",
  ) as string[];
  if (penTestParts.length > 0) line1Parts.push(penTestParts.join(" "));

  if (showRepo && item.repository) line1Parts.push(ansis.dim(item.repository));

  const idLabel = ansis.hex("#555555")(item.id);
  console.log(line1Parts.join(pipe) + `  ${idLabel}`);

  // Line 2: Title
  console.log(item.title);
  if (item.affectedTargets) console.log(ansis.dim(item.affectedTargets));
  console.log();

  // Line 3: Status DueAt | CVE/CWE | AffectedVersion → FixedVersion | Application | AffectedTargets
  const line3Parts: string[] = [
    `${colorStatus(item.status)} ${ansis.dim(formatDueDate(item.dueAt))}`,
  ];

  if (item.cve) line3Parts.push(ansis.dim(item.cve));
  else if (item.cwe) line3Parts.push(ansis.dim(`CWE-${item.cwe}`));

  if (item.affectedVersion) {
    const fixed =
      item.fixedVersion && item.fixedVersion.length > 0
        ? ` → ${item.fixedVersion.join(", ")}`
        : "";
    line3Parts.push(ansis.dim(`Update ${item.affectedVersion}${fixed}`));
  }

  if (item.application) line3Parts.push(ansis.dim(item.application));
  //if (item.affectedTargets) line3Parts.push(ansis.dim(item.affectedTargets));

  console.log(line3Parts.join(pipe));
  console.log();
  console.log(separator);
}

function printFindingsList(
  items: SrmItem[],
  total: number,
  showRepo: boolean,
): void {
  printSection("Findings", total, "finding");
  if (items.length === 0) {
    console.log(ansis.dim("  No findings."));
    return;
  }
  for (const item of items) {
    printFindingCard(item, showRepo);
  }
}

function parseCommaList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function registerFindingsCommand(program: Command) {
  program
    .command("findings")
    .alias("find")
    .description("Show security findings for a repository or an organization")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .argument(
      "[repository]",
      "repository name (omit to show organization-wide findings)",
    )
    .option("-q, --search <text>", "search term to filter findings")
    .option(
      "-s, --severities <severities>",
      "comma-separated severity levels (case-insensitive): Critical, High, Medium, Low",
    )
    .option(
      "-S, --statuses <statuses>",
      "comma-separated statuses (case-insensitive): Overdue, OnTrack, DueSoon, ClosedOnTime, ClosedLate, Ignored (default: Overdue,OnTrack,DueSoon)",
    )
    .option(
      "-c, --categories <categories>",
      "comma-separated security category names (case-sensitive)",
    )
    .option(
      "-T, --scan-types <types>",
      "comma-separated scan types (case-insensitive): SAST, Secrets, SCA, CICD, IaC, DAST, PenTesting, License, CSPM",
    )
    .option("-d, --dast-targets <urls>", "comma-separated DAST target URLs")
    .addHelpText(
      "after",
      `
Examples:
  $ codacy findings gh my-org my-repo
  $ codacy findings gh my-org
  $ codacy findings gh my-org --severities Critical,High
  $ codacy findings gh my-org my-repo --statuses Overdue,DueSoon
  $ codacy findings gh my-org my-repo --output json`,
    )
    .action(async function (
      this: Command,
      provider: string,
      organization: string,
      repository: string | undefined,
    ) {
      try {
        checkApiToken();
        const opts = this.opts();
        const format = getOutputFormat(this);

        const body: SearchSRMItems = {};
        if (repository) body.repositories = [repository];
        if (opts.search) body.searchText = opts.search;
        const severities = parseCommaList(opts.severities);
        if (severities) body.priorities = severities.map(normalizePriority);
        const statuses = parseCommaList(opts.statuses);
        body.statuses = statuses
          ? statuses.map(normalizeStatus)
          : ["Overdue", "OnTrack", "DueSoon"];
        const categories = parseCommaList(opts.categories);
        if (categories) body.categories = categories;
        const scanTypes = parseCommaList(opts.scanTypes);
        if (scanTypes) body.scanTypes = scanTypes.map(normalizeScanType);
        const dastTargets = parseCommaList(opts.dastTargets);
        if (dastTargets) body.dastTargetUrls = dastTargets;

        const spinner = ora(
          repository
            ? "Fetching findings..."
            : "Fetching organization findings...",
        ).start();

        const response = await SecurityService.searchSecurityItems(
          provider,
          organization,
          undefined,
          100,
          "Status", // actually sorting by due date
          "asc",
          body,
        );
        spinner.stop();

        const items = response.data;
        const total = response.pagination?.total ?? items.length;

        if (format === "json") {
          printJson({
            findings: items.map((item: any) => pickDeep(item, [
              "id",
              "title",
              "priority",
              "securityCategory",
              "scanType",
              "likelihood",
              "effortToFix",
              "repository",
              "status",
              "dueAt",
              "cve",
              "cwe",
              "affectedVersion",
              "fixedVersion",
              "application",
              "affectedTargets",
            ])),
            total,
          });
          return;
        }

        // Show repository column only when browsing org-wide (no repo filter)
        printFindingsList(items, total, !repository);
        printPaginationWarning(
          response.pagination,
          "Use --severities or --statuses to filter findings.",
        );
      } catch (err) {
        handleError(err);
      }
    });
}
