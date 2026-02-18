# Codacy Cloud CLI

A command-line tool to interact with [Codacy Cloud](https://app.codacy.com) directly from your terminal. Built with Node.js and TypeScript.

## Setup

```bash
npm install
```

Set your Codacy API token as an environment variable:

```bash
export CODACY_API_TOKEN=your-token-here
```

You can get a token from **Codacy > My Account > Access Management > Account API Tokens**.

## Usage

```bash
# Run in development mode
npx ts-node src/index.ts <command>

# Or build and run
npm run build
npm start -- <command>
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

## Development

```bash
# Run tests
npm test

# Type-check without emitting
npx tsc --noEmit

# Update the auto-generated API client
npm run update-api
```

### Project Structure

```
src/
  index.ts          # CLI entry point (Commander.js)
  commands/         # One file per command
  utils/            # Shared utilities (auth, error handling, output formatting)
  api/client/       # Auto-generated API client (do not edit)
```

## License

ISC
