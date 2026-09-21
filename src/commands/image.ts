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
import { formatCount } from "../utils/formatting";
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

export function registerImageCommand(program: Command) {
  program
    .command("image")
    .alias("img")
    .description("List an image's tags, or delete a tag or the whole image")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .argument("<image>", "Docker image name")
    .option(
      "-n, --limit <n>",
      `maximum number of tags to return (default: ${PAGE_SIZE}, max: ${MAX_LIMIT})`,
      String(PAGE_SIZE),
    )
    .option("-t, --delete-tag <tag>", "delete the SBOM for a single tag")
    .option("-D, --delete", "delete the image and all its SBOMs")
    .option("-y, --skip-confirmation", "skip the confirmation prompt")
    .addOption(repositoryTokenOption())
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli image gh my-org my-service
  $ codacy-cloud-cli image gh my-org my-service --limit 500
  $ codacy-cloud-cli image gh my-org my-service --delete-tag 1.2.3
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
        deleteTag?: string;
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

        // The two deletes have different blast radii, so silently letting one
        // win would be the worst outcome. Refuse instead.
        if (options.delete && options.deleteTag) {
          throw new Error(
            "--delete and --delete-tag cannot be combined. --delete removes the image and every tag; " +
              "--delete-tag <tag> removes a single tag.",
          );
        }

        if (options.deleteTag) {
          await deleteSingleTag(
            provider,
            organization,
            image,
            options.deleteTag,
            !!options.skipConfirmation,
            format === "json",
          );
          return;
        }

        if (options.delete) {
          await deleteWholeImage(
            provider,
            organization,
            image,
            !!options.skipConfirmation,
            format === "json",
          );
          return;
        }

        await listTags(provider, organization, image, options.limit, format);
      } catch (err) {
        handleError(err);
      }
    });
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

  let tags: ImageTagSummary[] = [];
  let cursor: string | undefined;
  let total: number | undefined;

  do {
    const response = await SbomService.listImageTags(
      provider,
      organization,
      image,
      cursor,
      Math.min(limit, PAGE_SIZE),
    );
    tags.push(...response.data);
    cursor = response.pagination?.cursor;
    total = response.pagination?.total ?? total;
  } while (cursor && tags.length < limit);

  if (tags.length > limit) tags = tags.slice(0, limit);

  spinner.stop();

  if (format === "json") {
    printJson(
      tags.map((tag) =>
        pickDeep(tag, [
          "imageName",
          "tag",
          "environment",
          "repositoryId",
          "repositoryName",
          "generatedAt",
          "uploadedAt",
          // `scanStatus` is deprecated in favour of `lastAnalysedAt`, so only
          // the replacement is projected.
          "lastAnalysedAt",
        ]),
      ),
    );
    return;
  }

  if (tags.length === 0) {
    console.log(
      ansis.dim(`\nNo tags found for ${sanitizeText(image)}.`),
    );
    return;
  }

  const tagTotal = total ?? tags.length;
  console.log(
    ansis.bold(
      `\nTags for ${sanitizeText(image)} in ${organization} (${provider}) — Found ${formatCount(tagTotal)} ${pluralize("tag", tagTotal)}\n`,
    ),
  );

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
      tag.environment ? sanitizeText(tag.environment) : ansis.dim("-"),
      tag.repositoryName ? sanitizeText(tag.repositoryName) : ansis.dim("-"),
      tag.generatedAt ? formatFriendlyDate(tag.generatedAt) : ansis.dim("-"),
      tag.uploadedAt ? formatFriendlyDate(tag.uploadedAt) : ansis.dim("-"),
      tag.lastAnalysedAt
        ? formatFriendlyDate(tag.lastAnalysedAt)
        : ansis.dim("-"),
    ]);
  }

  console.log(table.toString());
  console.log(
    ansis.dim(
      `\nDelete a tag with --delete-tag <tag>, or the whole image with --delete.`,
    ),
  );

  printPaginationWarning(
    cursor ? { cursor, limit: tags.length } : undefined,
    `Use --limit <n> (max ${MAX_LIMIT}) to fetch more.`,
  );
}

async function deleteSingleTag(
  provider: string,
  organization: string,
  image: string,
  tag: string,
  skipConfirmation: boolean,
  json: boolean,
): Promise<void> {
  const label = `${sanitizeText(image)}:${sanitizeText(tag)}`;

  if (!skipConfirmation) {
    console.log(ansis.yellow(METRICS_WIPE_NOTICE));
    const confirmed = await confirmAction(
      `Delete the SBOM for ${label}? This cannot be undone.`,
    );
    if (!confirmed) {
      console.log(ansis.dim(`Aborted — nothing was deleted. ${ABORT_HINT}`));
      return;
    }
  }

  const spinner = ora(`Deleting ${label}...`).start();
  await SbomService.deleteImageTag(provider, organization, image, tag);
  spinner.succeed(`Deleted the SBOM for ${label}.`);

  if (json) printJson({ imageName: image, tag, deleted: true });
}

async function deleteWholeImage(
  provider: string,
  organization: string,
  image: string,
  skipConfirmation: boolean,
  json: boolean,
): Promise<void> {
  const label = sanitizeText(image);

  if (!skipConfirmation) {
    // How many tags are about to go is the number that decides whether this is
    // routine cleanup or a mistake, so it is fetched before asking. `limit: 1`
    // is the cheapest shape that returns `pagination.total`; a lookup that
    // fails or omits the total must not block the delete, so the prompt just
    // drops the count.
    const countSpinner = ora("Counting tags...").start();
    let tagCount: number | undefined;
    try {
      const response = await SbomService.listImageTags(
        provider,
        organization,
        image,
        undefined, // cursor
        1,
      );
      tagCount = response.pagination?.total;
    } catch {
      tagCount = undefined;
    }
    countSpinner.stop();

    const scope =
      tagCount !== undefined
        ? `${label} and all ${formatCount(tagCount)} of its ${pluralize("tag", tagCount)}`
        : `${label} and all of its tags`;

    console.log(ansis.yellow(METRICS_WIPE_NOTICE));
    const confirmed = await confirmAction(
      `Delete ${scope}? This cannot be undone.`,
    );
    if (!confirmed) {
      console.log(ansis.dim(`Aborted — nothing was deleted. ${ABORT_HINT}`));
      return;
    }
  }

  const spinner = ora(`Deleting ${label}...`).start();
  await SbomService.deleteImageSboms(provider, organization, image);
  spinner.succeed(`Deleted ${label} and all of its SBOMs.`);

  if (json) printJson({ imageName: image, deleted: true });
}
