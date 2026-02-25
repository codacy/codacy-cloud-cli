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
| Coverage | `repo.coveragePercentage` | Colored by goals threshold (min mode) |
| Last Updated | `repo.lastUpdated` | Friendly date via `formatFriendlyDate()` |

Shows pagination warning if more pages exist.

## Tests

File: `src/commands/repositories.test.ts` — 5 tests.
