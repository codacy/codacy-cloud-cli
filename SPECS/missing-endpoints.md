# Missing repository-token endpoints

Backlog of API v3 operations that **don't** accept a repository (project) token
but would unlock Cloud CLI functionality if they did. Found while implementing
[OD-489](https://linear.app/codacy/issue/OD-489/cloud-cli-add-support-for-project-tokens);
each row is a candidate Linear task against the backend whitelist (see
[repository-tokens.md](repository-tokens.md) for the current 13).

Nothing here blocks the `configure-codacy-cloud` skill — it is fully supported
today. These are quality-of-life gaps that force users onto an account token for
otherwise repository-scoped work.

## Ranked by value

| # | operationId | Method | Unblocks | Why it matters |
|---|---|---|---|---|
| 1 | `listRepositoryPullRequests` | GET | `codacy pull-requests`, and the only reason `codacy repository` degrades at all | The single highest-value gap. Adding it makes the `repository` dashboard complete under a repository token and removes the whole skip/`unavailable` code path. Also unblocks a repository-scoped command users reach for constantly. |
| 2 | `getIssue` | GET | `codacy issue <id>` | Odd asymmetry today: `codacy issues` lists issues fine, but drilling into one is refused. Wants `getFileContent` (below) alongside it to render the code context. |
| 3 | `getFileContent` | GET | `codacy issue`, `codacy finding` code context | Only useful paired with #2. |
| 4 | `searchRepositoryIgnoredIssues` | POST | `codacy issues --ignored` | Read-only, and a natural sibling of the already-whitelisted `searchRepositoryIssues`. |
| 5 | `bulkIgnoreIssues` | POST | `codacy issues --ignore` | Write. Would let the auto-configuration flow ignore noisy issues instead of only disabling patterns. Note: a future read-only repository token must block this by operationId. |
| 6 | `updateIssueState` | PATCH | `codacy issue --ignore/--unignore` | Same category as #5, single-issue. |
| 7 | `uploadImageSbom` | POST | `codacy image --upload` from CI | Write, and the odd one out on this list: it is organization-scoped like the rest of `SbomService`, but it is the one image operation a *pipeline* runs, and pipelines are exactly where a repository token is the natural credential (the coverage reporter already reads `CODACY_PROJECT_TOKEN` there). The upload already names a `repositoryName`, so a repository-scoped token has an obvious meaning for it. Needs a decision from the API owners rather than an assumption. |
| 8 | `listCoverageReports` | GET | The coverage-expectation suffix on `codacy repository`'s Analysis row | Lowest value of the reads: it affects one optional suffix and has **zero** JSON impact (no coverage key is projected). Listed for completeness. |

## Deliberately out of scope

Per the parent project's "Out of scope" section, these are intended to keep
refusing repository tokens — documented rather than fixed:

- `AccountService.getUser` / `listUserOrganizations` — account-level by
  definition (`codacy info`).
- `listOrganizationRepositoriesWithAnalysis` — organization-level
  (`codacy repositories`).
- `SecurityService.*` (`searchSecurityItems`, `getSecurityItem`,
  `ignoreSecurityItem`, `unignoreSecurityItem`) — security findings are
  organization-scoped (`codacy findings` / `finding`).
- `addRepository`, `deleteRepository`, `followAddedRepository`,
  `unfollowRepository` — account-level repository management.
- `applyCodingStandardToRepositories` — coding standards are organization-level
  (`codacy repository --link-standard`, `codacy tools --import --force`).

## Unclear / needs a decision

- `RepositoryService.listFiles` / `listDirectories` — back `codacy ls` and
  `codacy directories`. Both are plainly repository-scoped reads, so there's no
  obvious reason to refuse them, but they weren't part of the CI-setup or
  auto-configuration use cases the whitelist was drawn around. Worth asking
  whether the omission was deliberate.
