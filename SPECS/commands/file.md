# `file` Command Spec

**Status:** ✅ Done (2026-11-10)

## Purpose

The CLI counterpart of the Codacy UI's file view for a single file: a summary of its metrics, its issues and clones, and its source code with coverage marks.

## Usage

```
codacy file src/index.ts                          # auto-detect repo; path relative to cwd
codacy file gh my-org my-repo src/index.ts        # explicit repo; path relative to repo root
codacy file src/index.ts --lines 40-120
codacy file src/index.ts --no-source
codacy file src/index.ts --branch develop
codacy file src/index.ts --output json
```

Alias: `fl`.

## API Endpoints

| Step | Operation | Notes |
|---|---|---|
| Resolve `fileId` | `RepositoryService.listFiles(…, branch, <parent dir>)` | Parent folder listing, all pages, exact `path` match |
| Metadata + metrics | `RepositoryService.getFileWithAnalysis(fileId)` | `file`, `quality`, `coverage` |
| Issues | `RepositoryService.getFileIssues(fileId)` | All pages |
| Clones | `RepositoryService.getFileClones(fileId)` | All pages |
| Line coverage | `RepositoryService.getFileCoverage(fileId)` | `{line, hits}[]`; a 404 (no coverage data for the file) means "no coverage", any other error fails the command |
| Source | `FileService.getFileContent(path, from, to, commitSha)` | Pinned to the analysed commit; skipped with `--no-source` and with `--output json` |

None of these are on the repository-token whitelist, so the command requires an account token (`resolveAccountAuth`).

## Options

| Option | Short | Description |
|---|---|---|
| `--branch <branch>` | `-b` | Branch (defaults to the main branch) |
| `--lines <range>` | `-l` | Source range: `40-120`, `40-` (to end) or `40`. Validated before any request |
| `--no-source` | `-N` | Hide the source section (and skip the content request) |

## Output

1. **Header**: path (bold), `language · branch · commit <sha7>` (dim), a yellow note if the file is ignored, then a table: Grade, Issues, Complexity, Duplication (`N clones · M duplicated lines`), Coverage (`66.7% (2/3 lines)` or `-`).
2. **Issues** — where they show depends on whether there is source:
   - **With source**, each issue is printed **inline** under its line as a compact card (`↳ • Severity | Category  #id`, the message, a false-positive note / dependency chain when present, a separator); no file path or line text, since the line is right above. A top section **Issues outside the shown lines — Found N issues** lists, as full `printIssueCard` cards, only the issues whose line isn't among the fetched lines (outside `--lines`); it is omitted when there are none.
   - **Without source** (`--no-source`, or the content request failed), **Issues — Found N issues** lists every issue as a full `printIssueCard`, ordered by line. `No issues.` when empty.
3. **Clones — Found N clones**: table of `Lines` (the block in this file) and `Also in` (`path:from-to` per other occurrence, including a second block in the same file), ordered by line.
4. **Source** (with issues inline, see 2): `NNN ▌ │ content`. The gutter bar is green for covered lines (`hits > 0`), red for uncovered (`hits = 0`), blank for lines that can't be covered or when the file has no coverage. A legend line is printed only when there is coverage. `Source not available (<reason>)` if the content request fails (e.g. over 1MB).

All repository-derived values (paths, content, clone paths) go through `sanitizeText`.

## JSON

`--output json` carries **no source code** — the content endpoint isn't called — only metadata, issues, clones and coverage. `--lines` and `--no-source` affect the source section only, so they don't change the JSON.

```json
{
  "file": { "path", "fileId", "branchId", "language", "commitSha", "ignored", "quality" },
  "issues": [ /* same projection as `issues --output json` */ ],
  "clones": [ { "id", "occurrences": [ { "path", "fileId", "fileDataId", "fromLine", "toLine" } ] } ],
  "coverage": { "coverage", "coverableLines", "coveredLines", "lines": [ { "line", "hits" } ] } | null
}
```

`coverage.lines` lists coverable lines only, ordered by line (`hits: 0` = not covered). `coverage` is `null` when the file has no coverage data.

## Tests

`src/commands/file.test.ts` (26 tests) + a refusal case in `repository-token-refusals.test.ts`.
