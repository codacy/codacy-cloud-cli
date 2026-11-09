---
"@codacy/codacy-cloud-cli": minor
---

`findings` can now narrow to container scanning: `--scan-types` accepts `ContainerSCA` (aliases `ContainerScanning` and `Container`), and the new `--image <name>` and `--image-tag <tag>` options filter findings to one container image. Container findings show their image as `name:tag` on each card and include `imageName`/`imageTag` in `--output json`.
