# `finding` Command Spec

**Status:** ✅ Done (2026-02-24); CVE enrichment ✅ Done (2026-02-24); vulnerable functions (advisoryInformation) ✅ Done (2026-07-28)

## Purpose

Show full details of a single security finding.

## Usage

```
codacy finding <provider> <organization> <findingId>
codacy fin gh my-org abc123-uuid
codacy fin gh my-org abc123-uuid --output json
codacy fin gh my-org abc123-uuid --ignore
codacy fin gh my-org abc123-uuid --ignore --ignore-reason FalsePositive --ignore-comment "Verified safe"
codacy fin gh my-org abc123-uuid --unignore
```

The `findingId` is the UUID shown in dim gray at the end of each findings card.

## Options

| Option | Short | Description |
|---|---|---|
| `--ignore` | `-I` | Ignore this finding |
| `--ignore-reason <reason>` | `-R` | Reason: `AcceptedUse` (default) \| `FalsePositive` \| `NotExploitable` \| `TestCode` \| `ExternalCode` |
| `--ignore-comment <comment>` | `-m` | Optional comment |
| `--unignore` | `-U` | Unignore this finding |

## API Endpoints

1. [`getSecurityItem`](https://api.codacy.com/api/api-docs#getsecurityitem) — `SecurityService.getSecurityItem(provider, org, findingId)`
2. For Codacy-source findings (`itemSource === 'Codacy'`), after step 1:
   - `AnalysisService.getIssue(provider, org, item.repository, parseInt(item.itemSourceId))` → linked quality issue
   - Then in parallel: `ToolsService.getPattern(toolUuid, patternId)` + `FileService.getFileContent(...)`
   - Failures at steps 2/3 are silently caught — the finding is still shown
3. When `item.cve` is present, fetch CVE data from `https://cveawg.mitre.org/api/cve/{CVE-ID}` in parallel with step 2
4. `item.advisoryInformation` (vulnerable functions), when present, comes inline on the `getSecurityItem` response itself — no extra request

## Output Format

```
{Priority colored} | {SecurityCategory} {ScanType} | {Optional: Likelihood} {EffortToFix} | {Optional: Repository}  {id dimmed}
{Finding title}

{Status} {DueAt} | {Optional: CVE/CWE} | {Optional: AffectedVersion → FixedVersion} | {Optional: Application} | {Optional: AffectedTargets}
{Optional: Dependency import chains (SCA findings with dependencyChains)}

{Optional: Ignored by {name} on {date}}
{Optional: Ignored reason}

{Optional: summary}
{Optional: additionalInfo}

{Optional: Remediation:}
{Optional: remediation}

{Optional: Vulnerable Functions block, from item.advisoryInformation — only when there is no linked Codacy issue}

{For Codacy-source: shared printIssueCodeContext output — file context + pattern docs}
```

## CVE Enrichment

When `item.cve` is present, fetch CVE data from `https://cveawg.mitre.org/api/cve/{CVE-ID}` and display:

- CVE ID as a bold header ("About {cveId}")
- CVSS score(s) and severity, published/updated dates (from `cveMetadata`)
- Title (from `containers.cna.title` or first English problem type description)
- English description (from `containers.cna.descriptions`)
- Deduplicated references from `cna` and all `adp` containers

For Codacy-source findings, the CVE block is injected between the code context and the pattern documentation. For non-Codacy-source findings, it follows the prose fields.

## Vulnerable functions (advisoryInformation)

When `item.advisoryInformation` is present, shows the shared `printAdvisoryBlock` (advisory ID header, optional published date, one bullet per vulnerable function) via `utils/formatting.ts` — the same renderer used by `issue`/`pull-request --issue`. Shown here only when there is **no** linked Codacy issue; when there is one, `printIssueCodeContext` already renders the equivalent block from `issue.advisoryInformation`, so this avoids a duplicate. This is what makes vulnerable functions visible for SCA/dependency findings and any other non-Codacy-source finding, which have no linked issue to borrow the block from. Included in `--output json` as `finding.advisoryInformation.{advisoryId,vulnerableFunctions,publishedAt}`.

## Dependency import chains (SCA)

When a finding carries `dependencyChains` (`string[][]`), **all** chains are listed
below the status line. The Direct/Transitive label (from the first chain) appears
once; continuation lines are indented so the `-` aligns under it. The
`AffectedVersion → FixedVersion` segment is dropped from the status line.

Same per-chain rules as `findings` (direct → `Update <pkg> to <fixedVersion>`;
transitive → `<chain> (Fixed in <fixedVersion>)`; 4+ packages collapse the middle
to `<first> → ... N more ... → <last>`). See `SPECS/commands/findings.md`.

Skipped when the linked Codacy issue carries its own `issue.dependencyChains` (added
OD-449) — `printIssueCodeContext` renders those instead, so printing the item-level
block too would duplicate it. Gated on the issue's chains, not on the issue existing,
so a linked issue without chains still gets the item-level block. That call passes `item.fixedVersion` through as
`printIssueCodeContext`'s `dependencyChainsFixedVersion` param so the merged block still
carries the fixed version — `CommitIssue` itself has no `fixedVersion` field to draw on.

## Tests

File: `src/commands/finding.test.ts` — 29 tests (27 + 2 for the linked-issue dependency-chain dedup).
