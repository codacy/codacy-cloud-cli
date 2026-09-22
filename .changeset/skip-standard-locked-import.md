---
"@codacy/codacy-cloud-cli": patch
---

`tools --import` no longer sends disables for tools and patterns enforced by a coding standard — it drops them from the import set up front (using `enabledBy` from the tools/patterns listings) instead of letting the server reject each one with a 409. These are now reported in a new `skipped[]` list, shown in the preview, the summary line, and `--output json`.
