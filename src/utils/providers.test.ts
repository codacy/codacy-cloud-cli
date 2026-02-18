import { describe, it, expect } from "vitest";
import { providerDisplayName } from "./providers";

describe("providerDisplayName", () => {
  it("should return GitHub for gh", () => {
    expect(providerDisplayName("gh")).toBe("GitHub");
  });

  it("should return GitLab for gl", () => {
    expect(providerDisplayName("gl")).toBe("GitLab");
  });

  it("should return Bitbucket for bb", () => {
    expect(providerDisplayName("bb")).toBe("Bitbucket");
  });

  it("should return the raw string for unknown providers", () => {
    expect(providerDisplayName("unknown")).toBe("unknown");
  });
});
