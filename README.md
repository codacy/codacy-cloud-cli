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
codacy-cloud-cli <command> [options]
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
codacy-cloud-cli info
codacy-cloud-cli info --output json
```

Displays:
- User details (name, email, admin status, active status)
- Organizations (name, provider, type, join status)

#### `repositories <provider> <organization>`

List repositories for an organization with analysis data.

```bash
codacy-cloud-cli repositories gh my-org
codacy-cloud-cli repositories gh my-org --search my-repo
codacy-cloud-cli repositories gl my-org --output json
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

Show detailed status and metrics for a specific repository.

```bash
codacy-cloud-cli repository gh my-org my-repo
codacy-cloud-cli repository gh my-org my-repo --output json
```

Displays a multi-section dashboard:
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
codacy-cloud-cli findings gh my-org my-repo
codacy-cloud-cli findings gh my-org
codacy-cloud-cli findings gh my-org --severities Critical,High
codacy-cloud-cli findings gh my-org my-repo --statuses Overdue,DueSoon
codacy-cloud-cli findings gh my-org my-repo --output json
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
codacy-cloud-cli issue gh my-org my-repo 12345
codacy-cloud-cli issue gh my-org my-repo 12345 --output json
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

#### `pull-request <provider> <organization> <repository> <prNumber>`

Show details, analysis status, issues, and changed files for a specific pull request.

```bash
codacy-cloud-cli pull-request gh my-org my-repo 42
codacy-cloud-cli pull-request gh my-org my-repo 42 --output json
```

| Argument | Description |
|---|---|
| `provider` | Git provider: `gh` (GitHub), `gl` (GitLab), or `bb` (Bitbucket) |
| `organization` | Organization name on the provider |
| `repository` | Repository name |
| `prNumber` | Pull request number |

Displays:
- **About** -- PR title, status, author, branches, head commit
- **Analysis** -- up-to-standards status, issues, coverage, complexity, duplication with gate pass/fail details
- **Issues** -- issues introduced by the PR, sorted by severity, with file path and line content
- **Files** -- changed files with metric deltas (issues, coverage, complexity, duplication)

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
