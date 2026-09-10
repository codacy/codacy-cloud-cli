# Commands Design Decisions

## Structure

Each command is a single file that exports a `register<Name>Command(program: Command)` function. Commands are registered in `src/index.ts`.

## Neutralizing untrusted output (CWE-150)

Repository-derived values (attacker may control them via a PR) are neutralized
with `sanitizeText()` (`utils/sanitize.ts`) before being written to the
human-readable output, so embedded ESC/control bytes can't be interpreted as
ANSI/OSC control sequences (repaint/hide findings, spoof gate status, OSC 52
clipboard writes, OSC 8 hyperlink spoofing).

- **Apply before styling, not at the boundary.** The CLI itself emits legitimate
  `ansis` SGR sequences, so sanitizing at `console.log` would strip its own
  colors, and merely allow-listing SGR would still pass an attacker's SGR
  through (the originally reported vector). Sanitize each raw untrusted value
  *before* it is wrapped in `ansis`.
- **JSON output is left untouched** — JSON encoding already escapes control
  bytes, so `--output json` consumers get the original values.
- **Where it lives.** Most sinks are covered centrally in the shared render
  helpers (`utils/formatting.ts`: issue cards/detail, code context, CVE block,
  dependency chains, version segments). Commands that render untrusted values
  outside those helpers sanitize at the render point: `pull-request` (About
  table, Files, diff-coverage, annotated diff line/hunk/path), `findings`/
  `finding`, `issues` (overview tables + noise suggestions), `issue`,
  `repository` (About, Open PRs, overview), `ls`/`directories` (dir/file names).
- **New commands/helpers** must sanitize each untrusted field (titles, author
  names, branches, file paths, diff/file content, issue messages, package
  names, etc.) at the point the raw value enters the output string.

## Command Aliases

Every command must declare a short alias via `.alias()`. Keep aliases short (2–4 characters) and intuitive:
- `repositories` → `repos`
- `repository` → `repo`
- `pull-request` → `pr`
- `issues` → `is`

## Option Short Flags

Every command option must have both a short flag and a long flag: `-X, --long-name <value>`. Pick single letters that are intuitive and don't conflict with Commander's built-in flags (`-V/--version`, `-h/--help`) or the global `-o/--output` option. When the natural letter is already taken, use uppercase (e.g. `-O, --overview` instead of `-o`).

**Exception — cross-command options are long-only.** An option declared on *every* command (currently `--repository-token`, `--no-update-notifier`) can't safely take a short flag: the short-flag space is already contested per command, so any letter would mean different things in different places (`-r` is `repository --remove`, `-R` is `--reanalyze`, `-t` is `--tags` on `issues`/`patterns` but `--token` on `login`). `codacy-analysis` dropped its `--repository-token` short flag for the same reason. Do not add short flags to these.

## Option Naming: Singular vs Plural

Use a **singular** option name when the parameter accepts a single value, and a **plural** name when it accepts a comma-separated list:

- `--branch main` → singular (one branch)
- `--severities Critical,High` → plural (list of severity levels)
- `--categories Security,CodeStyle` → plural (list of categories)
- `--languages TypeScript,Python` → plural (list of languages)
- `--authors dev@example.com,other@example.com` → plural (list of emails)

This applies to both the long flag name and the metavar: `--severities <severities>`, not `--severities <severity>`.

## Output Format

All commands support `--output json` via the global `-o, --output` option. Commands use `getOutputFormat(this)` (from `utils/output.ts`) to check the format and either:
- Render tables/styled output for `table` (default)
- Call `printJson(data)` for `json`

The `this` context in Commander action handlers gives access to the command instance, which is used to read global options via `optsWithGlobals()`.

## Table Styling

Tables are created via `createTable()` from `utils/output.ts`, which applies default styling:
- No pipe borders — clean tabular format with space separators only
- Column headers are **bold white** (not the default red from cli-table3)

## Pagination

All commands that call paginated API endpoints must check for a cursor in the response and call `printPaginationWarning()` when more results exist. The warning includes a command-specific hint suggesting how to filter results:
- `info` (organizations): generic message ("Not all organizations are shown.")
- `repositories`: suggests `--search <query>` to filter by name

New commands must follow this pattern: after printing the table, call `printPaginationWarning(response.pagination, "<hint>")`.

## Date Formatting

When displaying "Last Updated" or similar dates, use `formatFriendlyDate()` from `utils/output.ts`:
- Same day: relative time ("Just now", "10 minutes ago", "3 hours ago")
- Yesterday: "Yesterday"
- Older: "YYYY-MM-DD"

## info command (`info.ts`)

- Calls `AccountService.getUser()` and `AccountService.listUserOrganizations()` in parallel
- Displays user details in a key-value table (cli-table3 without headers)
- Displays organizations in a columnar table
- Provider codes (gh, gl, bb) are mapped to display names via `utils/providers.ts`
- Shows pagination warning if organizations response has more pages

