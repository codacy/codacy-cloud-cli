---
"@codacy/codacy-cloud-cli": minor
---

Show the fixed version on SCA issues in `codacy issue`, `codacy issues` and `codacy pull-request --issue`: a direct dependency now reads `Direct - Update <pkg> to <version>` and a transitive one ends with `(Fixed in <version>)`, matching `codacy finding`/`codacy findings`. `--output json` gains `fixedVersion` on the issue payload.
