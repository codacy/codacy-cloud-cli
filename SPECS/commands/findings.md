# `findings` Command Spec

**Status:** ✅ Done (2026-02-20)

## Purpose

Show security findings for a repository or an organization. The repository argument is optional — omitting it shows org-wide findings.

## Usage

```
codacy findings <provider> <organization> [repository]
codacy findings gh my-org my-repo
codacy findings gh my-org
codacy find gh my-org --severities High,Critical --statuses OnTrack
codacy find gh my-org my-repo --output json
```

## API Endpoints

- [`searchSecurityItems`](https://api.codacy.com/api/api-docs#searchsecurityitems) — `SecurityService.searchSecurityItems(provider, org, body)` with optional `repository` filter in body

## Options

| Option | Short | Description |
|---|---|---|
| `--search <term>` | `-q` | Search term to filter findings |
| `--severities <list>` | `-s` | Comma-separated priority levels: Critical, High, Medium, Low |
| `--statuses <list>` | `-S` | Comma-separated statuses: Overdue, OnTrack, DueSoon, ClosedOnTime, ClosedLate, Ignored |
| `--categories <list>` | `-c` | Comma-separated security category names |
| `--scan-types <list>` | `-T` | Comma-separated scan types: SAST, Secrets, SCA, CICD, IaC, DAST, PenTesting, License, CSPM |
| `--dast-targets <list>` | `-d` | Comma-separated DAST target URLs |

Default status filter: `Overdue,OnTrack,DueSoon`.

## Output

Card-style format:

```
────────────────────────────────────────

{Priority colored} | {SecurityCategory} {ScanType} | {Optional: Likelihood} {Optional: EffortToFix} | {Optional: Repository}  {id dimmed}
{Finding title}
{Optional: affectedTargets}

{Status} {DueAt} | {Optional: CVE or CWE} | {Optional: AffectedVersion → FixedVersion} | {Optional: Application}

────────────────────────────────────────
```

The `id` (UUID) is shown in dim gray at the end of line 1 — use it with the `finding` command to see full details.

Priority colors: Critical=red, High=orange, Medium=yellow, Low=blue.

Shows pagination warning if more results exist.

## Tests

File: `src/commands/findings.test.ts` — 13 tests.
