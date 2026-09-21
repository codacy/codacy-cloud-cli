---
"@codacy/codacy-cloud-cli": minor
---

Add `codacy image <provider> <org> <image> --delete --keep-latest <n>` to clean up old image tags, keeping the n most recently uploaded and deleting the rest. Intended as the cleanup step of a release pipeline, which runs before the SBOM upload.

`--dry-run` shows exactly which tags would be kept and deleted without deleting anything.

Under `--output json` the command emits one object after every delete has been attempted: `deleted` lists the tags that actually went and `failures` the ones that did not, and the exit code is non-zero when there are any. Deletes run one at a time and continue past failures, so a partial cleanup still frees space; the exit code is non-zero if any tag failed.

Because the organization tag cap counts image-and-tag pairs while `--keep-latest` applies per image, the command warns when keeping n tags across every image in the organization would exceed the default 1,000-tag cap, and says what the cap allows per image instead.
