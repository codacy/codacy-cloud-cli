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


### Issues Command
> Search for issues in a repository.
> API Endpoints to use: 
- [searchRepositoryIssues](https://api.codacy.com/api/api-docs#searchrepositoryissues)
- [issuesOverview](https://api.codacy.com/api/api-docs#issuesoverview)

Allow these parameters to filter the issues:
- branch: branch name
- patterns: comma separated list of pattern IDs
- severity: comma separated list of severity levels
- category: comma separated list of category names
- language: comma separated list of language names
- tags: comma separated list of tag names
- author: comma separated list of author emails
- overview: boolean to show the overview of the issues instead of the list

Use the same formatting as the `pull-request` command for the issues list. 

If `overview` parameter is provided, show the totals by language, category, severity, tag, and author.

Both endpoints accept the same body parameters for filtering (`SearchRepositoryIssuesBody`).

- [x] 2026-02-19 Implement `issues` command - search for issues in a repository
- [x] 2026-02-19 Write tests for `issues` command


### Security Findings Command
> Show security findings for a repository or an organization.
> API Endpoints to use: 
- [searchSecurityItems](https://api.codacy.com/api/api-docs#searchsecurityitems)

For this command the repository part is optional.
- codacy findings gh my-org my-repo // list findings for a repository
- codacy findings gh my-org // list findings for the organization

Allow these parameters to filter the findings:
- search: search term to filter the findings
- severities: comma separated list of severity (called priority in the API) names
- statuses: comma separated list of status names
- categories: comma separated list of category names
- scan-types: comma separated list of scan types
- dast-targets: comma separated list of DAST target URLs

Use a similar formatting as the `issues` command, with the same rules (totals, pagination limits, etc.). This is the format:
```
--------------------------------

{Severity/Priority} | {SecurityCategory} {ScanType} | {Optional: Likelihood} {Optional: EffortToFix} | {Optional: Repository Name when seeing organization findings}
{Finding Title}

{Status} {DueAt} | {Optional: CVE or CWE} {Optional: AffectedVersion -> FixedVersion} {Optional: Application} {Optional: AffectedTargets}  

--------------------------------
```

- [x] 2026-02-20 Implement `findings` command - show security findings for a repository or an organization
- [x] 2026-02-20 Write tests for `findings` command


### Quality Single Issue Command

> Show full details of a single quality issue.
> API Endpoints to use: 
- [getIssue](https://api.codacy.com/api/api-docs#getissue)
- [getPattern](https://api.codacy.com/api/api-docs#getpattern)
- [getFileContent](https://api.codacy.com/api/api-docs#getfilecontent)

Before implementing this command, add the `issueId` in the `issues` command output. Add it at the bottom of the card.

To get the information about the pattern, you need to call the `getPattern` endpoint with the `id` from the `patternInfo` object.

Use this format to show the details:
```
--------------------------------

{Severity} | {Category} {Subcategory}
{Issue Message}

{File Path}:{Line Number} 
{Extended Line content}

#IF FALSE POSITIVE
Potential false positive: {falsePositiveReason}
#ENDIF

{PatternInfo.Description}

Why is this a problem?
{PatternInfo.Rationale}

How to fix it?
{PatternInfo.Solution}

Tags: {PatternInfo.Tags}

Detected by: {PatternInfo.Tool}
{PatternInfo.Title} ({PatternInfo.Id})

--------------------------------
```

For the extended line content, you need to call the `getFileContent` endpoint with the `filePath` from the `issue` object.
Get +/-5 lines around the line number from the `issue` object.

Use this format to show the extended line content:
```
123 | content of the line
124 | content of the line
125 | content of the line
126 | content of the line
127 | content of the line
128 | LINE OF CONTENT OF THE ISSUE
{Optional: if present, show issue.suggestion in green and bold; with the same line number as the issue}
129 | content of the line
130 | content of the line
131 | content of the line
132 | content of the line
133 | content of the line
```

- [x] 2026-02-23 Implement `issue` command - show full details of a single quality issue
- [x] 2026-02-23 Write tests for `issue` command


### Security Single Finding Command
> Show full details of a single security finding.
> API Endpoints to use: 
- [getSecurityItem](https://api.codacy.com/api/api-docs#getsecurityitem)

Before implementing this command, add the `id` in the `findings` command output. Add it at the bottom of the card.

Use this format to show the details:
```
--------------------------------

{Severity/Priority} | {SecurityCategory} {ScanType} | {Optional: Likelihood} {Optional: EffortToFix} | {Optional: Repository Name when seeing organization findings}
{Finding Title}

{Status} {DueAt} | {Optional: CVE or CWE} {Optional: AffectedVersion -> FixedVersion} {Optional: Application} {Optional: AffectedTargets} 

#IF IGNORED
Ignore by {ignoredAt.authorName} on {ignoredAt.at}
{Ignored Reason}
#ENDIF

{Optional: Summary}
{Optional: Additional Information}
{Optional: Remediation}
{Optional: Pattern Information similar to the Issue command // only for findings with source Codacy}

--------------------------------
```

For findings of source Codacy, most of the information to show will be find in the security issue linked to the finding.
To show the information about it, you need first to call `getIssue` with the id you have in `itemSourceId`, and then `getPattern` to get the pattern information. Try to reuse as much code as possible from the Issue command (format, file context, false positive warning, etc.).


- [ ] Implement `finding` command - show full details of a single security finding
- [ ] Write tests for `finding` command



### Pull Request Coverage Command




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
- 2026-02-19: `issues` command implemented with tests (11 tests) — card-style list with filters, `--overview` mode with count tables by category/severity/language/tag/author
- 2026-02-20: `findings` command implemented with tests (13 tests) — card-style list for repo or org-wide, filters by severity/status/category/scan-type/DAST targets, CVE/CWE/version display
- 2026-02-23: `issue` command implemented with tests (8 tests) — full detail card with ±5 line context, pattern description/rationale/solution, suggestion, false positive warning; `issues` cards now show `resultDataId` for reference
- 2026-02-23: `pull-request --issue <id>` option added (4 new tests) — fetches all PR issues with pagination, filters by resultDataId, renders full issue detail using shared `printIssueDetail` from `utils/formatting.ts`
