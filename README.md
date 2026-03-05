# Codacy Cloud CLI

A command-line tool to interact with [Codacy Cloud](https://app.codacy.com) directly from your terminal. Built with Node.js and TypeScript.

## Installation

### From npm

```bash
npm install -g "@codacy/codacy-cloud-cli"
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
codacy <command> --help   # Detailed usage for any command
```

### Global Options

| Option | Description |
|---|---|
| `-o, --output <format>` | Output format: `table` (default) or `json` |
| `-V, --version` | Show version |
| `-h, --help` | Show help |

### Commands

| Command | Description |
|---|---|
| `info` | Show authenticated user info and their organizations |
| `repositories <provider> <org>` | List repositories for an organization |
| `repository <provider> <org> <repo>` | Show metrics for a repository, or add/remove/follow/unfollow/reanalyze it |
| `issues <provider> <org> <repo>` | Search issues in a repository with filters |
| `issue <provider> <org> <repo> <id>` | Show details for a single issue, or ignore/unignore it |
| `findings <provider> <org> [repo]` | Show security findings for a repository or organization |
| `finding <provider> <org> <id>` | Show details for a single security finding, or ignore/unignore it |
| `pull-request <provider> <org> <repo> <pr>` | Show PR analysis, issues, diff coverage, and changed files; or reanalyze it |
| `tools <provider> <org> <repo>` | List analysis tools configured for a repository |
| `tool <provider> <org> <repo> <tool>` | Enable, disable, or configure an analysis tool |
| `patterns <provider> <org> <repo> <tool>` | List patterns for a tool with filters |
| `pattern <provider> <org> <repo> <tool> <id>` | Enable, disable, or set parameters for a pattern |

Provider shortcodes: `gh` (GitHub), `gl` (GitLab), `bb` (Bitbucket).

Run `codacy <command> --help` for full argument and option details for any command.

## Development

```bash
npm start -- <command>   # Run in development mode
npm test                 # Run tests
npm run type-check       # Type-check without emitting
npm run build            # Build for production
npm run update-api       # Update the auto-generated API client
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

MIT
