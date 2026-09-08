---
"@codacy/codacy-cloud-cli": minor
---

Add HTTP/HTTPS proxy and TLS support, so the CLI works behind a corporate proxy (#40).

Every command now honors the standard environment variables:

- `HTTPS_PROXY` / `HTTP_PROXY` (and lowercase) — proxy URL per scheme; a bare `host:port` is accepted
- `NO_PROXY` / `no_proxy` — hosts that bypass the proxy (`*`, `.suffix`), matched per request
- `SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS` — PEM CA bundle for a TLS-intercepting proxy
- `CODACY_CLI_INSECURE` — disable TLS verification as a last resort (warns on stderr)

These are the same variable names the Codacy Analysis CLI and the Codacy VS Code extension use, so one environment configures all of them. The implementation is the shared `configureProxy()` from `@codacy/tooling` rather than a local reimplementation, which is what keeps the behavior identical across the tools. Misconfiguration fails immediately rather than silently doing something else: an unreadable or non-PEM CA bundle reports the path instead of quietly falling back to the default trust store, and a malformed proxy URL reports which variable was wrong and why (with any proxy password redacted) instead of a bare `Invalid URL`.

Nothing changes when no proxy variable is set — the proxy dependency is loaded lazily, so an unproxied run has no measurable overhead.

Thanks to @rattalur for reporting the gap and for the initial implementation in #39.
