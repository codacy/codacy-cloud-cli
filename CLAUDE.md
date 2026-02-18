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
├── src/
│   ├── index.ts                 # CLI entry point (Commander.js setup)
│   ├── api/
│   │   └── client/              # AUTO-GENERATED - do NOT edit manually
│   │       ├── core/            # Request handling, auth, errors
│   │       ├── models/          # 520+ TypeScript interfaces from OpenAPI
│   │       └── services/        # 28 service classes wrapping API endpoints
│   ├── commands/                # One file per command (see Command Pattern below)
│   │   └── CLAUDE.md            # Design decisions for commands
│   └── utils/                   # Shared utilities (auth, error handling, output formatting)
├── api-v3/
│   └── api-swagger.yaml         # OpenAPI 3.0.1 spec (source of truth for client generation)
├── dist/                        # Compiled JS output (gitignored)
├── TODO.md                      # Backlog of tasks - agents MUST read and update this
├── CLAUDE.md                    # This file
├── package.json
└── tsconfig.json
```

## Critical Rules

### For All Agents

1. **Read `TODO.md` before starting work.** Understand the current backlog, what's done, and what's next. When completing a task, mark it as done in `TODO.md` with the date.
2. **Never edit files under `src/api/client/`.** This directory is auto-generated. If the API client needs updating, run `npm run update-api`.
3. **Ask before assuming.** If a task in TODO.md or user instruction is ambiguous, ask clarifying questions before writing code. Do not guess intent.
4. **Document what you build.** Every command, utility, or significant piece of logic must include:
   - Inline comments where the logic isn't self-evident
   - A `CLAUDE.md` in the relevant folder explaining design and implementation decisions when the folder contains multiple related files
5. **Write tests for everything.** Every command must have corresponding tests. See Testing section below.
6. **One command per file.** Each CLI command lives in its own file inside `src/commands/`. The file exports a `register<Name>Command(program: Command)` function.
7. **Keep the entry point thin.** `src/index.ts` only handles Commander setup and command registration. No business logic belongs there.
8. **Keep `README.md` up to date.** After adding or changing commands, options, or usage patterns, update the README to reflect the current state. The README is the public-facing documentation for users of the CLI.

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
- **Pagination:** All commands calling paginated APIs must call `printPaginationWarning(response.pagination, hint)` from `utils/output.ts` after displaying results. The hint should suggest command-specific filtering options.
- **Error handling:** Use `try/catch` with the shared `handleError()` from `src/utils/error.ts`
- **Authentication:** All commands that call the API must call `checkApiToken()` from `src/utils/auth.ts` before making requests
- **API base URL:** `https://app.codacy.com/api/v3` (configured in `src/index.ts` via `OpenAPI.BASE`)
- **Auth mechanism:** `CODACY_API_TOKEN` environment variable, sent as `api-token` header

### Command Pattern

Every command file follows this structure:

```typescript
// src/commands/<command-name>.ts
import { Command } from "commander";
import ora from "ora";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
// Import relevant API service(s)

export function register<Name>Command(program: Command) {
  program
    .command("<command-name>")
    .description("Clear description of what this command does")
    .argument("[args]", "Description of arguments")
    .option("--flag <value>", "Description of options")
    .action(async (args, options) => {
      try {
        checkApiToken();
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

## TODO Backlog

The file `TODO.md` at the project root is the single source of truth for the project backlog. It tracks:
- Pending tasks (what to build next)
- In-progress work
- Completed tasks (with dates)

**Agents must:**
1. Read `TODO.md` at the start of every session
2. Pick up the next pending task (or the one specified by the user)
3. Mark tasks as done when completed, with the completion date
4. Add new tasks discovered during work (e.g., follow-up improvements, bugs found)

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CODACY_API_TOKEN` | Yes | API token for authenticating with Codacy. Get it from Codacy > Account > API Tokens |

## Useful Context

- Codacy API docs: https://api.codacy.com/api/api-docs
- The CLI targets Codacy Cloud (app.codacy.com), not self-hosted instances
- Provider shortcodes used in commands: `gh` (GitHub), `gl` (GitLab), `bb` (Bitbucket)
