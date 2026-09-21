import { promises as fs } from "node:fs";
import path from "node:path";
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
    .description("List an image's tags, show one tag, or upload/delete SBOMs")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .argument("<image>", "Docker image name")
    .option("-t, --tag <tag>", "act on a single tag instead of the whole image")
    .option(
      "-n, --limit <n>",
      `maximum number of tags to return (default: ${PAGE_SIZE}, max: ${MAX_LIMIT})`,
      String(PAGE_SIZE),
    )
    .option(
      "-u, --upload <file>",
      "upload an SBOM file (SPDX or CycloneDX) for --tag",
    )
    .option("-e, --environment <name>", "environment the image is deployed to (with --upload)")
    .option("-r, --repository <name>", "repository to associate the upload with")
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
  $ codacy-cloud-cli image gh my-org my-service --tag 1.2.3 --upload ./sbom.json
  $ codacy-cloud-cli image gh my-org my-service --tag 1.2.3 --upload ./sbom.json --environment production --repository my-repo
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
        upload?: string;
        environment?: string;
        repository?: string;
        delete?: boolean;
        skipConfirmation?: boolean;
      },
    ) {
      try {
        // Organization-level SBOM data: not on the repository-token whitelist
        // (see SPECS/repository-tokens.md), so refuse before any request.
        resolveAccountAuth(
          this,
          "it reads, uploads and deletes organization-level container image data",
        );
        const format = getOutputFormat(this);

        // Two different verbs, unlike `--delete`'s two scopes: asking for both
        // in one invocation says nothing coherent about what should happen to
        // the SBOM, so it is refused rather than ordered.
        if (options.upload && options.delete) {
          throw new Error(
            "--upload and --delete cannot be combined: one adds an SBOM, the other removes it.",
          );
        }

        if (options.upload) {
          await executeUpload(provider, organization, image, options.upload, {
            tag: options.tag,
            environment: options.environment,
            repositoryName: options.repository,
            json: format === "json",
          });
          return;
        }

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
 * Media type for the multipart part, from the file's extension. SPDX and
 * CycloneDX both ship as JSON or XML, and nothing else is expected here — an
 * unrecognized extension falls back to `application/octet-stream` and lets the
 * API decide rather than guessing wrong in the request.
 */
function sbomContentType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".json":
      return "application/json";
    case ".xml":
      return "application/xml";
    default:
      return "application/octet-stream";
  }
}

/**
 * `--upload <file>`: push an SBOM for one image tag.
 *
 * The file is read and validated locally first, so a typo'd path or an empty
 * file fails immediately with something actionable instead of a 400 from the
 * other side of the network. `--tag` is required because the API's upload is
 * per image *and* tag; there is no "untagged" SBOM to fall back to.
 */
/**
 * The SBOM's multipart part, read and validated locally first — a typo'd path
 * or an empty file fails immediately with something actionable instead of a
 * 400 from the other side of the network.
 *
 * `File` rather than a bare `Blob` so the part carries the real filename — a
 * `Blob` is sent as `filename="blob"`, which tells the server (and anyone
 * reading a request log) nothing. The generated client's `isBlob` accepts both.
 */
async function readSbomFile(file: string): Promise<File> {
  let contents: Buffer;
  try {
    contents = await fs.readFile(file);
  } catch {
    throw new Error(`Could not read SBOM file '${file}'.`);
  }
  if (contents.length === 0) {
    throw new Error(`SBOM file '${file}' is empty.`);
  }

  return new File([contents], path.basename(file), {
    type: sbomContentType(file),
  });
}

async function executeUpload(
  provider: string,
  organization: string,
  image: string,
  file: string,
  opts: {
    tag?: string;
    environment?: string;
    repositoryName?: string;
    json: boolean;
  },
): Promise<void> {
  if (!opts.tag) {
    throw new Error(
      "--upload requires --tag <tag>: an SBOM is uploaded for one image tag.",
    );
  }

  const sbom = await readSbomFile(file);

  const label = `${sanitizeText(image)}:${sanitizeText(opts.tag)}`;
  const spinner = ora(`Uploading SBOM for ${label}...`).start();

  await SbomService.uploadImageSbom(provider, organization, {
    sbom,
    imageName: image,
    tag: opts.tag,
    ...(opts.repositoryName ? { repositoryName: opts.repositoryName } : {}),
    ...(opts.environment ? { environment: opts.environment } : {}),
  });

  // Every value echoed back here reaches the terminal, so each one is
  // neutralized — the filename as much as the image and tag, since all three
  // are strings this process was handed rather than strings it chose.
  spinner.succeed(
    `Uploaded ${sanitizeText(path.basename(file))} for ${label}.`,
  );

  if (opts.json) {
    printJson({
      imageName: image,
      tag: opts.tag,
      ...(opts.repositoryName ? { repositoryName: opts.repositoryName } : {}),
      ...(opts.environment ? { environment: opts.environment } : {}),
      uploaded: true,
    });
    return;
  }

  console.log(
    ansis.dim(
      `\nRun 'codacy image ${provider} ${organization} ${sanitizeText(image)} --tag ${sanitizeText(opts.tag)}' to see it.`,
    ),
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
