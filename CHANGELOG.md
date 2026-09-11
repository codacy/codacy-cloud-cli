# @codacy/codacy-cloud-cli

## 1.11.0

### Minor Changes

- [#48](https://github.com/codacy/codacy-cloud-cli/pull/48) [`e58f17a`](https://github.com/codacy/codacy-cloud-cli/commit/e58f17a7cab60acd9e4e15fd9d518407017fcfcb) Thanks [@alerizzo](https://github.com/alerizzo)! - Show the repository's coverage **status**, not just its percentage.

  Codacy now reports whether a repository's coverage is up to date, still waiting
  on a report, has stopped receiving them, or was never set up — and the CLI can
  tell those apart:

  - `codacy repos` marks a repository whose latest commit has no report yet with a
    dim `⋯` after its last known value, and shows a dim `⊘` instead of a number
    for one that has stopped receiving reports. A legend under the table explains
    only the states actually present in the listing.
  - `codacy repo`'s Metrics section spells the same states out, with the date and
    commit of the last report, and notes when a stopped repository's coverage gate
    is no longer being enforced. A repository that never had coverage now reads
    `Not set up` rather than a bare `N/A`.
  - `codacy repo`'s Analysis row reads coverage state from the API's own status
    field instead of inferring it from a separate request. This fixes repositories
    that were reported as healthy while showing a stale percentage, drops one
    request per run, and makes the coverage state available under a repository
    token for the first time.

  `--output json` gains `coverage.status`, `coverage.lastCommitWithCoverage`,
  `coverage.statusUpdatedAt` and `coverage.valueUpdatedAt` on both commands. Under
  a repository token, `codacy repo`'s `unavailable` array is now `["pullRequests"]`
  only.

- [#45](https://github.com/codacy/codacy-cloud-cli/pull/45) [`e21f321`](https://github.com/codacy/codacy-cloud-cli/commit/e21f321c28ef2963a7bd0ee9cfdabb2666d15c46) Thanks [@alerizzo](https://github.com/alerizzo)! - New `-k, --matches-stack [value]` filter on `codacy patterns`, which narrows a tool's code patterns to those that do (or don't) match the repository's detected stack.

  It's a tri-state flag, the same shape as `issues --false-positives`:

  ```bash
  codacy patterns eslint9 --matches-stack          # only patterns matching the repo stack
  codacy patterns eslint9 --matches-stack true     # same
  codacy patterns eslint9 --matches-stack false    # only patterns that don't match
  codacy patterns eslint9                          # unfiltered
  ```

  The filter applies in bulk mode too, so `--enable-all` / `--disable-all` can be scoped to the stack:

  ```bash
  codacy patterns eslint9 --disable-all --matches-stack false
  ```

  The summary printed after a bulk update still reports counts for the whole tool, not just the updated subset.

  Only `true` and `false` are accepted as values. Because Commander's optional-value syntax consumes the next token, a lax parser would let `codacy patterns gh org repo --matches-stack eslint` silently swallow the tool name and then fail with a confusing positional-count error; the flag now rejects non-boolean values with a message that says what to do instead.

## 1.10.0

### Minor Changes

- [#43](https://github.com/codacy/codacy-cloud-cli/pull/43) [`3b215b3`](https://github.com/codacy/codacy-cloud-cli/commit/3b215b3e42344eaefd094ce83e9d42e49f086aa1) Thanks [@alerizzo](https://github.com/alerizzo)! - Add HTTP/HTTPS proxy and TLS support, so the CLI works behind a corporate proxy ([#40](https://github.com/codacy/codacy-cloud-cli/issues/40)).

  Every command now honors the standard environment variables:

  - `HTTPS_PROXY` / `HTTP_PROXY` (and lowercase) — proxy URL per scheme; a bare `host:port` is accepted
  - `NO_PROXY` / `no_proxy` — hosts that bypass the proxy (`*`, `.suffix`), matched per request
  - `SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS` — PEM CA bundle for a TLS-intercepting proxy
  - `CODACY_CLI_INSECURE` — disable TLS verification as a last resort (warns on stderr)

  These are the same variable names the Codacy Analysis CLI and the Codacy VS Code extension use, so one environment configures all of them. The implementation is the shared `configureProxy()` from `@codacy/tooling` rather than a local reimplementation, which is what keeps the behavior identical across the tools. Misconfiguration fails immediately rather than silently doing something else: an unreadable or non-PEM CA bundle reports the path instead of quietly falling back to the default trust store, and a malformed proxy URL reports which variable was wrong and why (with any proxy password redacted) instead of a bare `Invalid URL`.

  Nothing changes when no proxy variable is set — the proxy dependency is loaded lazily, so an unproxied run has no measurable overhead.

  Thanks to @rattalur for reporting the gap and for the initial implementation in [#39](https://github.com/codacy/codacy-cloud-cli/issues/39).

## 1.9.0

### Minor Changes

- [#37](https://github.com/codacy/codacy-cloud-cli/pull/37) [`402edd8`](https://github.com/codacy/codacy-cloud-cli/commit/402edd8d7bc8260cce9951da357e7b410ec2b219) Thanks [@alerizzo](https://github.com/alerizzo)! - Add repository (project) token support

  You can now authenticate with a **repository token** — scoped to a single repository — instead of a personal account API token that reaches every organization and repository you can see. This is the right credential for CI and for the auto-configuration agent: if it leaks, the blast radius is one repository.

  ```bash
  codacy tools --repository-token <your-repository-token>
  # or, for a whole CI job:
  export CODACY_PROJECT_TOKEN=<your-repository-token>
  ```

  Get one from **Codacy > Repository > Settings > Integrations > Project API token**. The new `--repository-token <token>` flag is accepted by every command, and `CODACY_PROJECT_TOKEN` is picked up automatically.

  **Token precedence** (identical to the Codacy Analysis CLI): `--repository-token` > `CODACY_PROJECT_TOKEN` > `CODACY_API_TOKEN` > stored `codacy login`. An explicit `--repository-token` wins outright, so a deliberately scoped run is never silently widened. Note that `CODACY_PROJECT_TOKEN` outranks `CODACY_API_TOKEN` — unset it if you want your account token used.

  **Not every command accepts a repository token**, because Codacy only honours them on a limited set of repository-scoped operations:

  - **Fully supported:** `tools`, `tool`, `patterns`, `pattern`, `issues` (including `--overview`), `tools --import`, `repository --reanalyze` / `--reanalyze-and-wait`.
  - **Partially supported:** `repository` works but omits the pull request and coverage sections. In `--output json`, `pullRequests` stays an empty array and a new `unavailable: ["pullRequests"]` field marks what couldn't be fetched. Output under an account token is unchanged.
  - **Account token required:** `info`, `repositories`, `ls`, `directories`, `pull-request`, `pull-requests`, `issue`, `findings`, `finding`, `issues --ignore`/`--ignored`, `tools --import --force`, and `repository`'s `--add`/`--remove`/`--follow`/`--unfollow`/`--link-standard`/`--unlink-standard`.

  Unsupported combinations now fail immediately with a message naming the operation, why a repository token can't perform it, and which token is in use — instead of sending a request that comes back as a bare `Unauthorized`.

  `codacy login` continues to store account tokens only; repository tokens are passed per command or via the environment.

  Also fixed: `codacy repository` no longer loses the entire dashboard when the pull request lookup fails, and `codacy login` no longer reports a repository token as "invalid" when it is rejected for being the wrong kind of token.

## 1.8.0

### Minor Changes

- [#35](https://github.com/codacy/codacy-cloud-cli/pull/35) [`72a4d3b`](https://github.com/codacy/codacy-cloud-cli/commit/72a4d3b2f3a7572108f8b297b49ef8ba76c48718) Thanks [@pedrobpereira](https://github.com/pedrobpereira)! - New `pull-requests` (`prs`) command: lists pull requests for a repository, with the same analysis-gated columns as `repository`'s "Open Pull Requests" table. `-q, --search` and `-B, --base` filter by free text (title/author handle) and target branch, mapping to the API's `textQuery`/`targetBranch` params; `-S, --state` filters by open (default) or closed.

### Patch Changes

- [#35](https://github.com/codacy/codacy-cloud-cli/pull/35) [`72a4d3b`](https://github.com/codacy/codacy-cloud-cli/commit/72a4d3b2f3a7572108f8b297b49ef8ba76c48718) Thanks [@pedrobpereira](https://github.com/pedrobpereira)! - Fix `findings`'s pagination warning silently not firing when the API response omits `pagination.total`: the guard now also checks for a remaining `cursor`, so a trailing page of results is no longer hidden from the `--limit` hint.

- [#35](https://github.com/codacy/codacy-cloud-cli/pull/35) [`72a4d3b`](https://github.com/codacy/codacy-cloud-cli/commit/72a4d3b2f3a7572108f8b297b49ef8ba76c48718) Thanks [@pedrobpereira](https://github.com/pedrobpereira)! - `formatStandards()` (used by `repository`'s Open Pull Requests table, `pull-request`'s Up to Standards row, and `pull-requests`' ✓ column) now shows a dim `⋯` while a pull request is still being analysed, instead of falling through to a hard ✗ on gate data that isn't final yet.

- [#35](https://github.com/codacy/codacy-cloud-cli/pull/35) [`72a4d3b`](https://github.com/codacy/codacy-cloud-cli/commit/72a4d3b2f3a7572108f8b297b49ef8ba76c48718) Thanks [@pedrobpereira](https://github.com/pedrobpereira)! - Fix PR complexity showing as no data, and polish the `pull-requests` table. Complexity is now read from the API's nested `quality` object, which is where the pull-request endpoints actually return it — `pull-requests`, `pull-request` and `repository` all previously rendered it as empty. The `pull-requests` table now leads with the up-to-standards column, orders metrics the same way `repositories` does (issues, complexity, duplication, coverage), hides the Coverage column when no listed PR has coverage data, shows `-` instead of `N/A` for metrics with no value, and no longer signs a zero issue count (`0` instead of `-0`). `--output json` now includes the quality and coverage `resultReasons`, so consumers can see which gates passed or failed.

## 1.7.0

### Minor Changes

- [#34](https://github.com/codacy/codacy-cloud-cli/pull/34) [`c26ff79`](https://github.com/codacy/codacy-cloud-cli/commit/c26ff795df60e9cc8b54a7ab782fa80bffb12e62) Thanks [@pedrobpereira](https://github.com/pedrobpereira)! - `issue`, `issues`, `pull-request --issue`, `finding`, and `findings` now show vulnerable/affected functions for SCA issues and findings with a linked OSV advisory (`CommitIssue.advisoryInformation` / `SrmItem.advisoryInformation`). Card views show a compact one-line summary; detail views show the full list with advisory ID and published date. Included in `--output json` for all five commands.

### Patch Changes

- [#30](https://github.com/codacy/codacy-cloud-cli/pull/30) [`12c1a33`](https://github.com/codacy/codacy-cloud-cli/commit/12c1a332f41163298344e794bf6ce2dee4a95366) Thanks [@alerizzo](https://github.com/alerizzo)! - Neutralize terminal control characters in human-readable output (CWE-150).
  Repository-derived values shown by the CLI — PR and finding titles, author
  names, branches, file paths, diff and file content, issue messages, and package
  names — are now stripped of ANSI/OSC escape and other control bytes before being
  printed, so a crafted pull request can no longer repaint or hide findings, spoof
  gate status, or trigger terminal side effects (e.g. clipboard writes) when you
  run the CLI against it. Offending bytes are shown in visible caret notation
  (e.g. `^[`) instead of being interpreted. `--output json` is unaffected — it
  still returns the original values, escaped by JSON encoding.

- [#34](https://github.com/codacy/codacy-cloud-cli/pull/34) [`c26ff79`](https://github.com/codacy/codacy-cloud-cli/commit/c26ff795df60e9cc8b54a7ab782fa80bffb12e62) Thanks [@pedrobpereira](https://github.com/pedrobpereira)! - Sanitize vulnerable/affected function names and the advisory ID (`CommitIssue.advisoryInformation` / `SrmItem.advisoryInformation`) before printing them in `issue`, `issues`, `pull-request --issue`, `finding`, and `findings`. These values come from the linked OSV advisory, so — like other repository-derived output — they are now passed through `sanitizeText()` to strip ANSI/OSC control bytes (CWE-150) instead of being printed raw.

## 1.6.0

### Minor Changes

- [#28](https://github.com/codacy/codacy-cloud-cli/pull/28) [`440a57f`](https://github.com/codacy/codacy-cloud-cli/commit/440a57fec915aae6fcebf9cc8dde6fca9d71c266) Thanks [@claudiacodacy](https://github.com/claudiacodacy)! - `codacy issues --ignore` now asks for confirmation before bulk-ignoring. It
  prints how many issues match the current filters and only proceeds when you
  answer `y`, guarding against a mistyped or too-broad filter ignoring far more
  issues than intended. Pass `--skip-confirmation` (`-y`) to bypass the prompt in
  CI or scripts; in a non-interactive shell without that flag the command aborts
  without ignoring anything.

- [#28](https://github.com/codacy/codacy-cloud-cli/pull/28) [`440a57f`](https://github.com/codacy/codacy-cloud-cli/commit/440a57fec915aae6fcebf9cc8dde6fca9d71c266) Thanks [@claudiacodacy](https://github.com/claudiacodacy)! - Add `codacy issues --ignored` (`-i`) to list issues that were marked as ignored
  on Codacy. Without the flag, `codacy issues` behaves exactly as before; pass
  `--ignored` to see the ignored ones instead. The
  ignored listing accepts all the same filters as the normal search (`--branch`,
  `--severities`, `--categories`, `--tools`, `--patterns`, `--languages`, `--tags`,
  `--authors`, `--limit`, and `--false-positives`), and each ignored issue shows
  who ignored it, when, the reason, and any comment. It cannot be combined with
  `--overview` or `--ignore`. `--output json` emits an `ignoredIssues` array.
  Unignoring individual issues stays with `codacy issue <id> --unignore`.

## 1.5.0

### Minor Changes

- [#26](https://github.com/codacy/codacy-cloud-cli/pull/26) [`bf903e4`](https://github.com/codacy/codacy-cloud-cli/commit/bf903e45f6aaa96a25d4cdbfdf19966d2a5f1c38) Thanks [@alerizzo](https://github.com/alerizzo)! - Add `ls` and `directories` commands to browse a repository's tree with quality
  metrics. `ls` lists the directories and files at a path — showing Grade, Issues,
  Complexity, Duplication, and Coverage per row — and `directories` (alias `dirs`)
  lists folders only, with `--plus-children` to also show one level of
  sub-directories as a `└─` tree. Both auto-detect the provider/organization/repository
  from the git remote and the path from your current directory (relative to the
  repo root); override with positional args, `--path`, and `--branch`. Sort with
  `--sort <field>` (`name`, `issues`, `grade`, `duplication`, `complexity`,
  `coverage`) and `--direction asc|desc`. `codacy ls --search <term>` finds files
  at any depth under the path. Folders and files are marked with `▸` and `·` (no
  emojis). Both commands fetch every page of results, so nothing is truncated.

- [#24](https://github.com/codacy/codacy-cloud-cli/pull/24) [`bf527ad`](https://github.com/codacy/codacy-cloud-cli/commit/bf527ad694a3f7d78576a5a3647dd4d53984e088) Thanks [@alerizzo](https://github.com/alerizzo)! - Add an npm-style "update available" notice. When a newer version is published, the
  CLI prints a one-time upgrade hint to stderr — it never auto-updates. The notice
  only shows with the default `--output table` in an interactive terminal; it is
  suppressed for `--output json`, when piped, in CI, and under `npx`/npm scripts, so
  machine-readable stdout stays byte-clean. The version lookup runs in a non-blocking
  background process (at most once a day) and never affects timing or exit codes. Opt
  out via `CODACY_DISABLE_UPDATE_CHECK`, `NO_UPDATE_NOTIFIER`, or `--no-update-notifier`.
  A package.json `overrides` entry pins `update-notifier`'s transitive `got`/`package-json`
  to patched, still-CommonJS versions to avoid CVE-2022-33987.

### Patch Changes

- [#27](https://github.com/codacy/codacy-cloud-cli/pull/27) [`c5c9af5`](https://github.com/codacy/codacy-cloud-cli/commit/c5c9af57f63bbdc2762acb59800de65247cdf94a) Thanks [@alerizzo](https://github.com/alerizzo)! - Stop `issues --overview` from suggesting noise reduction on repositories that aren't
  actually noisy. The "Suggested actions to reduce noise" section now requires two absolute
  floors before anything is suggested: the repository must have at least 200 issues in total,
  and an individual pattern must produce at least 100 issues on its own. The per-pattern floor
  matters because a repository with a long tail of tiny patterns pulls the median issues-per-
  pattern very low, which previously made a pattern with only a handful of issues look
  disproportionate — now a rule has to genuinely flood the repo before it's flagged. On top of
  those floors, a pattern must still show a relative signal: the "dominant share" rule (≥10% of
  all issues) only applies when there are at least 11 distinct patterns (an even split of N
  patterns only drops below 10% once N is above 10, so 8-10 balanced patterns would otherwise
  all be flagged), and the "disproportionate count" rule now compares each
  pattern against the **median** issues-per-pattern instead of the mean, so a single huge
  pattern can no longer inflate the baseline and hide smaller-but-still-disproportionate ones.

## 1.4.0

### Minor Changes

- [#20](https://github.com/codacy/codacy-cloud-cli/pull/20) [`cbf62d5`](https://github.com/codacy/codacy-cloud-cli/commit/cbf62d59da02d45b00a94cba2a1d275e615a7c5d) Thanks [@alerizzo](https://github.com/alerizzo)! - `codacy findings` and `codacy finding` now show the vulnerable dependency's import chain for SCA findings that carry the new `dependencyChains` field. Each finding is labelled **Direct** (`Update <pkg> to <fixedVersion>`) or **Transitive** (`<pkg> → … → <pkg> (Fixed in <fixedVersion>)`), and chains with 4+ packages collapse their middle to `<first> → ... N more ... → <last>`. The list shows the first chain plus `... and X more`; the detail lists every chain aligned under a single label. `dependencyChains` is also included in `--output json`.

## 1.3.1

### Patch Changes

- [#18](https://github.com/codacy/codacy-cloud-cli/pull/18) [`7b09b5b`](https://github.com/codacy/codacy-cloud-cli/commit/7b09b5ba254f7cd7f46a86bd594352e8d3751eb9) Thanks [@manufacturist](https://github.com/manufacturist)! - Fix `--version` flag reporting hardcoded `1.0.0` instead of the actual package version. The CLI now reads the version dynamically from `package.json` at runtime via `require`, so the reported version stays in sync with every release automatically.

## 1.3.0

### Minor Changes

- [#16](https://github.com/codacy/codacy-cloud-cli/pull/16) [`8f86866`](https://github.com/codacy/codacy-cloud-cli/commit/8f86866ac41bf45dfe5d5be0593d180e95f99919) Thanks [@manufacturist](https://github.com/manufacturist)! - `codacy repo --output json` now includes a `fileCount` field on the repository object, plucked from `coverage.numberTotalFiles` on the existing `getRepositoryWithAnalysis` response. The field is present even on repos without coverage data, so no extra API call is needed. Lets consumers (e.g. the `configure-codacy-cloud` skill) read repo size without a separate roundtrip.

## 1.2.1

### Patch Changes

- [#14](https://github.com/codacy/codacy-cloud-cli/pull/14) [`ca896df`](https://github.com/codacy/codacy-cloud-cli/commit/ca896dfb7da127454fc042e63169ce05e2e11130) Thanks [@pedrobpereira](https://github.com/pedrobpereira)! - Adds possibility of using the cli againsta other environments

## 1.2.0

### Minor Changes

- [#11](https://github.com/codacy/codacy-cloud-cli/pull/11) [`12ad8a3`](https://github.com/codacy/codacy-cloud-cli/commit/12ad8a30641a903e3d7a914dfd255bc2401287e5) Thanks [@alerizzo](https://github.com/alerizzo)! - Auto-detect provider, organization, and repository from the git remote origin URL. All repository-scoped commands now work without explicitly passing `<provider> <organization> <repository>` — just run them inside a git repo with an `origin` remote pointing at GitHub, GitLab, or Bitbucket.

- [#13](https://github.com/codacy/codacy-cloud-cli/pull/13) [`f039b39`](https://github.com/codacy/codacy-cloud-cli/commit/f039b39922440cb29d2d7e0ea7c7ea5091c3eb42) Thanks [@alerizzo](https://github.com/alerizzo)! - Improve `issues --overview`. The False Positives table now uses human-friendly labels ("Not a False Positive" / "Potential False Positive") instead of the raw `belowThreshold` / `equalOrAboveThreshold` API bucket names. The overview also adds a "Suggested actions to reduce noise" section that flags noisy patterns — those accounting for at least 10% of all issues, or at least 3× the average issues-per-pattern — and prints a ready-to-run `codacy pattern <tool> <patternId> --disable` command for each (the owning tool is resolved automatically; suggestions whose tool can't be resolved are omitted). `--output json` output is unchanged.

- [#13](https://github.com/codacy/codacy-cloud-cli/pull/13) [`f039b39`](https://github.com/codacy/codacy-cloud-cli/commit/f039b39922440cb29d2d7e0ea7c7ea5091c3eb42) Thanks [@alerizzo](https://github.com/alerizzo)! - Make the pattern commands aware of local configuration files and coding standards.

  - `pattern <tool> <patternId>` with no action flag now **shows the pattern's information** (same card as the `patterns` command, with `--output json` support). Since there's no single-pattern endpoint, it searches by ID and keeps the exact match.
  - When a tool is driven by a local configuration file, `patterns` (list) and `pattern` (info) print `<tool> is using a local configuration file.` and skip fetching patterns; `patterns --enable-all/--disable-all` and `pattern --enable/--disable/--parameter` refuse with `Tool uses a local configuration file, can't be updated.`
  - `pattern --enable/--disable/--parameter` also refuses patterns enforced by a coding standard with `Pattern enforced by <standard> coding standard, can't be modified.`
  - `issues --overview` noise suggestions now adapt per pattern: a runnable `codacy pattern … --disable` command when possible, otherwise a manual step — `Update your local <tool> configuration file to disable the pattern` or `Update <coding standard> to disable the pattern`.

- [#13](https://github.com/codacy/codacy-cloud-cli/pull/13) [`f039b39`](https://github.com/codacy/codacy-cloud-cli/commit/f039b39922440cb29d2d7e0ea7c7ea5091c3eb42) Thanks [@alerizzo](https://github.com/alerizzo)! - Add a `--reanalyze-and-wait` (`-w`) variant to the `repository` and `pull-request` commands. Unlike `--reanalyze` (which triggers analysis and exits), this blocking variant captures a baseline of the current issues, triggers the reanalysis, polls until it finishes (every 10s, up to 20 minutes), and then prints how long the analysis took and what changed — issue deltas by pattern, severity, and category. Supports `--output json`.

## 1.1.1

### Patch Changes

- [#9](https://github.com/codacy/codacy-cloud-cli/pull/9) [`a973363`](https://github.com/codacy/codacy-cloud-cli/commit/a973363794b803e13124ab592778e6eced2be88d) Thanks [@alerizzo](https://github.com/alerizzo)! - Fix tools import to preserve cloud-only tools (only disable tools the local CLI supports), handle config-file mode correctly (skip pattern reset when useLocalConfigurationFile is set), and surface structured API error details on import failures.

## 1.1.0

### Minor Changes

- [#6](https://github.com/codacy/codacy-cloud-cli/pull/6) [`0280af1`](https://github.com/codacy/codacy-cloud-cli/commit/0280af162217f5eec2094aca6d2f9e7efa9e615b) Thanks [@alerizzo](https://github.com/alerizzo)! - ### Changes since v1.0.5

  - **`--tools` filter for issues command** ([#4](https://github.com/codacy/codacy-cloud-cli/issues/4)): Added `--tools` option to filter issues by the tool/pattern that detected them. Includes new formatting utilities for tool name display.

  - **Filter and bulk-ignore for false positives** ([#5](https://github.com/codacy/codacy-cloud-cli/issues/5)): Added `--category` and `--severity` filters to the issues command. Introduced bulk-ignore functionality to ignore multiple issues matching filter criteria, streamlining false-positive triage workflows.

  - **Pin GitHub Actions to SHA hashes** ([#2](https://github.com/codacy/codacy-cloud-cli/issues/2)): Pinned all GitHub Actions workflow dependencies to commit SHAs for improved supply-chain security.

  - **Adopt changesets for automated versioning and publishing** ([#6](https://github.com/codacy/codacy-cloud-cli/issues/6)): Replaced the manual publish workflow with a changesets-based release pipeline. PRs now require a changeset file, and merging to main triggers automated version bumps and npm publishing with provenance.
