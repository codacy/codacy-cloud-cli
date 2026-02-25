# `repository` Command Spec

**Status:** ✅ Done (2026-02-18); actions (`--add`, `--remove`, `--follow`, `--unfollow`) added 2026-02-25

## Purpose

Show details, status, and metrics for a specific repository — a full dashboard view.

## Usage

```
codacy repository <provider> <organization> <repository>
codacy repo gh my-org my-repo --output json
```

## API Endpoints (parallel)

- [`getRepositoryWithAnalysis`](https://api.codacy.com/api/api-docs#getrepositorywithanalysis) — `AnalysisService.getRepositoryWithAnalysis(provider, org, repo)`
- [`listRepositoryPullRequests`](https://api.codacy.com/api/api-docs#listrepositorypullrequests) — `AnalysisService.listRepositoryPullRequests(provider, org, repo)`
- [`issuesOverview`](https://api.codacy.com/api/api-docs#issuesoverview) — `AnalysisService.issuesOverview(provider, org, repo)`

## Output Sections

### About (key-value table)

| Field | Source |
|---|---|
| Repository | `provider / org / name (⊙ if public)` |
| Default Branch | `repo.defaultBranch` |
| Last Updated | `repo.lastUpdated` (friendly date) |
| Last Analysis | `repo.lastAnalysedAt` time + short SHA |

### Setup (key-value table)

| Field | Source |
|---|---|
| Languages | `repo.languages` (comma-separated) |
| Coding Standards | `repo.standards` (names, comma-separated) |
| Quality Gate | `repo.qualityGateName` |
| Problems | `repo.problems` (yellow if present, green "None" otherwise) |

### Metrics (key-value table)

Colored by goals thresholds from `RepositoryQualitySettings`:

| Field | Notes |
|---|---|
| Issues | Count + Issues/kLoC ratio |
| Coverage | % (min threshold) |
| Complex Files | % (max threshold) |
| Duplication | % (max threshold) |

### Open Pull Requests (columnar table)

Columns: `#`, `Title` (truncated 50), `Branch` (truncated 40), `✓`, `Issues`, `Coverage`, `Complexity`, `Duplication`, `Updated`.

Metric columns colored by `resultReasons` gate pass/fail.

Shows pagination warning if more PRs exist.

### Issues Overview (three count tables)

By category, severity level, and language — sorted descending by count.

## Actions
In all cases, return a success message when the action is completed successfully, otherwise return an error message with the error details provided by the API.

### Add repository to Codacy
- API Endpoint: [`addRepository`](https://api.codacy.com/api/api-docs#addrepository) 
- Usage:
```
codacy repository <provider> <organization> <repository> --add
```

- Add an additional message explaining that the repository will be available after a few minutes (after first cloning and analysis is completed), depending on the size of the repository.

### Remove repository from Codacy
- API Endpoint: [`deleteRepository`](https://api.codacy.com/api/api-docs#deleterepository) 
- Usage:
```
codacy repository <provider> <organization> <repository> --remove
```

### Follow repository
- API Endpoint: [`followAddedRepository`](https://api.codacy.com/api/api-docs#followaddedrepository) 
- Usage:
```
codacy repository <provider> <organization> <repository> --follow
```

### Unfollow repository
- API Endpoint: [`unfollowRepository`](https://api.codacy.com/api/api-docs#unfollowrepository) 
- Usage:
```
codacy repository <provider> <organization> <repository> --unfollow
```

## Tests

File: `src/commands/repository.test.ts` — 5 tests.
