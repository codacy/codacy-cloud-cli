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
| 1 | `images` (list) and `image` (list tags, show a tag, `--delete` scoped by `--tag`) | done |
| 2 | `--upload` (`uploadImageSbom`) | done |
| 3 | bulk cleanup — `--delete --keep-latest <n>` | this one |

**The bulk-cleanup blocker is resolved (2026-09-21).** Every tag delete used to
zero-fill Container Scanning metrics for the *whole organization* until the next
nightly scan, which is why `--keep-latest` — a delete loop — was held back while
single-tag and whole-image delete shipped in PR 1. The backend fix
([Fix org-wide metrics wipe on image tag deletion](https://linear.app/codacy/project/fix-org-wide-metrics-wipe-on-image-tag-deletion-197476700869/overview))
is done, so the loop is safe and the warning notice that used to sit above every
delete confirmation is gone. Deletes are still sequential, for the reasons in
`deleteTagsInSequence`, but no longer because of this.

## API

All four operations already exist in the generated client
(`src/api/client/services/SbomService.ts`) — no `npm run update-api` was needed.

| operationId | Method | Endpoint |
|---|---|---|
| `listOrganizationImages` | GET | `/organizations/{provider}/{org}/images` |
| `listImageTags` | GET | `/organizations/{provider}/{org}/images/{imageName}/tags` |
| `deleteImageTag` | DELETE | `/organizations/{provider}/{org}/image-sboms/{imageName}/tags/{tag}` |
| `deleteImageSboms` | DELETE | `/organizations/{provider}/{org}/image-sboms/{imageName}` |

| `uploadImageSbom` | POST | `/organizations/{provider}/{org}/image-sboms` (multipart) |

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
| `-u, --upload <file>` | upload an SBOM file (SPDX or CycloneDX) for `--tag` |
| `-e, --environment <name>` | environment the image is deployed to (with `--upload`) |
| `-r, --repository <name>` | repository to associate the upload with |
| `-D, --delete` | delete the image's SBOMs, or just `--tag`'s |
| `-k, --keep-latest <n>` | with `--delete`: keep the n most recently uploaded tags, delete the rest |
| `--dry-run` | with `--delete`: show what would be deleted, delete nothing |
| `-y, --skip-confirmation` | skip the confirmation prompt |

**`--delete` is the action, `--tag` is the scope** — the same split
`issues --ignore` makes with its filters, where the flag that narrows what is
acted on is the same flag that narrows what is shown. There is no
`--delete-tag <tag>`: a second delete flag would mean two verbs whose blast radii
differ, and the only way to make that safe is a mutual-exclusion error the user
has to learn. Three modes fall out of the one flag:

| Invocation | Result |
|---|---|
| (no action) | list every tag |
| `--tag <tag>` | show that one tag's details |
| `--tag <tag> --upload <file>` | upload an SBOM for that tag |
| `--delete` | delete the image and every SBOM under it |
| `--tag <tag> --delete` | delete that tag's SBOM |
| `--delete --keep-latest <n>` | delete every tag but the n most recently uploaded |

List mode columns: Tag, Environment, Repository, Generated, Uploaded, Last
Analysed. `scanStatus` is deprecated in favour of `lastAnalysedAt`, so only the
replacement is rendered and projected.

**The single-tag lookup pages.** The tags endpoint has no per-tag filter, so
`--tag` (without `--delete`) pages the whole listing and matches exactly — the
shape `pull-request --issue <id>` already uses to resolve a single item — and
errors naming the tag when there is no match. JSON emits one object, not an
array. `--tag --delete` skips the lookup entirely and deletes straight away; the
API 404s on a tag that isn't there, which is the same answer at a lower cost.

**`--output json` owns stdout.** A declined confirmation reports itself as
`{deleted: false, aborted: true}`, so stdout carries exactly one JSON document
and a pipeline reading it never has to skip prose.

**Confirmation.** Every delete scope prompts via the shared `confirmAction`
(`utils/prompt.ts`) and proceed only on an explicit `y`; `-y` bypasses it for CI.
`confirmAction` returns `false` on a non-TTY, so a non-interactive run without
`-y` aborts rather than deleting by accident — same rule as `issues --ignore`.

A whole-image `--delete` fetches the tag count first (`limit: 1`, for
`pagination.total`) so the prompt can name how many tags are about to go — the
number that decides whether this is routine cleanup or a mistake. A count lookup
that fails must not block the delete, so the prompt falls back to "all of its
tags". Under `-y` the lookup is skipped entirely.

### `--upload <file>`

Uploads an SBOM (SPDX or CycloneDX) for one image tag.

**`--tag` is required**, because the API's upload is keyed on image *and* tag —
there is no untagged SBOM to fall back to. Refused with a message naming the
flag, before the file is even read.

**The file is validated locally first.** A missing/unreadable path and an empty
file both fail immediately with something actionable, rather than as a 400 from
the other side of the network.

**Sent as a `File`, not a bare `Blob`**, so the multipart part carries the real
filename — a `Blob` goes out as `filename="blob"`, which tells the server and
anyone reading a request log nothing. The generated client's `isBlob` accepts
both. The media type comes from the extension (`.json` → `application/json`,
`.xml` → `application/xml`, anything else → `application/octet-stream`, letting
the API decide rather than guessing wrong in the request).

`--environment` and `--repository` are optional passthroughs to the API's
`environment`/`repositoryName` fields, omitted from the form rather than sent as
undefined.

**`--upload` and `--delete` are refused together.** Unlike `--delete`'s two
scopes, these are two different verbs — asking for both says nothing coherent
about what should happen to the SBOM.

**Account token, even in CI.** `uploadImageSbom` is not on the repository-token
whitelist, which is awkward: uploading an SBOM from a pipeline is exactly where
a project token would be natural. Logged in
[missing-endpoints.md](../missing-endpoints.md) as a whitelist gap.

### `--delete --keep-latest <n>`

The release-pipeline cleanup step. Keeps the `n` most recently uploaded tags of
one image and deletes every older one.

**Why it is not `image delete-tags <image>`.** The project proposed that
(`container-tagging-guidance/AGENTS.md` §2, CLI-1) and marked it "Builder's
call". `--delete` is already the verb here and `--tag` already the scope, so
`--keep-latest` is one more scope — "all but the newest n" — rather than a
second command doing almost the same thing. It also spares this CLI its first
nested subcommand. The proposal's stated goal ("verb first, names what it
deletes") is met; the Figma snippet needs updating to match, which it needed
anyway (`research/setup-copy-and-snippet.md` §7 lists the verbless
`codacy image ${IMAGE_NAME} --keep-latest 19` as an outstanding defect).

**It runs first in the pipeline, before the upload** — forced by the backend:
`upsertImageTag` counts, tries an UPDATE and raises in one transaction, so
upload-then-delete *fails at the cap* and can strand an org there
(`setup-copy-and-snippet.md` §2). Three consequences for this command:

- **`n` is literal.** It counts the tags that exist when it runs, not after the
  upload that follows. Cleanup-first with `--keep-latest 10` therefore leaves 11
  tags — correct, and making `n` secretly mean `n-1` would be a number that
  doesn't match what the user typed.
- **"Nothing to delete" is success, not an error.** This runs on every release;
  an org under `n` is the common case.
- **A failed delete does not stop the loop.** Giving up at tag 3 of 80 leaves
  the org no better off and the next release hits the same wall, so every tag is
  attempted and the failures are listed. The exit code is still 1 — a partial
  cleanup is a real failure for the step that follows.

**Ordered by `uploadedAt`, not `generatedAt`.** "Latest" for a pipeline that
uploads per release means when Codacy received the SBOM; `generatedAt` is when
it was built, which can differ and is not what accumulates against the cap.

**Deletes run sequentially.** Not for latency — a cleanup run happens before the
upload, not in front of a waiting user — but because one request at a time is
what makes "deleted 77 of 80, here are the 3 that failed" straightforward to
report. (The original reason, the org-wide metrics wipe, is fixed.)

**`--dry-run` is long-only** — a deliberate exception to the "every option gets
a short flag" rule. Every free letter sits one shift-key from `-D, --delete`,
and the typo *that* produces is the destructive one.

#### The org-budget warning

The cap is organization-wide and counts image × tag rows; `--keep-latest` is per
image. So the safe ceiling is `cap ÷ images`, and `--keep-latest 10` — the
number in the Figma snippet — puts a 212-image org at 2,120 rows against a
1,000 cap, having apparently followed the instructions
(`research/per-image-tag-budget.md`).

That file's rule is: **never quote a constant `n` user-facing without the image
count beside it.** So this command reads the org's image count (one request,
`listOrganizationImages` with `limit: 1`, for `pagination.total`) and warns when
`n × images` exceeds the cap, naming the count and what the cap allows per
image.

It **warns, it does not refuse**, and it does not pick between the four options
that file leaves open — that design is unowned, and a CLI warning is the
smallest thing that honours the rule without pre-empting it.

`DEFAULT_ORG_TAG_CAP` is 1,000 but **the cap is configuration**
(`sbom.image.max-image-tags-per-org`, `reference.conf:115`; the test default is
100) and no endpoint exposes the value in force, so the copy says "default" and
admits the CLI cannot read it. If an endpoint ever returns it, read it instead.
A `--cap <n>` flag is the obvious escape hatch; not added because nobody asked
for it.

## Sanitization

Image names, tags, environments and repository names all arrive with the SBOM
upload, so they are user-controlled and reach the terminal. Every one goes
through `sanitizeText()` before styling, per the CWE-150 rule in
`src/commands/AGENTS.md`.

## Tests

`images.test.ts` (8) + `image.test.ts` (38) + 2 refusal cases in
`repository-token-refusals.test.ts` = 48.
