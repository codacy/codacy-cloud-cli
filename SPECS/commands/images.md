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
| 1 | `images` (list) and `image` (list tags, show a tag, `--delete` scoped by `--tag`) | this one |
| 2 | `--upload` (`uploadImageSbom`) | follow-up |
| 3 | bulk cleanup — `--delete --keep-latest <n>` | **blocked** |

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

Columns: Image, Latest Tag, Last Upload, Last Generated. JSON projects the same
four fields.

**No tag count here, deliberately.** It is the number an org at the cap actually
wants — "which image is holding 85 tags" — but `ImageSummary` doesn't carry one,
and deriving it client-side costs one extra request per image. It is being added
to the endpoint server-side instead (pending task in `SPECS/README.md`); when it
lands it becomes a column with no extra call. Until then the per-image count is
what `codacy image <image>` shows. Do not reintroduce a fan-out here.

## `image <provider> <organization> <image>` (alias `img`)

| Option | Description |
|---|---|
| `-t, --tag <tag>` | act on a single tag instead of the whole image |
| `-n, --limit <n>` | max tags to return (default 100, max 1000) |
| `-D, --delete` | delete the image's SBOMs, or just `--tag`'s |
| `-y, --skip-confirmation` | skip the confirmation prompt |

**`--delete` is the action, `--tag` is the scope** — the same split
`issues --ignore` makes with its filters, where the flag that narrows what is
acted on is the same flag that narrows what is shown. There is no
`--delete-tag <tag>`: a second delete flag would mean two verbs whose blast radii
differ, and the only way to make that safe is a mutual-exclusion error the user
has to learn. Three modes fall out of the one flag:

| Invocation | Result |
|---|---|
| (neither) | list every tag |
| `--tag <tag>` | show that one tag's details |
| `--delete` | delete the image and every SBOM under it |
| `--tag <tag> --delete` | delete that tag's SBOM |

List mode columns: Tag, Environment, Repository, Generated, Uploaded, Last
Analysed. `scanStatus` is deprecated in favour of `lastAnalysedAt`, so only the
replacement is rendered and projected.

**The single-tag lookup pages.** The tags endpoint has no per-tag filter, so
`--tag` (without `--delete`) pages the whole listing and matches exactly — the
shape `pull-request --issue <id>` already uses to resolve a single item — and
errors naming the tag when there is no match. JSON emits one object, not an
array. `--tag --delete` skips the lookup entirely and deletes straight away; the
API 404s on a tag that isn't there, which is the same answer at a lower cost.

**`--output json` owns stdout.** The metrics-wipe notice goes to stderr and a
declined confirmation reports itself as `{deleted: false, aborted: true}`, so
stdout carries exactly one JSON document and a pipeline reading it never has to
skip prose.

**Confirmation.** Both delete scopes prompt via the shared `confirmAction`
(`utils/prompt.ts`) and proceed only on an explicit `y`; `-y` bypasses it for CI.
`confirmAction` returns `false` on a non-TTY, so a non-interactive run without
`-y` aborts rather than deleting by accident — same rule as `issues --ignore`.

A whole-image `--delete` fetches the tag count first (`limit: 1`, for
`pagination.total`) so the prompt can name how many tags are about to go — the
number that decides whether this is routine cleanup or a mistake. A count lookup
that fails must not block the delete, so the prompt falls back to "all of its
tags". Under `-y` the lookup is skipped entirely.

## Sanitization

Image names, tags, environments and repository names all arrive with the SBOM
upload, so they are user-controlled and reach the terminal. Every one goes
through `sanitizeText()` before styling, per the CWE-150 rule in
`src/commands/AGENTS.md`.

## Tests

`images.test.ts` (8) + `image.test.ts` (16) + 2 refusal cases in
`repository-token-refusals.test.ts` = 26.
