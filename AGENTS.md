# Codacy Cloud CLI

A command-line Node.js + TypeScript tool to interact with the Codacy API.

## Project Overview

This CLI wraps the [Codacy Cloud API v3](https://api.codacy.com/api/api-docs) using an auto-generated TypeScript client. The goal is to provide a clean, well-structured CLI that lets users interact with Codacy directly from the terminal.

**Current state:** The project has a working boilerplate with Commander.js, an auto-generated API client, and a few prototype commands (`user`, `orgs`, `repos`) that will be removed and rebuilt. The foundation (entry point, API generation pipeline, utilities) is stable and should be preserved.

## Quick Reference

| Action | Command |
|---|---|
| Run in dev mode | `npx ts-node src/index.ts <command>` |
| Build | `npm run build` |
| Run built version | `node dist/index.js <command>` |
| Fetch latest API spec | `npm run fetch-api` |
| Regenerate API client | `npm run generate-api` |
| Full API update | `npm run update-api` |
| Run tests | `npm test` |

## Architecture & Project Structure

```
codacy-cloud-cli/
├── .changeset/                  # Changesets config and pending changeset files
├── src/
│   ├── index.ts                 # CLI entry point (Commander.js setup)
│   ├── api/
│   │   └── client/              # AUTO-GENERATED - do NOT edit manually
│   │       ├── core/            # Request handling, auth, errors
│   │       ├── models/          # 520+ TypeScript interfaces from OpenAPI
│   │       └── services/        # 28 service classes wrapping API endpoints
│   ├── commands/                # One file per command (see Command Pattern below)
│   │   └── CLAUDE.md            # Design decisions for commands
│   └── utils/                   # Shared utilities (auth, error handling, output formatting, formatting helpers)
├── api-v3/
│   └── api-swagger.yaml         # OpenAPI 3.0.1 spec (source of truth for client generation)
├── dist/                        # Compiled JS output (gitignored)
├── SPECS/                       # Specs and backlog - agents MUST read SPECS/README.md
│   ├── README.md                # Agent landing page: pending tasks, command table, changelog
│   ├── commands/                # One spec file per command
│   ├── setup.md                 # Test framework, build, utilities
│   └── deployment.md            # npm publishing, CI pipelines
├── TODO.md                      # Redirects to SPECS/README.md
├── CLAUDE.md                    # This file
├── package.json
└── tsconfig.json
```

## Critical Rules

### For All Agents

1. **Read `SPECS/README.md` before starting work.** It shows pending tasks, the command inventory, and the changelog. When completing a task, update the pending table and add a changelog entry.
2. **Never edit files under `src/api/client/`.** This directory is auto-generated. If the API client needs updating, run `npm run update-api`.
3. **Ask before assuming.** If a task in SPECS or a user instruction is ambiguous, ask clarifying questions before writing code. Do not guess intent.
4. **Document what you build.** Every command, utility, or significant piece of logic must include:
   - Inline comments where the logic isn't self-evident
   - A `CLAUDE.md` in the relevant folder explaining design and implementation decisions when the folder contains multiple related files
5. **Write tests for everything.** Every command must have corresponding tests. See Testing section below.
6. **One command per file.** Each CLI command lives in its own file inside `src/commands/`. The file exports a `register<Name>Command(program: Command)` function.
7. **Keep the entry point thin.** `src/index.ts` only handles Commander setup and command registration. No business logic belongs there.
8. **Keep `README.md` up to date, but concise.** The README contains only a short summary table of available commands and their one-line descriptions. Do **not** document per-command arguments, options, or examples in the README — users run `codacy <command> --help` for that. After adding or renaming a command, add or update its row in the summary table only.

### Code Style & Conventions

- **Language:** TypeScript (strict mode)
- **Module system:** CommonJS (`"module": "commonjs"` in tsconfig)
- **CLI framework:** Commander.js v14
- **Terminal output libraries:**
  - `ansis` for colors/styling
  - `cli-table3` for tabular output — always use `createTable()` from `utils/output.ts` (applies borderless styling and bold white headers)
  - `ora` for loading spinners
  - `dayjs` for date formatting — for "last updated" style dates, use `formatFriendlyDate()` from `utils/output.ts` (relative for today, "Yesterday", otherwise YYYY-MM-DD)
- **Output:** Default output is human readable with tables and colors, but can be overridden with the `--output json` flag.
- **Untrusted output — CWE (Common Weakness Enumeration) 150:** A crafted repo can smuggle terminal escape sequences through repository-derived values. Neutralize them so they can't be interpreted.
  - Pass each untrusted value through `sanitizeText()` (`utils/sanitize.ts`) before `ansis` styling — **except** in the two cases below.
  - **Sinks to sanitize:** PR/finding titles, author names, branches, file paths, diff/file content, issue messages, package/version names.
  - **Exceptions (do not sanitize):** the `console.log` boundary (it strips the CLI's own colors), and the `--output json` path (JSON already escapes control bytes).
  - New commands and render helpers sanitize each untrusted field where the raw value enters the output string.
- **Pagination:** All commands calling paginated APIs must call `printPaginationWarning(response.pagination, hint)` from `utils/output.ts` after displaying results. The hint should suggest command-specific filtering options.
- **Polling / waiting:** Commands that wait on a remote operation (e.g. `--reanalyze-and-wait`) use the shared helpers in `utils/reanalyze-wait.ts`.
  - Route polling delays through the exported `timers.sleep` so tests can stub it (`vi.spyOn(timers, "sleep").mockResolvedValue()`).
  - Prefer that over calling `setTimeout`/`sleep` directly in a command, unless you have a clear reason not to.
  - Default cadence is `POLL_INTERVAL_MS` (10s), capped at `MAX_WAIT_MS` (20min).
- **Error handling:** Use `try/catch` with the shared `handleError()` from `src/utils/error.ts`
- **API base URL:** `https://app.codacy.com/api/v3` (configured in `src/index.ts` via `OpenAPI.BASE`)
- **Proxy / TLS:** never hand-roll this. Outbound HTTP configuration is delegated to `configureProxy()` from `@codacy/tooling`, wrapped by `configureProxyFromEnv()` in `src/utils/proxy.ts` and called once at the top of `src/index.ts`. It installs a global `undici` dispatcher, so every `fetch` — the generated client and the CVE lookup alike — is covered without touching generated code. Keeping the implementation upstream is what keeps the environment contract identical to the Codacy Analysis CLI; a local reimplementation would drift. If proxy behavior needs to change, change it in `analysis-cli`'s `packages/tooling/src/proxy.ts` and bump the dependency here.
- **Authentication — two token kinds.** Read `SPECS/repository-tokens.md` before touching auth or adding a command.
  - An **account token** (`api-token` header) reaches everything its owner can see.
  - A **repository token** (`project-token` header) is scoped to one repository. It is accepted only on a fixed whitelist of 13 operations; everywhere else Codacy rejects it as if no token had been sent.
  - Every command that calls the API resolves auth first, via `resolveAuth(this)` from `src/utils/auth.ts` (returns a `RemoteAuth` discriminated union), and declares `.addOption(repositoryTokenOption())` so `--repository-token` parses.
  - **New commands must decide their token scope**, using the whitelist in `SPECS/repository-tokens.md`:
    - account-only end to end → `resolveAccountAuth(this, "<why a repository token can't do it>")`
    - fully whitelisted → `resolveAuth(this)`
    - mixed → `resolveAuth(this)` plus `requireAccountToken(auth, "<operation>", "<why>")` per unsupported flag, or `fetchIfAccountToken(...)` to skip an unsupported sub-call
  - **Guards must run before any request**, and before `resolveRepoArgs()` — that shells out to git and prints an auto-detection line, which is misleading ahead of a refusal.
    - Exception: a command whose endpoints are all whitelisted needs no guard at all — `resolveAuth(this)` alone is correct (see `tool`, `patterns`, `pattern`).
    - Exception: a data-dependent guard runs after the fetch it depends on.
    - Example: `guardForceUnlink` in `tools.ts` needs the coding-standard count.
    - Keep those reads whitelisted, so nothing doomed is sent.
    - Refuse before any prompt or mutation even so.
    - If an operation's scope is genuinely unclear, don't guess a guard.
    - Confirm the whitelist against the API owners instead.
    - Record the answer in `SPECS/repository-tokens.md`.
  - The whitelist is hardcoded in these guards.
  - **Re-verify the whitelist after every `npm run update-api`.**

### Command Pattern

Every command file follows this structure:

```typescript
// src/commands/<command-name>.ts
import { Command } from "commander";
import ora from "ora";
import { repositoryTokenOption, resolveAuth } from "../utils/auth";
import { handleError } from "../utils/error";
// Import relevant API service(s)

export function register<Name>Command(program: Command) {
  program
    .command("<command-name>")
    .description("Clear description of what this command does")
    .argument("[args]", "Description of arguments")
    .option("--flag <value>", "Description of options")
    // Declared per command (not only in index.ts) so `--repository-token` parses
    // in the test harnesses, which each build a bare `new Command()`.
    .addOption(repositoryTokenOption())
    .action(async function (this: Command, args, options) {
      try {
        // Or resolveAccountAuth(this, "<why>") for an account-only command —
        // see the Authentication bullet above.
        const auth = resolveAuth(this);
        const spinner = ora("Loading...").start();
        // Call API service
        // Format and display output
        spinner.succeed("Done.");
      } catch (err) {
        handleError(err);
      }
    });
}
```

Then register it in `src/index.ts`:
```typescript
import { register<Name>Command } from "./commands/<command-name>";
registerNameCommand(program);
```

## API Client Generation

The API client is auto-generated from the Codacy OpenAPI spec. **Never edit generated files.**

- **Spec location:** `api-v3/api-swagger.yaml`
- **Generator:** `@codacy/openapi-typescript-codegen@0.0.8`
- **Output:** `src/api/client/` (models, services, core)
- **Client type:** fetch-based

To update the API client:
```bash
npm run update-api    # Fetches latest spec + regenerates client
npm run fetch-api     # Only fetch the spec
npm run generate-api  # Only regenerate from existing spec
```

When referencing API operations, look at the generated services in `src/api/client/services/` to find available methods and their signatures. The models in `src/api/client/models/` define the request/response types.

## Testing

### Setup

Tests must be configured with a proper test framework (Vitest or Jest - check `package.json` for which is installed). Each command must have corresponding test files.

### Test Strategy

- **Unit tests** for utility functions and output formatting logic
- **Integration tests** for commands that call the Codacy API
  - These tests will use a dedicated test organization and repository in Codacy with known, predictable data
  - The test org/repo details will be configured via environment variables or test fixtures
- **Test file naming:** `<module>.test.ts` co-located next to the source file, or in a `__tests__/` directory within the same folder
- **Mocking:** Mock API service calls for unit tests; use real API calls (with test credentials) for integration tests

### Running Tests

```bash
npm test
```

## Specs & Backlog

The `SPECS/` folder at the project root is the single source of truth for specs and the project backlog.

- **`SPECS/README.md`** — agent landing page: pending tasks table, command inventory, changelog
- **`SPECS/commands/<command>.md`** — full spec for each command (API endpoints, output format, options, test counts)
- **`SPECS/setup.md`** — test framework, utilities reference
- **`SPECS/deployment.md`** — CI pipelines, npm publishing

**Agents must:**
1. Read `SPECS/README.md` at the start of every session
2. Pick up the next pending task from the pending table (or the one specified by the user)
3. Read the relevant `SPECS/commands/<command>.md` before implementing a command
4. Update `SPECS/README.md` (mark tasks done, add changelog entry) when completing work
5. Add new tasks to `SPECS/README.md` pending table when discovered during work

## Versioning & Releasing

This project uses [changesets](https://github.com/changesets/changesets) for versioning and npm publishing.

### How it works

1. Every PR must include a changeset file (CI enforces this via the `changeset-check` job)
2. Run `npx changeset` to create one — select the bump type (`patch`, `minor`, `major`) and describe the change
3. For PRs that don't need a version bump (docs, CI, refactors), use `npx changeset --empty`
4. On merge to `main`, the `release.yml` workflow creates a "chore: version packages" PR that bumps the version and updates `CHANGELOG.md`
5. Merging that PR triggers the actual npm publish with provenance

### Agent responsibilities for changesets

When completing work that changes user-facing behavior or adds features, agents **must**:
1. Run `npx changeset` and create an appropriate changeset file before committing
2. Use `patch` for bug fixes, `minor` for new features or commands, `major` for breaking changes
3. Write a clear, user-facing summary in the changeset (this becomes the CHANGELOG entry)

For internal-only changes (refactors, docs, CI, test-only changes), use `npx changeset --empty`.

### Agent responsibilities for self-documenting changes

When completing work, agents **must** update relevant documentation:
1. **`SPECS/README.md`** — mark tasks as done in the pending table, add a changelog entry
2. **`README.md`** — if a new command was added or renamed, update the commands summary table (one row per command, no detailed args/options)
3. **`AGENTS.md`** — if a new convention, pattern, or workflow was introduced that affects how agents work, add it to the relevant section
4. **`SPECS/deployment.md`** — if CI/CD or publishing workflows changed, update this spec to match

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CODACY_API_TOKEN` | One of the two | Account API token. Get it from Codacy > Account > API Tokens |
| `CODACY_PROJECT_TOKEN` | One of the two | Repository (project) token, scoped to one repository. Get it from Codacy > Repository > Settings > Integrations > Project API token. **Outranks `CODACY_API_TOKEN`** — see `SPECS/repository-tokens.md` |
| `HTTPS_PROXY` / `HTTP_PROXY` | No | Proxy URL per scheme (lowercase also honored). Resolved by `@codacy/tooling`'s `configureProxy()`, called once from `src/index.ts` via `configureProxyFromEnv()` |
| `NO_PROXY` / `no_proxy` | No | Comma-separated hosts that bypass the proxy (`*`, `.suffix`), matched **per request** — not once at startup |
| `SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS` | No | PEM CA bundle for a TLS-intercepting proxy. **Replaces** the default trust store; unreadable or non-PEM is fatal by design |
| `CODACY_CLI_INSECURE` | No | Disable TLS verification (also `NODE_TLS_REJECT_UNAUTHORIZED=0`). Last resort; warns on stderr |
| `CODACY_DISABLE_UPDATE_CHECK` | No | Disable the "update available" notice. Its `got` stack ignores the proxy variables above, so this is the escape hatch behind a strict proxy |

## Useful Context

- Codacy API docs: https://api.codacy.com/api/api-docs
- The CLI targets Codacy Cloud (app.codacy.com), not self-hosted instances
- Provider shortcodes used in commands: `gh` (GitHub), `gl` (GitLab), `bb` (Bitbucket)
