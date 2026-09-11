# `repositories` Command Spec

**Status:** ✅ Done (2026-02-17)

## Purpose

Show repositories for an organization, with quality metrics.

## Usage

```
codacy repositories <provider> <organization>
codacy repositories gh my-org --search "auth"
codacy repos gh my-org --output json
```

## API Endpoints

- [`listOrganizationRepositoriesWithAnalysis`](https://api.codacy.com/api/api-docs#listorganizationrepositorieswithanalysis) — `RepositoriesService.listOrganizationRepositoriesWithAnalysis(provider, org, cursor, limit, search)`

## Options

| Option | Short | Description |
|---|---|---|
| `--search <query>` | `-s` | Filter repositories by name |

## Output

Columnar table. Each row is one repository.

| Column | Source | Notes |
|---|---|---|
| Name | `repo.name` | Public repos append dimmed `⊙` (no separate visibility column) |
| Grade | `repo.grade` | A/B=green, C=yellow, D/F=red |
| Issues | `repo.issuesCount` | |
| Complex Files | `repo.complexFilesPercentage` | Colored by goals threshold (max mode) |
| Duplication | `repo.duplicationPercentage` | Colored by goals threshold (max mode) |
| Coverage | `repo.coverage.coveragePercentage` + `repo.coverage.status` | Colored by goals threshold (min mode). `Waiting` appends a dim `⋯`; `Stopped` shows a dim `⊘` instead of a value (the API sends none). `UpToDate`, `None` and an absent status render as before |
| Last Updated | `repo.lastUpdated` | Friendly date via `formatFriendlyDate()` |

### Coverage status legend

Printed after the table and before the pagination warning (the legend explains
the table, the warning explains the query), via `coverageStatusLegend()`. Only
the statuses actually present in the listing get a line, so an organization with
healthy coverage everywhere sees nothing:

```
⋯ no coverage report for the latest commit yet — showing the last known value
⊘ stopped receiving coverage reports
```

Shows pagination warning if more pages exist.

## Tests

File: `src/commands/repositories.test.ts` — 10 tests.
