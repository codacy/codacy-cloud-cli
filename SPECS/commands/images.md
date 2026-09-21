# `images` / `image`

Status: ✅ Listing + deleting done — [OD-710](https://linear.app/codacy/issue/OD-710/cloud-cli-add-images-and-image-commands-for-listing-and-managing)

Container images with SBOMs uploaded to a Codacy organization, and the tags
under them. The reason these exist: an organization at the 1000-tag cap has no
realistic way to get back under it. The UI deletes one tag at a time, and
nothing in the CLI could even *see* which image was holding 85 stale tags.

This is the actionable half of the limit work — OD-692 tells a user they are at
the cap, these commands are what they use to do something about it.

## Scope of this PR, and what follows

Split into stacked PRs, because one piece is blocked on a backend fix:

| PR | Scope | State |
|---|---|---|
| 1 | `images` (list) and `image` (list tags, `--delete-tag`, `--delete`) | this one |
| 2 | `--upload` (`uploadImageSbom`) | follow-up |
| 3 | bulk cleanup — `--delete-tags --keep-latest <n>` | **blocked** |

**Why bulk cleanup is blocked.** Every single tag delete currently zero-fills
Container Scanning metrics for the *whole organization*, across every
repository, and self-heals only on the next nightly scan. A command that loops
over 80 tags fires that 80 times. Single-tag delete is safe to ship ahead of the
fix (Container Scanning Findings Integrity, milestone "Fix org-wide metrics wipe
on image tag deletion"); anything that deletes in a loop waits for it.

Until it lands, both deletes print a yellow notice above the confirmation
prompt saying the metrics will be zeroed and restored by the next nightly scan.
Remove that notice when the fix ships.

## API

All four operations already exist in the generated client
(`src/api/client/services/SbomService.ts`) — no `npm run update-api` was needed.

| operationId | Method | Endpoint |
|---|---|---|
| `listOrganizationImages` | GET | `/organizations/{provider}/{org}/images` |
| `listImageTags` | GET | `/organizations/{provider}/{org}/images/{imageName}/tags` |
| `deleteImageTag` | DELETE | `/organizations/{provider}/{org}/image-sboms/{imageName}/tags/{tag}` |
| `deleteImageSboms` | DELETE | `/organizations/{provider}/{org}/image-sboms/{imageName}` |

`uploadImageSbom` (POST `/image-sboms`, multipart) is left for PR 2.

## Tokens

**Account token only**, both commands, all modes. These are organization-level
SBOM operations and none of them is on the 14-operation repository-token
whitelist in [repository-tokens.md](../repository-tokens.md) — so both call
`resolveAccountAuth(this, …)` and refuse before any request. Covered by the
cross-cutting `repository-token-refusals.test.ts`, not per-command suites.

## `images <provider> <organization>` (alias `imgs`)

| Option | Description |
|---|---|
| `-n, --limit <n>` | max images to return (default 100, max 1000) |
| `-N, --no-tag-counts` | skip the per-image tag count |

Columns: Image, Tags, Latest Tag, Last Upload, Last Generated.

**The Tags column costs one request per image.** `ImageSummary` carries no tag
count, and the count is the whole point of the listing — "which image is holding
85 tags" is the question a user at the cap is asking. So it is read from
`listImageTags`'s `pagination.total` with `limit: 1`: the cheapest shape that
answers "how many" without pulling pages of tags nobody asked to see. The
fan-out is bounded at `TAG_COUNT_CONCURRENCY` (8), a failed or `total`-less
lookup renders as a dim `-` rather than taking the listing down with it, and
`-N, --no-tag-counts` opts out of it entirely.

JSON: `imageName`, `tagCount`, `latestTag`, `lastSbomUploaded`,
`lastSbomGenerated` (`pickDeep` drops undefined, so `tagCount` is absent under
`--no-tag-counts`).

## `image <provider> <organization> <image>` (alias `img`)

| Option | Description |
|---|---|
| `-n, --limit <n>` | max tags to return (default 100, max 1000) |
| `-t, --delete-tag <tag>` | delete the SBOM for a single tag |
| `-D, --delete` | delete the image and all its SBOMs |
| `-y, --skip-confirmation` | skip the confirmation prompt |

Default mode lists tags: Tag, Environment, Repository, Generated, Uploaded,
Last Analysed. `scanStatus` is deprecated in favour of `lastAnalysedAt`, so only
the replacement is rendered and projected into JSON.

**`--delete` and `--delete-tag` cannot be combined.** They have different blast
radii, so letting one silently win would be the worst outcome; the command
throws before either is attempted.

**Confirmation.** Both deletes prompt via the shared `confirmAction`
(`utils/prompt.ts`) and proceed only on an explicit `y`; `-y` bypasses it for
CI. `confirmAction` returns `false` on a non-TTY, so a non-interactive run
without `-y` aborts rather than deleting by accident — same rule as
`issues --ignore`.

`--delete` fetches the tag count first (again `limit: 1`, for
`pagination.total`) so the prompt can name how many tags are about to go — the
number that decides whether this is routine cleanup or a mistake. A count
lookup that fails must not block the delete, so the prompt just drops the count
("all of its tags"). Under `-y` the lookup is skipped entirely.

## Sanitization

Image names, tags, environments and repository names all arrive with the SBOM
upload, so they are user-controlled and reach the terminal. Every one goes
through `sanitizeText()` before styling, per the CWE-150 rule in
`src/commands/AGENTS.md`.

## Tests

`images.test.ts` (9) + `image.test.ts` (14) + 2 refusal cases in
`repository-token-refusals.test.ts` = 25.
