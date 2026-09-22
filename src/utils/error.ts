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
  if (typeof body === "string") {
    const detail = plausibleMessage(body);
    return detail ? [detail] : [];
  }
  return [];
}

/**
 * The longest a body is allowed to be and still pass for a message.
 *
 * `ApiError.body` is not always JSON: the generated client's `getResponseBody`
 * returns `response.text()` for any content type that is not
 * `application/json` / `application/problem+json`. A gateway, load balancer or
 * TLS-intercepting proxy answering `502` with an HTML error page is normal for
 * a CLI that documents `HTTPS_PROXY` support — and without a cap the whole page
 * lands in the terminal behind `Error: `, in exactly the environments that
 * support was added for. A real API message is one short line.
 */
const MAX_DETAIL_LENGTH = 200;

/**
 * A string body as a detail, or `undefined` when it is not plausibly one —
 * in which case the caller falls back to the status name, which is what was
 * printed before any of this existed. Dropping beats truncating here: half an
 * HTML page or half a JSON object is noise, not a shorter explanation.
 */
function plausibleMessage(body: string): string | undefined {
  const firstLine = body.trim().split("\n")[0].trim();
  if (!firstLine || firstLine.length > MAX_DETAIL_LENGTH) return undefined;
  // `<!DOCTYPE html>`, `<html>`, `<h1>Bad Gateway</h1>` — markup, not a message.
  if (firstLine.startsWith("<")) return undefined;
  return firstLine;
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

/**
 * An unrecognized object body as one line, when it is short enough to read.
 * Same cap as {@link plausibleMessage}, for the same reason — a deeply nested
 * payload serializes to something no one wants printed at them.
 */
function serializedBody(body: unknown): string[] {
  const serialized = JSON.stringify(body);
  if (
    serialized &&
    serialized !== "{}" &&
    serialized !== "null" &&
    serialized.length <= MAX_DETAIL_LENGTH
  ) {
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
    const reason = apiErrorReason(err);
    if (reason) {
      return `Error: ${sanitizeText(reason)} (HTTP ${err.status})`;
    }
    return `Error: ${err.message}`;
  }
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return "An unknown error occurred.";
}

/** What the server said, or `undefined` when it said nothing worth printing. */
function apiErrorReason(err: ApiError): string | undefined {
  const details = apiErrorDetails(err.body)
    // A body that only repeats the status name adds nothing.
    .filter((detail) => detail.trim() && detail !== err.message);
  return details.length > 0 ? details.join("; ") : undefined;
}

/**
 * One failed request's explanation, for a caller that reports failures itself
 * instead of routing them through {@link handleError}.
 *
 * The `--keep-latest` cleanup loop is the case: it deliberately continues past
 * a failure so it can list every tag that did not go, so it formats the error
 * at its own call site and never reaches `formatError`. Reading `err.message`
 * there printed the generated client's static status name — `"Bad Request"` for
 * every failure, on the one path where the user most needs the reason.
 *
 * Not sanitized: the table path sanitizes at the point of render and the JSON
 * path does not sanitize at all, per the CWE-150 note in `commands/AGENTS.md`.
 */
export function errorReason(err: unknown): string {
  if (err instanceof ApiError) {
    return apiErrorReason(err) ?? err.message;
  }
  return err instanceof Error ? err.message : "unknown error";
}

export function handleError(err: unknown): void {
  console.error(ansis.red(formatError(err)));
  process.exit(1);
}
