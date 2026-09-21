import { describe, it, expect, vi } from "vitest";
import { ApiError } from "../api/client/core/ApiError";
import { apiErrorDetails, formatError, handleError } from "./error";

const ESC = String.fromCharCode(27);

function apiError(status: number, statusName: string, body: unknown): ApiError {
  return new ApiError(
    { method: "GET", url: "/x" } as any,
    { url: "/x", ok: false, status, statusText: statusName, body } as any,
    statusName,
  );
}

describe("apiErrorDetails", () => {
  it("reads the spec's message field", () => {
    expect(
      apiErrorDetails({
        message: "SBOM tag mismatch",
        actions: [],
        error: "BadRequest",
      }),
    ).toEqual(["SBOM tag mismatch"]);
  });

  it("reads an errors array of strings or objects", () => {
    expect(apiErrorDetails({ errors: ["a", { message: "b" }] })).toEqual([
      "a",
      "b",
    ]);
  });

  it("falls back to the serialized body when nothing is recognizable", () => {
    expect(apiErrorDetails({ code: 7 })).toEqual(['{"code":7}']);
  });

  it("returns nothing for an empty, null or absent body", () => {
    expect(apiErrorDetails({})).toEqual([]);
    expect(apiErrorDetails(null)).toEqual([]);
    expect(apiErrorDetails(undefined)).toEqual([]);
    expect(apiErrorDetails("")).toEqual([]);
  });

  it("takes a plain string body as the detail", () => {
    expect(apiErrorDetails("upstream exploded")).toEqual(["upstream exploded"]);
  });
});

describe("formatError", () => {
  it("surfaces the API's own message instead of the static status name", () => {
    const err = apiError(400, "Bad Request", {
      message: "SBOM tag mismatch: expected 9.9.9, found 3.20",
      actions: [],
      error: "BadRequest",
    });
    // What the user used to see here was a bare "Error: Bad Request".
    expect(formatError(err)).toBe(
      "Error: SBOM tag mismatch: expected 9.9.9, found 3.20 (HTTP 400)",
    );
  });

  it("joins several field errors", () => {
    const err = apiError(422, "Unprocessable Entity", {
      errors: ["tag is required", "imageName is required"],
    });
    expect(formatError(err)).toBe(
      "Error: tag is required; imageName is required (HTTP 422)",
    );
  });

  it("keeps the old output when the body carries nothing", () => {
    expect(formatError(apiError(404, "Not Found", undefined))).toBe(
      "Error: Not Found",
    );
    expect(formatError(apiError(404, "Not Found", {}))).toBe("Error: Not Found");
  });

  it("does not repeat a body that only echoes the status name", () => {
    const err = apiError(401, "Unauthorized", { message: "Unauthorized" });
    expect(formatError(err)).toBe("Error: Unauthorized");
  });

  it("neutralizes terminal escape sequences echoed back by the API", () => {
    // Error bodies quote back image names, tags and branches, which a crafted
    // repository controls.
    const err = apiError(400, "Bad Request", {
      message: `unknown tag 'evil${ESC}[31m'`,
    });
    const out = formatError(err);
    expect(out).not.toContain(`evil${ESC}[31m`);
    expect(out).toContain("evil^[");
  });

  it("passes a plain Error through unchanged", () => {
    expect(formatError(new Error("--upload requires --tag <tag>"))).toBe(
      "Error: --upload requires --tag <tag>",
    );
  });

  it("handles a non-Error throw", () => {
    expect(formatError("nope")).toBe("An unknown error occurred.");
  });
});

describe("handleError", () => {
  it("prints the formatted line and exits 1", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    expect(() =>
      handleError(apiError(400, "Bad Request", { message: "boom" })),
    ).toThrow("process.exit called");
    expect(errorSpy.mock.calls.flat().join("")).toContain("boom (HTTP 400)");

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
