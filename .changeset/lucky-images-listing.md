---
"@codacy/codacy-cloud-cli": minor
---

Add `images` and `image` commands for container images with SBOMs uploaded to an organization.

`codacy images <provider> <org>` lists images with their latest tag and last upload/generation dates.

`codacy image <provider> <org> <image>` lists that image's tags (environment, repository, generated/uploaded/last-analysed dates), shows a single one with `-t, --tag <tag>`, and deletes with `-D, --delete` — the whole image on its own, or just one tag when combined with `--tag`. Under `--output json` a declined confirmation reports itself as `{"deleted": false, "aborted": true}` rather than a prose line, so stdout stays parseable. Deletes confirm first (`-y, --skip-confirmation` bypasses it for CI) and warn that deleting SBOM data temporarily zeroes Container Scanning metrics for the whole organization until the next nightly scan.

Both commands require an account API token.
