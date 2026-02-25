# `findings` Command Spec

**Status:** ✅ Done (2026-02-20)

## Purpose

Show security findings for a repository or an organization. The repository argument is optional — omitting it shows org-wide findings.

## Usage

```
codacy findings <provider> <organization> [repository]
codacy findings gh my-org my-repo
codacy findings gh my-org
codacy fins gh my-org --severities High,Critical --statuses OnTrack
codacy fins gh my-org my-repo --output json
```

## API Endpoints

- [`searchSecurityItems`](https://api.codacy.com/api/api-docs#searchsecurityitems) — `SecurityService.searchSecurityItems(provider, org, body)` with optional `repository` filter in body

## Options

| Option | Short | Description |
|---|---|---|
| `--search <term>` | `-s` | Search term to filter findings |
| `--severities <list>` | `-S` | Comma-separated priority levels |
| `--statuses <list>` | `-t` | Comma-separated status names |
| `--categories <list>` | `-c` | Comma-separated security category names |
| `--scan-types <list>` | `-T` | Comma-separated scan types |
| `--dast-targets <list>` | `-d` | Comma-separated DAST target URLs |

## Output

Card-style format:

```
────────────────────────────────────────

{Priority colored} | {SecurityCategory} {ScanType} | {Optional: Likelihood} {Optional: EffortToFix} | {Optional: Repository}  {id dimmed}
{Finding title}

{Status} {DueAt} | {Optional: CVE or CWE} | {Optional: AffectedVersion → FixedVersion} | {Optional: Application} | {Optional: AffectedTargets}

────────────────────────────────────────
```

The `id` (UUID) is shown in dim gray at the end of line 1 for use with the `finding` command.

Priority colors: Critical=red, High=orange, Medium=yellow, Low=blue.

Shows pagination warning if more results exist.

## Tests

File: `src/commands/findings.test.ts` — 13 tests.
