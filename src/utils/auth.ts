import ansis from "ansis";
import { Command, Option } from "commander";
import { OpenAPI } from "../api/client/core/OpenAPI";
import { loadCredentials } from "./credentials";

/**
 * Codacy accepts two kinds of token, on two different headers, with two very
 * different scopes:
 *
 *  - an **account token** (`api-token` header) reaches anything the account can
 *    see: every organization, every repository, every endpoint;
 *  - a **repository token** (`project-token` header, also called a project
 *    token) is issued for a single repository and is accepted only on a small,
 *    fixed whitelist of repository-scoped operations. Everywhere else the API
 *    rejects it exactly as if no token had been sent.
 *
 * That last point is why the CLI has to know which kind it holds *before* it
 * calls: a bare `Error: Unauthorized` tells the user nothing, so commands
 * refuse (or skip a section) up front instead. See `SPECS/repository-tokens.md`
 * for the whitelist and the per-command support matrix.
 *
 * The discriminated union makes "exactly one token, and we always know which
 * kind and where it came from" a compile-time property: there is no way to
 * build a value carrying both, or neither. `source` is carried so refusals can
 * name the thing the user actually set — the difference between an explicit
 * `--repository-token` and an ambient `CODACY_PROJECT_TOKEN` is exactly what
 * makes a surprising refusal debuggable in one read.
 */
export type AccountAuth = {
  kind: "account-token";
  token: string;
  source: "CODACY_API_TOKEN" | "credentials";
};

export type RepositoryAuth = {
  kind: "repository-token";
  token: string;
  source: "flag" | "CODACY_PROJECT_TOKEN";
};

export type RemoteAuth = AccountAuth | RepositoryAuth;

export const NO_TOKEN_MESSAGE =
  "No API token found. Provide --repository-token, set CODACY_PROJECT_TOKEN, " +
  "set CODACY_API_TOKEN, or run 'codacy login'.";

export const EMPTY_REPOSITORY_TOKEN_MESSAGE =
  "--repository-token was given an empty value. This is refused rather than " +
  "ignored: falling back to an account token would silently run with far wider " +
  "access than the scoped run you asked for. Check the variable you passed " +
  "(e.g. --repository-token \"$CODACY_PROJECT_TOKEN\" with the secret unset), " +
  "or drop the flag to use an account token deliberately.";

const REPOSITORY_TOKEN_FLAGS = "--repository-token <token>";
const REPOSITORY_TOKEN_DESCRIPTION =
  "repository (project) token, scoped to a single repository (env: CODACY_PROJECT_TOKEN)";

/**
 * The `--repository-token` option, for `.addOption()` on the root program and
 * on every command.
 *
 * Deliberately no short flag. The short-flag space is crowded and collides
 * per command (`-r` is `repository --remove`, `-R` is `--reanalyze`, `-t` is
 * `--tags` on `issues`/`patterns` and `--token` on `login`), so any single
 * letter would either clash or mean something different depending on the
 * command. `codacy-analysis` dropped its short flag for the same reason.
 *
 * Returns a **new** Option per call: Commander stores the instance on the
 * command and writes parsed values onto it, so a shared instance would be
 * shared mutable state across all 17 commands.
 */
export function repositoryTokenOption(): Option {
  return new Option(REPOSITORY_TOKEN_FLAGS, REPOSITORY_TOKEN_DESCRIPTION);
}

/**
 * The `--repository-token` value *as typed by the user*, or undefined.
 *
 * The option is declared both on the root program (`codacy --repository-token X
 * tools`) and on each command (`codacy tools --repository-token X`). Commander's
 * `optsWithGlobals()` lets globals overwrite locals, so read the command's own
 * value first — nearest wins, which is what users expect. (In practice they
 * cannot conflict: the option has no default, so a program that never received
 * it has no key to overwrite with.)
 */
export function repositoryTokenFlag(command: Command): string | undefined {
  const own = command.opts().repositoryToken;
  if (typeof own === "string") return own;
  const inherited = command.optsWithGlobals().repositoryToken;
  return typeof inherited === "string" ? inherited : undefined;
}

/**
 * Headers sent on every request regardless of token kind. Single source of
 * truth: `applyAuthHeaders` replaces `OpenAPI.HEADERS` wholesale, so anything
 * only set at startup in `src/index.ts` would be dropped by the first command
 * that resolves auth.
 */
export const BASE_HEADERS: Record<string, string> = {
  "X-Codacy-Origin": "cli-cloud-tool",
};

/**
 * Point the generated client at a token. Auth is process-global
 * (`OpenAPI.HEADERS`) because the generated services never accept per-request
 * headers; the header *name* is what selects the token kind server-side.
 *
 * Always assigns a fresh object — never merges — so switching kinds can never
 * leave the other token's header behind.
 */
export function applyAuthHeaders(auth: RemoteAuth): void {
  const tokenHeader = auth.kind === "account-token" ? "api-token" : "project-token";
  OpenAPI.HEADERS = {
    ...BASE_HEADERS,
    [tokenHeader]: auth.token,
  };
}

/**
 * Install an account token directly. For `login`, which validates a token it
 * was just handed rather than resolving one — it must not go through
 * {@link resolveAuth}, which would pick up an ambient token instead.
 */
export function applyAccountToken(token: string): void {
  applyAuthHeaders({ kind: "account-token", token, source: "credentials" });
}

