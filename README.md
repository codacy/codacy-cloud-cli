# Codacy Cloud CLI

A command-line tool to interact with [Codacy Cloud](https://app.codacy.com) directly from your terminal. Built with Node.js and TypeScript.

## Installation

### From npm

```bash
npm install -g "@codacy/codacy-cloud-cli"
```

### From source

```bash
git clone https://github.com/codacy/codacy-cloud-cli.git
cd codacy-cloud-cli
npm install
npm run build
npm link
```

## Authentication

The CLI accepts two kinds of token.

### Account API token

Reaches every organization and repository your account can see. Log in interactively (recommended):

```bash
codacy login
```

Or set the `CODACY_API_TOKEN` environment variable:

```bash
export CODACY_API_TOKEN=your-token-here
```

You can get a token from **Codacy > My Account > Access Management > API Tokens** ([link](https://app.codacy.com/account/access-management)).

The `login` command stores the token encrypted at `~/.codacy/credentials`. The environment variable takes precedence over stored credentials when both are present.

### Repository (project) token

Scoped to a single repository — the right choice for CI, since a leaked token can't reach anything else. Get one from **Codacy > Repository > Settings > Integrations > Project API token**.

```bash
codacy tools --repository-token your-repository-token
# or, for a whole CI job:
export CODACY_PROJECT_TOKEN=your-repository-token
```

Codacy accepts repository tokens on a **limited set of repository-scoped operations**, so some commands require an account token and say so explicitly rather than failing with a generic authorization error:

| Works with a repository token | Requires an account token |
|---|---|
| `tools`, `tool`, `patterns`, `pattern` | `info`, `repositories` |
| `issues` (including `--overview`) | `issues --ignore`, `issues --ignored`, `issue` |
| `repository`, `repository --reanalyze` | `repository --add`/`--remove`/`--follow`/`--unfollow`/`--link-standard`/`--unlink-standard` |
| | `pull-request`, `pull-requests`, `ls`, `directories`, `findings`, `finding` |

`codacy repository` works, but omits the pull request section — that endpoint doesn't accept repository tokens. In `--output json` it marks it as `"unavailable": ["pullRequests"]`, so a consumer can tell "none" apart from "couldn't look". Everything else, including the coverage status, is available.

`codacy login` stores account tokens only; pass repository tokens per command or via `CODACY_PROJECT_TOKEN`.

### Token precedence

1. `--repository-token <token>`
2. `CODACY_PROJECT_TOKEN`
3. `CODACY_API_TOKEN`
4. Stored credentials from `codacy login`

An explicit `--repository-token` wins outright, so a deliberately scoped run is never silently widened by an environment variable or a stale login. Note that `CODACY_PROJECT_TOKEN` outranks `CODACY_API_TOKEN` (matching the [Codacy Analysis CLI](https://github.com/codacy/analysis-cli)) — unset it if you want your account token used.

Passing `--repository-token` with an **empty** value is an error rather than a fallback. `--repository-token "$CODACY_PROJECT_TOKEN"` with the secret unset is a common CI mistake, and quietly falling back to an account token would run with much wider access than you asked for. An empty *environment variable*, by contrast, simply means "unset".

## Proxy and TLS

All outbound requests honor the standard proxy environment variables — set them once and every command routes accordingly.

| Variable | Purpose |
|---|---|
| `HTTPS_PROXY` / `HTTP_PROXY` (or lowercase) | Proxy URL for HTTPS / HTTP requests. A bare `host:port` is treated as `http://` |
| `NO_PROXY` / `no_proxy` | Comma-separated hosts that bypass the proxy (`*`, `.suffix`), matched per request |
| `SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS` | PEM CA bundle to trust, e.g. for a corporate SSL-inspection proxy |
| `CODACY_CLI_INSECURE` / `NODE_TLS_REJECT_UNAUTHORIZED=0` | Disable TLS verification (last resort; warns on stderr) |

```bash
export HTTPS_PROXY=http://proxy.corp:8080
export NO_PROXY=app.codacy.com,.internal
export SSL_CERT_FILE=/path/to/corporate-ca.pem   # prefer trusting the CA over disabling TLS
```

If your proxy performs TLS interception (MITM), trust its CA rather than disabling verification. Node doesn't read the OS trust store, so requests can fail with `unable to get local issuer certificate` even when `curl -x "$HTTPS_PROXY" https://app.codacy.com/api/v3/user` against the same host succeeds — curl working while the CLI doesn't is the tell-tale sign. Ask your IT team for the bundle, or export it from your OS trust store in PEM format.

Note that `SSL_CERT_FILE` **replaces** the default trust store rather than adding to it, the same way curl's `--cacert` does, so the bundle must contain the full chain for every host you reach — including hosts that bypass the proxy via `NO_PROXY`. A misconfigured or unreadable bundle fails fast with a clear error instead of silently falling back.

These variable names match the Codacy Analysis CLI and the Codacy VS Code extension, so one environment drives all of them.

> The "update available" notice uses a separate network stack that does not honor these variables. Behind a strict proxy, disable it with `CODACY_DISABLE_UPDATE_CHECK=1`.

## Usage

```bash
codacy <command> [options]
codacy <command> --help   # Detailed usage for any command
```

### Global Options

| Option | Description |
|---|---|
| `-o, --output <format>` | Output format: `table` (default) or `json` |
| `--repository-token <token>` | Repository (project) token, scoped to one repository (env: `CODACY_PROJECT_TOKEN`) |
| `-V, --version` | Show version |
| `-h, --help` | Show help |

### Repository Auto-Detection

When you run a command inside a git repository, the CLI automatically detects the **provider**, **organization**, and **repository** from the `origin` remote URL. This means you can skip those arguments entirely:

```bash
# Inside a GitHub repo — auto-detects provider/org/repo
codacy issues
codacy pull-request 42
codacy tools

# Or specify them explicitly
codacy issues gh my-org my-repo
```

Supported providers: GitHub (`gh`), GitLab (`gl`), Bitbucket (`bb`).

### Commands

| Command | Description |
|---|---|
| `login` | Authenticate with Codacy by storing your API token |
| `logout` | Remove stored Codacy API token |
| `info` | Show authenticated user info and their organizations |
| `repositories <provider> <org>` | List repositories for an organization |
| `repository [provider] [org] [repo]` | Show metrics for a repository, or add/remove/follow/unfollow/reanalyze it (optionally waiting for results) |
| `ls [provider] [org] [repo]` | List (or search) directories and files at a path in a repository, with quality metrics and sorting |
| `directories [provider] [org] [repo]` | List directories at a path in a repository (optionally one level of sub-directories), with quality metrics |
| `issues [provider] [org] [repo]` | Search issues in a repository with filters |
| `issue [provider] [org] [repo] <id>` | Show details for a single issue, or ignore/unignore it |
| `findings [provider] [org] [repo]` | Show security findings for a repository or organization |
| `finding <provider> <org> <id>` | Show details for a single security finding, or ignore/unignore it |
| `pull-request [provider] [org] [repo] <pr>` | Show PR analysis, issues, diff coverage, and changed files; or reanalyze it (optionally waiting for results) |
| `pull-requests [provider] [org] [repo]` | List pull requests for a repository, with analysis data and text/branch filters |
| `tools [provider] [org] [repo]` | List analysis tools configured for a repository |
| `tool [provider] [org] [repo] <tool>` | Enable, disable, or configure an analysis tool |
| `patterns [provider] [org] [repo] <tool>` | List patterns for a tool, or bulk enable/disable them |
| `pattern [provider] [org] [repo] <tool> <id>` | Show a pattern, or enable, disable, or set parameters for it |

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

- **CI**: Runs on every push to `main` and on PRs. Builds, smoke-tests the built CLI, and runs the test suite across Node.js 20 and 22.
- **Release**: Uses [changesets](https://github.com/changesets/changesets) for automated versioning and npm publishing.

#### Publishing a new version

1. When making changes, run `npx changeset` and describe your change (select `patch`, `minor`, or `major`)
2. Include the generated `.changeset/*.md` file in your PR
3. CI enforces that every PR includes a changeset (use `npx changeset --empty` for changes that don't need a version bump, like docs or CI)
4. When PRs are merged to `main`, the release workflow automatically creates a **"chore: version packages"** PR that bumps the version and updates `CHANGELOG.md`
5. Merging that PR publishes to npm with provenance

**Prerequisite**: An `NPM_TOKEN` secret must be configured in the GitHub repository settings.

## License

MIT
