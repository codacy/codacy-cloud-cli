import { describe, it, expect, vi } from "vitest";
import { ApiError } from "../api/client/core/ApiError";
import {
  apiErrorDetails,
  errorReason,
  formatError,
  handleError,
} from "./error";

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

  it("survives malformed errors entries instead of throwing over them", () => {
    // Nothing guarantees the shape of these — they are not in the spec. A
    // non-string `message` used to reach `formatError` unconverted and throw
    // on `.trim()`, losing the API error the user was waiting to read.
    expect(
      apiErrorDetails({
        errors: [{ message: 42 }, { message: null }, null, 7, [], undefined],
      }),
    ).toEqual(["42", '{"message":null}', "null", "7", "[]"]);

    expect(() =>
      formatError(apiError(400, "Bad Request", { errors: [{ message: 42 }] })),
    ).not.toThrow();
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

  // `ApiError.body` is not always JSON — the generated client returns
  // `response.text()` for any non-JSON content type, so a proxy's HTML error
  // page arrives here as one enormous string.
  describe("a string body that is not plausibly a message", () => {
    it("drops an HTML error page rather than printing it", () => {
      const page = `<!DOCTYPE html>\n<html>\n<head><title>502 Bad Gateway</title></head>\n<body><h1>502 Bad Gateway</h1><hr><center>nginx</center></body>\n</html>`;

      expect(apiErrorDetails(page)).toEqual([]);
      expect(formatError(apiError(502, "Bad Gateway", page))).toBe(
        "Error: Bad Gateway",
      );
    });

    it("drops a single-line body longer than the cap", () => {
      const wall = "x".repeat(201);

      expect(apiErrorDetails(wall)).toEqual([]);
      expect(formatError(apiError(403, "Forbidden", wall))).toBe(
        "Error: Forbidden",
      );
    });

    it("drops a body that is only whitespace", () => {
      expect(apiErrorDetails("   \n  ")).toEqual([]);
      expect(apiErrorDetails("")).toEqual([]);
    });

    it("keeps a short plain-text body, and the first line of a multi-line one", () => {
      expect(apiErrorDetails("Access denied by policy")).toEqual([
        "Access denied by policy",
      ]);
      expect(
        apiErrorDetails("Rate limit exceeded\n  at Foo.bar (/app/x.js:1:1)"),
      ).toEqual(["Rate limit exceeded"]);
      // Exactly at the cap, so still a message.
      expect(apiErrorDetails("y".repeat(200))).toEqual(["y".repeat(200)]);
    });

    it("drops an oversized serialized object body too", () => {
      const sprawling = { nested: { data: Array.from({ length: 80 }, (_, i) => `entry-${i}`) } };

      expect(JSON.stringify(sprawling).length).toBeGreaterThan(200);
      expect(apiErrorDetails(sprawling)).toEqual([]);
      expect(formatError(apiError(400, "Bad Request", sprawling))).toBe(
        "Error: Bad Request",
      );
    });
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

describe("errorReason", () => {
  // The `--keep-latest` cleanup loop reports failures itself instead of
  // routing them through handleError, so it never reaches formatError. Reading
  // `err.message` there printed the client's static status table — every
  // failure in the report read "Bad Request".
  it("prefers the API's message over the client's status name", () => {
    expect(
      errorReason(
        apiError(400, "Bad Request", {
          message: "SBOM tag mismatch: expected 9.9.9, found 3.20",
        }),
      ),
    ).toBe("SBOM tag mismatch: expected 9.9.9, found 3.20");
  });

  it("falls back to the status name when the body says nothing", () => {
    expect(errorReason(apiError(404, "Not Found", undefined))).toBe("Not Found");
    expect(errorReason(apiError(400, "Bad Request", { message: "Bad Request" }))).toBe(
      "Bad Request",
    );
  });

  it("carries a plain Error's message, and names anything else", () => {
    expect(errorReason(new Error("socket hang up"))).toBe("socket hang up");
    expect(errorReason("nope")).toBe("unknown error");
    expect(errorReason(undefined)).toBe("unknown error");
  });

  // No `(HTTP n)` suffix and no sanitization: this lands in a table cell that
  // sanitizes at render, or in a JSON document that does not sanitize at all.
  it("returns the bare reason, unlike formatError", () => {
    const err = apiError(409, "Conflict", { message: "Tag is in use" });

    expect(errorReason(err)).toBe("Tag is in use");
    expect(formatError(err)).toBe("Error: Tag is in use (HTTP 409)");
  });
});
