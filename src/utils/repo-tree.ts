import { execFileSync } from "child_process";
import * as path from "path";
import { RepositoryService } from "../api/client/services/RepositoryService";
import { DirectoryWithAnalysisInfo } from "../api/client/models/DirectoryWithAnalysisInfo";
import { FileWithAnalysisInfo } from "../api/client/models/FileWithAnalysisInfo";

/**
 * Helpers for the `ls` and `directories` commands: figuring out *where* in the
 * repository to list (path resolution) and fetching *all* children of a folder
 * (the list endpoints are cursor-paginated, and these commands intentionally
 * fetch every page rather than showing a "first N results" warning).
 */

/**
 * Absolute path of the current git repository's root, or null when not inside a
 * git repository. Mirrors `getGitRemoteUrl` in git-remote.ts (shells out, never
 * throws).
 */
export function getGitRepoRoot(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Repository-relative path of the current working directory, using forward
 * slashes. Returns "" (the repository root) when not inside a git repository or
 * when the cwd is the repository root itself.
 */
export function getCwdRepoRelativePath(): string {
  const root = getGitRepoRoot();
  if (!root) return "";
  const relative = path.relative(root, process.cwd());
  // path.relative returns "" when cwd === root; normalize Windows separators.
  return relative.split(path.sep).join("/");
}

/**
 * Normalize a user-supplied path into the form the API expects: no leading
 * "./", no leading or trailing slashes. The repository root is represented as
 * an empty string.
 */
export function normalizeRepoPath(input: string): string {
  const trimmed = input.trim();
  // "." / "./" mean "here" — i.e. the current scope, which for the API is root.
  if (trimmed === "." || trimmed === "./") return "";
  return trimmed
    .replace(/^\.\/+/, "") // strip a leading "./"
    .replace(/^\/+/, "") // strip leading slashes
    .replace(/\/+$/, ""); // strip trailing slashes
}

/**
 * Run `fn` over `items` with at most `limit` promises in flight at once — a
 * bounded alternative to `Promise.all(items.map(...))` that avoids flooding the
 * API with unbounded concurrent requests (each item may itself paginate).
 */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      await fn(items[index]);
    }
  };
  const size = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: size }, async () => worker()));
}

/**
 * Decide which repository folder to list:
 * - an explicit `--path` always wins (normalized),
 * - otherwise, when the repo was auto-detected from the git remote, use the
 *   current working directory relative to the repo root,
 * - otherwise (repo passed explicitly, no `--path`), the repository root ("").
 */
export function resolveListingPath(
  explicitPath: string | undefined,
  autoDetected: boolean,
): string {
  if (explicitPath !== undefined) return normalizeRepoPath(explicitPath);
  if (autoDetected) return getCwdRepoRelativePath();
  return "";
}

// Sort fields accepted at the CLI (--sort). The same vocabulary is used for
// both files and folders; the files endpoint calls the "name" field "filename",
// which resolveSort maps for us.
export const SORT_FIELDS = [
  "name",
  "issues",
  "grade",
  "duplication",
  "complexity",
  "coverage",
] as const;

/**
 * Validate a --sort value and map it to the API field for the given endpoint.
 * Returns undefined when no sort was requested; throws on an invalid value.
 */
export function resolveSort(
  cliSort: string | undefined,
  kind: "file" | "directory",
): string | undefined {
  if (cliSort === undefined) return undefined;
  const field = cliSort.toLowerCase();
  if (!(SORT_FIELDS as readonly string[]).includes(field)) {
    throw new Error(
      `Invalid --sort value '${cliSort}'. Valid values: ${SORT_FIELDS.join(", ")}.`,
    );
  }
  // The files endpoint names the file field "filename" rather than "name".
  if (kind === "file" && field === "name") return "filename";
  return field;
}

const DIRECTIONS: Record<string, string> = {
  asc: "asc",
  ascending: "asc",
  desc: "desc",
  descending: "desc",
};

/**
 * Validate a --direction value and map it to the API's "asc"/"desc". Returns
 * undefined when no direction was requested; throws on an invalid value.
 */
export function resolveDirection(
  cliDirection: string | undefined,
): string | undefined {
  if (cliDirection === undefined) return undefined;
  const dir = DIRECTIONS[cliDirection.toLowerCase()];
  if (!dir) {
    throw new Error(
      `Invalid --direction value '${cliDirection}'. Valid values: asc (ascending), desc (descending).`,
    );
  }
  return dir;
}

/**
 * Fetch every folder directly inside `path`, following pagination cursors until
 * the API returns no more pages. `path` is always a string ("" = repo root);
 * passing it explicitly (never undefined) keeps the listing non-recursive.
 * Optional `sort`/`direction` are applied server-side (order is preserved
 * across pages).
 */
export async function fetchAllDirectories(
  provider: string,
  organization: string,
  repository: string,
  branch: string | undefined,
  path: string,
  sort?: string,
  direction?: string,
): Promise<DirectoryWithAnalysisInfo[]> {
  const all: DirectoryWithAnalysisInfo[] = [];
  let cursor: string | undefined;
  do {
    const response = await RepositoryService.listDirectories(
      provider,
      organization,
      repository,
      branch,
      path,
      sort,
      direction,
      cursor,
      100, // limit
    );
    all.push(...response.data);
    cursor = response.pagination?.cursor;
  } while (cursor);
  return all;
}

/**
 * Fetch every file matching the request, following pagination cursors until the
 * API returns no more pages. For a plain listing, `path` is a string ("" = repo
 * root, non-recursive). For a search, pass `path = undefined` (recursive) and a
 * `search` term — the caller folds the folder scope into the search string, so
 * matches are found at any depth under it. Optional `sort`/`direction` are
 * applied server-side.
 */
export async function fetchAllFiles(
  provider: string,
  organization: string,
  repository: string,
  branch: string | undefined,
  path: string | undefined,
  search?: string,
  sort?: string,
  direction?: string,
): Promise<FileWithAnalysisInfo[]> {
  const all: FileWithAnalysisInfo[] = [];
  let cursor: string | undefined;
  do {
    const response = await RepositoryService.listFiles(
      provider,
      organization,
      repository,
      branch,
      path,
      search,
      sort,
      direction,
      cursor,
      100, // limit
    );
    all.push(...response.data);
    cursor = response.pagination?.cursor;
  } while (cursor);
  return all;
}
