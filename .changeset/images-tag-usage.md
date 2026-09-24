---
"@codacy/codacy-cloud-cli": minor
---

`images` now shows how many tags each image holds, and the organization's image tag usage against its limit. `--output json` includes `tagCount` per image. The `image --delete --keep-latest` warning now uses the organization's actual tag limit instead of assuming 1,000.
