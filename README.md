# Codacy Cloud CLI

A command-line tool to interact with [Codacy Cloud](https://app.codacy.com) directly from your terminal. Built with Node.js and TypeScript.

## Installation

### From npm

```bash
npm install -g codacy-cloud-cli
```

### From source

```bash
git clone https://github.com/alerizzo/codacy-cloud-cli.git
cd codacy-cloud-cli
npm install
npm run build
npm link
```

## Authentication

Set your Codacy API token as an environment variable:

```bash
export CODACY_API_TOKEN=your-token-here
```

You can get a token from **Codacy > My Account > Access Management > Account API Tokens**.

## Usage

```bash
codacy <command> [options]
```

### Global Options

| Option | Description | Default |
|---|---|---|
| `-o, --output <format>` | Output format: `table` or `json` | `table` |
| `-V, --version` | Show version | |
| `-h, --help` | Show help | |

### Commands

#### `info`

Show authenticated user information and their organizations.

```bash
codacy info
codacy info --output json
```

Displays:
- User details (name, email, admin status, active status)
- Organizations (name, provider, type, join status)

#### `repositories <provider> <organization>`

List repositories for an organization with analysis data.

```bash
codacy repositories gh my-org
codacy repositories gh my-org --search my-repo
codacy repositories gl my-org --output json
```

| Argument | Description |
|---|---|
| `provider` | Git provider: `gh` (GitHub), `gl` (GitLab), or `bb` (Bitbucket) |
| `organization` | Organization name on the provider |

| Option | Description |
|---|---|
| `-s, --search <query>` | Filter repositories by name |

Displays: name, grade, issues, complexity, duplication, coverage, and last updated. Quality metrics are colored red/green based on repository quality goals.

#### `repository <provider> <organization> <repository>`

Show detailed status and metrics for a specific repository, or perform an action on it.

```bash
codacy repository gh my-org my-repo
codacy repository gh my-org my-repo --output json
codacy repository gh my-org my-repo --add
codacy repository gh my-org my-repo --remove
codacy repository gh my-org my-repo --follow
codacy repository gh my-org my-repo --unfollow
```

| Option | Description |
|---|---|
| `-a, --add` | Add this repository to Codacy |
| `-r, --remove` | Remove this repository from Codacy |
| `-f, --follow` | Follow this repository on Codacy |
| `-u, --unfollow` | Unfollow this repository on Codacy |

Without an action flag, displays a multi-section dashboard:
- **About** -- repository info, default branch, last analysis
- **Setup** -- languages, coding standards, quality gate, problems
- **Metrics** -- issues (count + per kLoC), coverage, complexity, duplication
- **Open Pull Requests** -- status, issues, coverage, complexity, duplication deltas
- **Issues Overview** -- totals by category, severity, and language

#### `issues <provider> <organization> <repository>`

Search for issues in a repository with optional filters.

```bash
codacy issues gh my-org my-repo
codacy issues gh my-org my-repo --branch main --severities Critical,High
codacy issues gh my-org my-repo --categories Security --overview
codacy issues gh my-org my-repo --output json
```

| Argument | Description |
|---|---|
| `provider` | Git provider: `gh` (GitHub), `gl` (GitLab), or `bb` (Bitbucket) |
| `organization` | Organization name on the provider |
| `repository` | Repository name |

| Option | Description |
|---|---|
| `--branch <branch>` | Branch name (defaults to the main branch) |
| `--patterns <patterns>` | Comma-separated list of pattern IDs |
| `--severities <severities>` | Comma-separated list of severity levels: `Critical`, `High`, `Medium`, `Minor` |
| `--categories <categories>` | Comma-separated list of category names |
| `--languages <languages>` | Comma-separated list of language names |
| `--tags <tags>` | Comma-separated list of tag names |
| `--authors <authors>` | Comma-separated list of author emails |
| `--overview` | Show issue count totals instead of the issues list |

Without `--overview`, displays issues as cards sorted by severity (Error first), with file path, line content, and false-positive warnings where applicable.

With `--overview`, displays issue count totals grouped by: category, severity, language, tag, and author.

#### `findings <provider> <organization> [repository]`

Show security findings for a repository or an entire organization.

```bash
codacy findings gh my-org my-repo
codacy findings gh my-org
codacy findings gh my-org --severities Critical,High
codacy findings gh my-org my-repo --statuses Overdue,DueSoon
codacy findings gh my-org my-repo --output json
```

| Argument | Description |
|---|---|
| `provider` | Git provider: `gh` (GitHub), `gl` (GitLab), or `bb` (Bitbucket) |
| `organization` | Organization name on the provider |
| `repository` | Repository name (optional — omit to show org-wide findings) |

| Option | Description |
|---|---|
| `-q, --search <text>` | Search term to filter findings |
| `-s, --severities <severities>` | Comma-separated priority levels: `Critical`, `High`, `Medium`, `Low` |
| `-S, --statuses <statuses>` | Comma-separated statuses: `Overdue`, `OnTrack`, `DueSoon`, `ClosedOnTime`, `ClosedLate`, `Ignored` |
| `-c, --categories <categories>` | Comma-separated security category names |
| `-T, --scan-types <types>` | Comma-separated scan types |
| `-d, --dast-targets <urls>` | Comma-separated DAST target URLs |

Displays findings as cards sorted by priority (Critical first). Each card shows:
- Priority, security category, scan type, and (for pen test findings) likelihood and effort to fix
- Finding title
- Status, due date, CVE/CWE identifiers, affected/fixed versions, application, and affected targets

When browsing org-wide (no repository argument), the repository name is shown on each card.

#### `issue <provider> <organization> <repository> <issueId>`

Show full details of a single quality issue, including extended code context and pattern documentation.

```bash
codacy issue gh my-org my-repo 12345
codacy issue gh my-org my-repo 12345 --output json
```

| Argument | Description |
|---|---|
| `provider` | Git provider: `gh` (GitHub), `gl` (GitLab), or `bb` (Bitbucket) |
| `organization` | Organization name on the provider |
| `repository` | Repository name |
| `issueId` | Issue ID shown at the bottom of each card in the `issues` command output |

Displays:
- **Header** — severity, category, subcategory, and issue message
- **File context** — ±5 lines around the issue with the issue line highlighted; suggested fix shown inline if available
- **False positive warning** — if the issue is likely a false positive
- **Pattern documentation** — full description, rationale ("Why is this a problem?"), solution ("How to fix it?"), tags, and tool/pattern reference

#### `finding <provider> <organization> <repository> <findingId>`

Show full details for a single security finding, with CVE enrichment when a CVE ID is present.

```bash
codacy finding gh my-org my-repo 12345
codacy finding gh my-org my-repo 12345 --output json
```

| Argument | Description |
|---|---|
| `provider` | Git provider: `gh` (GitHub), `gl` (GitLab), or `bb` (Bitbucket) |
| `organization` | Organization name on the provider |
| `repository` | Repository name |
| `findingId` | Finding ID shown at the bottom of each card in the `findings` command output |

Displays:
- **Header** — priority, security category, scan type, status, CVE/CWE identifiers, affected/fixed versions
- **Code context** — if the finding comes from a Codacy quality issue: ±5 lines of code with the issue line highlighted and pattern documentation
- **Pattern documentation** — description ("About this pattern"), rationale, solution, tags, tool/pattern reference
- **CVE details** — (when a CVE ID is present) CVSS v3/v4 scores colored by severity, published/updated dates, title, English description, and deduplicated references fetched in parallel from the NVD database

#### `pull-request <provider> <organization> <repository> <prNumber>`

Show details, analysis status, issues, and changed files for a specific pull request.

```bash
codacy pull-request gh my-org my-repo 42
codacy pull-request gh my-org my-repo 42 --output json
codacy pull-request gh my-org my-repo 42 --issue 9901
codacy pull-request gh my-org my-repo 42 --diff
```

| Argument | Description |
|---|---|
| `provider` | Git provider: `gh` (GitHub), `gl` (GitLab), or `bb` (Bitbucket) |
| `organization` | Organization name on the provider |
| `repository` | Repository name |
| `prNumber` | Pull request number |

| Option | Description |
|---|---|
| `-i, --issue <issueId>` | Show full details for a specific issue introduced by this PR (use the `#id` shown on issue cards) |
| `-d, --diff` | Show the git diff annotated with coverage hits/misses and new issues |

Default view displays:
- **About** — PR title, status, author, branches, head commit
- **Analysis** — up-to-standards status, issues, coverage, complexity, duplication with gate pass/fail details; "To check" hints when a gate is configured but the metric has no data yet
- **Issues** — all issues introduced by the PR (confirmed + potential), sorted by severity, with file path, line content, and false-positive warnings
- **Diff Coverage Summary** — per-file diff coverage percentage and compressed uncovered line ranges (when coverage data is available)
- **Files** — changed files with metric deltas (issues, coverage, complexity, duplication)

With `--issue <id>`: shows full detail for that issue (code context + pattern docs), same format as the `issue` command.

With `--diff`: shows the annotated git diff — only blocks containing covered/uncovered lines or new issues, with 3 lines of context around each. Coverage is shown with ✓ (green, covered) and ✘ (red, uncovered) symbols; issues are annotated inline with severity, category, and message.

#### `tools <provider> <organization> <repository>`

List all analysis tools configured for a repository with their status.

```bash
codacy tools gh my-org my-repo
codacy tools gh my-org my-repo --output json
```

Displays tools grouped into **Enabled** and **Disabled** sections. For each tool:
- **Config File** — `Applied` (config file detected and in use), `Available` (detected but not used), or `Not Available`
- **Via Standard** — name of any Coding Standard that enabled the tool
- **Notes** — `Client-side tool` for tools that run locally

#### `tool <provider> <organization> <repository> <toolName>`

Enable, disable, or configure an analysis tool for a repository.

```bash
codacy tool gh my-org my-repo eslint --enable
codacy tool gh my-org my-repo eslint --disable
codacy tool gh my-org my-repo eslint --configuration-file true
codacy tool gh my-org my-repo eslint --enable --configuration-file true
```

| Argument | Description |
|---|---|
| `toolName` | Tool name (use hyphens for spaces, e.g. `eslint-(deprecated)`) |

| Option | Description |
|---|---|
| `-e, --enable` | Enable the tool |
| `-d, --disable` | Disable the tool |
| `-c, --configuration-file <true/false>` | Set whether the tool uses a configuration file |

Tool names are matched by best-fit: `eslint` matches "ESLint" but not "ESLint9" or "ESLint (deprecated)"; `eslint-(deprecated)` matches "ESLint (deprecated)".

#### `patterns <provider> <organization> <repository> <toolName>`

List all patterns for an analysis tool in a repository with their status and configuration.

```bash
codacy patterns gh my-org my-repo eslint
codacy patterns gh my-org my-repo eslint --enabled --categories Security
codacy patterns gh my-org my-repo eslint --severities Critical,High --search "sql injection"
codacy patterns gh my-org my-repo eslint --output json
```

| Option | Description |
|---|---|
| `-l, --languages <languages>` | Comma-separated list of languages |
| `-C, --categories <categories>` | Comma-separated list of categories |
| `-s, --severities <severities>` | Comma-separated severity levels: `Critical`, `High`, `Medium`, `Minor` |
| `-t, --tags <tags>` | Comma-separated list of tags |
| `-q, --search <search>` | Search term to filter patterns |
| `-e, --enabled` | Show only enabled patterns |
| `-D, --disabled` | Show only disabled patterns |
| `-r, --recommended` | Show only recommended patterns |

Displays patterns as cards sorted by severity (Critical first), then recommended first, then alphabetically. Each card shows severity, category, description, rationale, solution, and active parameter values.

#### `pattern <provider> <organization> <repository> <toolName> <patternId>`

Enable, disable, or set parameters for a specific analysis pattern.

```bash
codacy pattern gh my-org my-repo eslint no-unused-vars --enable
codacy pattern gh my-org my-repo eslint no-unused-vars --disable
codacy pattern gh my-org my-repo eslint max-len --parameter max=120
codacy pattern gh my-org my-repo eslint max-len --enable --parameter max=120 --parameter tabWidth=2
```

| Option | Description |
|---|---|
| `-e, --enable` | Enable the pattern |
| `-d, --disable` | Disable the pattern |
| `-p, --parameter <name=value>` | Set a parameter value (`name=value` format, repeatable) |

When only `--parameter` is used (without `--enable` or `--disable`), the current enabled state of the pattern is preserved automatically.

## Development

```bash
# Run in development mode
npx ts-node src/index.ts <command>

# Run tests
npm test

# Type-check without emitting
npx tsc --noEmit

# Build for production
npm run build

# Update the auto-generated API client
npm run update-api
```

### Project Structure

```
src/
  index.ts          # CLI entry point (Commander.js)
  commands/         # One file per command
  utils/            # Shared utilities (auth, error handling, output, formatting)
  api/client/       # Auto-generated API client (do not edit)
```

### CI/CD

- **CI**: Runs on every push to `main` and on PRs. Builds and tests across Node.js 18, 20, and 22.
- **Publish**: Triggered on GitHub release creation. Builds, tests, and publishes to npm with provenance.

To publish a new version:
1. Update the version in `package.json`
2. Create a GitHub release with a tag matching the version (e.g. `v1.1.0`)
3. The publish workflow will automatically build and push to npm

**Prerequisite**: Add an `NPM_TOKEN` secret to your GitHub repository settings.

## License

ISC
