---
"@codacy/codacy-cloud-cli": minor
---

Add `codacy image <provider> <org> <image> --tag <tag> --upload <file>` to upload an SBOM (SPDX or CycloneDX) for a container image tag.

`-e, --environment <name>` and `-r, --repository <name>` optionally record where the image is deployed and which repository it belongs to. The file is checked before the request, so a wrong path or an empty file fails immediately.
