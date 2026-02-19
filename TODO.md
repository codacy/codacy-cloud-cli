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

### Pull Request Command
> Show details for a specific pull request.
> API Endpoints to use: 
- [getRepositoryPullRequest](https://api.codacy.com/api/api-docs#getrepositorypullrequest)
- [listPullRequestIssues](https://api.codacy.com/api/api-docs#listpullrequestissues)
- [listPullRequestFiles](https://api.codacy.com/api/api-docs#listpullrequestfiles)

Important information to show:
- About the pull request
  - Provider / Organization / Repository Name / Visibility
  - Pull Request Number
  - Title
  - Created At
  - Updated At
  - Last Analysis (Time and Commit SHA)
  - From Branch to Target Branch
  - Status (Open, Closed, Merged)
  - Author
- About the analysis
  - Is it currently being analyzed?
  - Is it up to standards?
  - Issues (New and Fixed)
  - Coverage Diff and Delta
  - Complex Delta
  - Duplication Delta
  - General considerations
    - use again `resultReasons` to color the metrics, and this time, if a metric is not up to the standards, show why (e.g. "Fails <= 2 medium issues")
    - if in `resultReasons` there is a gate value expected for a metric that still has no data, also show it next to the metric saying for example "To check >= 50% gate"
- Issues List: show new and new potential issues only (`onlyPotential` false for non potential, true for only potential -- new issues have `deltaType` = 'Added'); sort by severity level, showing the most sever first
  - File Path, Line Number
  - Line content
  - Issue message
  - Category
  - Severity (red for critical/error, orange for high, yellow for medium/warning, blue for low/info)
  - Subcategory (only for security issues)
  - Detected by (Tool + Pattern title; e.g. "ESLint: no undef vars")
- Files List: list only files with any metric delta change
  - File Path
  - Issues +{New Issues} / -{Fixed Issues}
  - Coverage Delta +/-{Delta Coverage %}
  - Complex Delta
  - Duplication Delta

For the Issues List in particular, showing them in a table will not work. So follow this format:
```
--------------------------------

{Severity} | {Category} {Subcategory} | {Detected by}
{Issue Message}

{File Path}:{Line Number} 
{Line content}

--------------------------------
```

- [x] 2026-02-18 Implement `pull-request` command - show details for a specific pull request
- [x] 2026-02-18 Write tests for `pull-request` command


## Deployment & CI

- [x] 2026-02-18 Make the project ready to deploy to npm and be executed as a CLI tool by running `npm install -g`
- [x] 2026-02-18 Make the project ready to distribute later as a separate brew formula for macOS/Linux/Windows
- [x] 2026-02-18 Add CI pipeline for build + test (GitHub Actions)
- [x] 2026-02-18 Add CI pipeline for deploy to npm (GitHub Actions)
- [x] 2026-02-18 Add CLI help examples to each command

---

## Completed

- 2026-02-17: Project setup complete — Vitest configured, `--output json` global flag, `src/index.ts` cleaned up
- 2026-02-17: `info` command implemented with tests (4 tests)
- 2026-02-17: `repositories` command implemented with tests (5 tests)
- 2026-02-17: Utility tests added for `auth` and `providers` (6 tests)
- 2026-02-17: `src/commands/CLAUDE.md` created with design decisions
- 2026-02-18: `repository` command implemented with tests (5 tests) — dashboard with about, setup, metrics, PRs, and issues overview
- 2026-02-18: Extracted shared formatting helpers to `utils/formatting.ts` (reused by repository + pull-request)
- 2026-02-18: `pull-request` command implemented with tests (11 tests) — about, analysis with gate reasons, issues cards, files list
- 2026-02-18: npm package ready — bin, files, prepublishOnly, tsconfig.build.json, engines
- 2026-02-18: CI pipelines — build+test on push/PR (Node 18/20/22), publish to npm on release
- 2026-02-18: CLI help examples added to all commands
