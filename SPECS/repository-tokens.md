# Repository (project) token support

Status: ✅ Done (2026-08-11) — [OD-489](https://linear.app/codacy/issue/OD-489/cloud-cli-add-support-for-project-tokens)

A **repository token** (also called a project token) is scoped to a single
repository, unlike an **account token**, which reaches everything its owner can
see. It lets CI and the auto-configuration agent authenticate without a personal
all-access token.

## How it reaches the API

| | Account token | Repository token |
|---|---|---|
| Header | `api-token` | `project-token` |
| Sources | `CODACY_API_TOKEN`, `codacy login` | `--repository-token`, `CODACY_PROJECT_TOKEN` |

Resolution order (`pickAuth` in `src/utils/auth.ts`), **identical to
`codacy-analysis`** so both CLIs document the same rule:

1. `--repository-token <token>` → repository token
2. `CODACY_PROJECT_TOKEN` → repository token
3. `CODACY_API_TOKEN` → account token
4. stored credentials (`codacy login`) → account token
5. otherwise: error

An explicit `--repository-token` wins outright — it never even looks for an
account token, so a deliberately-scoped run can't be silently widened by an
ambient env var or a stale login.

An explicitly-passed **empty** flag throws (`EMPTY_REPOSITORY_TOKEN_MESSAGE`)
rather than falling through. `--repository-token "$CODACY_PROJECT_TOKEN"` with
the secret unset is a routine CI mistake, and treating it as "no flag" would
hand the run an ambient account token — precisely the widening the precedence
rule exists to prevent. Empty *env vars* keep meaning "unset" (the test config
depends on it). Both flag and env values are trimmed.

> ⚠️ Because `CODACY_PROJECT_TOKEN` outranks `CODACY_API_TOKEN`, and it is the
> variable the Codacy coverage reporter reads (so it is routinely exported
> job-wide in CI), `vitest.config.mts` blanks it via `test.env` — otherwise token
> resolution under test would depend on the developer's shell.

## The backend whitelist

> ⚠️ **Re-verify this list after every `npm run update-api`.** The CLI's guards
> hardcode it; if the backend adds an operation, a guard here will still refuse
> it. Source: Linear project *"Project token works in selected API v3
> (+expiration)"*.
>
> **Last verified against API `57.4.17`** (2026-09-09). Since `57.4.x` the spec
> declares the `ProjectTokenAuth` security scheme (`project-token` header) on
> each supported operation, so the whitelist is now machine-checkable:
>
> ```bash
> python3 -c "
> import re
> cur=None; out=[]
> for l in open('api-v3/api-swagger.yaml'):
>     m=re.match(r'\s*operationId:\s*(\S+)', l)
>     if m: cur=m.group(1)
>     if 'ProjectTokenAuth' in l and cur and cur not in out: out.append(cur)
> print(len(out)); print('\n'.join(sorted(out)))"
> ```
>
> On `57.3.9` (the previously pinned build) the scheme was not declared
> anywhere, which is why this table was maintained by hand.

Codacy accepts a repository token on **exactly** these 14 operations. Everywhere
else it is rejected as if no token had been sent.

| operationId | Method | Used by this CLI |
|---|---|---|
| `listRepositoryTools` | GET | `tools`, `tool`, `patterns`, `pattern`, `issues -O` |
| `listRepositoryToolPatterns` | GET | `patterns`, `pattern`, `issues -O` |
| `getRepositoryWithAnalysis` | GET | `repository`, `tools --import` |
| `issuesOverview` | POST | `repository`, `issues -O` |
| `searchRepositoryIssues` | POST | `issues` |
| `toolPatternsOverview` | GET | `patterns --enable-all/--disable-all` |
| `listRepositoryCommits` | GET | `repository`, `repository --reanalyze*` |
| `configureTool` | PATCH | `tool`, `pattern`, `tools --import` |
| `updateRepositoryToolPatterns` | PATCH | `patterns`, `tools --import` |
| `reanalyzeCommitById` | POST | `repository --reanalyze*` |
| `getRepositoryLanguages` | GET | — |
| `getRepository` | GET | — |
| `listIgnoredFiles` | GET | — |
| `searchAiInventoryCategories` | POST | — |

`ToolsService.listTools` / `listPatterns` / `getPattern` are declared
`security: []` in the spec — unauthenticated, so they work with any token or
none. `issues -T <name>` and the `issues -O` noise suggestions rely on this.

## Support matrix

| Command | Under a repository token |
|---|---|
| `tool`, `patterns`, `pattern` | ✅ all modes |
| `issues` (list, all filters, `-O`) | ✅ |
| `issues --ignore` / `--ignored` | ❌ refused |
| `tools` (list, `--import`) | ✅ |
| `tools --import --force` | ❌ refused **when standards exist**; warns and continues when there are none (`--force` is then a no-op) |
| `repository` (dashboard) | ⚠️ partial — pull requests + coverage reports skipped |
| `repository --reanalyze` / `--reanalyze-and-wait` | ✅ |
| `repository --add/--remove/--follow/--unfollow/--link-standard/--unlink-standard` | ❌ refused |
| `info`, `repositories`, `ls`, `directories`, `pull-request`, `pull-requests`, `issue`, `findings`, `finding` | ❌ refused |
| `login`, `logout` | Warn that the flag is ignored |

Every invocation in the `configure-codacy-cloud` skill lands in ✅ or the
partial-but-sufficient `repository` dashboard.

## Implementation notes

- **Fail fast, never a bare 401.** Guards run *before* any request — and before
  `resolveRepoArgs`, which shells out to git and prints an auto-detection line
  that would be misleading ahead of a refusal. Refusal messages name the
  operation, the reason, **and where the token came from** (`--repository-token`
  vs `CODACY_PROJECT_TOKEN`), which is what makes a surprising refusal
  debuggable in one read.
- **`--repository-token` has no short flag.** The short-flag space collides per
  command (`-r` is `repository --remove`, `-R` is `--reanalyze`, `-t` is
  `--tags` on `issues`/`patterns` and `--token` on `login`), so any letter would
  mean different things in different commands. `codacy-analysis` dropped its
  short flag for the same reason. This is a deliberate exception to the
  "every option needs a short flag" rule in `src/commands/AGENTS.md`.
- **Declared per command, plus once on the root program**, via
  `.addOption(repositoryTokenOption())`. Declaring it only in `index.ts` would
  make it invisible to the test harnesses, which each build a bare
  `new Command()`. `repositoryTokenFlag()` reads the command's own value before
  the inherited one, so the nearest wins.
- **`repository` dashboard degradation.** `listRepositoryPullRequests` is
  skipped rather than attempted. The table keeps the `Open Pull Requests` header
  with an explanatory line — a vanishing section reads as a bug, and
  `printPullRequests([])` would claim "No open pull requests", a different and
  false statement. In JSON, `pullRequests` stays `[]` (so `jq '.pullRequests[]'`
  and `| length` keep working) and an additive `unavailable` array distinguishes
  "none" from "couldn't look". Under an account token the payload is
  byte-identical.

  `unavailable` used to list `coverageReports` too: `listCoverageReports` is not
  whitelisted, and skipping it silently suppressed the coverage state on the
  Analysis row. That call is gone — `getRepositoryWithAnalysis`, which *is*
  whitelisted, now returns `coverage.status`, so a repository token gets the
  full coverage state (in the Analysis row, the Metrics section and JSON) and
  `unavailable` is `["pullRequests"]` alone. This is one of the few places where
  a repository token gained capability rather than losing it.
- **`login` is account-only.** It validates against `/user`, which a repository
  token can never reach, and the credentials store holds a single bare token
  with no record of its kind. Its 401 message names the repository-token case
  explicitly, since that request fails by design rather than because the token
  is bad.
- **The "flag ignored" warning keys on the explicit flag only**, never on an
  ambient `CODACY_PROJECT_TOKEN` — warning on that would fire on every
  unrelated invocation in CI and train users to ignore warnings.

See [missing-endpoints.md](missing-endpoints.md) for the whitelist gaps worth
closing.
