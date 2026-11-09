# `findings` Command Spec

**Status:** ✅ Done (2026-02-20); vulnerable functions (advisoryInformation) ✅ Done (2026-07-28)

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
| `--scan-types <list>` | `-T` | Comma-separated scan types: SAST, Secrets, SCA, ContainerSCA (aliases: ContainerScanning, Container), CICD, IaC, DAST, PenTesting, License, CSPM. Case-insensitive; spaces, hyphens and underscores are ignored |
| `--dast-targets <list>` | `-d` | Comma-separated DAST target URLs |
| `--image <name>` | `-i` | Container image name (sent as `containerImage.name`) |
| `--image-tag <tag>` | `-t` | Container image tag (sent as `containerImage.tag`). Requires `--image`: the API rejects a tag without a name, so the CLI refuses it locally before any request or git auto-detection |

Default status filter: `Overdue,OnTrack,DueSoon`.

`--image` / `--image-tag` map to the request body's single `ContainerImageFilter` (one image per request, not a list — hence singular names). `--image-tag` rather than `--tag` so it reads as narrowing the image, not as a finding tag. `--image` does not add `ContainerSCA` to `--scan-types` implicitly; the API applies the filter itself.

## Output

Card-style format:

```
────────────────────────────────────────

{Priority colored} | {SecurityCategory} {ScanType} | {Optional: Likelihood} {Optional: EffortToFix} | {Optional: Image or Repository}  {id dimmed}
{Finding title}
{Optional: affectedTargets}

{Status} {DueAt} | {Optional: CVE or CWE} | {Optional: AffectedVersion → FixedVersion} | {Optional: Application}
{Optional: Dependency import chain (SCA findings with dependencyChains)}
{Optional: Vulnerable functions: fn1, fn2 (+N more) — from item.advisoryInformation}

────────────────────────────────────────
```

The `id` (UUID) is shown in dim gray at the end of line 1 — use it with the `finding` command to see full details.

Priority colors: Critical=red, High=orange, Medium=yellow, Low=blue.

Shows pagination warning if more results exist.

### Dependency import chain (SCA)

When a finding carries `dependencyChains` (`string[][]` — one ordered import chain
per entry, root → vulnerable package), a dedicated line is shown below the status
line, built from the **first** chain. The `AffectedVersion → FixedVersion` segment
is dropped from the status line (it would duplicate the chain line).

- **Direct** (chain has 1 package): `Direct - Update <pkg> to <fixedVersion>`
- **Transitive** (2+ packages): `Transitive - <pkg> → … → <pkg> (Fixed in <fixedVersion>)`
- Chains with **4+ packages** collapse their middle: `<first> → ... N more ... → <last>` (N = length − 2).
- Multiple chains append `... and X more` (X = chains − 1).

### Vulnerable functions (advisoryInformation)

When an item carries `advisoryInformation` (`{advisoryId, vulnerableFunctions, publishedAt}`), a compact `Vulnerable functions: fn1, fn2 (+N more)` line is shown below the status/chain lines, via the shared `summarizeFunctions` helper (`utils/formatting.ts`, capped at 3 entries) — same rendering as `issue`/`pull-request`'s card view. Included in `--output json` as `advisoryInformation.{advisoryId,vulnerableFunctions,publishedAt}` per item.

### Container image (container scanning)

When an item carries `imageName` (container scanning findings), the header line shows the scanned image as `name:tag` (just `name` when `imageTag` is absent), dimmed and sanitized, **in place of the repository**: the finding is about an image, not a repository. Unlike the repository, the image is shown in the single-repository view too, since the command's arguments don't imply it. The switch is on `imageName` being present, not on `scanType === "ContainerSCA"`. `--output json` includes `imageName` and `imageTag` per item.

## Tests

File: `src/commands/findings.test.ts` — 37 tests.
