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
import { sanitizeText } from "../utils/sanitize";
import { formatCount } from "../utils/formatting";
import { SbomService } from "../api/client/services/SbomService";
import type { ImageSummary } from "../api/client/models/ImageSummary";

/** Matches `findings` — the API's own page size, and its ceiling. */
const MAX_LIMIT = 1000;
const PAGE_SIZE = 100;

export function registerImagesCommand(program: Command) {
  program
    .command("images")
    .alias("imgs")
    .description("List Docker images with SBOMs uploaded to an organization")
    .argument("<provider>", "git provider (gh, gl, or bb)")
    .argument("<organization>", "organization name")
    .option(
      "-n, --limit <n>",
      `maximum number of images to return (default: ${PAGE_SIZE}, max: ${MAX_LIMIT})`,
      String(PAGE_SIZE),
    )
    .addOption(repositoryTokenOption())
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli images gh my-org
  $ codacy-cloud-cli images gh my-org --limit 500
  $ codacy-cloud-cli images gh my-org --output json`,
    )
    .action(async function (
      this: Command,
      provider: string,
      organization: string,
      options: { limit: string },
    ) {
      try {
        // Organization-level SBOM data: not on the repository-token whitelist
        // (see SPECS/repository-tokens.md), so refuse before any request.
        resolveAccountAuth(
          this,
          "it reads organization-level container image data (every image in the organization)",
        );
        await listImages(
          provider,
          organization,
          options.limit,
          getOutputFormat(this),
        );
      } catch (err) {
        handleError(err);
      }
    });
}

/**
 * Every image the organization has an SBOM for, following the cursor until
 * `limit` is reached. Mirrors `image`'s `fetchTags`: one request per page, and
 * the trim at the end is what keeps `--limit 150` from returning 200.
 */
async function fetchImages(
  provider: string,
  organization: string,
  limit: number,
): Promise<{ images: ImageSummary[]; cursor?: string; total?: number }> {
  let images: ImageSummary[] = [];
  let cursor: string | undefined;
  let total: number | undefined;

  do {
    const response = await SbomService.listOrganizationImages(
      provider,
      organization,
      cursor,
      Math.min(limit, PAGE_SIZE),
    );
    images.push(...response.data);
    cursor = response.pagination?.cursor;
    total = response.pagination?.total ?? total;
  } while (cursor && images.length < limit);

  if (images.length > limit) images = images.slice(0, limit);

  return { images, cursor, total };
}

function renderImagesTable(images: ImageSummary[]): string {
  // No tag count here: `ImageSummary` doesn't carry one, and deriving it
  // would mean one extra request per image. It is being added server-side
  // instead — see the pending task in SPECS/README.md. Until then, the
  // per-image tag count is what `codacy image <image>` shows.
  const table = createTable({
    head: ["Image", "Latest Tag", "Last Upload", "Last Generated"],
  });

  for (const image of images) {
    // Image and tag names are user-supplied (they arrive with the SBOM
    // upload) and reach the terminal — neutralize before styling.
    table.push([
      sanitizeText(image.imageName),
      image.latestTag ? sanitizeText(image.latestTag) : ansis.dim("-"),
      image.lastSbomUploaded
        ? formatFriendlyDate(image.lastSbomUploaded)
        : ansis.dim("-"),
      image.lastSbomGenerated
        ? formatFriendlyDate(image.lastSbomGenerated)
        : ansis.dim("-"),
    ]);
  }

  return table.toString();
}

async function listImages(
  provider: string,
  organization: string,
  limitOption: string,
  format: string,
): Promise<void> {
  const limit = Math.min(
    Math.max(parseInt(limitOption, 10) || PAGE_SIZE, 1),
    MAX_LIMIT,
  );

  const spinner = ora("Fetching images...").start();
  const { images, cursor, total } = await fetchImages(
    provider,
    organization,
    limit,
  );
  spinner.stop();

  if (format === "json") {
    printJson(images.map(projectImage));
    return;
  }

  printImages(provider, organization, images, total);

  printPaginationWarning(
    cursor ? { cursor, limit: images.length } : undefined,
    `Use --limit <n> (max ${MAX_LIMIT}) to fetch more.`,
  );
}

function printImages(
  provider: string,
  organization: string,
  images: ImageSummary[],
  total: number | undefined,
): void {
  if (images.length === 0) {
    console.log(
      ansis.dim(
        "\nNo images found. Upload an SBOM for a Docker image to see it here.",
      ),
    );
    return;
  }

  const imageTotal = total ?? images.length;
  console.log(
    ansis.bold(
      `\nImages for ${organization} (${provider}) — Found ${formatCount(imageTotal)} ${pluralize("image", imageTotal)}\n`,
    ),
  );
  console.log(renderImagesTable(images));
  console.log(
    ansis.dim(
      `\nRun 'codacy image ${provider} ${organization} <image>' to list and delete an image's tags.`,
    ),
  );
}

/** The fields `--output json` promises, and only those. */
function projectImage(image: ImageSummary) {
  return pickDeep(image, [
    "imageName",
    "latestTag",
    "lastSbomUploaded",
    "lastSbomGenerated",
  ]);
}