## Visibility Indicator

Instead of a dedicated "Visibility" column (wastes horizontal space), public repositories are marked with a dimmed `⊙` (U+2299, circled dot operator) appended to the name. Private repositories show the name alone. This character is in the Mathematical Operators Unicode block and renders reliably across terminals.

## repositories command (`repositories.ts`)

- Takes `<provider>` and `<organization>` as required arguments
- Optional `--search <query>` passes through to the API's `search` parameter
- Public repos show `⊙` after the name instead of a separate Visibility column
- Quality metrics (complexity, duplication, coverage) are colored red/green based on `goals` thresholds from `RepositoryQualitySettings`:
  - **Max thresholds** (issues, complexity, duplication): green if under, red if over
  - **Min thresholds** (coverage): green if above, red if below
- Grade letters are colored: A/B = green, C = yellow, D/F = red
- Last Updated uses friendly date formatting (relative for today, "Yesterday", otherwise YYYY-MM-DD)
- Shows pagination warning if more results exist, suggesting `--search` to filter

## repository command (`repository.ts`)

- Takes `<provider>`, `<organization>`, and `<repository>` as required arguments
- Calls three API endpoints in parallel: `getRepositoryWithAnalysis`, `listRepositoryPullRequests`, `issuesOverview`
- Displays a multi-section dashboard:
  - **About**: provider/org/name, visibility, default branch, last updated (friendly date), last analysis (time + short SHA)
  - **Setup**: languages, coding standards, quality gate, problems (yellow if present, green "None" otherwise)
  - **Metrics**: issues (count + per kLoC), coverage, complexity, duplication — colored by goals thresholds
  - **Open Pull Requests**: filtered to open status, columns:
    - `#`, `Title` (truncated at 50), `Branch` (truncated at 40)
    - `✓` (header is a gray ✓) — green ✓ if `isUpToStandards` is true, red ✗ if false, dim `-` if undefined
    - `Issues` — combined `+newIssues / -fixedIssues`
    - `Coverage` — `diffCoverage% (+/-deltaCoverage%)`
    - `Complexity` — delta value with +/- sign
    - `Duplication` — delta clones count with +/- sign
    - `Updated` — friendly date
    - **Metric coloring via `resultReasons`**: The `quality.resultReasons` and `coverage.resultReasons` arrays contain per-gate pass/fail info (`gate` name + `isUpToStandards`). Gate names are matched by keyword to color the corresponding metric column:
      - `"issue"` (not security) → Issues column
      - `"coverage"` → Coverage column
      - `"complexity"` → Complexity column
      - `"duplication"` or `"clone"` → Duplication column
      - Green if gate passes, red if gate fails; no coloring if no matching gate exists
  - **Issues Overview**: three count tables — by category, severity level, and language — sorted descending by count within each group
- Shows pagination warning for pull requests if more exist
- JSON output bundles all three API responses into a single object, plus a `repository.fileCount` field plucked from `data.coverage.numberTotalFiles` (present on the existing `getRepositoryWithAnalysis` response even when the repo has no coverage data — no extra API call). Omitted when that field is absent
- **`--reanalyze` mode** (`-R`): fetches HEAD commit SHA, calls `RepositoryService.reanalyzeCommitById`; early return
- **`--reanalyze-and-wait` mode** (`-w`): blocking variant — see "Reanalyze and wait" below. Baseline comes from `issuesOverview`; polling reads the repo's first commit via `listRepositoryCommits(limit=1)` analysis timestamps

## ls command (`ls.ts`) and directories command (`directories.ts`)

Repository-level "file browser" commands built on `RepositoryService.listFiles`
and `listDirectories`. `ls` lists directories **and** files at a path;
`directories` (alias `dirs`) lists folders only, with `-c, --plus-children` to
also pull each folder's immediate sub-folders (one extra level).

- **Repo + path resolution**: optional `[provider] [organization] [repository]`
  positionals via `resolveRepoArgs(..., 0, ...)` (auto-detected from the git
  remote when omitted). The listed path comes from `resolveListingPath(options.path, autoDetected)`
  in `utils/repo-tree.ts`: an explicit `--path` wins; otherwise, when the repo
  was auto-detected, the current working directory relative to the git root
  (`getCwdRepoRelativePath` → `git rev-parse --show-toplevel` + `path.relative`);
  otherwise the repo root. `autoDetected = !(provider && organization && repository)`.
- **Fetch-all, no pagination warning (deliberate deviation)**: unlike every other
  paginated command, these two fetch *all* pages (`fetchAllDirectories` /
  `fetchAllFiles` loop over `pagination.cursor`) and do **not** call
  `printPaginationWarning` — the whole listing must be shown. Do not "fix" this
  by adding a warning.
