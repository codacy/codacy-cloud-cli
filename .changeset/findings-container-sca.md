---
"@codacy/codacy-cloud-cli": minor
---

`findings` can now narrow to container scanning: `--scan-types` accepts `ContainerSCA` (aliases `ContainerScanning` and `Container`), and the new `--image <name>` (or `name:tag`) and `--image-tag <tag>` options filter findings to one container image. Container findings show their image as `name:tag` in place of the repository, on both `findings` cards and the `finding` detail view, and include `imageName`/`imageTag` in `--output json`.
