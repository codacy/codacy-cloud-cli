import { promises as fs } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import ora, { type Ora } from "ora";
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
 * The organization-wide image-tag cap this CLI assumes when warning about
 * `--keep-latest`. It is **configuration, not a constant**
 * (`sbom.image.max-image-tags-per-org`, `reference.conf:115`; the test default
 * is 100) and no API endpoint exposes the value in force, so the warning says
 * "default" rather than stating it as fact. If an endpoint ever returns it,
 * read it instead of this.
 */
const DEFAULT_ORG_TAG_CAP = 1000;

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
    .option(
      "-k, --keep-latest <n>",
      "with --delete: keep the n most recently uploaded tags, delete the rest",
    )
    // Deliberately long-only, a documented exception to the "every option gets
    // a short flag" rule in AGENTS.md: every free letter sits one shift-key
    // from `-D, --delete`, and the typo that produces is the destructive one.
    .option("--dry-run", "with --delete: show what would be deleted, delete nothing")
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
  $ codacy-cloud-cli image gh my-org my-service --delete --keep-latest 10 --dry-run
  $ codacy-cloud-cli image gh my-org my-service --delete --keep-latest 10 --skip-confirmation
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
        keepLatest?: string;
        dryRun?: boolean;
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
        rejectIncoherentOptions(options);

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
          if (options.keepLatest !== undefined) {
            await executeKeepLatest(provider, organization, image, {
              keepLatest: parseKeepLatest(options.keepLatest),
              dryRun: !!options.dryRun,
              skipConfirmation: !!options.skipConfirmation,
              json: format === "json",
            });
            return;
          }
          await executeDelete(
            provider,
            organization,
            image,
            options.tag,
            !!options.skipConfirmation,
            !!options.dryRun,
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
 * The flag combinations that say nothing coherent, refused before any request.
 *
 * Each is a pair the command could silently pick a winner from, and silently
 * picking is the failure mode worth avoiding here — the command deletes.
 */
function rejectIncoherentOptions(options: {
  tag?: string;
  upload?: string;
  delete?: boolean;
  keepLatest?: string;
  dryRun?: boolean;
}): void {
  // Two different verbs, unlike `--delete`'s two scopes: asking for both
  // in one invocation says nothing coherent about what should happen to
  // the SBOM, so it is refused rather than ordered.
  if (options.upload && options.delete) {
    throw new Error(
      "--upload and --delete cannot be combined: one adds an SBOM, the other removes it.",
    );
  }

  // `--keep-latest` and `--dry-run` narrow and preview a delete; neither
  // says anything on its own, so they are refused rather than ignored.
  if (!options.delete && (options.keepLatest !== undefined || options.dryRun)) {
    throw new Error(
      `${options.keepLatest !== undefined ? "--keep-latest" : "--dry-run"} only applies to --delete.`,
    );
  }

  // Two ways to say which tags to act on. `--tag` names one, and
  // `--keep-latest` names all but the newest n — asking for both says
  // nothing coherent about the scope.
  if (options.tag && options.keepLatest !== undefined) {
    throw new Error(
      "--tag and --keep-latest cannot be combined: --tag acts on one tag, --keep-latest on every tag but the newest n.",
    );
  }
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
 * `--keep-latest <n>`. Rejects anything that isn't a non-negative integer:
 * `--keep-latest 10.5` or `--keep-latest ten` silently coerced to something
 * would decide how many tags get deleted.
 */
function parseKeepLatest(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `--keep-latest expects a non-negative whole number, got '${value}'.`,
    );
  }
  return n;
}

/**
 * How many images the organization holds, or `undefined` when the lookup fails.
 *
 * Only used to qualify `--keep-latest`: the cap is organization-wide and counts
 * image x tag rows, while this flag is per image, so `n` is only safe as
 * `cap / images`. `--keep-latest 10` is under the cap for a 7-image org and
 * more than double it for a 212-image one. One request (`limit: 1`, for
 * `pagination.total`), never a fan-out.
 */
