/**
 * Unit tests for the proxy/TLS startup hook (`configureProxyFromEnv`).
 *
 * The proxy behavior itself lives in `@codacy/tooling` and is covered by its own
 * suite — env-var precedence, `NO_PROXY` matching, bare `host:port`
 * normalization, PEM validation. Re-testing any of that here would freeze
 * upstream's internals against us, so `configureProxy` is mocked and these tests
 * pin only the seam we own: that we delegate with no overrides (env is the sole
 * input, which is what keeps the contract identical to the Analysis CLI), and
 * that a misconfigured CA bundle is fatal with the message preserved verbatim.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted so the spy exists before the mock factory and the module under test load.
const { configureProxySpy } = vi.hoisted(() => ({ configureProxySpy: vi.fn() }));

// Only `configureProxy` is needed: `src/types/codacy-config.ts` also imports from
// this module, but via `export type`, which is erased at compile time.
vi.mock("@codacy/tooling", () => ({ configureProxy: configureProxySpy }));

import { configureProxyFromEnv } from "./proxy";

describe("configureProxyFromEnv", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // handleError is exercised for real, so process.exit has to be stubbed to
    // throw — otherwise it would tear down the test run.
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    configureProxySpy.mockReset();
  });

  it("delegates proxy setup to @codacy/tooling, with no overrides", () => {
    configureProxyFromEnv();

    expect(configureProxySpy).toHaveBeenCalledOnce();
    // The zero-argument call is the contract: passing overrides would make this
    // CLI's proxy behavior diverge from every other Codacy tool.
    expect(configureProxySpy.mock.calls[0]).toEqual([]);
  });

  it("does nothing and does not throw when no proxy is configured", () => {
    // Mirrors tooling's early return when no proxy/TLS variable is set.
    configureProxySpy.mockImplementation(() => {});

    expect(() => configureProxyFromEnv()).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("exits with the tooling error message when the CA bundle is unreadable", () => {
    configureProxySpy.mockImplementation(() => {
      throw new Error(
        "Failed to read CA certificate from /nope.pem: ENOENT: no such file or directory",
      );
    });

    expect(() => configureProxyFromEnv()).toThrow("process.exit called");
    // Asserted as a substring so the message survives ansis colorization. The
    // point is that we relay tooling's text unchanged rather than rewording it.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to read CA certificate from /nope.pem"),
    );
  });

  it("exits on a non-Error throw", () => {
    configureProxySpy.mockImplementation(() => {
      throw "not an Error";
    });

    expect(() => configureProxyFromEnv()).toThrow("process.exit called");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("An unknown error occurred."),
    );
  });
});
