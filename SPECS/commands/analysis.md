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

- Analysis finished, waiting for coverage (within 3h):
```
Analysis       Finished 12h ago (c00e638) — Waiting for coverage reports...
```

- Analysis finished, coverage overdue (>3h):
```
Analysis       Finished 12h ago (c00e638) — Missing coverage reports
```

- Normal finished state:
```
Analysis       Finished 12h ago (c00e638)
```

"In progress..." and "Reanalysis in progress..." are colored light blue. "Missing coverage reports" is yellow.

### `pull-request` command — About section

Same "Analysis" row replaces the former "Head Commit" row, with the same status logic applied to the PR's HEAD commit.

## Analysis Status Logic

- **Being analyzed**: `startedAnalysis` is set AND (`endedAnalysis` is absent OR `startedAnalysis > endedAnalysis`)
- **Coverage expected**: determined by `listCoverageReports(limit=1).data.hasCoverageOverview`
- **Coverage data present**: `diffCoverage.value !== undefined OR deltaCoverage !== undefined` (PR); `coveragePercentage !== undefined` (repo)
- **Wait threshold**: 3 hours from `endedAnalysis`

Implemented in `formatAnalysisStatus()` in `src/utils/formatting.ts`.

## API Endpoints

- [`reanalyzeCommitById`](https://api.codacy.com/api/api-docs#reanalyzecommitbyid) — `RepositoryService.reanalyzeCommitById(provider, org, repo, { commitUuid: sha })`
- [`getPullRequestCommits`](https://api.codacy.com/api/api-docs#getpullrequestcommits) with `limit=1` — head commit timing for PR
- [`listRepositoryCommits`](https://api.codacy.com/api/api-docs#listrepositorycommits) with `limit=1` — head commit timing for repo
- [`listCoverageReports`](https://api.codacy.com/api/api-docs#listcoveragereports) with `limit=1` — check `hasCoverageOverview`

## Tasks

- [x] Update analysis status in the About section of the `repository` command
- [x] Update analysis status in the About section of the `pull-request` command
- [x] Add `--reanalyze` option to the `repository` command
- [x] Add `--reanalyze` option to the `pull-request` command
- [x] Update existing tests for the status sections
- [x] Add tests for the new `--reanalyze` option

## Tests

- `src/utils/formatting.test.ts` — 6 unit tests for `formatAnalysisStatus`
- `src/commands/repository.test.ts` — 4 new tests (analysis status, reanalyze)
- `src/commands/pull-request.test.ts` — 3 new tests (analysis status, reanalyze)
