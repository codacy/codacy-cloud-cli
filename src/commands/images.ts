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

/**
 * How many tag-count lookups run at once. The listing itself is one request,
 * but the count is one extra request *per image* (see `fetchTagCounts`), so an
 * organization near the 1000-tag cap can easily have dozens. Bounded so the
 * command never opens an unbounded fan-out against the API.
 */
const TAG_COUNT_CONCURRENCY = 8;

/** Matches `findings` — the API's own page size, and its ceiling. */
const MAX_LIMIT = 1000;
const PAGE_SIZE = 100;

export type ImageRow = ImageSummary & { tagCount?: number };

/**
 * Number of tags per image.
 *
 * `ImageSummary` carries no tag count, and the count is the whole point of this
 * listing: the case this command exists for is an organization at the 1000-tag
 * cap trying to find *which* image is holding 85 stale tags. So it is read from
 * `listImageTags`'s `pagination.total` with `limit: 1` — the cheapest shape that
 * answers "how many", one small request per image rather than pulling pages of
 * tags nobody asked to see.
 *
 * A failed or `total`-less lookup resolves to `undefined` rather than throwing:
 * a missing count renders as a dim `-` and the rest of the row is still worth
 * showing. `-N, --no-tag-counts` skips the fan-out entirely.
 */
async function fetchTagCounts(
  provider: string,
  organization: string,
  images: ImageSummary[],
): Promise<Array<number | undefined>> {
  const counts: Array<number | undefined> = new Array(images.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < images.length) {
      const index = next++;
      try {
        const response = await SbomService.listImageTags(
          provider,
          organization,
          images[index].imageName,
          undefined, // cursor
          1,
        );
        counts[index] = response.pagination?.total;
      } catch {
        counts[index] = undefined;
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(TAG_COUNT_CONCURRENCY, images.length) },
      worker,
    ),
  );

  return counts;
}

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
    .option(
      "-N, --no-tag-counts",
      "skip the per-image tag count (one extra request per image)",
    )
    .addOption(repositoryTokenOption())
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli images gh my-org
  $ codacy-cloud-cli images gh my-org --limit 500
  $ codacy-cloud-cli images gh my-org --no-tag-counts
  $ codacy-cloud-cli images gh my-org --output json`,
    )
    .action(async function (
      this: Command,
      provider: string,
      organization: string,
      options: { limit: string; tagCounts: boolean },
    ) {
      try {
        // Organization-level SBOM data: not on the repository-token whitelist
        // (see SPECS/repository-tokens.md), so refuse before any request.
        resolveAccountAuth(
          this,
          "it reads organization-level container image data (every image in the organization)",
        );
        const format = getOutputFormat(this);
        const limit = Math.min(
          Math.max(parseInt(options.limit, 10) || PAGE_SIZE, 1),
          MAX_LIMIT,
        );

        const spinner = ora("Fetching images...").start();

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

        let counts: Array<number | undefined> = [];
        if (options.tagCounts && images.length > 0) {
          spinner.text = "Counting tags...";
          counts = await fetchTagCounts(provider, organization, images);
        }

        spinner.stop();

        const rows: ImageRow[] = images.map((image, i) => ({
          ...image,
          tagCount: counts[i],
        }));

        if (format === "json") {
          printJson(
            rows.map((row) =>
              pickDeep(row, [
                "imageName",
                "tagCount",
                "latestTag",
                "lastSbomUploaded",
                "lastSbomGenerated",
              ]),
            ),
          );
          return;
        }

        if (rows.length === 0) {
          console.log(
            ansis.dim(
              "\nNo images found. Upload an SBOM for a Docker image to see it here.",
            ),
          );
          return;
        }

        const imageTotal = total ?? rows.length;
        console.log(
          ansis.bold(
            `\nImages for ${organization} (${provider}) — Found ${formatCount(imageTotal)} ${pluralize("image", imageTotal)}\n`,
          ),
        );

        const head = ["Image"];
        if (options.tagCounts) head.push("Tags");
        head.push("Latest Tag", "Last Upload", "Last Generated");
        const table = createTable({ head });

        for (const row of rows) {
          // Image and tag names are user-supplied (they arrive with the SBOM
          // upload) and reach the terminal — neutralize before styling.
          const cells: string[] = [sanitizeText(row.imageName)];
          if (options.tagCounts) {
            cells.push(
              row.tagCount !== undefined
                ? String(row.tagCount)
                : ansis.dim("-"),
            );
          }
          cells.push(
            row.latestTag ? sanitizeText(row.latestTag) : ansis.dim("-"),
            row.lastSbomUploaded
              ? formatFriendlyDate(row.lastSbomUploaded)
              : ansis.dim("-"),
            row.lastSbomGenerated
              ? formatFriendlyDate(row.lastSbomGenerated)
              : ansis.dim("-"),
          );
          table.push(cells);
        }

        console.log(table.toString());

        console.log(
          ansis.dim(
            `\nRun 'codacy image ${provider} ${organization} <image>' to list and delete an image's tags.`,
          ),
        );

        printPaginationWarning(
          cursor ? { cursor, limit: rows.length } : undefined,
          `Use --limit <n> (max ${MAX_LIMIT}) to fetch more.`,
        );
      } catch (err) {
        handleError(err);
      }
    });
}