- **Explicit empty-string path**: the repo root is listed by passing `path = ""`
  (not `undefined`). The generated client serializes `""` as `path=`, which the
  API treats as "root, non-recursive"; `undefined` would omit the param and make
  `listFiles` recursive across the whole repo. `fetchAll*` always take a `string`.
- **Row markers (no emojis)**: `▸` (U+25B8) for folders, dim `·` for files.
  `directories --plus-children` renders each child on its own indented row with a
  `└─` connector under its parent (`DirectoryNode.children`).
- **Metric columns**: Name, Grade, Issues, Complexity, Duplication, Coverage.
  Grade via `formatGrade` (A/B green, C yellow, D/E/F red — Codacy folder/file
  grades can be E). Issues/Complexity/Duplication via `formatCountCell`
  (abbreviated, dim `-` when absent). Complexity is `complexity` (for a folder,
  the *highest* file complexity under it — surfaces hotspots — not the
  `complexitySum` total). Duplication is `numberOfClones` (number of cloned
  code blocks, matching Codacy's UI — not `duplication`, which is duplicated
  *lines*). Coverage via `formatCoverageCell` (`coverageWithDecimals`). Only the
  Grade is colored — directory/file items carry no `goals` thresholds, so
  metrics are not threshold-colored.
- **Ordering / `--sort` + `--direction`**: with no sort flags, results are
  sorted client-side by name (directories) / basename (files), ascending. When
  `--sort` or `--direction` is given, ordering is delegated to the API (`sort`/
  `direction` params, order preserved across pages) and the client sort is
  skipped. `resolveSort`/`resolveDirection` (in `repo-tree.ts`) validate the
  values and map them: CLI `name` → API `filename` for the files endpoint;
  `ascending`/`descending` (and `asc`/`desc`) → `asc`/`desc`. In `ls`,
  directories and files are always sorted **independently** and never merged
  (dirs fully paginated + sorted, then files) so the type grouping holds. In
  `directories`, the same sort is applied to the top-level and each
  `--plus-children` listing.
- **`ls --search <term>` (files only)**: `listDirectories` has no `search`, so
  search mode lists files only (directories skipped). The folder scope is folded
  into the search string as `<path>/%<term>` (just `<term>` at the repo root) and
  `path` is **not** sent — otherwise the API would restrict to immediate
  children. Results show each file's full repository-relative path (not just the
  basename), since matches span folders.
- **`directories --plus-children` header**: appends `, M subdirectories` where M
  is the summed count of children across all listed directories.
- **Aliases**: `directories` → `dirs`; `ls` has no alias (already the minimal
  form).
- JSON: `ls` → `{ path, directories, files }`; `directories` → `{ path, directories: [{…, children?}] }`, each item projected via `pickDeep`.

## Shared Formatting Utilities (`utils/formatting.ts`)

Several helpers are shared between `repository.ts` and `pull-request.ts` via `utils/formatting.ts`:
- `printSection(title)` — bold section header
- `truncate(text, max)` — truncate with "..." suffix
- `colorMetric(value, threshold, mode)` — threshold-based coloring (max/min)
- `colorByGate(display, passing)` — green/red based on gate status
- `formatDelta(value, passing)` — +/- signed value with optional gate coloring
- `buildGateStatus(pr)` — maps `resultReasons` gate names to metric columns
- `formatStandards(pr)` — dim `⋯` while `pr.isAnalysing`, else ✓/✗/- from quality + coverage `isUpToStandards`
- `formatPrCoverage(pr, passing)` — diffCoverage% (+/-deltaCoverage%)
- `formatPrIssues(pr, passing)` — +newIssues (colored by gate) / -fixedIssues (always gray). A zero count renders as a bare `0`, no sign — `-0` reads as a negative number, and neither `+0` nor `-0` says anything a plain `0` doesn't (same rule `pull-request.ts`'s Files table and `formatFileDelta` already follow)
- `prQualityMetric(pr, key)` — reads `newIssues`/`fixedIssues`/`deltaComplexity`/`deltaClonesCount`, **preferring `pr.quality[key]` over the flat top-level `pr[key]`**. The API populates the two inconsistently: the pull-request endpoints return `quality.deltaComplexity` but omit the top-level `deltaComplexity` (while still sending a top-level `deltaClonesCount`), so reading the flat field alone made every PR's complexity render as "no data". `quality` is the newer structured shape — same direction as `coverage` vs. the deprecated top-level coverage fields — so it wins, flat field as fallback. Use this instead of `pr.deltaComplexity` / `pr.deltaClonesCount` in any new PR rendering
- `hasAnyPrCoverage(prs)` — true when at least one PR in the list carries a coverage number. Callers listing many PRs use it to drop the Coverage column when the repo has no coverage set up (the API returns `diffCoverage.cause` and no values). Lives next to `formatPrCoverage` so both agree on what counts as "has data"

