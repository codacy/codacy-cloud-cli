# Commands Design Decisions

## Structure

Each command is a single file that exports a `register<Name>Command(program: Command)` function. Commands are registered in `src/index.ts`.

## Command Aliases

Every command must declare a short alias via `.alias()`. Keep aliases short (2–4 characters) and intuitive:
- `repositories` → `repos`
- `repository` → `repo`
- `pull-request` → `pr`
- `issues` → `is`

## Option Short Flags

Every command option must have both a short flag and a long flag: `-X, --long-name <value>`. Pick single letters that are intuitive and don't conflict with Commander's built-in flags (`-V/--version`, `-h/--help`) or the global `-o/--output` option. When the natural letter is already taken, use uppercase (e.g. `-O, --overview` instead of `-o`).

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
- JSON output bundles all three API responses into a single object

## Shared Formatting Utilities (`utils/formatting.ts`)

Several helpers are shared between `repository.ts` and `pull-request.ts` via `utils/formatting.ts`:
- `printSection(title)` — bold section header
- `truncate(text, max)` — truncate with "..." suffix
- `colorMetric(value, threshold, mode)` — threshold-based coloring (max/min)
- `colorByGate(display, passing)` — green/red based on gate status
- `formatDelta(value, passing)` — +/- signed value with optional gate coloring
- `buildGateStatus(pr)` — maps `resultReasons` gate names to metric columns
- `formatStandards(pr)` — ✓/✗/- from quality + coverage `isUpToStandards`
- `formatPrCoverage(pr, passing)` — diffCoverage% (+/-deltaCoverage%)
- `formatPrIssues(pr, passing)` — +newIssues (colored by gate) / -fixedIssues (always gray)

## issue command (`issue.ts`)

- Takes `<provider>`, `<organization>`, `<repository>`, and `<issueId>` (the numeric `resultDataId` shown on issue cards) as required arguments
- Fetches the issue, pattern info, and ±5 lines of file context in parallel
- **Default mode**: displays full issue detail — header, code context, false positive warning, pattern documentation
- **`--ignore` mode** (`-I`): calls `AnalysisService.updateIssueState` with `{ ignored: true, reason, comment }`; skips rendering issue details
  - `-R, --ignore-reason`: `AcceptedUse` (default) | `FalsePositive` | `NotExploitable` | `TestCode` | `ExternalCode`
  - `-m, --ignore-comment`: optional free-text comment
- **`--unignore` mode** (`-U`): calls `AnalysisService.updateIssueState` with `{ ignored: false }`; skips rendering issue details
- The API uses the string UUID (`issue.issueId`), not the numeric `resultDataId`, for the `updateIssueState` call

## finding command (`finding.ts`)

- Takes `<provider>`, `<organization>`, and `<findingId>` (UUID shown on finding cards) as required arguments — **no `<repository>` argument**
- Fetches the security item; for Codacy-source findings, also fetches the linked quality issue, pattern, and file context
- Fetches CVE enrichment in parallel when the finding has a `cve` field
- **Default mode**: displays full finding detail — header, prose fields, code context (Codacy-source only), CVE block
- **`--ignore` mode** (`-I`): calls `SecurityService.ignoreSecurityItem` with `{ reason, comment }`; skips rendering finding details
  - `-R, --ignore-reason`: `AcceptedUse` (default) | `FalsePositive` | `NotExploitable` | `TestCode` | `ExternalCode`
  - `-m, --ignore-comment`: optional free-text comment
- **`--unignore` mode** (`-U`): calls `SecurityService.unignoreSecurityItem`; skips rendering finding details

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
- **Analysis status in About**: replaced "Head Commit" with "Analysis" row using `formatAnalysisStatus()` from `utils/formatting.ts`; fetches `getPullRequestCommits(limit=1)` and `listCoverageReports(limit=1)` in parallel with existing calls

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
