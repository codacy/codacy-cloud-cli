# Codacy Cloud CLI — Specs

This is the single source of truth for all project tasks and specs.

**Agents: read this file at the start of every session.** Pick up the next pending task, then read the relevant spec file for full details.

## Pending Tasks

_No pending tasks._ All commands implemented.

## Command Inventory

| Command | Alias | Status | Spec |
|---|---|---|---|
| `info` | `inf` | ✅ Done | [info.md](commands/info.md) |
| `repositories` | `repos` | ✅ Done | [repositories.md](commands/repositories.md) |
| `repository` | `repo` | ✅ Done (actions added) | [repository.md](commands/repository.md) |
| `pull-request` | `pr` | ✅ Done (--diff + Diff Coverage Summary added) | [pull-request.md](commands/pull-request.md) |
| `issues` | `is` | ✅ Done | [issues.md](commands/issues.md) |
| `issue` | `iss` | ✅ Done | [issue.md](commands/issue.md) |
| `findings` | `fins` | ✅ Done | [findings.md](commands/findings.md) |
| `finding` | `fin` | ✅ Done (CVE enrichment included) | [finding.md](commands/finding.md) |
| `tools` | `tls` | ✅ Done | [tools-and-patterns.md](commands/tools-and-patterns.md) |
| `tool` | `tl` | ✅ Done | [tools-and-patterns.md](commands/tools-and-patterns.md) |
| `patterns` | `pats` | ✅ Done | [tools-and-patterns.md](commands/tools-and-patterns.md) |
| `pattern` | `pat` | ✅ Done | [tools-and-patterns.md](commands/tools-and-patterns.md) |
| `analysis` | N/A | ✅ Done | [analysis.md](commands/analysis.md) |
| `json-output` | N/A | ✅ Done | [json-output.md](commands/json-output.md) |
| `login` | N/A | ✅ Done | — |
| `logout` | N/A | ✅ Done | — |


## Other Specs

- [setup.md](setup.md) — test framework, build, CI/CD setup
- [deployment.md](deployment.md) — npm publishing, brew formula

## Changelog

| Date | What was done |
|---|---|
| 2026-02-17 | Project setup: Vitest, `--output json`, `src/index.ts` cleaned up |
| 2026-02-17 | `info` command + tests (4 tests) |
| 2026-02-17 | `repositories` command + tests (5 tests) |
| 2026-02-17 | Utility tests: `auth`, `providers` (6 tests) |
| 2026-02-17 | `src/commands/CLAUDE.md` created with design decisions |
| 2026-02-18 | `repository` command + tests (5 tests) |
| 2026-02-18 | Shared formatting helpers extracted to `utils/formatting.ts` |
| 2026-02-18 | `pull-request` command + tests (11 tests) |
| 2026-02-18 | npm package ready (bin, files, prepublishOnly, tsconfig.build.json, engines) |
| 2026-02-18 | CI pipelines: build+test on Node 18/20/22, publish to npm on release |
| 2026-02-18 | CLI help examples added to all commands |
| 2026-02-19 | `issues` command + tests (11 tests) |
| 2026-02-20 | `findings` command + tests (13 tests) |
| 2026-02-23 | `issue` command + tests (8 tests); `issues` cards now show `resultDataId` |
| 2026-02-23 | `pull-request --issue <id>` option added (4 new tests) |
| 2026-02-24 | `finding` command + tests (9 tests); `findings` cards now show finding `id` |
| 2026-02-24 | CVE enrichment for `finding`: fetches `cveawg.mitre.org` in parallel, shows CVSS/description/references (5 new tests, 102 total) |
| 2026-02-24 | SPECS folder created — TODO.md split into `SPECS/README.md` + per-command specs + setup/deployment |
| 2026-02-25 | `pull-request --diff` option + Diff Coverage Summary section (6 new tests, 108 total) |
| 2026-02-25 | `repository` actions: `--add`, `--remove`, `--follow`, `--unfollow` (4 new tests, 112 total) |
| 2026-02-25 | `tools`, `tool`, `patterns`, `pattern` commands + tests (35 new tests, 147 total); `findToolByName` helper added to `utils/formatting.ts` |
| 2026-03-02 | `issue --ignore`, `pull-request --ignore-issue` / `--ignore-all-false-positives`, `finding --ignore` + tests (17 new tests, 164 total); all use `-R/--ignore-reason` and `-m/--ignore-comment` options |
| 2026-03-05 | Analysis status in `repository` and `pull-request` About sections using `formatAnalysisStatus()`; `--reanalyze` option for both commands (13 new tests, 185 total) |
| 2026-03-05 | JSON output filtering with `pickDeep` across all commands: `info`, `repositories`, `repository`, `pull-request`, `issues`, `issue`, `findings`, `finding`, `tools`, `patterns`; documented pattern in `src/commands/CLAUDE.md` |
| 2026-03-12 | `patterns --enable-all` / `--disable-all` bulk update with filter support (6 new tests, 196 total) |
| 2026-03-12 | `login` and `logout` commands: encrypted token storage in `~/.codacy/credentials`, masked interactive prompt, `--token` flag for non-interactive use, token resolution chain (env var → stored credentials); `checkApiToken()` updated to set `OpenAPI.HEADERS` dynamically (9 new tests, 219 total) |
