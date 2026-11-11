import * as path from "path";
import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import pluralize from "pluralize";
import { repositoryTokenOption, resolveAccountAuth } from "../utils/auth";
import { handleError } from "../utils/error";
import { createTable, getOutputFormat, pickDeep, printJson } from "../utils/output";
import { sanitizeText } from "../utils/sanitize";
import { resolveRepoArgs } from "../utils/resolve-repo-args";
import {
  fetchAllFiles,
  getCwdRepoRelativePath,
  normalizeRepoPath,
} from "../utils/repo-tree";
import {
  colorSeverity,
  formatDependencyChainsLine,
  formatCount,
  formatCountCell,
  formatCoverageCell,
  formatGrade,
  printIssueCard,
  printSection,
} from "../utils/formatting";
import { RepositoryService } from "../api/client/services/RepositoryService";
import { FileService } from "../api/client/services/FileService";
import { CodeBlockLine } from "../api/client/models/CodeBlockLine";
import { CommitIssue } from "../api/client/models/CommitIssue";
import { FileClone } from "../api/client/models/FileClone";
import { FileInformationWithAnalysis } from "../api/client/models/FileInformationWithAnalysis";
import { PaginationInfo } from "../api/client/models/PaginationInfo";
import { ApiError } from "../api/client/core/ApiError";

/**
 * `codacy file` — the CLI counterpart of the file view in the Codacy UI:
 * summary metrics, the file's issues and clones, and its source code with a
 * coverage gutter. See SPECS/commands/file.md.
 */

interface FileOptions {
  branch?: string;
  lines?: string;
  /** Commander's `--no-source` negation: true unless the flag is passed. */
  source: boolean;
}

export interface LineRange {
  from?: number;
  to?: number;
}

/** Glyph for the coverage gutter; colored green (covered) or red (not covered). */
const COVERAGE_BAR = "▌";

/**
 * Parse `--lines`: `40-120`, `40-` (to the end) or `40` (one line).
 * Throws on anything else so the command fails before any request.
 */
export function parseLineRange(value: string): LineRange {
  const match = /^\s*(\d+)\s*(?:(-)\s*(\d*)\s*)?$/.exec(value);
  if (!match) {
    throw new Error(
      `Invalid --lines value "${value}". Use FROM-TO, FROM- or a single LINE (e.g. 40-120, 40-, 40).`,
    );
  }
  const from = parseInt(match[1], 10);
  const hasDash = match[2] !== undefined;
  const to = match[3] ? parseInt(match[3], 10) : hasDash ? undefined : from;
  if (from < 1 || (to !== undefined && to < from)) {
    throw new Error(
      `Invalid --lines value "${value}": lines start at 1 and the start must not exceed the end.`,
    );
  }
  return { from, to };
}

/**
 * Turn the user's path argument into a repository-relative path. With an
 * auto-detected repository the path is relative to the current directory (like
 * a local file path); with an explicit repository it is relative to the root.
 */
export function resolveFilePath(input: string, autoDetected: boolean): string {
  const joined = autoDetected
    ? path.posix.join(getCwdRepoRelativePath(), input.trim())
    : input;
  return normalizeRepoPath(joined);
}

/** Fetch every page of a cursor-paginated endpoint. */
async function fetchAllPages<T>(
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<{ data: T[]; pagination?: PaginationInfo }>,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const response = await fetchPage(cursor);
    all.push(...response.data);
    cursor = response.pagination?.cursor;
  } while (cursor);
  return all;
}

/**
 * Resolve a path to its Codacy `fileId` by listing the parent folder
 * (non-recursive) and matching the path exactly. Listing the parent instead of
 * using `search` avoids its substring/wildcard matching.
 */
async function resolveFileId(
  provider: string,
  organization: string,
  repository: string,
  branch: string | undefined,
  filePath: string,
): Promise<number> {
  const dir = path.posix.dirname(filePath);
  const files = await fetchAllFiles(
    provider,
    organization,
    repository,
    branch,
    dir === "." ? "" : dir,
  );
  const match = files.find((f) => f.path === filePath);
  if (!match) {
    throw new Error(
      `File '${sanitizeText(filePath)}' not found on Codacy. It may be ignored, not analyzed yet, ` +
        `or not on this branch${branch ? "" : " (try --branch)"}.`,
    );
  }
  return match.fileId;
}

