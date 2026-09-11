# Codacy AI review instructions

Project-specific context for reviewing this repository. These notes exist to
prevent recurring false positives — they are not blanket exemptions, so still
flag a finding when it points at a concrete defect.

## Repository shape

- Single-package Node.js + TypeScript CLI (`@codacy/codacy-cloud-cli`) wrapping
  the Codacy API v3. Commander for the CLI, Vitest for tests.
- `src/api/client/` is **auto-generated** from the OpenAPI spec by
  `npm run update-api`. Never flag findings there and never suggest edits to it.
- Conventions live in `AGENTS.md` (root) and `src/commands/AGENTS.md`; specs and
  the backlog live in `SPECS/`.

## Tests

- Test files are deliberately long and repetitive: fixtures are written out in
  full rather than factored into builders, so each test reads standalone. **File-level
  length and duplication findings on `*.test.ts` are expected** and should not be
  reported. This covers suggestions to *reorganize* as well as metrics — "split
  this file into focused files", "extract shared fixtures into a module" and the
  like. Tests are co-located one-per-module by design (`<module>.test.ts` beside
  its source), so a helper's tests belong in its module's file however long that
  file grows; splitting by theme instead would break that mapping.
- Each command test builds its own bare `new Command()` harness rather than
  importing `src/index.ts`. That duplication is intentional — it keeps a command's
  tests independent of global CLI wiring.

## Complexity metrics

- Lizard's TypeScript parser sometimes **merges adjacent function declarations**
  into a single span, reporting their combined cyclomatic complexity against the
  first function's name. Before reporting a complexity finding, check that the
  named function really contains that many branches; if the reported span covers
  more than one declaration, the number is a parser artifact.
- Command action handlers are inherently branchy — they dispatch across mutually
  exclusive flag modes with early returns. Prefer suggesting extraction of a
  cohesive block (validation, rendering) over generic "reduce complexity" advice.

## Authentication

- The CLI accepts two token kinds: an **account token** (`api-token` header) and a
  **repository/project token** (`project-token` header). See
  `SPECS/repository-tokens.md`.
- Codacy honours repository tokens on only a fixed set of operations. That
  whitelist is **deliberately hardcoded** in the command guards — it mirrors a
  server-side allowlist that the client cannot query, so don't suggest deriving it
  dynamically. It carries a "re-verify after every `npm run update-api`" note.
- Guards intentionally refuse **before** issuing any request and before
  `resolveRepoArgs()` runs, so an unsupported operation fails fast instead of
  returning a bare `Unauthorized`.

## Documentation

- Cross-references between `SPECS/*.md`, `AGENTS.md`, and `README.md` are often
  added in the **same** pull request as the file they point at. Verify the target
  is absent from the PR's own diff before reporting a broken reference.
