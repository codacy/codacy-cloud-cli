# `issues` Command Spec

**Status:** ✅ Done (2026-02-19)

## Purpose

Search for issues in a repository, with filters and an optional overview mode.

## Usage

```
codacy issues <provider> <organization> <repository>
codacy issues gh my-org my-repo --branch main --severities Critical,High
codacy issues gh my-org my-repo --overview
codacy is gh my-org my-repo --output json
```

## API Endpoints

- [`searchRepositoryIssues`](https://api.codacy.com/api/api-docs#searchrepositoryissues) — `AnalysisService.searchRepositoryIssues(provider, org, repo, body)`
- [`issuesOverview`](https://api.codacy.com/api/api-docs#issuesoverview) — `AnalysisService.issuesOverview(provider, org, repo)` (only when `--overview` is given)

Both accept the same `SearchRepositoryIssuesBody` for filtering.

## Options

| Option | Short | Description |
|---|---|---|
| `--branch <branch>` | `-b` | Branch name |
| `--patterns <patterns>` | `-p` | Comma-separated pattern IDs |
| `--severities <severities>` | `-s` | Comma-separated severity levels |
| `--categories <categories>` | `-c` | Comma-separated category names |
| `--languages <languages>` | `-l` | Comma-separated language names |
| `--tags <tags>` | `-t` | Comma-separated tag names |
| `--authors <authors>` | `-a` | Comma-separated author emails |
| `--overview` | `-O` | Show overview counts instead of list |

## Output

### List mode (default)

Card-style format (same as pull-request issues):

```
────────────────────────────────────────

{Severity colored} | {Category} {SubCategory?} | {Tool}: {Pattern title}
{Issue message}

{FilePath}:{LineNumber}   ID: {resultDataId}
{LineText}
{Optional: Potential false positive warning}

────────────────────────────────────────
```

Severity colors: Error=red, High=orange, Warning=yellow, Info=blue.

### Overview mode (`--overview`)

Four count tables: by language, category, severity, tag, and author.

## Tests

File: `src/commands/issues.test.ts` — 11 tests.
