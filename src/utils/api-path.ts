/**
 * Encoder for OpenAPI path parameters.
 *
 * Every `{param}` in a generated URL template is a single path segment, but the
 * generated client falls back to `encodeURI` when `OpenAPI.ENCODE_PATH` is
 * unset, and `encodeURI` deliberately leaves `/` alone — it is meant for whole
 * URLs, not for the pieces they are built from. A value carrying a slash
 * therefore grew an extra segment and hit a route that does not exist:
 * a namespaced image such as `codacy/codacy-website` produced
 * `/images/codacy/codacy-website/tags`, which the API answers with 404.
 * Namespaced image names are the norm, so every `image` subcommand failed
 * against them.
 *
 * `encodeURIComponent` escapes the separators instead, which is what a single
 * segment needs. It is also correct for the other path parameters that can
 * carry a slash, such as branch names and file paths.
 */
export const encodePathSegment = (value: string): string => encodeURIComponent(value);
