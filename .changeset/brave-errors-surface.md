---
"@codacy/codacy-cloud-cli": patch
---

Show the error message Codacy actually returned instead of a generic status name. Failures that used to print `Error: Not Found` now print what went wrong — for example `Error: Could not find repository gh/my-org/my-repo (HTTP 404)`, `Error: Bad credentials (HTTP 401)`, or `Error: SBOM tag mismatch: expected 9.9.9, found 3.20 (HTTP 400)`. This affects every command. Where the API sends no explanation, the output is unchanged.

Only a body that plausibly *is* a message is used: not every error response is JSON, so a proxy or load balancer answering with an HTML error page falls back to the status name (`Error: Bad Gateway`) rather than dumping the page into the terminal. The same applies to `image --delete --keep-latest`, whose per-tag failure list reported `Bad Request` for every failure because it formats errors at its own call site.
