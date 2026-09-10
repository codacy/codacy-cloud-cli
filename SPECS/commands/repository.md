# `repository` Command Spec

**Status:** ✅ Done (2026-02-18); actions (`--add`, `--remove`, `--follow`, `--unfollow`) added 2026-02-25; analysis status + `--reanalyze` added 2026-03-05

## Purpose

Show details, status, and metrics for a specific repository — a full dashboard view.

## Usage

```
codacy repository <provider> <organization> <repository>
codacy repo gh my-org my-repo --output json
codacy repo gh my-org my-repo --reanalyze
```

## API Endpoints (parallel)

- [`getRepositoryWithAnalysis`](https://api.codacy.com/api/api-docs#getrepositorywithanalysis) — `AnalysisService.getRepositoryWithAnalysis(provider, org, repo)`
- [`listRepositoryPullRequests`](https://api.codacy.com/api/api-docs#listrepositorypullrequests) — `AnalysisService.listRepositoryPullRequests(provider, org, repo)`
- [`issuesOverview`](https://api.codacy.com/api/api-docs#issuesoverview) — `AnalysisService.issuesOverview(provider, org, repo)`
- [`listRepositoryCommits`](https://api.codacy.com/api/api-docs#listrepositorycommits) with `limit=1` — head commit timing for analysis status

`listCoverageReports` used to be a fifth call, supplying the `hasCoverageOverview`
flag behind the Analysis row's coverage hint. `getRepositoryWithAnalysis` now
returns `coverage.status` ([`CoverageStatus`](https://api.codacy.com/api/api-docs#tocs_coveragestatus)),
which answers the same question authoritatively, so the call was dropped — see
[analysis.md](analysis.md).

## Output Sections

### About (key-value table)

| Field | Source |
|---|---|
| Repository | `provider / org / name` |
| Visibility | `repo.visibility` |
| Default Branch | `repo.defaultBranch.name` |
| Last Updated | `repo.lastUpdated` (friendly date) |
| Analysis | `formatAnalysisStatus()` — see [analysis.md](analysis.md) |

### Setup (key-value table)

| Field | Source |
|---|---|
| Languages | `repo.languages` (comma-separated) |
| Coding Standards | `repo.standards` (names, comma-separated) |
| Quality Gate | `repo.gatePolicyName` |
| Problems | `repo.problems` (yellow if present, green "None" otherwise) |

### Metrics (key-value table)

Colored by goals thresholds from `RepositoryQualitySettings`:

| Field | Notes |
|---|---|
| Issues | Count + Issues/kLoC ratio |
| Coverage | % (min threshold), plus the coverage status spelled out — see below |
| Complex Files | % (max threshold) |
| Duplication | % (max threshold) |

The Coverage row reads `coverage.status` via `formatRepoCoverageDetail()`. Where
the `repositories` table has room only for a glyph, this row has room for a
sentence:

| `status` | Coverage row |
|---|---|
| `Waiting` | `19.0%  Not reported yet for the latest commit — value from 11h ago (5474cbf)` (blueBright) |
| `Stopped` | `Stopped receiving reports 2026-08-26 — last report 8752dbd` (yellow), plus ` — coverage gate no longer enforced` when `goals.minCoveragePercentage` is set. No percentage: the API sends none |
| `None` | dim `Not set up` — distinguishable from a metric Codacy didn't compute, which is all a bare `N/A` could say |
| `UpToDate`, absent status, absent `coverage` | unchanged (`colorMetric`) |

### Open Pull Requests (columnar table)

Columns: `#`, `Title` (truncated 50), `Branch` (truncated 40), `✓`, `Issues`, `Coverage`, `Complexity`, `Duplication`, `Updated`.

Metric columns colored by `resultReasons` gate pass/fail.

Shows pagination warning if more PRs exist.

### Issues Overview (three count tables)

By category, severity level, and language — sorted descending by count.

## Actions

In all cases, show a success message on completion or an error message with details on failure.

### Add repository (`--add`)

- API: [`addRepository`](https://api.codacy.com/api/api-docs#addrepository)
- Shows an additional note that the repository will be available after a few minutes (initial clone + analysis).

### Remove repository (`--remove`)

- API: [`deleteRepository`](https://api.codacy.com/api/api-docs#deleterepository)

### Follow repository (`--follow`)

- API: [`followAddedRepository`](https://api.codacy.com/api/api-docs#followaddedrepository)

### Unfollow repository (`--unfollow`)

- API: [`unfollowRepository`](https://api.codacy.com/api/api-docs#unfollowrepository)

### Reanalyze (`--reanalyze`)

- Fetches the HEAD commit SHA via `listRepositoryCommits(limit=1)`
- API: [`reanalyzeCommitById`](https://api.codacy.com/api/api-docs#reanalyzecommitbyid)
- Shows success/failure message

## Tests

File: `src/commands/repository.test.ts` — 45 tests.
