---
"@codacy/codacy-cloud-cli": patch
---

`codacy tools --import --force` no longer leaves enabled a tool that unlinking the coding standard switched on. Unlinking hands the repository's tools back to Codacy's defaults, which can enable tools the import's preview never saw (for example ESLint with its default patterns, TypeScript rules included, in a repository without TypeScript). The import now re-reads the repository's tools after unlinking and disables those as well, by the same rule as before: only tools the local `codacy-analysis` CLI supports, never cloud-only ones.