**Empty-metric convention:** `formatDelta`, `formatPrCoverage`, and `formatPrIssues` render missing values as a dim `-`, matching `formatStandards`, `formatCountCell`, and `formatCoverageCell`. `N/A` is still used elsewhere in the CLI for non-metric fields (grades, dates, author names, default branch) — new metric rendering should use `-`.

Dependency-chain helpers shared between `findings.ts` (list) and `finding.ts` (detail):
- `formatVersionSegment(affectedVersion, fixedVersion, { includeUpdatePrefix })` — the `affected → fixed` status-line segment shown when a finding has no dependency chains; `includeUpdatePrefix` prepends `Update ` (list uses it, detail doesn't); returns `null` when there's no affected version
- `formatDependencyChain(chain)` — joins a chain with ` → `, collapsing the middle to `<first> → ... N more ... → <last>` when it has 4+ packages (≤ 3 shown in full)
- `formatDependencyChainsLine(chains, fixedVersion)` — one-line list summary: first chain with its Direct/Transitive label + `... and N more`; returns `null` for no chains
- `formatDependencyChainsBlock(chains, fixedVersion)` — multi-line detail block: all chains, label shown once, continuation lines aligned under the label; returns `null` for no chains

Advisory-information helpers shared between `issue.ts`/`pull-request.ts` (via `CommitIssue.advisoryInformation`) and `finding.ts`/`findings.ts` (via `SrmItem.advisoryInformation`) — same `AdvisoryInformation` shape from either source:
- `summarizeFunctions(fns, limit = 3)` — compact `fn1, fn2 (+N more)` string for card views (`issue`/`pull-request` cards, `findings` list)
- `printAdvisoryBlock(advisory)` — full detail block: bold `Vulnerable Functions (<advisoryId>)` header, optional `Published:` date, one bullet per function; used by `printIssueCodeContext` (issue detail views) and directly by `finding.ts` when there's no linked Codacy issue to render it via that path

Pattern helpers shared between `patterns.ts` (list) and `pattern.ts` (single info):
- `printPatternCard(cp)` — the configured-pattern card (icons, enforced-by line, metadata, why/how, parameters)
- `PATTERN_JSON_FIELDS` — `pickDeep` paths for the JSON projection of a `ConfiguredPattern`
- `patternEnforcedBy(cp)` — coding-standard names from `cp.enabledBy` (empty = not enforced)

## pattern / patterns commands — config-file & coding-standard guards

Patterns can be unmodifiable for two reasons, surfaced consistently across
`pattern`, `patterns`, and the `issues --overview` noise suggestions:

- **Local configuration file** — `tool.settings.usesConfigurationFile` (from
  `listRepositoryTools`). The tool's patterns are overwritten by the file, so
  the API can't list or change them.
- **Coding-standard enforcement** — a `ConfiguredPattern.enabledBy` array with
  entries. The pattern is managed in the standard, not at repo level.

There is no single-pattern endpoint, so a pattern is looked up via
`listRepositoryToolPatterns(search=<patternId>)` filtered to the **exact** ID
match. Modify-mode refusals (`pattern --enable/--disable/--parameter`, and
`patterns --enable-all/--disable-all`) print the reason and `process.exit(1)`;
info/list displays print a notice and exit 0.

## Reanalyze and wait (`utils/reanalyze-wait.ts`)

Shared by the `repository` and `pull-request` `--reanalyze-and-wait` (`-w`) modes.
Keeps the two command handlers thin: they only supply the API-specific callbacks
(get HEAD SHA, fetch baseline/after snapshot, `getStatus`).

- **Snapshots**: `IssueSnapshot { total, bySeverity, byCategory, byPattern }`.
  `snapshotFromOverview()` (repo) builds independent dimension counts and pattern
  buckets with **no** category/severity. `snapshotFromPrIssues()` (PR) tallies the
  same dimensions from the raw issue list and **annotates** each pattern bucket
  with its category + severity.
- **`diffSnapshots(before, after)`**: signed **net** deltas per dimension (drops
  unchanged buckets). Severity sorted Critical→Minor; category/pattern sorted by
  |delta|. The overview can't decompose net change into added-vs-removed, so the
  report shows net deltas, not a literal "new/resolved" split or a cross-tab.
- **`pollForAnalysis(getStatus, opts)`**: two-phase loop — wait for a new analysis
  to start (or detect it already finished), then wait for it to finish. `getStatus`
  returns the first commit's `{ startedAnalysis, endedAnalysis }` (from the `/commits`
  endpoint). In-progress = `startedAnalysis` more recent than both `endedAnalysis`
  and `triggeredAt` (t0); done = `startedAnalysis` after t0 and `endedAnalysis` ≥
  `startedAnalysis` (helpers `isAnalysisInProgress`/`isAnalysisDone`). Comparing to
  t0 ensures we track *our* analysis, not a stale one. Returns `{ status, timedOut }`.
  Defaults: `POLL_INTERVAL_MS=10s`, `MAX_WAIT_MS=20min`.
