import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { repositoryTokenOption, resolveAccountAuth } from "../utils/auth";
import { handleError } from "../utils/error";
import { detectRepoContext } from "../utils/git-remote";
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
  formatVersionSegment,
  formatDependencyChainsLine,
  formatImageReference,
  summarizeFunctions,
} from "../utils/formatting";
import { sanitizeText } from "../utils/sanitize";
import { SecurityService } from "../api/client/services/SecurityService";
import { SrmItem } from "../api/client/models/SrmItem";
import { SearchSRMItems } from "../api/client/models/SearchSRMItems";
import { ContainerImageFilter } from "../api/client/models/ContainerImageFilter";

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
  // The API calls container image scanning "ContainerSCA"; the product UI
  // calls it "Container scanning", so both spellings (and plain "container")
  // map to the API value.
  containersca: "ContainerSCA",
  containerscanning: "ContainerSCA",
  container: "ContainerSCA",
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

// Line 1: Priority | SecurityCategory ScanType | Likelihood EffortToFix | Repository or Image
function buildFindingHeaderLine(item: SrmItem, showRepo: boolean): string {
  const pipe = ` ${ansis.dim("|")} `;
  const parts: string[] = [colorPriority(item.priority)];

  const catParts = [
    sanitizeText(item.securityCategory),
    item.scanType ? ansis.dim(sanitizeText(item.scanType)) : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  if (catParts) parts.push(catParts);

  const penTestParts = [item.likelihood, item.effortToFix].filter(
    (v) => v && v !== "not_applicable",
  ) as string[];
  if (penTestParts.length > 0) parts.push(penTestParts.join(" "));

  // A container scanning finding is about an image, not a repository, so its
  // image:tag takes the repository's slot. It is shown even in the
  // single-repository view (where the repository is hidden as redundant),
  // since the image is not implied by the command's arguments.
  const image = formatImageReference(item.imageName, item.imageTag);
  if (image) {
    parts.push(ansis.dim(sanitizeText(image)));
  } else if (showRepo && item.repository) {
    parts.push(ansis.dim(sanitizeText(item.repository)));
  }

  const idLabel = ansis.hex("#555555")(item.id);
  return parts.join(pipe) + `  ${idLabel}`;
}

// Line 3: Status DueAt | CVE/CWE | AffectedVersion → FixedVersion | Application
function buildFindingStatusLine(item: SrmItem, hasChains: boolean): string {
  const pipe = ` ${ansis.dim("|")} `;
  const parts: string[] = [
    `${colorStatus(item.status)} ${ansis.dim(formatDueDate(item.dueAt))}`,
  ];

  if (item.cve) parts.push(ansis.dim(item.cve));
  else if (item.cwe) parts.push(ansis.dim(`CWE-${item.cwe}`));

  // When dependency chains are present they carry the vulnerable package and
  // fixed version on their own line, so the redundant version segment is dropped.
  if (!hasChains) {
    const versionSegment = formatVersionSegment(
      item.affectedVersion,
      item.fixedVersion,
      { includeUpdatePrefix: true },
    );
    if (versionSegment) parts.push(ansis.dim(versionSegment));
  }

  if (item.application) parts.push(ansis.dim(sanitizeText(item.application)));

  return parts.join(pipe);
}

function printFindingCard(item: SrmItem, showRepo: boolean): void {
  const separator = ansis.dim("─".repeat(40));

  console.log();
  console.log(buildFindingHeaderLine(item, showRepo));

  // Line 2: Title
  console.log(sanitizeText(item.title));
  if (item.affectedTargets) console.log(ansis.dim(sanitizeText(item.affectedTargets)));
  console.log();

  const hasChains = !!item.dependencyChains?.length;
  console.log(buildFindingStatusLine(item, hasChains));

  // Line 4: dependency import chain (SCA findings with dependencyChains)
  if (hasChains) {
    const chainLine = formatDependencyChainsLine(
      item.dependencyChains,
      item.fixedVersion,
    );
    if (chainLine) console.log(ansis.dim(chainLine));
  }

  // Vulnerable functions (findings with an OSV-linked advisory), compact form
  if (item.advisoryInformation?.vulnerableFunctions?.length) {
    console.log(
      ansis.dim(`Vulnerable functions: ${summarizeFunctions(item.advisoryInformation.vulnerableFunctions)}`),
    );
  }

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

/**
 * Build the request's `containerImage` filter from `--image` / `--image-tag`,
 * or undefined when neither was given. Throws (before any request) on input
 * the API would mishandle silently:
 *
 * - An empty or whitespace-only value. A truthiness check would drop it, so
 *   `--image "$IMG"` with `IMG` unset would widen to every finding in the org.
 * - `--image-tag` without an image name: `ContainerImageFilter` requires `name`.
 * - A digest reference (`name@sha256:…`): the API filters by tag only.
 * - Two different tags, one in `--image name:tag` and one in `--image-tag`.
 *
 * `--image name:tag` is split, because the cards print the image in exactly
 * that form and copying it back is the natural next step; sent whole it would
 * match no image name. Only a colon after the last `/` starts a tag, so a
 * registry port (`registry:5000/app`) stays part of the name.
 */
export function parseImageFilter(
  image: string | undefined,
  imageTag: string | undefined,
): ContainerImageFilter | undefined {
  if (image === undefined && imageTag === undefined) return undefined;

  let name = image?.trim();
  let tag = imageTag?.trim();
  if (image !== undefined && !name) {
    throw new Error("--image needs an image name, but the value is empty.");
  }
  if (imageTag !== undefined && !tag) {
    throw new Error("--image-tag needs a tag, but the value is empty.");
  }
  if (!name) throw new Error("--image-tag requires --image <name>.");

  if (name.includes("@")) {
    throw new Error(
      `--image takes an image name or name:tag, not a digest reference (got "${name}").`,
    );
  }

  const colon = name.lastIndexOf(":");
  if (colon > name.lastIndexOf("/")) {
    const refTag = name.slice(colon + 1);
    name = name.slice(0, colon);
    if (!name || !refTag) {
      throw new Error(`--image expects name or name:tag (got "${image!.trim()}").`);
    }
    if (tag && tag !== refTag) {
      throw new Error(
        `--image ${name}:${refTag} and --image-tag ${tag} name different tags; give the tag once.`,
      );
    }
    tag = refTag;
  }

  return tag ? { name, tag } : { name };
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
    .argument("[provider]", "git provider (gh, gl, or bb) — auto-detected from git remote if omitted")
    .argument("[organization]", "organization name")
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
      "comma-separated scan types (case-insensitive): SAST, Secrets, SCA, ContainerSCA (aliases: ContainerScanning, Container), CICD, IaC, DAST, PenTesting, License, CSPM",
    )
    .option("-n, --limit <n>", "maximum number of findings to return (default: 100, max: 1000)", "100")
    .option("-d, --dast-targets <urls>", "comma-separated DAST target URLs")
    .option("-i, --image <name>", "container image name, or name:tag, e.g. nginx or nginx:1.25.3 (container scanning findings)")
    .option("-t, --image-tag <tag>", "container image tag, e.g. 1.25.3 (requires --image)")
    .addOption(repositoryTokenOption())
    .addHelpText(
      "after",
      `
Examples:
  $ codacy findings                                   # auto-detect from git remote
  $ codacy findings gh my-org my-repo
  $ codacy findings gh my-org                          # organization-wide findings
  $ codacy findings gh my-org --severities Critical,High
  $ codacy findings gh my-org my-repo --statuses Overdue,DueSoon
  $ codacy findings gh my-org --scan-types ContainerSCA   # container image findings only
  $ codacy findings gh my-org --image nginx --image-tag 1.25.3
  $ codacy findings gh my-org my-repo --limit 500
  $ codacy findings gh my-org my-repo --output json`,
    )
    .action(async function (
      this: Command,
      providerArg?: string,
      organizationArg?: string,
      repositoryArg?: string,
    ) {
      try {
        resolveAccountAuth(this, "Codacy does not accept repository tokens on the security findings endpoints");

        // Validated here, before git auto-detection or any request, so a bad
        // --image/--image-tag is refused rather than silently widening or
        // emptying the result. See parseImageFilter.
        const opts = this.opts();
        const containerImage = parseImageFilter(opts.image, opts.imageTag);

        const argCount = [providerArg, organizationArg, repositoryArg].filter(
          (v) => v !== undefined,
        ).length;
        let provider: string;
        let organization: string;
        let repository: string | undefined;

        if (argCount === 3) {
          provider = providerArg!;
          organization = organizationArg!;
          repository = repositoryArg;
        } else if (argCount === 2) {
          provider = providerArg!;
          organization = organizationArg!;
          repository = undefined;
        } else if (argCount === 0) {
          const ctx = detectRepoContext();
          console.error(
            ansis.dim(
              `  Using ${ctx.provider} / ${ctx.organization} / ${ctx.repository} (from git remote)`,
            ),
          );
          provider = ctx.provider;
          organization = ctx.organization;
          repository = ctx.repository;
        } else {
          throw new Error(
            "Ambiguous arguments for 'findings'. Expected 0, 2, or 3 positional arguments.\n\n" +
              "Usage:\n" +
              "  codacy findings                          (auto-detect from git remote)\n" +
              "  codacy findings <provider> <organization>                (organization-wide)\n" +
              "  codacy findings <provider> <organization> <repository>  (repo-specific)",
          );
        }

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
        // De-duplicated: several aliases map to the same API value (e.g.
        // ContainerScanning and ContainerSCA).
        if (scanTypes)
          body.scanTypes = [...new Set(scanTypes.map(normalizeScanType))];
        const dastTargets = parseCommaList(opts.dastTargets);
        if (dastTargets) body.dastTargetUrls = dastTargets;
        if (containerImage) body.containerImage = containerImage;

        const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 100, 1), 1000);

        const spinner = ora(
          repository
            ? "Fetching findings..."
            : "Fetching organization findings...",
        ).start();

        const pageSize = Math.min(limit, 100);
        let items: SrmItem[] = [];
        let cursor: string | undefined;
        let total: number | undefined;

        do {
          const response = await SecurityService.searchSecurityItems(
            provider,
            organization,
            cursor,
            pageSize,
            "Status", // actually sorting by due date
            "asc",
            body,
          );
          items = items.concat(response.data);
          total ??= response.pagination?.total;
          cursor = response.pagination?.cursor;
        } while (cursor && items.length < limit);

        // Trim to exact limit
        if (items.length > limit) items = items.slice(0, limit);
        total ??= items.length;
        spinner.stop();

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
              "imageName",
              "imageTag",
              "dependencyChains",
              "advisoryInformation.advisoryId",
              "advisoryInformation.vulnerableFunctions",
              "advisoryInformation.publishedAt",
            ])),
            total,
          });
          return;
        }

        // Show repository column only when browsing org-wide (no repo filter)
        printFindingsList(items, total, !repository);
        if (total > items.length || cursor) {
          printPaginationWarning(
            { cursor: "more", limit: items.length },
            "Use --limit <n> (max 1000) to fetch more, or --severities, --statuses, --image to filter.",
          );
        }
      } catch (err) {
        handleError(err);
      }
    });
}
