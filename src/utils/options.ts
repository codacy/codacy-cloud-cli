/**
 * Shared coercion helpers for Commander option values.
 */

/**
 * Coerce the value of a tri-state boolean option declared as `--flag [value]`.
 *
 * Commander only invokes this parser when a value is actually supplied, so the
 * bare flag (`--flag`) yields boolean `true` without passing through here.
 * Anything other than a case-insensitive `"false"` is treated as `true`, which
 * keeps `--flag`, `--flag true` and `--flag TRUE` equivalent.
 *
 * Read the resulting option as a tri-state — `true` / `false` / `undefined`
 * (omitted) — rather than with a truthiness check, so "omitted" stays distinct
 * from an explicit `false`.
 */
export function parseBooleanOption(value: string): boolean {
  return value.toLowerCase() !== "false";
}
