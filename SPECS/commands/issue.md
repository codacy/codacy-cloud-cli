# `issue` Command Spec

**Status:** ✅ Done (2026-02-23); ignore/unignore added 2026-03-02; vulnerable functions block added 2026-07-24; dependency chains block added 2026-09-22 (OD-449)

## Purpose

Show full details of a single quality issue, including file context, pattern description, and suggested fix.

## Usage

```
codacy issue <provider> <organization> <repository> <issueId>
codacy iss gh my-org my-repo 12345
codacy iss gh my-org my-repo 12345 --output json
codacy iss gh my-org my-repo 12345 --ignore
codacy iss gh my-org my-repo 12345 --ignore --ignore-reason FalsePositive --ignore-comment "Not applicable here"
codacy iss gh my-org my-repo 12345 --unignore
```

The `issueId` is the `resultDataId` shown at the bottom of each issue card in `issues` and `pull-request`.

## Options

| Option | Short | Description |
|---|---|---|
| `--ignore` | `-I` | Ignore this issue |
| `--ignore-reason <reason>` | `-R` | Reason: `AcceptedUse` (default) \| `FalsePositive` \| `NotExploitable` \| `TestCode` \| `ExternalCode` |
| `--ignore-comment <comment>` | `-m` | Optional comment |
| `--unignore` | `-U` | Unignore this issue |

## API Endpoints

1. [`getIssue`](https://api.codacy.com/api/api-docs#getissue) — `AnalysisService.getIssue(provider, org, repo, resultDataId)`
2. Then in parallel:
   - [`getPattern`](https://api.codacy.com/api/api-docs#getpattern) — `ToolsService.getPattern(toolUuid, patternId)`
   - [`getFileContent`](https://api.codacy.com/api/api-docs#getfilecontent) — `FileService.getFileContent(provider, org, repo, encodedPath, startLine, endLine)`
3. For ignore/unignore: [`updateIssueState`](https://api.codacy.com/api/api-docs#updateissuestate) — uses `issue.issueId` (UUID string), not `resultDataId`

File context: ±5 lines around the issue's line number.

## Output Format

Rendered via shared `printIssueDetail` from `utils/formatting.ts`:

```
{Severity colored} | {Category} {SubCategory?}
{Issue message}

{FilePath}:{LineNumber}
{Extended line content (±5 lines)}
{Optional: suggestion line in green+bold}

{Optional: Potential false positive warning}

{Pattern description}

Why is this a problem?
{Pattern rationale}

How to fix it?
{Pattern solution}

Tags: {pattern tags}

Detected by: {tool name}
{pattern title} ({pattern id})
```

**Vulnerable Functions block** — shown between the false-positive warning and the pattern
docs whenever `issue.advisoryInformation` is present (SCA issues linked to an OSV advisory):

```
Vulnerable Functions ({advisoryId})
Published: {publishedAt, formatted YYYY-MM-DD}

  • {vulnerableFunctions[0]}
  • {vulnerableFunctions[1]}
  ...
```

Rendered via `printAdvisoryBlock` in `utils/formatting.ts`, called from `printIssueCodeContext`
(so it's also shared with the `pull-request --issue` detail view). No conditional on issue
category — gated purely on `advisoryInformation` being present, mirroring how the CVE block
is gated on `cve` for `finding`.

**Dependency import chains block** — shown right after the CVE block whenever `issue.dependencyChains`
is present (SCA issues), reusing `formatDependencyChainsBlock` from `finding`/`findings` — see
`SPECS/commands/finding.md` for the format. `CommitIssue` has no `affectedVersion`, so there's no
version segment to drop. It carries `fixedVersion` (`string[]`, API 57.7.9+; empty when no fix is
available), which the block uses: a direct dependency renders `Direct - Update <pkg> to <version>`
and a transitive one ends `(Fixed in <version>)`. With an empty or absent `fixedVersion` a direct
dependency renders as a bare `Direct - Update <pkg>`. Shared via `printIssueCodeContext`, so also
applies to the `pull-request --issue` detail view. `finding`'s detail view passes its
`SrmItem.fixedVersion` through as an override (see `SPECS/commands/finding.md`'s "Dependency
import chains" section); when it passes none, the issue's own `fixedVersion` is used.
`--output json` includes `issue.fixedVersion`.

## Tests

File: `src/commands/issue.test.ts` — 28 tests (20 + 8 for the dependency chains block).
