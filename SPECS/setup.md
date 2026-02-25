# Project Setup Spec

**Status:** ✅ Done (2026-02-17)

## Test Framework

- **Framework:** Vitest with TypeScript support
- **Config:** `vitest.config.ts` at project root
- **Script:** `npm test` runs `vitest run`
- **File naming:** `<module>.test.ts` co-located next to the source file

## TypeScript

- **Strict mode** enabled in `tsconfig.json`
- **Module system:** CommonJS (`"module": "commonjs"`)
- **Build output:** `dist/` (gitignored)
- **Build command:** `npm run build` (runs `tsc`)
- **Build tsconfig:** `tsconfig.build.json` (excludes test files, used for `prepublishOnly`)

## Global Flag

All commands support `--output json` via a global `-o, --output <format>` option on the root `program` in `src/index.ts`. Commands read this with `getOutputFormat(this)` from `utils/output.ts`.

## Utilities

| Module | Purpose |
|---|---|
| `utils/auth.ts` | `checkApiToken()` — validates `CODACY_API_TOKEN` env var |
| `utils/error.ts` | `handleError(err)` — prints error and exits |
| `utils/output.ts` | `createTable()`, `printJson()`, `printPaginationWarning()`, `formatFriendlyDate()`, `getOutputFormat()` |
| `utils/formatting.ts` | Shared display helpers: `printSection`, `truncate`, `colorByGate`, `formatDelta`, `buildGateStatus`, `printIssueDetail`, `printIssueCodeContext`, `colorPriority`, `colorStatus`, `formatDueDate` |
| `utils/providers.ts` | Maps provider codes (`gh`, `gl`, `bb`) to display names |

## CI Pipeline

See [deployment.md](deployment.md) for GitHub Actions details.
