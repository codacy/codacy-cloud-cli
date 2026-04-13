import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatAnalysisStatus, resolveToolUuids } from "./formatting";

// Mock ansis to return raw text for easier testing
vi.mock("ansis", () => ({
  default: {
    dim: (s: string) => s,
    blueBright: (s: string) => s,
    yellow: (s: string) => s,
    bold: (s: string) => s,
    red: (s: string) => s,
    green: (s: string) => s,
    blue: (s: string) => s,
    hex: () => (s: string) => s,
    white: (s: string) => s,
    magenta: (s: string) => s,
  },
}));

describe("formatAnalysisStatus", () => {
  it("should show 'Finished' when analysis is complete and no coverage expected", () => {
    const result = formatAnalysisStatus({
      commitSha: "abc1234567890",
      startedAnalysis: "2025-06-15T10:00:00Z",
      endedAnalysis: "2025-06-15T10:05:00Z",
      expectsCoverage: false,
      hasCoverageData: false,
    });
    expect(result).toContain("Finished");
    expect(result).toContain("abc1234");
  });

  it("should show 'In progress...' for first analysis", () => {
    const result = formatAnalysisStatus({
      commitSha: "def5678901234",
      startedAnalysis: "2025-06-15T10:00:00Z",
      endedAnalysis: undefined,
      expectsCoverage: false,
      hasCoverageData: false,
    });
    expect(result).toContain("In progress...");
    expect(result).toContain("def5678");
  });

  it("should show 'Reanalysis in progress...' when reanalysis is running", () => {
    const result = formatAnalysisStatus({
      commitSha: "abc1234567890",
      startedAnalysis: "2025-06-15T12:00:00Z",
      endedAnalysis: "2025-06-15T10:05:00Z",
      expectsCoverage: false,
      hasCoverageData: false,
    });
    expect(result).toContain("Reanalysis in progress...");
    expect(result).toContain("Finished");
    expect(result).toContain("abc1234");
  });

  it("should show 'Waiting for coverage reports...' when coverage expected within 3h", () => {
    const recentEnd = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    const result = formatAnalysisStatus({
      commitSha: "cov1234567890",
      startedAnalysis: "2025-06-15T10:00:00Z",
      endedAnalysis: recentEnd,
      expectsCoverage: true,
      hasCoverageData: false,
    });
    expect(result).toContain("Waiting for coverage reports...");
    expect(result).toContain("cov1234");
  });

  it("should show 'Missing coverage reports' when coverage expected after 3h", () => {
    const oldEnd = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(); // 4h ago
    const result = formatAnalysisStatus({
      commitSha: "old1234567890",
      startedAnalysis: "2025-06-15T10:00:00Z",
      endedAnalysis: oldEnd,
      expectsCoverage: true,
      hasCoverageData: false,
    });
    expect(result).toContain("Missing coverage reports");
    expect(result).toContain("old1234");
  });

  it("should show 'Never' when no analysis data", () => {
    const result = formatAnalysisStatus({
      commitSha: "abc1234567890",
      startedAnalysis: undefined,
      endedAnalysis: undefined,
      expectsCoverage: false,
      hasCoverageData: false,
    });
    expect(result).toBe("Never");
  });
});

describe("resolveToolUuids", () => {
  const mockTools = [
    { uuid: "uuid-eslint", name: "ESLint", shortName: "eslint", prefix: "ESLint_" },
    { uuid: "uuid-eslint9", name: "ESLint 9", shortName: "eslint9", prefix: "ESLint9_" },
    { uuid: "uuid-semgrep", name: "Semgrep", shortName: "semgrep", prefix: "Semgrep_" },
    { uuid: "uuid-markdownlint", name: "Markdownlint", shortName: "markdownlint", prefix: "Markdownlint_" },
    { uuid: "uuid-remarklint", name: "Remarklint", shortName: "remarklint", prefix: "Remarklint_" },
  ] as any[];

  const fetchTools = vi.fn(async () => mockTools);

  beforeEach(() => {
    fetchTools.mockClear();
  });

  it("should pass UUIDs through without fetching tools", async () => {
    const result = await resolveToolUuids(
      ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
      fetchTools,
    );
    expect(result).toEqual(["a1b2c3d4-e5f6-7890-abcd-ef1234567890"]);
    expect(fetchTools).not.toHaveBeenCalled();
  });

  it("should resolve exact name match (case-insensitive)", async () => {
    const result = await resolveToolUuids(["eslint"], fetchTools);
    expect(result).toEqual(["uuid-eslint"]);
  });

  it("should resolve exact shortName match (case-insensitive)", async () => {
    const result = await resolveToolUuids(["eslint9"], fetchTools);
    expect(result).toEqual(["uuid-eslint9"]);
  });

  it("should resolve a unique substring match via name", async () => {
    const result = await resolveToolUuids(["semgr"], fetchTools);
    expect(result).toEqual(["uuid-semgrep"]);
  });

  it("should error on ambiguous substring match", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolveToolUuids(["mark"], fetchTools)).rejects.toThrow(
      "process.exit called",
    );

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("ambiguous"),
    );

    mockExit.mockRestore();
    (console.error as any).mockRestore();
  });

  it("should error when tool is not found", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolveToolUuids(["zzz"], fetchTools)).rejects.toThrow(
      "process.exit called",
    );

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );

    mockExit.mockRestore();
    (console.error as any).mockRestore();
  });

  it("should handle mixed UUIDs and names, fetching tools only once", async () => {
    const result = await resolveToolUuids(
      ["a1b2c3d4-e5f6-7890-abcd-ef1234567890", "semgrep", "eslint"],
      fetchTools,
    );
    expect(result).toEqual([
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "uuid-semgrep",
      "uuid-eslint",
    ]);
    expect(fetchTools).toHaveBeenCalledTimes(1);
  });
});
