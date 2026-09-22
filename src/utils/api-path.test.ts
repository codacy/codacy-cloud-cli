import { describe, it, expect } from "vitest";
import { encodePathSegment } from "./api-path";

describe("encodePathSegment", () => {
  it("escapes the slash in a namespaced image name", () => {
    // The reported defect: `encodeURI` left this slash alone, so the value
    // became two path segments and the request 404'd.
    expect(encodePathSegment("codacy/codacy-website")).toBe("codacy%2Fcodacy-website");
    expect(encodePathSegment("codacy/codacy-website")).not.toContain("/");
  });

  it("escapes a slash wherever a path parameter can carry one", () => {
    // Branch names and file paths reach the client through the same encoder.
    expect(encodePathSegment("feature/OD-710")).toBe("feature%2FOD-710");
    expect(encodePathSegment("src/utils/api-path.ts")).toBe("src%2Futils%2Fapi-path.ts");
  });

  it("leaves an ordinary segment untouched", () => {
    // The common case must not start arriving percent-encoded.
    expect(encodePathSegment("my-service")).toBe("my-service");
    expect(encodePathSegment("gh")).toBe("gh");
    expect(encodePathSegment("57.5.12")).toBe("57.5.12");
  });

  it("escapes the other separators that would change how a path parses", () => {
    expect(encodePathSegment("a?b")).toBe("a%3Fb");
    expect(encodePathSegment("a#b")).toBe("a%23b");
    // A traversal attempt stops being one once the slashes are escaped.
    expect(encodePathSegment("../../admin")).toBe("..%2F..%2Fadmin");
  });

  it("differs from encodeURI exactly where the defect was", () => {
    // Pins the reason this function exists: encodeURI is the client's fallback.
    const value = "codacy/codacy-website";
    expect(encodeURI(value)).toBe(value);
    expect(encodePathSegment(value)).not.toBe(encodeURI(value));
  });
});