- **`timers.sleep`**: polling delay wrapped in an exported object so tests stub it
  (`vi.spyOn(timers, "sleep").mockResolvedValue()`) for instant polling. Drive the
  poll loop in command tests with sequential `mockResolvedValueOnce` status values;
  use the optional `now` injection in `pollForAnalysis` to unit-test the timeout.
- **Non-TTY progress**: ora's spinner text never reaches a piped/non-interactive
  stderr, so silent CI/agent shells (e.g. Gemini CLI) can kill the process as
  hung. When `!process.stderr.isTTY` (injectable via `opts.isTTY`), the loop
  writes `elapsed <N>m, status=<waiting|inProgress>` to stderr every
  `PROGRESS_INTERVAL_MS` (60s) instead. TTY output is unchanged.
- **Rendering**: `renderReanalyzeReport(delta, durationMs)` prints the
  `Analysis finished in <duration>` headline + By pattern / By severity /
  By category lists (pattern rows soft-capped at `PATTERN_LIMIT=20`) + an
  `In total: before → after (net ±N)` line. `reanalyzeJson()` is the `--output json`
  payload. `durationFromStatus()` derives the duration from commit timestamps.

## issue command (`issue.ts`)

- Takes `<provider>`, `<organization>`, `<repository>`, and `<issueId>` (the numeric `resultDataId` shown on issue cards) as required arguments
- Fetches the issue, pattern info, and ±5 lines of file context in parallel
- **Default mode**: displays full issue detail — header, code context, false positive warning, pattern documentation
- **`--ignore` mode** (`-I`): calls `AnalysisService.updateIssueState` with `{ ignored: true, reason, comment }`; skips rendering issue details
  - `-R, --ignore-reason`: `AcceptedUse` (default) | `FalsePositive` | `NotExploitable` | `TestCode` | `ExternalCode`
  - `-m, --ignore-comment`: optional free-text comment
- **`--unignore` mode** (`-U`): calls `AnalysisService.updateIssueState` with `{ ignored: false }`; skips rendering issue details
- The API uses the string UUID (`issue.issueId`), not the numeric `resultDataId`, for the `updateIssueState` call

## issues command (`issues.ts`)

- Takes `<provider>`, `<organization>`, and `<repository>` as required arguments
- **List mode** (default): card-style format sorted by severity (Error > High > Warning > Info)
- **Overview mode** (`-O, --overview`): seven count tables — Category, Severity, Language, Tag, Pattern, Author, False Positives
  - The False Positives table relabels the API's raw bucket names via `FALSE_POSITIVE_LABELS`: `belowThreshold` → "Not a False Positive", `equalOrAboveThreshold` → "Potential False Positive" (the threshold is on FP probability, so at/above = potential FP — matching `printIssueCard`)
  - **Noise suggestions**: after the tables, `detectNoisyPatterns()` flags noisy patterns, sorted by count desc. A pattern must clear **two absolute floors** and show a **relative signal**: (1) the repo must have at least `NOISE_MIN_TOTAL` (200) issues total, else the whole section is suppressed — kept above `NOISE_MIN_PATTERN` so it does independent work (were they equal, any pattern clearing the per-pattern floor would already push the repo past an equal total floor, making it dead code); (2) the individual pattern must have at least `NOISE_MIN_PATTERN` (100) issues — this AND-gate is what stops a long tail of tiny patterns (which drags the median to ~3) from making a 9-issue pattern look "3× the median"; (3) *and* it must either account for ≥`NOISE_SHARE` (10%) of all issues **or** have ≥`NOISE_MEDIAN_MULTIPLE` (3×) the **median** issues-per-pattern. The share rule only applies when there are at least `NOISE_MIN_PATTERNS_FOR_SHARE` (11) distinct patterns — an even split of N patterns gives each `1/N`, which only drops below 10% once N > 10, so with 8–10 patterns a perfectly balanced repo would otherwise flag every pattern. The median (not the mean, via `medianOf()`) is deliberate: a single huge pattern would inflate a mean baseline and mask smaller-but-still-disproportionate patterns. For each noisy pattern, `resolvePatternTool()` maps the pattern ID to its owning tool by matching `Tool.prefix` (e.g. `Bandit_B101` → prefix `Bandit_`; longest match wins) against the global tool list (`fetchAllTools()` / `ToolsService.listTools`). Resolved ones print a `> codacy pattern <tool> <patternId> --disable` line under "Suggested actions to reduce noise". Patterns whose tool can't be resolved (no/unmatched prefix) are **silently discarded**. The tools fetch only happens when noisy patterns exist; JSON output is unaffected (raw counts only)
