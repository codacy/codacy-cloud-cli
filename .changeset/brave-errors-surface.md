---
"@codacy/codacy-cloud-cli": patch
---

Show the error message Codacy actually returned instead of a generic status name. Failures that used to print `Error: Not Found` now print what went wrong — for example `Error: Could not find repository gh/my-org/my-repo (HTTP 404)`, `Error: Bad credentials (HTTP 401)`, or `Error: SBOM tag mismatch: expected 9.9.9, found 3.20 (HTTP 400)`. This affects every command. Where the API sends no explanation, the output is unchanged.
