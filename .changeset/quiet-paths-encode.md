---
"@codacy/codacy-cloud-cli": patch
---

Escape path parameters per segment, so a namespaced image name reaches the right endpoint. `codacy image gh my-org my-org/my-service` and every other `image` subcommand failed with `Error: The requested resource could not be found. (HTTP 404)` against any image whose name carries a slash — which is the usual shape, and was every image in our own organization.

The generated client falls back to `encodeURI` when `OpenAPI.ENCODE_PATH` is unset, and `encodeURI` leaves `/` alone because it is meant for whole URLs rather than the pieces they are built from. `codacy/codacy-website` therefore expanded into two path segments and hit a route that does not exist. The entry point now sets `encodePathSegment` (`encodeURIComponent`), which escapes separators as a single segment requires.

This affects every command, not only `image`: the same encoder handles branch names and file paths, which can carry slashes for the same reason. No currently shipped command sent one as a path parameter, so nothing else changes shape.
