# Analysis Status & Reanalyze Spec

**Status:** ✅ Done (2026-03-05)

## Purpose

Show analysis status of the HEAD commit in the `repository` and `pull-request` commands, and allow triggering reanalysis.

## Usage

```
codacy repository <provider> <organization> <repository> --reanalyze
codacy pull-request <provider> <organization> <repository> <prNumber> --reanalyze
```

On success, show: "Reanalysis requested successfully, new results will be available in a few minutes."
On failure, show: "Failed to request reanalysis: \<error message\>".

### `--reanalyze-and-wait` (`-w`) — blocking variant

A second variant triggers the reanalysis and **waits** for it to complete, then
prints what changed. The fire-and-forget `--reanalyze` stays as-is.

```
codacy repository <provider> <organization> <repository> --reanalyze-and-wait
codacy pull-request <provider> <organization> <repository> <prNumber> --reanalyze-and-wait
```

Flow:
1. Capture a **baseline** of current issues — for the repository from
   `issuesOverview` (counts by severity / category / pattern as independent
   lists); for the pull request by paging `listPullRequestIssues(status="new")`
   (each issue carries its pattern's category + severity).
2. Trigger `reanalyzeCommitById` on the HEAD commit.
3. **Poll every 10 s** (giving up after **20 min**), with the spinner showing
   `"Analysis requested. Waiting for it to start..."` → `"Analysis in progress.
   This may take a few minutes..."` → `"Analysis done. Fetching results to
   compare..."`. On each poll, read the **first commit** from the `/commits`
   endpoint (`listRepositoryCommits` for the repo, `getPullRequestCommits` for
   the PR, both `limit=1`) and look at its `startedAnalysis`/`endedAnalysis`:
   - **In progress** = `startedAnalysis` more recent than `endedAnalysis` **and**
     more recent than `t0` (the moment we triggered) — i.e. the analysis that
     started is ours, not a previous one.
   - **Done** = `startedAnalysis` more recent than `t0` **and** `endedAnalysis`
     at or after `startedAnalysis` (our analysis has since finished).
4. Fetch a fresh snapshot, diff against the baseline, and print:
   - `Analysis finished in <duration>` headline (from the commit's
     `startedAnalysis`→`endedAnalysis`, falling back to wall-clock).
   - **By pattern / By severity / By category** signed net-delta lists. PR
     pattern rows are annotated `(Category · Severity)`; repo pattern rows are
     title-only (the overview doesn't map patterns to category/severity).
   - `In total: <before> → <after> issues (net ±N)`.

Notes:
- The overview only exposes **net** per-bucket change, so deltas are signed net
  values per dimension, not a literal "added vs removed" split or a
  severity×category cross-tab.
- The pattern list is soft-capped at 20 rows with a `… (N more)` line.
- `--output json` emits `{ durationMs, durationHuman, totals, deltas }`.
- On timeout, the spinner fails with a "didn't finish within 20 minutes" message.

Shared logic lives in `src/utils/reanalyze-wait.ts` (`pollForAnalysis`,
`snapshotFromOverview`, `snapshotFromPrIssues`, `diffSnapshots`,
`renderReanalyzeReport`, `reanalyzeJson`, and a `timers.sleep` indirection that
tests stub for instant polling). `formatDuration` lives in `utils/formatting.ts`.

## Updates to existing commands

### `repository` command — About section

The "Last Analysis" row is replaced by "Analysis", showing the current analysis status of the HEAD commit:

- Reanalysis in progress (HEAD commit already analyzed, but currently being reanalyzed):
```
Analysis       Finished 12h ago (c00e638) — Reanalysis in progress...
```

- First analysis (HEAD commit not yet analyzed):
```
Analysis       In progress... (c00e638)
```

- Analysis finished, no coverage report for the latest commit yet
  (`coverage.status === "Waiting"`):
```
Analysis       Finished 12h ago (c00e638) — Waiting for coverage reports...
```

- Analysis finished, coverage reports stopped arriving
  (`coverage.status === "Stopped"`):
```
Analysis       Finished 12h ago (c00e638) — Stopped receiving coverage reports
```

- Normal finished state (`UpToDate`, `None`, or no status at all):
```
Analysis       Finished 12h ago (c00e638)
```

"In progress...", "Reanalysis in progress..." and "Waiting for coverage
reports..." are colored light blue. "Stopped receiving coverage reports" (and
the pull-request-only "Missing coverage reports") are yellow.

The row deliberately stays short: the Metrics section's Coverage row carries the
same state with its dates and commit, so the dashboard states it at two
altitudes rather than saying the same sentence twice. See
[repository.md](repository.md).

### `pull-request` command — About section

Same "Analysis" row replaces the former "Head Commit" row, with the same status
logic applied to the PR's HEAD commit — except for the coverage state, which
still comes from the heuristic below. `PullRequestCoverage`/`DiffCoverage` carry
no `status` field, so there is nothing authoritative to read. This is the only
remaining caller of the heuristic, and the only reason it still exists.

- Coverage expected, none yet (within 3h): `— Waiting for coverage reports...`
- Coverage expected, overdue (>3h): `— Missing coverage reports`

## Analysis Status Logic

- **Being analyzed**: `startedAnalysis` is set AND (`endedAnalysis` is absent OR `startedAnalysis > endedAnalysis`)

The coverage half is decided by `coverageAnalysisSuffix()`, which has two
sources in priority order:

1. **`coverageStatus`** — the API's own `Coverage.status`, available on the
   repository endpoints (`getRepositoryWithAnalysis`). Authoritative, so it wins
   outright: `Waiting` and `Stopped` each get their line, `UpToDate`/`None` get
   nothing. Used by `repository`.
2. **The heuristic** — "a coverage overview exists but this commit has no
   coverage number", with a 3-hour grace period from `endedAnalysis`:
   - **Coverage expected**: `listCoverageReports(limit=1).data.hasCoverageOverview`
   - **Coverage data present**: `diffCoverage.value !== undefined OR deltaCoverage !== undefined`
   - **Wait threshold**: 3 hours from `endedAnalysis`

   Only `pull-request` still needs it (see above).

**Why (1) exists.** The heuristic is *wrong* for `Waiting`: a waiting repository
still reports a percentage — a stale one, from `lastCommitWithCoverage` — so
"coverage data present" is true and the heuristic reads the repository as
healthy, leaving the row silent in exactly the case worth surfacing. It was also
vaguer than necessary for `Stopped` ("Missing coverage reports"), and could never
work under a repository token at all, since `listCoverageReports` is not
whitelisted while `getRepositoryWithAnalysis` is.

**Accepted trade-off.** When `status` is `undefined` — which a substantial share
of repositories return — `repository` now shows no coverage hint, where the
heuristic might have said "Missing coverage reports". That is the honest reading
of an absent status.

Implemented in `formatAnalysisStatus()` in `src/utils/formatting.ts`.

## API Endpoints

- [`reanalyzeCommitById`](https://api.codacy.com/api/api-docs#reanalyzecommitbyid) — `RepositoryService.reanalyzeCommitById(provider, org, repo, { commitUuid: sha })`
- [`getPullRequestCommits`](https://api.codacy.com/api/api-docs#getpullrequestcommits) with `limit=1` — head commit timing for PR
- [`listRepositoryCommits`](https://api.codacy.com/api/api-docs#listrepositorycommits) with `limit=1` — head commit timing for repo
- [`listCoverageReports`](https://api.codacy.com/api/api-docs#listcoveragereports) with `limit=1` — check `hasCoverageOverview`. **`pull-request` only** — `repository` dropped this call when `coverage.status` superseded it

Additionally used by `--reanalyze-and-wait`:
- `listRepositoryCommits` (`limit=1`) — repo first-commit analysis timestamps, polled for status
- `getPullRequestCommits` (`limit=1`) — PR first-commit analysis timestamps, polled for status
- `getRepositoryPullRequest` — fetched once to resolve the PR `headCommitSha`
- `issuesOverview` — repo baseline/after issue counts (severity / category / pattern)
- `listPullRequestIssues` (`status="new"`, paginated) — PR baseline/after issue list

## Tasks

- [x] Update analysis status in the About section of the `repository` command
- [x] Update analysis status in the About section of the `pull-request` command
- [x] Add `--reanalyze` option to the `repository` command
- [x] Add `--reanalyze` option to the `pull-request` command
- [x] Update existing tests for the status sections
- [x] Add tests for the new `--reanalyze` option
- [x] Add `--reanalyze-and-wait` (`-w`) blocking variant to both commands (2026-06-02)
- [x] Drive `repository`'s coverage state from `Coverage.status` instead of the `listCoverageReports` heuristic (2026-09-10)

## Tests

- `src/utils/formatting.test.ts` — 11 unit tests for `formatAnalysisStatus` (6 for the heuristic, 5 for the authoritative `coverageStatus`, including the Waiting-with-a-stale-percentage case the heuristic got wrong); + `formatDuration` and `isBeingAnalyzed` tests
- `src/commands/repository.test.ts` — 4 tests (analysis status, reanalyze) + 3 for `--reanalyze-and-wait`
- `src/commands/pull-request.test.ts` — 3 tests (analysis status, reanalyze) + 3 for `--reanalyze-and-wait`
- `src/utils/reanalyze-wait.test.ts` — 12 unit tests (snapshots, diff, poll loop incl. timeout, render, json)
