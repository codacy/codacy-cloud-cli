/**
 * Proxy and TLS configuration for outbound requests.
 *
 * Every network call in this CLI goes through Node's native global `fetch` — the
 * generated API client in `src/api/client/core` and the MITRE CVE lookup in
 * `commands/finding.ts` — and Node's `fetch` does **not** honor
 * `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` the way `curl` does. Behind a corporate
 * proxy, requests simply hang or fail.
 *
 * The implementation is deliberately **not** ours: `configureProxy()` from
 * `@codacy/tooling` installs a global `undici` dispatcher that routes each
 * request by protocol, honors `NO_PROXY` per request, normalizes a bare
 * `host:port` proxy value, and loads a corporate CA bundle. Delegating to it
 * keeps the environment contract identical to the Codacy Analysis CLI and the
 * VSCode extension, so one corporate-proxy setup drives all of them:
 *
 *   HTTPS_PROXY / HTTP_PROXY (or lowercase) — proxy URL per scheme
 *   NO_PROXY / no_proxy                    — hosts that bypass the proxy
 *   SSL_CERT_FILE / NODE_EXTRA_CA_CERTS    — PEM CA bundle to trust
 *   CODACY_CLI_INSECURE                    — disable TLS verification (warns)
 *
 * A no-op when none of those are set — and a free one. `@codacy/tooling` loads
 * `undici` lazily, only once `configureProxy` gets past its "nothing
 * configured" early-out, so an unproxied run pays nothing: measured at 0 ms
 * median against a `main` build (20 interleaved `--version` runs, Node 20).
 * That property is upstream's to keep, and it is guarded there by
 * `packages/tooling/test/proxy-lazy-undici.test.ts`. It is worth re-measuring
 * on a major bump, since a top-level `undici` import upstream would silently
 * put ~27 ms back onto every invocation, `--help` and `--version` included —
 * which is what 0.22.0 did before this was fixed.
 *
 * Note the "update available" notice is unaffected: `update-notifier` uses its
 * own `got` stack, which honors neither this dispatcher nor the proxy variables.
 * Behind a strict proxy, disable it with `CODACY_DISABLE_UPDATE_CHECK=1`.
 */
import { configureProxy } from "@codacy/tooling";

import { handleError } from "./error";

/**
 * Apply proxy/TLS settings from the environment. Call once at startup, before
 * any command can make a request.
 *
 * A misconfigured setting is **fatal by design**, and the catch is deliberately
 * broad rather than tied to a specific failure. `configureProxy` throws on an
 * unreadable or non-PEM CA bundle and on a malformed proxy URL, and the exact
 * set has already changed once across a minor bump. Enumerating it here would
 * just rot: this wrapper's contract is "any failure to apply the requested
 * configuration is fatal", and upstream owns which failures exist and how they
 * read. Upstream also redacts credentials before echoing a bad proxy value, so
 * passing the message straight through does not leak a proxy password.
 *
 * Unlike `maybeNotifyUpdate`, which swallows everything because an update check
 * must never break the CLI, swallowing here would leave the user running with
 * configuration they believe is in effect — silently falling back to the system
 * trust store or to a direct connection — and hand them a confusing TLS or
 * timeout error later instead of the real cause now.
 */
export function configureProxyFromEnv(): void {
  try {
    configureProxy();
  } catch (err) {
    handleError(err);
  }
}
