# `finding` Command Spec

**Status:** ✅ Done (2026-02-24); CVE enrichment ✅ Done (2026-02-24)

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

## Output Format

```
{Priority colored} | {SecurityCategory} {ScanType} | {Optional: Likelihood} {EffortToFix} | {Optional: Repository}  {id dimmed}
{Finding title}

{Status} {DueAt} | {Optional: CVE/CWE} | {Optional: AffectedVersion → FixedVersion} | {Optional: Application} | {Optional: AffectedTargets}

{Optional: Ignored by {name} on {date}}
{Optional: Ignored reason}

{Optional: summary}
{Optional: additionalInfo}

{Optional: Remediation:}
{Optional: remediation}

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

## Tests

File: `src/commands/finding.test.ts` — 14 tests (9 original + 5 for CVE enrichment).
