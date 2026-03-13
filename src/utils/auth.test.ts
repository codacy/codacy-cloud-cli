import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkApiToken } from "./auth";

vi.mock("./credentials", () => ({
  loadCredentials: vi.fn(() => null),
}));

import { loadCredentials } from "./credentials";

describe("checkApiToken", () => {
  beforeEach(() => {
    delete process.env.CODACY_API_TOKEN;
    vi.mocked(loadCredentials).mockReturnValue(null);
  });

  it("should return the token when CODACY_API_TOKEN is set", () => {
    process.env.CODACY_API_TOKEN = "my-token";
    expect(checkApiToken()).toBe("my-token");
  });

  it("should prefer env var over stored credentials", () => {
    process.env.CODACY_API_TOKEN = "env-token";
    vi.mocked(loadCredentials).mockReturnValue("stored-token");
    expect(checkApiToken()).toBe("env-token");
    expect(loadCredentials).not.toHaveBeenCalled();
  });

  it("should fall back to stored credentials when env var is not set", () => {
    vi.mocked(loadCredentials).mockReturnValue("stored-token");
    expect(checkApiToken()).toBe("stored-token");
  });

  it("should throw when no env var and no stored credentials", () => {
    expect(() => checkApiToken()).toThrow(
      "No API token found. Set CODACY_API_TOKEN or run 'codacy login'.",
    );
  });
});
