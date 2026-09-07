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
 * No-op when none of those are set, so the default path is unchanged.
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
 * A misconfigured CA bundle is **fatal by design** — it is the one thing
 * `configureProxy` throws on. Unlike `maybeNotifyUpdate`, which swallows
 * everything because an update check must never break the CLI, swallowing here
 * would silently fall back to the system trust store and hand the user a
 * confusing TLS error later instead of the real cause now.
 */
export function configureProxyFromEnv(): void {
  try {
    configureProxy();
  } catch (err) {
    handleError(err);
  }
}