async function fetchImageCount(
  provider: string,
  organization: string,
): Promise<number | undefined> {
  try {
    const response = await SbomService.listOrganizationImages(
      provider,
      organization,
      undefined, // cursor
      1,
    );
    return response.pagination?.total;
  } catch {
    return undefined;
  }
}

/**
 * The warning that stops `--keep-latest <n>` being read as safe on its own.
 *
 * Project rule (`per-image-tag-budget.md`): never put a constant `n` in front
 * of a user without the image count beside it. This is the smallest thing that
 * honours it — it warns, it does not refuse, and it does not pick between the
 * four options that file leaves open.
 */
function orgBudgetWarning(
  keepLatest: number,
  imageCount: number | undefined,
): string | undefined {
  if (imageCount === undefined || imageCount === 0) return undefined;
  const projected = keepLatest * imageCount;
  if (projected <= DEFAULT_ORG_TAG_CAP) return undefined;

  const safePerImage = Math.floor(DEFAULT_ORG_TAG_CAP / imageCount);
  // Exact numbers, not `formatCount`: its abbreviation turns the cap everyone
  // quotes into "1k" and the projection into "2.1k", which is the wrong
  // register for the two figures the reader is being asked to compare.
  const exact = (n: number) => n.toLocaleString("en-US");
  return (
    `Warning: this organization has ${exact(imageCount)} ${pluralize("image", imageCount)}. ` +
    `Keeping ${exact(keepLatest)} tags on each holds ${exact(projected)} image tags, ` +
    `above the default organization cap of ${exact(DEFAULT_ORG_TAG_CAP)} — past which new tags are ` +
    `rejected and those images stop being scanned. ` +
    `At this image count the cap allows ${exact(safePerImage)} per image. ` +
    `(The cap is configurable; this CLI cannot read the value in force.)`
  );
}

/**
 * `--delete --keep-latest <n>`: keep the n most recently uploaded tags of an
 * image and delete every older one. The cleanup step of a release pipeline,
 * which is why it runs to completion rather than stopping at the first failure,
 * and why `--dry-run` exists.
 *
 * `n` is literal — it counts the tags that exist when the command runs, not
 * after the upload that follows it. Making it secretly mean n-1 would be a
 * number that doesn't match what the user typed.
 */
type KeepLatestPlan = {
  tags: ImageTagSummary[];
  kept: ImageTagSummary[];
  doomed: ImageTagSummary[];
  imageCount: number | undefined;
  budgetWarning: string | undefined;
};

/**
 * What `--keep-latest <n>` would do, decided before anything is printed or
 * deleted — so the JSON path, the table path and the dry run all work from one
 * answer rather than each recomputing it.
 */
async function planKeepLatest(
  provider: string,
  organization: string,
  image: string,
  keepLatest: number,
): Promise<KeepLatestPlan> {
  const spinner = ora(`Fetching tags for ${sanitizeText(image)}...`).start();
  // Every page: a tag on page 3 is just as deletable as one on page 1, and a
  // partial view would silently keep tags the user asked to remove.
  const { tags } = await fetchTags(provider, organization, image);
  const imageCount = await fetchImageCount(provider, organization);
  spinner.stop();

  // Newest first. `uploadedAt` is when Codacy received the SBOM, which is what
  // "latest" means for a pipeline that uploads on every release — `generatedAt`
  // is when the SBOM was built, which can differ and is not what accumulates.
  const ordered = [...tags].sort(
    (a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt),
  );

  return {
    tags,
    kept: ordered.slice(0, keepLatest),
    doomed: ordered.slice(keepLatest),
    imageCount,
    budgetWarning: orgBudgetWarning(keepLatest, imageCount),
  };
}

/**
 * `--keep-latest` under `--output json`.
 *
 * The deletions run *before* anything is printed. Reporting the doomed tags as
 * `deleted` up front claimed successes that had not happened yet, and a later
 * partial failure then printed a second document — two JSON values on one
 * stdout, which no parser accepts. One document, after the fact.
 */