/**
 * How the token in use was configured, phrased to drop into a sentence. Typed
 * as a total Record over the union so adding a source is a compile error until
 * it has a description.
 */
const SOURCE_DESCRIPTIONS: Record<RemoteAuth["source"], string> = {
  flag: "provided with --repository-token",
  CODACY_PROJECT_TOKEN: "from CODACY_PROJECT_TOKEN",
  CODACY_API_TOKEN: "from CODACY_API_TOKEN",
  credentials: "from the stored login",
};

/**
 * Token precedence, identical to `codacy-analysis`:
 *
 *   1. explicit `--repository-token`   → repository token
 *   2. CODACY_PROJECT_TOKEN            → repository token
 *   3. CODACY_API_TOKEN                → account token
 *   4. stored credentials (`codacy login`) → account token
 *   5. throw
 *
 * An explicit flag wins outright — it never even looks for an account token, so
 * a deliberately-scoped run can't be silently widened by an ambient env var or
 * a stale login lying around.
 *
 * An explicitly-passed but *empty* flag is an error, not a miss. `--repository-token
 * "$CODACY_PROJECT_TOKEN"` with the secret unset is a routine CI mistake, and
 * treating it as "no flag" would hand the run an ambient account token — the
 * widening this function exists to prevent. Empty *env vars* are different: they
 * mean "unset" by convention (the test config relies on it), so they fall through.
 */
function pickAuth(flagToken?: string): RemoteAuth {
  if (flagToken !== undefined) {
    const token = flagToken.trim();
    if (!token) throw new Error(EMPTY_REPOSITORY_TOKEN_MESSAGE);
    return { kind: "repository-token", token, source: "flag" };
  }

  const projectEnv = process.env.CODACY_PROJECT_TOKEN?.trim();
  if (projectEnv) {
    return { kind: "repository-token", token: projectEnv, source: "CODACY_PROJECT_TOKEN" };
  }

  const accountEnv = process.env.CODACY_API_TOKEN?.trim();
  if (accountEnv) {
    return { kind: "account-token", token: accountEnv, source: "CODACY_API_TOKEN" };
  }

  const stored = loadCredentials();
  if (stored) {
    return { kind: "account-token", token: stored, source: "credentials" };
  }

  throw new Error(NO_TOKEN_MESSAGE);
}

/**
 * Resolve the auth to use and install its header. Exported separately from
 * {@link resolveAuth} so unit tests can drive it without a Commander instance.
 */
export function resolveAuthFromToken(flagToken?: string): RemoteAuth {
  const auth = pickAuth(flagToken);
  applyAuthHeaders(auth);
  return auth;
}

/**
 * What every API-calling command calls first, mirroring `getOutputFormat(this)`
 * from `utils/output.ts`. Returns the resolved auth; commands that branch on
 * the token kind keep the value, the rest ignore it.
 */
export function resolveAuth(command: Command): RemoteAuth {
  return resolveAuthFromToken(repositoryTokenFlag(command));
}

/**
 * Guard for an operation Codacy does not accept a repository token on. Returns
 * the narrowed account auth so callers can keep using the value; otherwise
 * throws into the command's existing `catch (err) { handleError(err) }`, which
 * prints `Error: <message>` in red and exits 1.
 *
 * @param operation what the user asked for, e.g. `codacy info` or `--add`
 * @param because why a repository token can't do it, as a sentence fragment
 */
export function requireAccountToken(
  auth: RemoteAuth,
  operation: string,
  because: string,
): AccountAuth {
  if (auth.kind === "account-token") return auth;
  throw new Error(
    `${operation} requires an account API token — ${because}. ` +
      `The token in use is a repository token (${SOURCE_DESCRIPTIONS[auth.source]}). ` +
      `Set CODACY_API_TOKEN or run 'codacy login'.`,
  );
}

/**
 * Resolve auth for a command that is account-only end to end, deriving the
 * operation name from the command itself.
 */
export function resolveAccountAuth(command: Command, because: string): AccountAuth {
  return requireAccountToken(resolveAuth(command), `codacy ${command.name()}`, because);
}

/**
 * Run `fetch` only under an account token; otherwise resolve to `fallback`
 * without calling at all. For sections of an otherwise-supported command that
 * hang off a non-whitelisted endpoint — see the pull request table in
 * `commands/repository.ts`.
 */
export async function fetchIfAccountToken<T, F>(
  auth: RemoteAuth,
  fallback: F,
  fetch: () => Promise<T>,
): Promise<T | F> {
  return auth.kind === "account-token" ? fetch() : Promise.resolve(fallback);
}

/** Note rendered in place of a section skipped because of the token kind. */
export function repositoryTokenSkipNote(what: string): string {
  return `Not shown with a repository token — ${what} require an account API token.`;
}

/**
 * Warn that an explicitly-passed `--repository-token` is doing nothing here.
 *
 * Keyed on the **explicit flag only**, never on an ambient
 * `CODACY_PROJECT_TOKEN`: that variable is the standard Codacy CI credential
 * (the coverage reporter reads it), so it is routinely exported job-wide.
 * Warning on it would fire on every unrelated invocation in such a job, which
 * trains users to ignore the warning that does matter.
 */
export function warnUnusedRepositoryToken(command: Command, detail: string): void {
  // Presence, not truthiness: `--repository-token ""` was still typed by the
  // user, and is still being ignored here.
  if (repositoryTokenFlag(command) === undefined) return;
  console.error(ansis.yellow(`Warning: --repository-token is ignored by ${detail}`));
}
