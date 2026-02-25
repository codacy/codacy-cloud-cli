# `repository` Command Spec

**Status:** ✅ Done (2026-02-18)

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

## Tests

File: `src/commands/repository.test.ts` — 5 tests.
