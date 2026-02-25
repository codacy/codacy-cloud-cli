# `issue` Command Spec

**Status:** ✅ Done (2026-02-23)

## Purpose

Show full details of a single quality issue, including file context, pattern description, and suggested fix.

## Usage

```
codacy issue <provider> <organization> <repository> <issueId>
codacy iss gh my-org my-repo 12345
codacy iss gh my-org my-repo 12345 --output json
```

The `issueId` is the `resultDataId` shown at the bottom of each issue card in `issues` and `pull-request`.

## API Endpoints (parallel after `getIssue`)

1. [`getIssue`](https://api.codacy.com/api/api-docs#getissue) — `AnalysisService.getIssue(provider, org, repo, resultDataId)`
2. Then in parallel:
   - [`getPattern`](https://api.codacy.com/api/api-docs#getpattern) — `ToolsService.getPattern(toolUuid, patternId)`
   - [`getFileContent`](https://api.codacy.com/api/api-docs#getfilecontent) — `FileService.getFileContent(provider, org, repo, encodedPath, startLine, endLine)`

File context: ±5 lines around the issue's line number.

## Output Format

Rendered via shared `printIssueDetail` from `utils/formatting.ts`:

```
────────────────────────────────────────

{Severity colored} | {Category} {SubCategory?}
{Issue message}

{FilePath}:{LineNumber}
{Extended line content (±5 lines)}
{Optional: suggestion line in green+bold}

{Optional: Potential false positive warning}

{Pattern description}

Why is this a problem?
{Pattern rationale}

How to fix it?
{Pattern solution}

Tags: {pattern tags}

Detected by: {tool name}
{pattern title} ({pattern id})

────────────────────────────────────────
```

## Tests

File: `src/commands/issue.test.ts` — 8 tests.