interface RepoRef {
  provider: string;
  organization: string;
  repository: string;
}

interface FileData {
  info: FileInformationWithAnalysis;
  issues: CommitIssue[];
  clones: FileClone[];
  /** line number → hits; null when the file has no coverage data. */
  coverage: Map<number, number> | null;
  /** null when the source was not requested or could not be fetched. */
  source: CodeBlockLine[] | null;
  sourceError?: string;
}

async function fetchFileData(
  { provider, organization, repository }: RepoRef,
  filePath: string,
  fileId: number,
  fetchSource: boolean,
  range: LineRange,
): Promise<FileData> {
  const [info, issues, clones, coverageResponse] = await Promise.all([
    RepositoryService.getFileWithAnalysis(provider, organization, repository, fileId),
    fetchAllPages((cursor) =>
      RepositoryService.getFileIssues(provider, organization, repository, fileId, cursor, 100),
    ),
    fetchAllPages((cursor) =>
      RepositoryService.getFileClones(provider, organization, repository, fileId, cursor, 100),
    ),
    // Coverage is optional: a file without coverage data answers 404 ("No
    // coverage data for file …"). Any other failure is a real error.
    RepositoryService.getFileCoverage(provider, organization, repository, fileId).catch(
      (err: unknown) => {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      },
    ),
  ]);

  const coverage =
    coverageResponse && coverageResponse.data.length > 0
      ? new Map(coverageResponse.data.map((c) => [c.line, c.hits]))
      : null;

  let source: CodeBlockLine[] | null = null;
  let sourceError: string | undefined;
  if (fetchSource) {
    try {
      // Pinned to the analysed commit so line numbers match issues and coverage.
      // The raw path is passed: the client's global encoder (`encodePathSegment`,
      // installed in index.ts) escapes it once, `/` included.
      const content = await FileService.getFileContent(
        provider,
        organization,
        repository,
        filePath,
        range.from,
        range.to,
        info.file.commitSha,
      );
      source = content.data;
    } catch (err) {
      sourceError = err instanceof Error ? err.message : String(err);
    }
  }

  // Issues ordered by line, as they appear in the file.
  issues.sort((a, b) => a.lineNumber - b.lineNumber);
  return { info, issues, clones, coverage, source, sourceError };
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** The coverage gutter cell for one line: green/red bar, or blank when not coverable. */
export function coverageGutter(
  line: number,
  coverage: Map<number, number> | null,
): string {
  if (!coverage) return " ";
  const hits = coverage.get(line);
  if (hits === undefined) return " ";
  return hits > 0 ? ansis.green(COVERAGE_BAR) : ansis.red(COVERAGE_BAR);
}

/** Width of the separator under an inline issue card. */
const INLINE_SEPARATOR_WIDTH = 78;

/**
 * A compact issue card printed under its source line:
 *
 *   ↳   • Medium | Complexity  #131497158287
 *         Method printFindingDetail has 81 lines of code (limit is 60)
 *   ──────────────────────────────────────────
 *
 * The `↳` sits in the line-number column and the body aligns past the gutter.
 * The file path and line text of the full card are dropped: the line is right
 * above it.
 */
export function renderInlineIssue(issue: CommitIssue, width: number): string[] {
  const p = issue.patternInfo;
  const arrow = ansis.dim("↳".padStart(width, " "));
  const indent = " ".repeat(width + 5);
  const subCat = p.subCategory ? ` ${sanitizeText(p.subCategory)}` : "";
  const id = ansis.hex("#555555")(`#${issue.resultDataId}`);
  const out = [
    `${arrow}   • ${colorSeverity(p.severityLevel)} ${ansis.dim("|")} ${sanitizeText(p.category)}${subCat}  ${id}`,
    `${indent}${sanitizeText(issue.message)}`,
  ];
  if (
    issue.falsePositiveProbability !== undefined &&
    issue.falsePositiveProbability >= issue.falsePositiveThreshold
  ) {
    const reason = issue.falsePositiveReason || "No reason provided";
    out.push(`${indent}${ansis.yellow(`Potential false positive: ${sanitizeText(reason)}`)}`);
  }
  if (issue.dependencyChains?.length) {
    // Already sanitized by the helper.
    const chain = formatDependencyChainsLine(issue.dependencyChains, issue.fixedVersion);
    if (chain) out.push(`${indent}${ansis.dim(chain)}`);
  }
  out.push(ansis.dim(`${" ".repeat(Math.max(0, width - 1))}${"─".repeat(INLINE_SEPARATOR_WIDTH)}`));
  return out;
}

/**
 * Source lines as `NNN ▌ │ content`, with the coverage gutter, and each line's
 * issues rendered inline right under it.
 */
export function renderSource(
  lines: CodeBlockLine[],
  coverage: Map<number, number> | null,
  issues: CommitIssue[] = [],
): string[] {
  // A reduce, not Math.max(...lines): spreading ~150k lines overflows the stack.
  const maxLine = lines.reduce((max, l) => (l.number > max ? l.number : max), 0);
  const width = String(maxLine).length;
  const byLine = new Map<number, CommitIssue[]>();
  for (const issue of issues) {
    byLine.set(issue.lineNumber, [...(byLine.get(issue.lineNumber) ?? []), issue]);
  }
  return lines.flatMap((l) => {
    const num = ansis.dim(String(l.number).padStart(width, " "));
    // File content is attacker-controllable — neutralize before printing.
    const line = `${num} ${coverageGutter(l.number, coverage)} ${ansis.dim("│")} ${sanitizeText(l.content)}`;
    const inline = (byLine.get(l.number) ?? []).flatMap((i) => renderInlineIssue(i, width));
    return [line, ...inline];
  });
}

/**
 * Issues that won't appear inline: all of them without source, otherwise those
 * whose line isn't among the fetched source lines (outside `--lines`, or a line
 * the content endpoint didn't return).
 */
export function issuesNotInline(
  issues: CommitIssue[],
  source: CodeBlockLine[] | null,
): CommitIssue[] {
  if (!source || source.length === 0) return issues;
  const shown = new Set(source.map((l) => l.number));
  return issues.filter((i) => !shown.has(i.lineNumber));
}

function printSummary(data: FileData, branch: string | undefined): void {
  const { file, quality, coverage } = data.info;
  console.log(ansis.bold(`\n${sanitizeText(file.path)}`));
  const meta = [
    file.language ? sanitizeText(file.language) : undefined,
    branch ? `branch ${sanitizeText(branch)}` : undefined,
    file.commitSha ? `commit ${sanitizeText(file.commitSha.substring(0, 7))}` : undefined,
  ].filter(Boolean);
  if (meta.length) console.log(ansis.dim(meta.join(" · ")));
  if (file.ignored) {
    console.log(ansis.yellow("This file is ignored on Codacy and excluded from analysis."));
  }
  console.log();

  const clonesCount = quality?.duplication ?? data.clones.length;
  const duplication =
    quality?.duplicatedLinesOfCode !== undefined && quality?.duplicatedLinesOfCode !== null
      ? `${formatCount(clonesCount)} ${pluralize("clone", clonesCount)} · ` +
        `${formatCount(quality.duplicatedLinesOfCode)} duplicated ${pluralize("line", quality.duplicatedLinesOfCode)}`
      : `${formatCount(clonesCount)} ${pluralize("clone", clonesCount)}`;
  const coverageCell = coverage
    ? `${formatCoverageCell(coverage.coverage)} ${ansis.dim(
        `(${coverage.coveredLines}/${coverage.coverableLines} lines)`,
      )}`
    : formatCoverageCell(undefined);

  const table = createTable({
    head: ["Grade", "Issues", "Complexity", "Duplication", "Coverage"],
  });
  table.push([
    formatGrade(quality?.gradeLetter),
    formatCountCell(quality?.totalIssues ?? data.issues.length),
    formatCountCell(quality?.complexity),
    duplication,
    coverageCell,
  ]);
  console.log(table.toString());
}

/**
 * The top Issues section. Without source it lists every issue; with source the
 * issues are inline, so it only lists the ones that aren't (and is skipped when
 * there are none).
 */
function printIssues(data: FileData): void {
  const inlineMode = !!data.source && data.source.length > 0;
  const issues = issuesNotInline(data.issues, data.source);
  if (inlineMode) {
    if (issues.length === 0) return;
    printSection("Issues outside the shown lines", issues.length, "issue");
  } else {
    printSection("Issues", issues.length, "issue");
    if (issues.length === 0) {
      console.log(ansis.dim("No issues."));
      return;
    }
  }
  for (const issue of issues) printIssueCard(issue);
}

function formatBlock(from: number, to: number): string {
  return from === to ? `${from}` : `${from}-${to}`;
}

function printClones(clones: FileClone[], fileId: number, filePath: string): void {
  printSection("Clones", clones.length, "clone");
  if (clones.length === 0) {
    console.log(ansis.dim("No clones."));
    return;
  }
  const isHere = (o: FileClone["occurrences"][number]) =>
    o.fileId === fileId || o.path === filePath;
  // Ordered by where each clone starts in this file, like the issues.
  const firstLineHere = (c: FileClone) =>
    Math.min(...c.occurrences.filter(isHere).map((o) => o.fromLine), Infinity);
  const sorted = [...clones].sort((a, b) => firstLineHere(a) - firstLineHere(b));
  const table = createTable({ head: ["Lines", "Also in"] });
  for (const clone of sorted) {
    const here = clone.occurrences.filter(isHere);
    const elsewhere = clone.occurrences.filter((o) => !isHere(o));
    // Same-file clones: every occurrence beyond the first is also "elsewhere".
    const shownHere = here.slice(0, 1);
    const others = [...here.slice(1), ...elsewhere];
    table.push([
      shownHere.map((o) => formatBlock(o.fromLine, o.toLine)).join(", ") || ansis.dim("-"),
      others
        .map((o) => `${sanitizeText(o.path)}:${formatBlock(o.fromLine, o.toLine)}`)
        .join("\n") || ansis.dim("-"),
    ]);
  }
  console.log(table.toString());
}

function printSource(data: FileData): void {
  printSection("Source");
  if (!data.source) {
    console.log(
      ansis.dim(
        `Source not available${data.sourceError ? ` (${sanitizeText(data.sourceError)})` : ""}.`,
      ),
    );
    return;
  }
  if (data.source.length === 0) {
    console.log(ansis.dim("No lines in this range."));
    return;
  }
  if (data.coverage) {
    console.log(
      ansis.dim(`${ansis.green(COVERAGE_BAR)} covered  ${ansis.red(COVERAGE_BAR)} not covered\n`),
    );
  }
  for (const line of renderSource(data.source, data.coverage, data.issues)) console.log(line);
}

/** Issue fields in the JSON output — the same projection `issues` uses. */
const ISSUE_JSON_FIELDS = [
  "patternInfo.id",
  "patternInfo.severityLevel",
  "patternInfo.category",
  "patternInfo.subCategory",
  "message",
  "filePath",
  "lineNumber",
  "lineText",
  "resultDataId",
  "falsePositiveProbability",
  "falsePositiveThreshold",
  "falsePositiveReason",
  "advisoryInformation.advisoryId",
  "advisoryInformation.vulnerableFunctions",
  "advisoryInformation.publishedAt",
  "dependencyChains",
  "fixedVersion",
];

/**
 * The `--output json` projection: metadata, issues, clones and coverage — no
 * source code. `--lines` and `--no-source` only affect the source section, so
 * they don't change it. `coverage` is null when the file has no coverage data;
 * `coverage.lines` lists the coverable lines only (`hits: 0` = not covered).
 */
export function fileJson(data: FileData): Record<string, unknown> {
  const { file, quality, coverage } = data.info;
  return {
    file: {
      path: file.path,
      fileId: file.fileId,
      branchId: file.branchId,
      language: file.language,
      commitSha: file.commitSha,
      ignored: file.ignored,
      quality: quality ?? null,
    },
    issues: data.issues.map((issue) => pickDeep(issue, ISSUE_JSON_FIELDS)),
    clones: data.clones,
    coverage:
      coverage || data.coverage
        ? {
            coverage: coverage?.coverage ?? null,
            coverableLines: coverage?.coverableLines ?? null,
            coveredLines: coverage?.coveredLines ?? null,
            lines: data.coverage
              ? [...data.coverage]
                  .map(([line, hits]) => ({ line, hits }))
                  .sort((a, b) => a.line - b.line)
              : [],
          }
        : null,
  };
}

/** The human-readable view: summary, issues, clones, source. */
function printFileView(data: FileData, options: FileOptions): void {
  printSummary(data, options.branch);
  printIssues(data);
  printClones(data.clones, data.info.file.fileId, data.info.file.path);
  if (options.source) printSource(data);
}

export function registerFileCommand(program: Command) {
  program
    .command("file")
    .alias("fl")
    .description(
      "Show a file's metrics, issues, clones, and source code with coverage",
    )
    .argument(
      "[provider]",
      "git provider (gh, gl, or bb) — auto-detected from git remote if omitted",
    )
    .argument("[organization]", "organization name")
    .argument("[repository]", "repository name")
    .argument(
      "[path]",
      "file path (relative to the current directory when the repository is auto-detected, otherwise to the repository root)",
    )
    .option("-b, --branch <branch>", "branch name (defaults to the main branch)")
    .option(
      "-l, --lines <range>",
      "only show this range of the source: <from>-<to>, <from>- or <line>",
    )
    .option("-N, --no-source", "hide the source code section")
    // Declared per command so `--repository-token` parses in the test harnesses.
    .addOption(repositoryTokenOption())
    .addHelpText(
      "after",
      `
Examples:
  $ codacy file src/index.ts                          # auto-detect repo; path relative to cwd
  $ codacy file gh my-org my-repo src/index.ts
  $ codacy file src/index.ts --lines 40-120
  $ codacy file src/index.ts --no-source              # summary, issues and clones only
  $ codacy file src/index.ts --branch develop
  $ codacy file src/index.ts --output json`,
    )
    .action(async function (
      this: Command,
      providerArg: string | undefined,
      organizationArg: string | undefined,
      repositoryArg: string | undefined,
      pathArg: string | undefined,
      options: FileOptions,
    ) {
      try {
        resolveAccountAuth(
          this,
          "Codacy does not accept repository tokens on the file endpoints",
        );
        const format = getOutputFormat(this);
        // Validate --lines before any git call or request.
        const range = options.lines ? parseLineRange(options.lines) : {};

        const defined = [providerArg, organizationArg, repositoryArg, pathArg].filter(
          (v) => v !== undefined,
        );
        const autoDetected = defined.length === 1;
        const { provider, organization, repository, trailingArgs } = resolveRepoArgs(
          [providerArg, organizationArg, repositoryArg, pathArg],
          1,
          "file",
          ["path"],
        );
        const filePath = resolveFilePath(trailingArgs[0], autoDetected);
        if (!filePath) {
          throw new Error("A file path is required.");
        }

        const spinner = ora(`Loading ${filePath}...`).start();
        let data: FileData;
        try {
          const fileId = await resolveFileId(
            provider,
            organization,
            repository,
            options.branch,
            filePath,
          );
          // JSON carries no source code, so the content is never fetched for it.
          const fetchSource = options.source && format !== "json";
          data = await fetchFileData(
            { provider, organization, repository },
            filePath,
            fileId,
            fetchSource,
            range,
          );
        } finally {
          spinner.stop();
        }

        if (format === "json") printJson(fileJson(data));
        else printFileView(data, options);
      } catch (err) {
        handleError(err);
      }
    });
}
