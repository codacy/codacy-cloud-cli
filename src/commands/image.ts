import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import pluralize from "pluralize";
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
import { confirmAction } from "../utils/prompt";
import { sanitizeText } from "../utils/sanitize";
import { formatCount, printSection } from "../utils/formatting";
import { SbomService } from "../api/client/services/SbomService";
import type { ImageTagSummary } from "../api/client/models/ImageTagSummary";

const MAX_LIMIT = 1000;
const PAGE_SIZE = 100;

/**
 * Printed before every delete confirmation.
 *
 * Deleting an image tag currently zero-fills Container Scanning metrics for the
 * *whole organization*, across every repository, until the next nightly scan
 * heals them. That is a surprising, org-wide side effect of what reads like a
 * per-image cleanup, so the user sees it before they answer — not afterwards in
 * a dashboard. (Tracked in "Fix org-wide metrics wipe on image tag deletion";
 * this notice comes out once that lands.)
 */
const METRICS_WIPE_NOTICE =
  "Note: deleting SBOM data temporarily zeroes Container Scanning metrics for the whole " +
  "organization. They are restored by the next nightly scan.";

const ABORT_HINT =
  "Pass --skip-confirmation (-y) to bypass this prompt in CI or scripts.";

const TAG_JSON_FIELDS = [
  "imageName",
  "tag",
  "environment",
  "repositoryId",
  "repositoryName",
  "generatedAt",
  "uploadedAt",
  // `scanStatus` is deprecated in favour of `lastAnalysedAt`, so only the
  // replacement is projected.
  "lastAnalysedAt",
];

