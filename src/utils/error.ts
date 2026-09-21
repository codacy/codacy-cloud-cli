import ansis from "ansis";
import { ApiError } from "../api/client/core/ApiError";
import { sanitizeText } from "./sanitize";

/**
 * The human-readable parts of a Codacy API error body.
 *
 * Every documented error response in the spec is an `ApiError`
 * (`{ message, innerMessage?, actions }`) widened with an `error` string — so
 * `message` is the field worth reading, and the rest is either a link list or
 * the status name we already have. `errors` is accepted too: it is not in the
 * spec, but validation endpoints have been seen returning it and a list of
 * field errors is exactly the detail this exists to surface.
 *
 * `innerMessage` is deliberately skipped — it carries server internals, and the
 * user-facing half is `message`.
 *
 * Lives here rather than in `import-config.ts`, where it started life as
 * `parseApiErrorBody` for the `tools --import` failure table: the same
 * extraction now also feeds every command's top-level error, so there is one
 * copy and one place to fix when a new body shape shows up.
 */
export function apiErrorDetails(body: unknown): string[] {
  if (body && typeof body === "object") {
    const details = objectDetails(body as Record<string, unknown>);
    if (details.length > 0) return details;
    return serializedBody(body);
  }
  if (typeof body === "string" && body.length > 0) {
    return [body];
  }
  return [];
}

function objectDetails(obj: Record<string, unknown>): string[] {
  const details: string[] = [];
  if (typeof obj.message === "string") {
    details.push(obj.message);
  }
  if (Array.isArray(obj.errors)) {
    for (const entry of obj.errors) {
      const detail = errorEntryDetail(entry);
      if (detail) details.push(detail);
    }
  }
  return details;
}

/**
 * One `errors` entry as a string, whatever shape it arrived in.
 *
 * The entries are not in the spec, so nothing guarantees them. A `message`
 * that is a number used to reach the caller unconverted and `.trim()` threw
 * there — an exception raised while reporting an API error, which loses the
 * error the user was waiting to read. Every entry leaves here as a string, or
 * as `""` for the ones with nothing to say (`undefined`, and the functions and
 * symbols `JSON.stringify` declines to serialize).
 */
function errorEntryDetail(entry: unknown): string {
  if (typeof entry === "string") return entry;

  const message = (entry as { message?: unknown } | null | undefined)?.message;
  if (typeof message === "string") return message;
  if (typeof message === "number" || typeof message === "boolean") {
    return String(message);
  }

  const serialized = JSON.stringify(entry);
  return typeof serialized === "string" ? serialized : "";
}

function serializedBody(body: unknown): string[] {
  const serialized = JSON.stringify(body);
  if (serialized && serialized !== "{}" && serialized !== "null") {
    return [serialized];
  }
  return [];
}

/**
 * The line a failed command prints.
 *
 * For an {@link ApiError} the generated client's `message` is a **static status
 * name** from its own lookup table (`400` → `"Bad Request"`), not anything the
 * server said — so printing it alone threw away the actual explanation. The API
 * does send one: a mistyped SBOM tag answers with
 * `SBOM tag mismatch: expected 9.9.9, found 3.20` and the user used to read
 * `Error: Bad Request`. The status is kept as a trailing `(HTTP 400)`, since it
 * is the part worth quoting in a bug report and "Unauthorized" still carries
 * meaning that a terse body message might not.
 *
 * The body is server-provided but routinely **echoes values the user or a
 * repository supplied** (image names, tags, branch names), so it is sanitized
 * like any other untrusted string reaching the terminal — see the CWE-150 note
 * in `src/commands/AGENTS.md`.
 *
 * Exported for tests; `handleError` is what commands call.
 */
export function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    const details = apiErrorDetails(err.body)
      // A body that only repeats the status name adds nothing.
      .filter((detail) => detail.trim() && detail !== err.message);
    if (details.length > 0) {
      return `Error: ${sanitizeText(details.join("; "))} (HTTP ${err.status})`;
    }
    return `Error: ${err.message}`;
  }
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return "An unknown error occurred.";
}

export function handleError(err: unknown): void {
  console.error(ansis.red(formatError(err)));
  process.exit(1);
}
