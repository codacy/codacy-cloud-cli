---
"@codacy/codacy-cloud-cli": patch
---

Stored credentials now require the full 16-byte AES-GCM authentication tag. Previously a truncated tag (as short as 4 bytes) still verified, which weakened the integrity check on `~/.codacy/credentials`; existing credential files keep working because the CLI has always written full-length tags. Also tidies a handful of lint findings (unused imports, `??` over `||` for nullish defaults, typed `catch` parameters) and adds a `.codacy.yaml` so Codacy skips test files for ESLint and generated Markdown for markdownlint.
