---
"@codacy/codacy-cloud-cli": minor
---

Add `images` and `image` commands for container images with SBOMs uploaded to an organization.

`codacy images <provider> <org>` lists images with their tag count, latest tag, and last upload/generation dates — so an organization near the 1000-tag cap can see which image is holding the stale tags. `-N, --no-tag-counts` skips the per-image count lookup.

`codacy image <provider> <org> <image>` lists that image's tags (environment, repository, generated/uploaded/last-analysed), and deletes them: `-t, --delete-tag <tag>` for one tag, `-D, --delete` for the image and all its SBOMs. Both confirm first (`-y, --skip-confirmation` bypasses it for CI) and warn that deleting SBOM data temporarily zeroes Container Scanning metrics for the whole organization until the next nightly scan.

Both commands require an account API token.
