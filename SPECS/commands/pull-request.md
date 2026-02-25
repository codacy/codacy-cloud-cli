# `pull-request` Command Spec

**Status:**
✅ Done (2026-02-18); `--issue` option added 2026-02-23; `--diff` + Diff Coverage Summary added 2026-02-25

## Purpose

Show details for a specific pull request — about info, analysis status with gate results, issues list, and changed files.

## Usage

```
codacy pull-request <provider> <organization> <repository> <prNumber>
codacy pr gh my-org my-repo 42
codacy pr gh my-org my-repo 42 --issue 12345
codacy pr gh my-org my-repo 42 --output json
```

## Options

| Option | Short | Description |
|---|---|---|
| `--issue <issueId>` | `-i` | Show full detail for a single issue (by `resultDataId`) |
| `--diff` | `-d` | Show git diff annotated with coverage hits/misses and issues |

## API Endpoints (parallel)

- [`getRepositoryPullRequest`](https://api.codacy.com/api/api-docs#getrepositorypullrequest) — `AnalysisService.getRepositoryPullRequest(provider, org, repo, prNumber)`
- [`listPullRequestIssues`](https://api.codacy.com/api/api-docs#listpullrequestissues) (status=new, onlyPotential=false) — new confirmed issues
- [`listPullRequestIssues`](https://api.codacy.com/api/api-docs#listpullrequestissues) (status=new, onlyPotential=true) — new potential issues
- [`listPullRequestFiles`](https://api.codacy.com/api/api-docs#listpullrequestfiles) — files with metric deltas
- [`getRepositoryPullRequestFilesCoverage`](https://api.codacy.com/api/api-docs#getrepositorypullrequestfilescoverage) — files coverage

## `--issue` mode

When `--issue <issueId>` is provided:
1. Fetch all PR issues (confirmed + potential) using `fetchAllPrIssues()` pagination helper
2. Find the issue by `resultDataId`
3. Fetch `getPattern` + `getFileContent` in parallel
4. Render using shared `printIssueDetail` from `utils/formatting.ts`

## `--diff` mode

When `--diff` is provided, print the git diff annotated with coverage hits/misses and issues.

fetch the following in parallel:
- [`getPullRequestDiff`](https://api.codacy.com/api/api-docs#getpullrequestdiff) - PR's git diff, pass HEAD and target commits - IGNORE THE FACT IT SAYS DEPRECATED, USE IT ANYWAY
- [`getRepositoryPullRequestFilesCoverage`](https://api.codacy.com/api/api-docs#getrepositorypullrequestfilescoverage) - diff coverage by file, with each line hits counted
- [`listPullRequestIssues`](https://api.codacy.com/api/api-docs#listpullrequestissues) (status=new, onlyPotential=false) — new confirmed issues
- [`listPullRequestIssues`](https://api.codacy.com/api/api-docs#listpullrequestissues) (status=new, onlyPotential=true) — new potential issues

Use the `parseDiff` function from `utils/diff.ts` to parse the git diff into an object.

When printing the diff, do not print the entire diff, only blocks containing lines that have coverage hits or misses, or issues.

Example output of the diff:
```
-------------------------------------------------------------------------------
path/to/file.ts
@@ -29,54 +29,17 @@ class DastAnalysisServiceImpl(
...
     45 |     x = y +10;
     46 |     
     48 -     return (y + 10);
✓    49 +     return { x }; // covered
     50 | 
     51 | 
...
-------------------------------------------------------------------------------
path/to/another-file.ts
@@ -29,54 +29,17 @@ class AnotherClass(
...
     45 |     x = y +10;
     46 |     
     48 -     return (y + 10);
✘    49 +     return { x }; // not covered
     50 | 
     51 | 
...
-------------------------------------------------------------------------------
path/to/file-with-issues.ts
@@ -29,54 +29,17 @@ class ClassWithIssues(
...
     45 |     x = y +10;
     46 |     
     48 -     return (y + 10);
┃    49 +     return { x }; 
┃     ↳  Critical | Security Cryptography | Potential false positive #123456
┃        Object property should be a constant.
     50 | 
     51 | 
...
@@ -29,54 +29,17 @@ class MultipleThings(
...
     45 |     x = y +10;
     46 |     
     48 -     return (y + 10);
✘    49 +     return { x }; 
┃     ↳  Critical | Security Cryptography | Potential false positive #123456
┃        Object property should be a constant.
     50 | 
     51 | 
...
```

Styling rules for the diff:
- unchanged lines should be gray
- removed lines should be dark gray
- added lines should be white
- covered line number and pipe should be green
- uncovered line number and pipe should be red
- issue left line should match the color of the severity
- when a line has both a coverage hit/miss and an issue, for code line itself show the coverage hit/miss symbol (avoid the left line character that would otherwise be shown because of the issue)


## Output Sections

### About (key-value table)

Provider/org/repo, PR number + title, status, author, branches (origin → target), updated, head commit SHA.

### Analysis (key-value table)

- **Analyzing**: Yes/No
- **Up to Standards**: green ✓ / red ✗ (from `quality.isUpToStandards` + `coverage.isUpToStandards`)
- **Issues**: `+new / -fixed` with gate coloring; inline reason if failing or pending ("Fails <= 2 warning issues" / "To check >= 50% coverage")
- **Coverage**, **Complexity**, **Duplication**: deltas with gate coloring + inline reasons

Gate reasons come from `quality.resultReasons` and `coverage.resultReasons`.

### Issues List (card-style, NOT a table)

Merged list of confirmed + potential issues, sorted by severity (Error > High > Warning > Info).

```
────────────────────────────────────────

{Severity colored} | {Category} {SubCategory?} | {Optional: POTENTIAL}
{Tool}: {Pattern title}
{Issue message}

{FilePath}:{LineNumber}   ID: {resultDataId}
{LineText}
{Optional: Potential false positive warning}

────────────────────────────────────────
```

### Diff Coverage Summary

If `getRepositoryPullRequestFilesCoverage` returns data, print a summary of the diff coverage by file under the title "Diff Coverage Summary".

```
{File path} | {Coverage diff%} | Uncovered lines: {uncoveredLines}
```

e.g. 

```
src/index.ts | 85.0% | Uncovered lines: 23,32,78-90,100-105
```

- The metric Diff Coverage is a percentage for the covered lines in the diff.
- Covered lines have `hits` > 0 in the response.
- Lines with `hits` = 0 are coverable but uncovered by tests.


### Files List (columnar table)

Only files with any metric delta change. Columns: file path, issues (+new/-fixed), coverage delta, complexity delta, duplication delta.

## Tests

File: `src/commands/pull-request.test.ts` — 15 tests (11 original + 4 for `--issue`).
