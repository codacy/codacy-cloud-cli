# `issues` Command Spec

**Status:** ✅ Done (2026-02-19); vulnerable functions line added 2026-07-24; dependency chains line added 2026-09-22 (OD-449)

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

- [`searchRepositoryIssues`](https://api.codacy.com/api/api-docs#searchrepositoryissues) — `AnalysisService.searchRepositoryIssues(provider, org, repo, cursor, limit, body)`
- [`searchRepositoryIgnoredIssues`](https://api.codacy.com/api/api-docs#searchrepositoryignoredissues) — `AnalysisService.searchRepositoryIgnoredIssues(provider, org, repo, cursor, limit, body)` (only when `--ignored` is given; accepts the same `SearchRepositoryIssuesBody`)
- [`issuesOverview`](https://api.codacy.com/api/api-docs#issuesoverview) — `AnalysisService.issuesOverview(provider, org, repo, body)` (only when `--overview` is given)
- [`listTools`](https://api.codacy.com/api/api-docs#listtools) — `ToolsService.listTools(cursor, limit)` (only when `--overview` surfaces noisy patterns, to map each pattern's `prefix` to its owning tool)
- [`listRepositoryTools`](https://api.codacy.com/api/api-docs#listrepositorytools) — `AnalysisService.listRepositoryTools(provider, org, repo)` (only when `--overview` surfaces noisy patterns, to detect config-file-driven tools)
- [`listRepositoryToolPatterns`](https://api.codacy.com/api/api-docs#listrepositorytoolpatterns) — `search=<patternId>` (only for noisy patterns on non-config-file tools, to detect coding-standard enforcement)

`searchRepositoryIssues` and `issuesOverview` accept the same `SearchRepositoryIssuesBody` for filtering.

## Options

| Option | Short | Description |
|---|---|---|
| `--branch <branch>` | `-b` | Branch name |
| `--patterns <patterns>` | `-p` | Comma-separated pattern IDs |
| `--severities <severities>` | `-s` | Comma-separated severity levels: Critical, High, Medium, Minor (or Error, Warning, Info) |
| `--categories <categories>` | `-c` | Comma-separated category names (e.g. Security, CodeStyle, ErrorProne) |
| `--languages <languages>` | `-l` | Comma-separated language names |
| `--tags <tags>` | `-t` | Comma-separated tag names |
| `--authors <authors>` | `-a` | Comma-separated author emails |
| `--tools <tools>` | `-T` | Comma-separated tool UUIDs or names |
| `--limit <n>` | `-n` | Maximum number of issues (default: 100, max: 1000) |
| `--overview` | `-O` | Show overview counts instead of list |
| `--ignored` | `-i` | List issues marked as ignored instead of active ones |
| `--false-positives [value]` | `-F` | Filter by potential false positives (true, false, or omit) |
| `--ignore` | `-I` | Ignore all issues matching current filters |
| `--ignore-reason <reason>` | `-R` | Reason for ignoring (AcceptedUse, FalsePositive, NotExploitable, TestCode, ExternalCode) |
| `--ignore-comment <comment>` | `-m` | Optional comment when using --ignore |
| `--skip-confirmation` | `-y` | Skip the confirmation prompt when using --ignore (for CI/scripts) |

## Output

### List mode (default)

Card-style format, sorted by severity (Error > High > Warning > Info):

```
────────────────────────────────────────

{Severity colored} | {Category} {SubCategory?}   #{resultDataId dimmed}
{Issue message}

{FilePath}:{LineNumber}
{LineText}
{Optional: Potential false positive warning}
{Optional: Transitive - a → b → c ... and N more}
{Optional: Vulnerable functions: fn1, fn2, fn3 (+N more)}

────────────────────────────────────────
```

Severity colors: Error=red, High=orange, Warning=yellow, Info=blue.

The dependency-chain line is shown when `issue.dependencyChains` is present (SCA issues),
reusing `formatDependencyChainsLine` from `finding`/`findings` — see `SPECS/commands/findings.md`
for the format. `--output json` includes the full `dependencyChains` array, no truncation. Not
shown for ignored issues (`IgnoredIssue` has no `dependencyChains` field).

The "Vulnerable functions" line is shown when `issue.advisoryInformation` is present (SCA
issues linked to an OSV advisory), listing up to 3 function names with a "(+N more)" suffix
for longer lists. Rendered via `printIssueCard` in `utils/formatting.ts`. `--output json`
includes the full `advisoryInformation` object (`advisoryId`, `vulnerableFunctions`,
`publishedAt`) — no truncation there. Not shown for ignored issues (`IgnoredIssue` has no
`advisoryInformation` field).

Shows pagination warning if more results exist.

### Overview mode (`--overview`)

Seven count tables sorted descending by count: Category, Severity, Language, Tag,
Pattern, Author, and False Positives.

The **False Positives** table relabels the API's raw bucket names for readability:
`belowThreshold` → "Not a False Positive", `equalOrAboveThreshold` → "Potential
False Positive" (the bucket is keyed on FP probability vs. the configured
threshold, so at/above threshold = a potential false positive).

After the tables, a **"Suggested actions to reduce noise"** section lists patterns
worth disabling. A pattern must clear two absolute floors **and** show a relative
signal:

- **Total floor** (`NOISE_MIN_TOTAL`, 200): the section is suppressed entirely
  unless the repo has ≥200 issues in total — on low-volume repos, disabling a rule
  to shave a handful of issues isn't real noise reduction. Kept above the
  per-pattern floor so it does independent work (were they equal, any pattern that
  clears the per-pattern floor would already push the repo past an equal total
  floor, making it dead code).
- **Per-pattern floor** (`NOISE_MIN_PATTERN`, 100): the individual pattern must
  have ≥100 issues on its own. Without it, a long tail of tiny patterns drags the
  median down (e.g. to 3) so far that a pattern with only ~9 issues clears the
  relative bar below — yet 9 issues is nothing worth disabling a rule over.
- **Relative signal** (either one): accounts for **≥10% of all issues** shown
  (only applied when there are **≥11 distinct patterns** — an even split of N
  patterns gives each `1/N`, which only drops below 10% once N > 10, so with 8–10
  patterns a balanced repo would otherwise flag every one), **or** has **≥3× the
  median** issues-per-pattern.
  The median (not the mean) is used so a single huge pattern can't inflate the
  baseline and mask smaller-but-still-disproportionate patterns.

The owning tool is resolved by matching the pattern ID against each tool's
`prefix` (longest match wins); patterns whose tool can't be resolved (no/unknown
prefix) are dropped silently. The list is capped at 10 with a "… (N more)" note.

The suggested step depends on **how the pattern is managed**, since not every
pattern can be disabled through the CLI:

```
Suggested actions to reduce noise

  Disable "Use of assert detected" (-2.5k issues)
  > codacy pattern Bandit Bandit_B101 --disable
```

- **Default** — a runnable `> codacy pattern <tool> <patternId> --disable` command.
- **Tool uses a local configuration file** — no command; instead
  `→ Update your local <tool> configuration file to disable the pattern`.
- **Pattern enforced by a coding standard** — no command; instead
  `→ Update <standard name(s)> to disable the pattern`.

To classify each noisy pattern, the command additionally fetches the repository
tools (`listRepositoryTools`, for `usesConfigurationFile` and the repo tool
UUID) and, for non-config-file tools, the pattern's `enabledBy` via
`listRepositoryToolPatterns` (`search=<patternId>`, one call per noisy pattern).
A config file takes precedence over coding-standard enforcement. These extra
calls only run when at least one noisy pattern exists.

`--output json` is unaffected (raw counts only — no relabeling or suggestions).

### Ignored mode (`--ignored`)

Lists issues that were marked as ignored on Codacy, via the dedicated
`searchRepositoryIgnoredIssues` endpoint. `--ignored` is a boolean flag (like
`--false-positives`); without it, `codacy issues …` lists active issues as
before, and passing `--ignored` switches to the ignored listing.

The endpoint accepts the same filter body as the active-issues search, so every
filter (`--branch`, `--patterns`, `--tools`, `--severities`, `--categories`,
`--languages`, `--tags`, `--authors`, `--limit`) and `--false-positives` apply.
It cannot be combined with `--overview` (no ignored-issues overview exists) or
`--ignore` (those issues are already ignored) — both error out.

Output is a card list sorted by severity, like the default list mode, plus an
ignore-metadata line per issue:

```
Critical | Security Injection  <issueId>
Potential SQL injection vulnerability

src/auth.ts:20
db.query(`SELECT * FROM users WHERE id = ${id}`);

Ignored as FalsePositive by Jane Dev · 2026-06-01
Comment: Reviewed, not exploitable
```

Ignored issues carry the string `issueId` (there is no numeric `resultDataId`),
and the `Comment:` line is shown only when a comment was recorded. Unignoring is
not part of this mode — use `codacy issue <id> --unignore` (there is no
bulk-unignore endpoint). `--output json` emits `{ ignoredIssues: [...] }`
projected to the shown fields.

### Bulk ignore mode (`--ignore`)

Fetches every issue matching the current filters (all pages) and marks them all
as ignored via `bulkIgnoreIssues` (batched at 100 IDs per call). Because this is
destructive and applies to *all* matching issues, it prompts for confirmation
after showing the count (`Ignore all N matching issues? …`) and only proceeds on
an explicit `y`. `--skip-confirmation` (`-y`) bypasses the prompt for CI/scripts;
in a non-interactive shell without that flag the prompt cannot be answered, so
the command aborts without ignoring anything (rather than ignoring by accident).
Cannot be combined with `--overview` or `--limit`.

## Tests

File: `src/commands/issues.test.ts` — 76 tests (72 + 3 for the dependency chains line, + 1 for the ignored-issue-card safety check).
