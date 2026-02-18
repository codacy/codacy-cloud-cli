import { describe, it, expect, beforeEach } from "vitest";
import { checkApiToken } from "./auth";

describe("checkApiToken", () => {
  beforeEach(() => {
    delete process.env.CODACY_API_TOKEN;
  });

  it("should return the token when set", () => {
    process.env.CODACY_API_TOKEN = "my-token";
    expect(checkApiToken()).toBe("my-token");
  });

  it("should throw when CODACY_API_TOKEN is not set", () => {
    expect(() => checkApiToken()).toThrow(
      "CODACY_API_TOKEN environment variable is not set"
    );
  });
});