async function keepLatestAsJson(
  provider: string,
  organization: string,
  image: string,
  plan: KeepLatestPlan,
  opts: { keepLatest: number; dryRun: boolean },
): Promise<void> {
  const { kept, doomed, imageCount, budgetWarning } = plan;
  const outcome: DeletionOutcome =
    opts.dryRun || doomed.length === 0
      ? { deleted: [], failures: [] }
      : await deleteTagsInSequence(provider, organization, image, doomed, true);

  printJson({
    imageName: image,
    keepLatest: opts.keepLatest,
    dryRun: opts.dryRun,
    kept: kept.map((t) => t.tag),
    deleted: outcome.deleted,
    wouldDelete: opts.dryRun ? doomed.map((t) => t.tag) : undefined,
    ...(outcome.failures.length > 0 ? { failures: outcome.failures } : {}),
    ...(imageCount !== undefined ? { organizationImageCount: imageCount } : {}),
    ...(budgetWarning ? { warning: budgetWarning } : {}),
  });

  // Same contract as the table path: a partial cleanup is a real failure for
  // the caller, and `--output json` is the mode a release pipeline runs in —
  // the mode where a silent zero exit is most expensive.
  if (outcome.failures.length > 0) process.exitCode = 1;
}

/** The "what is about to happen" block: one sentence, then the keep/delete table. */
function printKeepLatestPlan(
  label: string,
  { tags, kept, doomed }: KeepLatestPlan,
  opts: { keepLatest: number; dryRun: boolean },
): void {
  console.log(
    `\n${opts.dryRun ? "Would delete" : "Deleting"} ${ansis.bold(String(doomed.length))} of ${formatCount(tags.length)} ${pluralize("tag", tags.length)} on ${label}, keeping the ${formatCount(opts.keepLatest)} most recently uploaded:\n`,
  );
  console.log(renderKeepLatestTable(kept, doomed));
}

function renderKeepLatestTable(
  kept: ImageTagSummary[],
  doomed: ImageTagSummary[],
): string {
  const table = createTable({ head: ["", "Tag", "Uploaded"] });
  for (const tag of kept) {
    table.push([ansis.green("keep"), sanitizeText(tag.tag), formatFriendlyDate(tag.uploadedAt)]);
  }
  for (const tag of doomed) {
    table.push([ansis.red("delete"), sanitizeText(tag.tag), formatFriendlyDate(tag.uploadedAt)]);
  }
  return table.toString();
}

async function executeKeepLatest(
  provider: string,
  organization: string,
  image: string,
  opts: {
    keepLatest: number;
    dryRun: boolean;
    skipConfirmation: boolean;
    json: boolean;
  },
): Promise<void> {
  const label = sanitizeText(image);
  const plan = await planKeepLatest(
    provider,
    organization,
    image,
    opts.keepLatest,
  );
  const { tags, doomed, budgetWarning } = plan;

  if (opts.json) {
    await keepLatestAsJson(provider, organization, image, plan, opts);
    return;
  }

  if (budgetWarning) console.log(ansis.yellow(`\n${budgetWarning}`));

  // Nothing to do is the common case in a pipeline that runs this every
  // release, so it exits cleanly rather than treating it as an error.
  if (doomed.length === 0) {
    console.log(
      ansis.green(
        `\n${label} has ${formatCount(tags.length)} ${pluralize("tag", tags.length)}, at or under the ${formatCount(opts.keepLatest)} to keep. Nothing to delete.`,
      ),
    );
    return;
  }

  printKeepLatestPlan(label, plan, opts);

  if (opts.dryRun) {
    console.log(
      ansis.dim("\nDry run — nothing was deleted. Drop --dry-run to apply."),
    );
    return;
  }

  if (!(await confirmKeepLatest(label, doomed.length, opts.skipConfirmation))) {
    return;
  }

  const outcome = await deleteTagsInSequence(
    provider,
    organization,
    image,
    doomed,
    false,
  );
  // A partial cleanup is a real failure for the caller: the pipeline step that
  // follows may still hit the cap.
  if (outcome.failures.length > 0) process.exitCode = 1;
}

