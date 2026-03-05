# `pull-request` Command Spec

**Status:** ✅ Done (2026-02-18); `--issue` added 2026-02-23; `--diff` + Diff Coverage Summary added 2026-02-25; ignore/unignore options added 2026-03-02; analysis status + `--reanalyze` added 2026-03-05

## Purpose

Show details for a specific pull request — about info, analysis status with gate results, issues list, and changed files.

## Usage

```
codacy pull-request <provider> <organization> <repository> <prNumber>
codacy pr gh my-org my-repo 42
codacy pr gh my-org my-repo 42 --issue 12345
codacy pr gh my-org my-repo 42 --output json
codacy pr gh my-org my-repo 42 --reanalyze
```

## Options

| Option | Short | Description |
|---|---|---|
| `--issue <issueId>` | `-i` | Show full detail for a single issue (by `resultDataId`) |
| `--diff` | `-d` | Show git diff annotated with coverage hits/misses and issues |
| `--ignore-issue <issueId>` | `-I` | Ignore a specific issue in this PR |
| `--ignore-all-false-positives` | `-F` | Ignore all potential false positive issues |
| `--ignore-reason <reason>` | `-R` | Reason: `AcceptedUse` (default) \| `FalsePositive` \| `NotExploitable` \| `TestCode` \| `ExternalCode` |
| `--ignore-comment <comment>` | `-m` | Optional comment for ignore actions |
| `--unignore-issue <issueId>` | `-U` | Unignore a specific issue in this PR |
| `--reanalyze` | `-A` | Request reanalysis of the HEAD commit |

## API Endpoints (default mode, parallel)

- [`getRepositoryPullRequest`](https://api.codacy.com/api/api-docs#getrepositorypullrequest) — PR metadata + analysis summary
- [`listPullRequestIssues`](https://api.codacy.com/api/api-docs#listpullrequestissues) (status=new, onlyPotential=false) — new confirmed issues
- [`listPullRequestIssues`](https://api.codacy.com/api/api-docs#listpullrequestissues) (status=new, onlyPotential=true) — new potential issues
- [`listPullRequestFiles`](https://api.codacy.com/api/api-docs#listpullrequestfiles) — files with metric deltas
- [`getRepositoryPullRequestFilesCoverage`](https://api.codacy.com/api/api-docs#getrepositorypullrequestfilescoverage) — files coverage
- [`getPullRequestCommits`](https://api.codacy.com/api/api-docs#getpullrequestcommits) with `limit=1` — head commit timing for analysis status
- [`listCoverageReports`](https://api.codacy.com/api/api-docs#listcoveragereports) with `limit=1` — `hasCoverageOverview` flag

## `--issue` mode

When `--issue <issueId>` is provided:
1. Fetch all PR issues (confirmed + potential) using `fetchAllPrIssues()` pagination helper
2. Find the issue by `resultDataId`
3. Fetch `getPattern` + `getFileContent` in parallel
4. Render using shared `printIssueDetail` from `utils/formatting.ts`

## `--diff` mode

When `--diff` is provided, print the git diff annotated with coverage hits/misses and issues.

Fetches in parallel:
- [`getPullRequestDiff`](https://api.codacy.com/api/api-docs#getpullrequestdiff) — PR's git diff
- [`getRepositoryPullRequestFilesCoverage`](https://api.codacy.com/api/api-docs#getrepositorypullrequestfilescoverage) — diff coverage by file
- [`listPullRequestIssues`](https://api.codacy.com/api/api-docs#listpullrequestissues) (confirmed + potential)

Only prints blocks containing lines with coverage hits/misses or issues. Uses `parseDiff` from `utils/diff.ts`.

Example output:
```
-------------------------------------------------------------------------------
path/to/file.ts
@@ -29,54 +29,17 @@
...
✓    49 +     return { x }; // covered
✘    50 +     return { y }; // not covered
┃    51 +     return { z };
┃     ↳  Critical | Security Cryptography #123456
┃        Object property should be a constant.
...
-------------------------------------------------------------------------------
```

Styling: unchanged=gray, removed=dark gray, added=white; covered line number/pipe=green; uncovered=red; issue pipe=severity color. When a line has both coverage and an issue, coverage symbol takes priority.

## Output Sections (default mode)

### About (key-value table)

| Field | Source |
|---|---|
| Repository | `provider / org / repo` |
| Pull Request | `#number — title` |
| Status | `pullRequest.status` |
| Author | `pullRequest.owner.name` |
| Branches | `originBranch → targetBranch` |
| Updated | `pullRequest.updated` (friendly date) |
| Analysis | `formatAnalysisStatus()` — see [analysis.md](analysis.md) |

### Analysis (key-value table)

- **Analyzing**: Yes/No
- **Up to Standards**: green ✓ / red ✗ (from `quality.isUpToStandards` + `coverage.isUpToStandards`)
- **Issues**: `+new / -fixed` with gate coloring; inline reason if failing or pending
- **Coverage**, **Complexity**, **Duplication**: deltas with gate coloring + inline reasons

Gate reasons come from `quality.resultReasons` and `coverage.resultReasons`.

### Issues List (card-style, NOT a table)

Merged list of confirmed + potential issues, sorted by severity (Error > High > Warning > Info).

### Diff Coverage Summary

If coverage data is available, a per-file summary showing coverage % and uncovered line ranges:
```
src/index.ts | 85.0% | Uncovered lines: 23,32,78-90
```

### Files List (columnar table)

Only files with any metric delta change. Columns: file path, issues (+new/-fixed), coverage delta, complexity delta, duplication delta.

## Tests

File: `src/commands/pull-request.test.ts` — 27 tests.