- **Filters**: `--branch`, `--patterns`, `--tools`, `--severities`, `--categories`, `--languages`, `--tags`, `--authors`, `--limit`
- **`--false-positives [value]`** (`-F`): tri-state filter — `true` (default when flag present) sends `onlyPotentialFalsePositives: true`, `false` sends `onlyPotentialFalsePositives: false`, omitted sends nothing
- **`--ignore` mode** (`-I`): fetches all issues matching current filters (all pages), then calls `AnalysisService.bulkIgnoreIssues` in batches of 100
  - `-R, --ignore-reason`: `AcceptedUse` (default) | `FalsePositive` | `NotExploitable` | `TestCode` | `ExternalCode`
  - `-m, --ignore-comment`: optional free-text comment
  - **Confirmation** (`-y, --skip-confirmation`): the ignore is destructive and applies to *all* matching issues, so `executeBulkIgnore` prompts via `confirmAction` (shared `utils/prompt.ts`) after printing the count, and only proceeds on an explicit `y`. `--skip-confirmation` skips the prompt for CI/scripts. `confirmAction` returns `false` on a non-TTY, so a non-interactive run without the flag aborts rather than ignoring by accident. Same `-y` short flag as `tools --import`'s `--skip-approval`. Confirmation happens *after* fetching (so the count is shown) but *before* any `bulkIgnoreIssues` call
  - Cannot be combined with `--overview` or `--limit`
  - Works with any combination of filters; use `--false-positives --ignore` to ignore only FP issues
- **`--ignored` mode** (`-i`): boolean flag that lists ignored issues instead of active ones. Modeled as a boolean flag for consistency with the other boolean filter, `--false-positives` (not a `--state <value>` selector). `-i` is the natural short flag; note it is distinct from `-I/--ignore` (the bulk-ignore *action*) — `-i` lists already-ignored issues, `-I` ignores matching active ones. Omitting the flag keeps the existing active-issues behavior unchanged
  - `--ignored` calls `AnalysisService.searchRepositoryIgnoredIssues` (dedicated `.../ignoredIssues/search` endpoint), reusing `buildFilterBody` — every base filter passes through unchanged — and the same paginate-to-`--limit` loop + pagination warning as list mode
  - Guards: errors when combined with `--overview` (no ignored-issues overview endpoint) or `--ignore` (those issues are already ignored). `--false-positives` is intentionally **allowed** — it's part of the shared filter body, so "ignored issues that are potential false positives" is a valid query
  - Rendered via `printIgnoredIssueCard` (in `utils/formatting.ts`): a variant of `printIssueCard` because `IgnoredIssue` has no numeric `resultDataId` (shows the string `issueId` instead) and carries ignore metadata — the trailing `Ignored as <reason> by <name> · <friendly date>` line plus an optional `Comment:` line
  - View-only: unignoring stays with `issue --unignore` (there is no bulk-unignore endpoint; it would be N per-issue `updateIssueState` calls — a possible fast-follow since `IgnoredIssue` carries the string `issueId`)
  - JSON: `{ ignoredIssues: [...] }`, each item projected via `pickDeep` (`issueId`, `reason`, `comment`, `ignoredByName`, `ignoredTimestamp`, `patternInfo.*`, `filePath`, `lineNumber`, `lineText`, `falsePositive*`)

## finding command (`finding.ts`)

- Takes `<provider>`, `<organization>`, and `<findingId>` (UUID shown on finding cards) as required arguments — **no `<repository>` argument**
- Fetches the security item; for Codacy-source findings, also fetches the linked quality issue, pattern, and file context
- Fetches CVE enrichment in parallel when the finding has a `cve` field
- **Default mode**: displays full finding detail — header, prose fields, code context (Codacy-source only), CVE block
- **`--ignore` mode** (`-I`): calls `SecurityService.ignoreSecurityItem` with `{ reason, comment }`; skips rendering finding details
  - `-R, --ignore-reason`: `AcceptedUse` (default) | `FalsePositive` | `NotExploitable` | `TestCode` | `ExternalCode`
  - `-m, --ignore-comment`: optional free-text comment
