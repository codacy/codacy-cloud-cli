# Codacy Cloud CLI — Specs

This is the single source of truth for all project tasks and specs.

**Agents: read this file at the start of every session.** Pick up the next pending task, then read the relevant spec file for full details.

## Pending Tasks

_No pending tasks._

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
