import { InvalidArgumentError } from "commander";

/**
 * Shared coercion helpers for Commander option values.
 */

/**
 * Coerce the value of a tri-state boolean option declared as `--flag [value]`.
 *
 * Commander only invokes this parser when a value is actually supplied, so the
 * bare flag (`--flag`) yields boolean `true` without passing through here.
 * Anything other than a case-insensitive `"false"` is treated as `true`.
 *
 * Prefer {@link strictBooleanOption} on any command that also takes positional
 * arguments — see the warning there.
 */
export function parseBooleanOption(value: string): boolean {
  return value.toLowerCase() !== "false";
}

/**
 * Strict parser for a tri-state boolean option declared as `--flag [value]`,
 * accepting only a case-insensitive `"true"` or `"false"`.
 *
 * Commander's optional-value syntax greedily consumes the next token, even one
 * meant as a positional argument. On a command that takes positionals, a lax
 * parser turns `patterns gh org repo --matches-stack eslint` into
 * `matchesStack=true` with the tool name silently swallowed, and the command
 * then fails with a confusing complaint about the positional count that never
 * mentions the flag. Rejecting non-boolean values converts that into an
 * immediate, self-explanatory error instead.
 *
 * @param flag the user-facing flag name, used in the error message
 */
export function strictBooleanOption(flag: string) {
  return (value: string): boolean => {
    const normalized = value.toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    throw new InvalidArgumentError(
      `expected "true" or "false". If "${value}" was meant as an argument, ` +
        `place it before ${flag}, or pass ${flag} on its own to mean true.`,
    );
  };
}