/** Whether to go ahead, printing the abort line when the answer is no. */
async function confirmKeepLatest(
  label: string,
  count: number,
  skipConfirmation: boolean,
): Promise<boolean> {
  if (skipConfirmation) return true;

  const confirmed = await confirmAction(
    `Delete ${count} ${pluralize("tag", count)} from ${label}? This cannot be undone.`,
  );
  if (!confirmed) {
    console.log(ansis.dim(`Aborted — nothing was deleted. ${ABORT_HINT}`));
  }
  return confirmed;
}

/**
 * Delete tags one at a time, carrying on past a failure.
 *
 * Sequential rather than parallel. The original reason — each delete zero-filled
 * organization-wide Container Scanning metrics — is gone (fixed backend-side,
 * 2026-09-21), but the shape is kept: a cleanup run is not latency-sensitive, it
 * happens before the upload rather than in front of a waiting user, and one
 * request at a time is what makes "deleted 77 of 80, here are the 3 that failed"
 * straightforward to report. Carrying on past a failure is what makes the
 * command idempotent for a pipeline — a run that gives up at tag 3 of 80 leaves
 * the org no better off, and the next release hits the same wall.
 */
type DeletionOutcome = {
  deleted: string[];
  failures: Array<{ tag: string; reason: string }>;
};

async function deleteTagsInSequence(
  provider: string,
  organization: string,
  image: string,
  tags: ImageTagSummary[],
  json: boolean,
): Promise<DeletionOutcome> {
  const spinner = json
    ? undefined
    : ora(`Deleting 0/${tags.length} tags...`).start();
  const outcome: DeletionOutcome = { deleted: [], failures: [] };

  for (const [index, tag] of tags.entries()) {
    try {
      await SbomService.deleteImageTag(provider, organization, image, tag.tag);
      outcome.deleted.push(tag.tag);
    } catch (err) {
      outcome.failures.push({
        tag: tag.tag,
        reason: err instanceof Error ? err.message : "unknown error",
      });
    }
    if (spinner) spinner.text = `Deleting ${index + 1}/${tags.length} tags...`;
  }

  // Under `--output json` the caller owns stdout: it folds this outcome into
  // the single document it prints once every request has finished. Nothing is
  // reported here, because nothing here knows the run is over.
  if (spinner) reportDeletions(spinner, image, tags.length, outcome);

  return outcome;
}

function reportDeletions(
  spinner: Ora,
  image: string,
  attempted: number,
  { deleted, failures }: DeletionOutcome,
): void {
  if (failures.length === 0) {
    spinner.succeed(
      `Deleted ${ansis.bold(String(deleted.length))} ${pluralize("tag", deleted.length)} from ${sanitizeText(image)}.`,
    );
    return;
  }

  spinner.warn(
    `Deleted ${deleted.length} of ${attempted} ${pluralize("tag", attempted)}; ${failures.length} failed.`,
  );
  for (const failure of failures) {
    console.log(
      ansis.red(`  ${sanitizeText(failure.tag)}: ${sanitizeText(failure.reason)}`),
    );
  }
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
  dryRun: boolean,
  json: boolean,
): Promise<void> {
  const label = tag
    ? `${sanitizeText(image)}:${sanitizeText(tag)}`
    : sanitizeText(image);

  if (dryRun) {
    const scope = tag
      ? `the SBOM for ${label}`
      : `${label} and ${await describeTagCount(provider, organization, image)}`;
    if (json) {
      printJson({
        imageName: image,
        ...(tag ? { tag } : {}),
        dryRun: true,
        deleted: false,
      });
      return;
    }
    console.log(`\nWould delete ${scope}.`);
    console.log(
      ansis.dim("\nDry run — nothing was deleted. Drop --dry-run to apply."),
    );
    return;
  }

  if (!skipConfirmation) {
    const scope = tag
      ? `the SBOM for ${label}`
      : `${label} and ${await describeTagCount(provider, organization, image)}`;

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
