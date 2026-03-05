import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatAnalysisStatus } from "./formatting";

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