- **`--unignore` mode** (`-U`): calls `SecurityService.unignoreSecurityItem`; skips rendering finding details
- **Dependency import chains** (SCA findings): when `item.dependencyChains` (`string[][]`) is present, both `finding` (detail) and `findings` (list) render the vulnerable dependency's import path. A chain with a single package is a **direct** dependency (`Direct - Update <pkg> to <fixedVersion>`); 2+ packages is **transitive** (`Transitive - <chain> (Fixed in <fixedVersion>)`). Chains with **4+ packages** collapse the middle to `<first> → ... N more ... → <last>` (N = length − 2). The list shows only the first chain + `... and X more`; the detail lists **all** chains with the Direct/Transitive label shown once and continuation lines indented so the `-` aligns. When chains are present, the redundant `AffectedVersion → FixedVersion` segment is dropped from the status line. Mixed direct/transitive chains (rare) take their label from the first chain. Rendering lives in `formatDependencyChainsLine` / `formatDependencyChainsBlock` (see Shared Formatting Utilities).
- **Vulnerable functions** (`item.advisoryInformation`, both `finding` and `findings`): `findings` (list) shows the compact `Vulnerable functions: fn1, fn2 (+N more)` line via `summarizeFunctions` (same helper `issue`/`pull-request`'s card view uses). `finding` (detail) shows the full `printAdvisoryBlock` — but **only when there is no linked Codacy issue**; when there is one, `printIssueCodeContext` already renders the equivalent block from `issue.advisoryInformation`, so `finding` skips its own to avoid a duplicate. This is what makes vulnerable functions visible for SCA/dependency findings (and any other non-Codacy-source finding), which have no linked issue to borrow the block from at all.

## pull-request command (`pull-request.ts`)

- Takes `<provider>`, `<organization>`, `<repository>`, and `<prNumber>` as required arguments
- Action modes are mutually exclusive and checked in this order: `--ignore-issue`, `--ignore-all-false-positives`, `--unignore-issue`, `--issue`, `--diff`, default
- **Default mode**: calls four API endpoints in parallel:
  - `getRepositoryPullRequest` — PR metadata + analysis summary
  - `listPullRequestIssues` (status=new, onlyPotential=false) — new confirmed issues
  - `listPullRequestIssues` (status=new, onlyPotential=true) — new potential issues
  - `listPullRequestFiles` — files with metric deltas
- Displays a multi-section view:
  - **About**: provider/org/repo, PR number + title, status, author, branches (origin → target), updated (friendly date), head commit SHA
  - **Analysis**: analyzing status, up-to-standards (✓/✗ computed from quality + coverage), issues, coverage, complexity, duplication — all colored by gate status
    - Gate failure/pass reasons shown inline next to the metric (e.g. "Fails <= 2 warning issues", "Fails <= 0 security issues")
    - "To check" hints shown inline when a gate is configured but the metric has no data yet (e.g. "To check >= 50% coverage")
    - Security gates (`securityIssueThreshold`) are handled explicitly — not falling through to generic formatting
  - **Issues**: single merged list of confirmed + potential issues, card-style format (not a table), sorted by severity (Error > High > Warning > Info)
    - Each card shows: colored severity | category + subcategory | POTENTIAL (if potential issue)
    - Message, file:line, line content
    - Severity colors: Error=red, High=orange (#FF8C00), Warning=yellow, Info=blue
    - False positive detection: if `falsePositiveProbability >= falsePositiveThreshold`, shows "Potential false positive: {reason}" below line content
  - **Files**: table showing only files with any metric delta change
    - File path (truncated at 50), issues (new red, fixed green), coverage delta, complexity delta, duplication delta
    - Zero values shown in gray without +/- sign; N/A also gray
- Shows pagination warnings for issues and files
- JSON output bundles PR data, new issues, potential issues, and files
- **`--ignore-issue <id>` mode** (`-I`): fetches all PR issues (new + potential, paginated), finds by `resultDataId`, calls `updateIssueState` with `{ ignored: true, reason, comment }`
  - Supports `-R/--ignore-reason` (default: `AcceptedUse`) and `-m/--ignore-comment`
- **`--ignore-all-false-positives` mode** (`-F`): fetches all potential false positive issues (onlyPotential=true, paginated), ignores them all in parallel with hardcoded reason `FalsePositive`; supports `-m/--ignore-comment`
- **`--unignore-issue <id>` mode** (`-U`): same lookup as `--ignore-issue`, calls `updateIssueState` with `{ ignored: false }`
- **`--reanalyze` mode** (`-A`): fetches PR data to get `headCommitSha`, calls `RepositoryService.reanalyzeCommitById`; early return
- **`--reanalyze-and-wait` mode** (`-w`): blocking variant — see "Reanalyze and wait" below. Baseline comes from paging `listPullRequestIssues(status="new")`; polling reads the PR's first commit via `getPullRequestCommits(limit=1)` analysis timestamps
- **Analysis status in About**: replaced "Head Commit" with "Analysis" row using `formatAnalysisStatus()` from `utils/formatting.ts`; fetches `getPullRequestCommits(limit=1)` and `listCoverageReports(limit=1)` in parallel with existing calls

## pull-requests command (`pull-requests.ts`)

The plural counterpart to `pull-request` — lists PRs for a repository instead of showing one by number.

- Takes `[provider] [organization] [repository]` — all optional, auto-detected from the git remote via `resolveRepoArgs(..., 0, ...)` when omitted (same pattern as `repository`/`ls`/`directories`), unlike `findings`' older hand-rolled arg-count branching
- `-q, --search <text>` and `-B, --base <name>` map to `AnalysisService.listRepositoryPullRequests`'s `textQuery`/`targetBranch` params (added server-side in OD-376, on the same `57.3.9` client bump that also brought `SrmItem.advisoryInformation`). `-q, --search` matches `findings`/`patterns`'s flag for the same free-text concept; `--base` (not `--branch`) avoids colliding with `-b, --branch`'s different meaning ("the analysed branch") in `ls`/`directories`/`issues` — this command's branch filter is the PR's *target* branch, a different axis
- `-S, --state <state>` (`open` default, or `closed`) always passes an explicit value for the endpoint's own `search` classification param — `open` → `"last-updated"`, `closed` → `"merged"` (the API's actual enum value, but named `closed` on the CLI since that classification also returns closed-but-not-merged PRs, so `"merged"` would mislabel it). Passing `undefined` here would return closed/merged PRs mixed into an "open" list with no Status column to tell them apart — the same problem `repository.ts`'s Open Pull Requests table works around with a client-side `status === "open" || "Open"` filter
- `-n, --limit <n>` (default 100, max 1000) with the same paginate-to-limit loop as `findings`, extracted into a local `fetchPullRequests()` helper: request `pageSize = min(limit, 100)`, follow `pagination.cursor`, stop once `items.length >= limit`, then trim to the exact limit. Returns `hasMore` (whether a `cursor` was still set) alongside `items`/`total` — the pagination-warning check is `total > items.length || hasMore`, not `total` alone, since the API can omit `pagination.total` (falls back to `items.length`, which would otherwise always read as "no more pages" even with a live cursor). `findings.ts` had the same latent bug (same loop shape, copied from here) fixed at the same time
- Table columns (`✓`, `#`, Title, Branches, Issues, Complexity, Duplication, Coverage, Updated): Issues/Complexity/Duplication/Coverage reuse the **same shared helpers** `repository`'s "Open Pull Requests" table uses (`buildGateStatus`, `formatPrIssues`, `formatPrCoverage`, `formatDelta`). `✓` leads the row — the gate verdict is what you scan a PR list for — and the four metrics follow the `repositories` command's order (issues → complexity → duplication → coverage) so they read the same way across the CLI. Branches shows `originBranch → targetBranch` (truncated 30, same pairing as `pull-request.ts`'s About section) rather than either alone — disambiguates against `repository.ts`'s Open PR table, which shows `originBranch` alone under the same "Branch" header. `✓` uses `formatStandards()`, now shared-fixed to show a dim `⋯` while `isAnalysing` is true instead of falling through to a hard ✗ on gate data that isn't final yet (also benefits `repository`/`pull-request`'s uses of the same helper)
- **Coverage column is dropped entirely** when `hasAnyPrCoverage()` is false — a repo with no coverage set up returns `diffCoverage.cause` (`MissingRequirements`) and no numbers on *any* PR, so the column would render as nothing but `-`. Both the header and the cells are spread conditionally
- JSON whitelist: `pullRequest.originBranch`/`targetBranch` (both rendered via Branches), `coverage.isUpToStandards`/`quality.isUpToStandards` (needed to reproduce the ✓ column — `formatStandards` reads exactly these two), the `quality.*` metric mirrors (`newIssues`/`fixedIssues`/`deltaComplexity`/`deltaClonesCount` — what the table actually renders, see `prQualityMetric` below), and `quality.resultReasons`/`coverage.resultReasons` (they drive the per-metric gate coloring, so JSON consumers need them to tell which gate passed or failed). No `pullRequest.status`/`owner.name` (neither rendered anywhere in the table)
- Shows pagination warning (suggesting `--limit`, `--search`, `--base`, `--state`) when more results exist than were fetched, same as `findings`

## JSON Output Filtering (`pickDeep`)

All commands that output JSON now filter their response using `pickDeep(data, paths)` from `utils/output.ts`. This ensures the JSON output only includes fields that correspond to what's shown in the console table/card output.

**Pattern for new commands:**
```typescript
if (format === "json") {
  printJson(pickDeep(data, [
    "field.nested.path",
    "another.field",
  ]));
  return;
}
```

**For arrays of items**, map each item through `pickDeep`:
```typescript
printJson(items.map((item: any) => pickDeep(item, [...])));
```

**Special rules for JSON output:**
- Commit SHAs: include the full SHA (not truncated)
- Dates: include full ISO timestamps (not formatted)
- IDs: only include IDs already shown in console output
