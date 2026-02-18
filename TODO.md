# TODO Backlog

This file is the single source of truth for project tasks. Agents must read this at the start of every session, pick up pending work, and mark tasks as done when completed.

**Format:**
- `[ ]` Pending
- `[~]` In progress
- `[x]` Done (include date: YYYY-MM-DD)

---

## Project Setup

- [x] 2026-02-17 Set up test framework (Vitest or Jest) with TypeScript support
- [x] 2026-02-17 Add test script to `package.json`
- [x] 2026-02-17 Create test configuration file
- [x] Remove existing prototype commands (`user.ts`, `orgs.ts`, `repos.ts`) and their registrations in `index.ts`
- [x] 2026-02-17 Clean up `src/index.ts` to be a minimal boilerplate ready for new commands
- [x] 2026-02-17 Add `--output json` flag support to all commands for scriptable output

## Commands

> Commands to rebuild with proper structure, tests, and documentation.

### Info Command
> Show authenticated user information and their available organizations
> API Command: [getUser](https://api.codacy.com/api/api-docs#getuser)

Important information to show about a user:
- Name
- Email
- Other Emails
- Is an Administrator?
- Is the account active?
- Organizations
  - Name
  - Provider (GitHub, GitLab, Bitbucket)
  - Type
  - Join status

- [x] 2026-02-17 Implement `info` command - show authenticated user info, show available organizations
- [x] 2026-02-17 Write tests for `info` command

### Repositories Command
> Show repositories for an organization.
> API Command: [listOrganizationRepositoriesWithAnalysis](https://api.codacy.com/api/api-docs#listorganizationrepositorieswithanalysis)

Important information to show about a repository:
- Name
- Type (Public, Private)
- Grade
- Issues Count
- Complex Files %
- Duplication %
- Coverage %
- Last Updated

Use the information in Goals to show quality values in red or green.

Allow a parameter `--search <query>` to filter repositories by name.

- [x] 2026-02-17 Implement `repositories` command - show repositories for an organization
- [x] 2026-02-17 Write tests for `repositories` command

### Repository Command

> Show details, status, and metrics for a specific repository.
> API Endpoints to use: 
- [getRepositoryAnalysis](https://api.codacy.com/api/api-docs#getrepositorywithanalysis)
- [listRepositoryPullRequests](https://api.codacy.com/api/api-docs#listrepositorypullrequests)
- [issuesOverview](https://api.codacy.com/api/api-docs#issuesoverview)

Important information to show:
- About the repository
  - Provider / Organization / Repository Name / Visibility
  - Default Branch
  - Last Updated
  - Last Analysis (Time and Commit SHA)
- Repository Setup
  - Languages
  - Followed Coding Standards (use `standards` property from `RepositoryAnalysis`)
  - Followed Quality Gates
  - Problems
- Repository Metrics (use the `goals` to know the thresholds for the metrics)
  - Issues (Count and Issues / kLoC)
  - Coverage %
  - Complex Files %
  - Duplication %
- Open Pull Requests
- Issues Review Totals by Category, Severity Level, and Language

- [x] 2026-02-18 Implement `repository` command - show details, status, and metrics for a specific repository
- [x] 2026-02-18 Write tests for `repository` command

## Deployment & CI

- [ ] Make the project ready to deploy to npm and be executed as a CLI tool by running `npm install -g`
- [ ] Add CI pipeline for build + test (GitHub Actions)
- [ ] Add CI pipeline for deploy to npm (GitHub Actions)
- [ ] Add CLI help examples to each command

---

## Completed

- 2026-02-17: Project setup complete — Vitest configured, `--output json` global flag, `src/index.ts` cleaned up
- 2026-02-17: `info` command implemented with tests (4 tests)
- 2026-02-17: `repositories` command implemented with tests (5 tests)
- 2026-02-17: Utility tests added for `auth` and `providers` (6 tests)
- 2026-02-17: `src/commands/CLAUDE.md` created with design decisions
- 2026-02-18: `repository` command implemented with tests (5 tests) — dashboard with about, setup, metrics, PRs, and issues overview