export function registerImageCommand(program: Command) {
  program
    .command("image")
    .alias("img")
    .description("List an image's tags, show one tag, or delete them")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .argument("<image>", "Docker image name")
    .option("-t, --tag <tag>", "act on a single tag instead of the whole image")
    .option(
      "-n, --limit <n>",
      `maximum number of tags to return (default: ${PAGE_SIZE}, max: ${MAX_LIMIT})`,
      String(PAGE_SIZE),
    )
    .option("-D, --delete", "delete the image's SBOMs, or just --tag's")
    .option("-y, --skip-confirmation", "skip the confirmation prompt")
    .addOption(repositoryTokenOption())
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli image gh my-org my-service
  $ codacy-cloud-cli image gh my-org my-service --limit 500
  $ codacy-cloud-cli image gh my-org my-service --tag 1.2.3
  $ codacy-cloud-cli image gh my-org my-service --tag 1.2.3 --delete
  $ codacy-cloud-cli image gh my-org my-service --delete --skip-confirmation
  $ codacy-cloud-cli image gh my-org my-service --output json`,
    )
    .action(async function (
      this: Command,
      provider: string,
      organization: string,
      image: string,
      options: {
        limit: string;
        tag?: string;
        delete?: boolean;
        skipConfirmation?: boolean;
      },
    ) {
      try {
        // Organization-level SBOM data: not on the repository-token whitelist
        // (see SPECS/repository-tokens.md), so refuse before any request.
        resolveAccountAuth(
          this,
          "it reads and deletes organization-level container image data",
        );
        const format = getOutputFormat(this);

        // `--delete` is the action and `--tag` is the scope, the same split
        // `issues --ignore` makes with its filters: the flag that narrows what
        // is acted on is the same flag that narrows what is shown.
        if (options.delete) {
          await executeDelete(
            provider,
            organization,
            image,
            options.tag,
            !!options.skipConfirmation,
            format === "json",
          );
          return;
        }

        if (options.tag) {
          await showTag(provider, organization, image, options.tag, format);
          return;
        }

        await listTags(provider, organization, image, options.limit, format);
      } catch (err) {
        handleError(err);
      }
    });
}

/**
 * Every tag of an image, following the cursor until `limit` is reached (or to
 * the end when `limit` is omitted — what the single-tag lookup needs, since the
 * tag it wants may be on any page).
 */
async function fetchTagPage(
  provider: string,
  organization: string,
  image: string,
  cursor: string | undefined,
  limit: number | undefined,
): Promise<{ tags: ImageTagSummary[]; cursor?: string; total?: number }> {
  const response = await SbomService.listImageTags(
    provider,
    organization,
    image,
    cursor,
    limit ? Math.min(limit, PAGE_SIZE) : PAGE_SIZE,
  );
  return {
    tags: response.data,
    cursor: response.pagination?.cursor,
    total: response.pagination?.total,
  };
}

async function fetchTags(
  provider: string,
  organization: string,
  image: string,
  limit?: number,
): Promise<{ tags: ImageTagSummary[]; cursor?: string; total?: number }> {
  let tags: ImageTagSummary[] = [];
  let cursor: string | undefined;
  let total: number | undefined;

  do {
    const page = await fetchTagPage(provider, organization, image, cursor, limit);
    tags.push(...page.tags);
    cursor = page.cursor;
    total = page.total ?? total;
  } while (cursor && (limit === undefined || tags.length < limit));

  if (limit !== undefined && tags.length > limit) tags = tags.slice(0, limit);

  return { tags, cursor, total };
}

/** A dash rather than a blank cell, so an empty column still reads as a column. */
function orDash(value: string | undefined, render: (v: string) => string): string {
  return value ? render(value) : ansis.dim("-");
}

function renderTagsTable(tags: ImageTagSummary[]): string {
  const table = createTable({
    head: [
      "Tag",
      "Environment",
      "Repository",
      "Generated",
      "Uploaded",
      "Last Analysed",
    ],
  });

  for (const tag of tags) {
    // Tag, environment and repository names arrive with the SBOM upload and are
    // user-controlled — neutralize before styling.
    table.push([
      sanitizeText(tag.tag),
      orDash(tag.environment, sanitizeText),
      orDash(tag.repositoryName, sanitizeText),
      orDash(tag.generatedAt, formatFriendlyDate),
      orDash(tag.uploadedAt, formatFriendlyDate),
      orDash(tag.lastAnalysedAt, formatFriendlyDate),
    ]);
  }

  return table.toString();
}

async function listTags(
  provider: string,
  organization: string,
  image: string,
  limitOption: string,
  format: string,
): Promise<void> {
  const limit = Math.min(
    Math.max(parseInt(limitOption, 10) || PAGE_SIZE, 1),
    MAX_LIMIT,
  );

  const spinner = ora("Fetching image tags...").start();
  const { tags, cursor, total } = await fetchTags(
    provider,
    organization,
    image,
    limit,
  );
  spinner.stop();

  if (format === "json") {
    printJson(tags.map((tag) => pickDeep(tag, TAG_JSON_FIELDS)));
    return;
  }

  if (tags.length === 0) {
    console.log(ansis.dim(`\nNo tags found for ${sanitizeText(image)}.`));
    return;
  }

  const tagTotal = total ?? tags.length;
  console.log(
    ansis.bold(
      `\nTags for ${sanitizeText(image)} in ${organization} (${provider}) — Found ${formatCount(tagTotal)} ${pluralize("tag", tagTotal)}\n`,
    ),
  );

  console.log(renderTagsTable(tags));
  console.log(
    ansis.dim(
      `\nDelete one tag with --tag <tag> --delete, or every tag with --delete.`,
    ),
  );

  printPaginationWarning(
    cursor ? { cursor, limit: tags.length } : undefined,
    `Use --limit <n> (max ${MAX_LIMIT}) to fetch more.`,
  );
}

/**
 * One tag's details. The tags endpoint has no per-tag filter, so this pages
 * through the whole listing and matches exactly — the same shape
 * `pull-request --issue <id>` uses to resolve a single item.
 */
async function showTag(
  provider: string,
  organization: string,
  image: string,
  tag: string,
  format: string,
): Promise<void> {
  const spinner = ora(`Looking for tag ${sanitizeText(tag)}...`).start();
  const { tags } = await fetchTags(provider, organization, image);
  spinner.stop();

  const match = tags.find((t) => t.tag === tag);

  if (!match) {
    throw new Error(
      `Tag '${tag}' not found on image '${image}'. ` +
        `Run 'codacy image ${provider} ${organization} ${image}' to list its tags.`,
    );
  }

  if (format === "json") {
    printJson(pickDeep(match, TAG_JSON_FIELDS));
    return;
  }

  printSection(`${sanitizeText(image)}:${sanitizeText(match.tag)}`);

  const table = createTable();
  table.push(
    ["Environment", orDash(match.environment, sanitizeText)],
    ["Repository", orDash(match.repositoryName, sanitizeText)],
    ["Generated", orDash(match.generatedAt, formatFriendlyDate)],
    ["Uploaded", orDash(match.uploadedAt, formatFriendlyDate)],
    ["Last Analysed", orDash(match.lastAnalysedAt, formatFriendlyDate)],
  );
  console.log(table.toString());
  // `match.tag` came back from the API, so it is neutralized like every other
  // SBOM-supplied value reaching the terminal — not just the ones in the table.
  console.log(
    ansis.dim(`\nDelete this tag with --tag ${sanitizeText(match.tag)} --delete.`),
  );
}

/**
 * `--delete`, scoped by `--tag` when it is given: one tag's SBOM, or the image
 * and every SBOM under it.
 */
async function executeDelete(
  provider: string,
  organization: string,
  image: string,
  tag: string | undefined,
  skipConfirmation: boolean,
  json: boolean,
): Promise<void> {
  const label = tag
    ? `${sanitizeText(image)}:${sanitizeText(tag)}`
    : sanitizeText(image);

  if (!skipConfirmation) {
    const scope = tag
      ? `the SBOM for ${label}`
      : `${label} and ${await describeTagCount(provider, organization, image)}`;

    console.error(ansis.yellow(METRICS_WIPE_NOTICE));
    const confirmed = await confirmAction(
      `Delete ${scope}? This cannot be undone.`,
    );
    if (!confirmed) {
      // Under `--output json` stdout carries one JSON document and nothing
      // else, so the outcome is reported as that document rather than as a
      // prose line a parser would choke on.
      if (json) {
        printJson({
          imageName: image,
          ...(tag ? { tag } : {}),
          deleted: false,
          aborted: true,
        });
        return;
      }
      console.log(ansis.dim(`Aborted — nothing was deleted. ${ABORT_HINT}`));
      return;
    }
  }

  const spinner = ora(`Deleting ${label}...`).start();
  if (tag) {
    await SbomService.deleteImageTag(provider, organization, image, tag);
    spinner.succeed(`Deleted the SBOM for ${label}.`);
  } else {
    await SbomService.deleteImageSboms(provider, organization, image);
    spinner.succeed(`Deleted ${label} and all of its SBOMs.`);
  }

  if (json) printJson({ imageName: image, ...(tag ? { tag } : {}), deleted: true });
}

/**
 * How many tags a whole-image delete is about to take, for the prompt — the
 * number that decides whether this is routine cleanup or a mistake. `limit: 1`
 * is the cheapest shape that returns `pagination.total`; a lookup that fails or
 * omits the total must not block the delete, so it falls back to the vaguer
 * wording rather than throwing.
 */
async function describeTagCount(
  provider: string,
  organization: string,
  image: string,
): Promise<string> {
  const spinner = ora("Counting tags...").start();
  let count: number | undefined;
  try {
    const response = await SbomService.listImageTags(
      provider,
      organization,
      image,
      undefined, // cursor
      1,
    );
    count = response.pagination?.total;
  } catch {
    count = undefined;
  }
  spinner.stop();

  return count !== undefined
    ? `all ${formatCount(count)} of its ${pluralize("tag", count)}`
    : "all of its tags";
}
