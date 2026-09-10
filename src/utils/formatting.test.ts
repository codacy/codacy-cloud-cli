import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatAnalysisStatus,
  resolveToolUuids,
  formatDuration,
  isBeingAnalyzed,
  formatVersionSegment,
  formatDependencyChain,
  formatDependencyChainsLine,
  formatDependencyChainsBlock,
  formatGrade,
  formatCountCell,
  formatCoverageCell,
  formatDelta,
  formatPrCoverage,
  formatPrIssues,
  prQualityMetric,
  hasAnyPrCoverage,
  colorMetric,
  coverageStatusGlyph,
  coverageStatusLegend,
  coverageStatusNote,
  formatRepoCoverageCell,
  formatRepoCoverageDetail,
} from "./formatting";
import { formatFriendlyDate } from "./output";

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

  it("should show 'Waiting for coverage reports...' within 3h (pull-request fallback heuristic)", () => {
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

  it("should show 'Missing coverage reports' after 3h (pull-request fallback heuristic)", () => {
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

  it("shows 'Waiting for coverage reports...' from an authoritative Waiting status", () => {
    const result = formatAnalysisStatus({
      commitSha: "wait123456789",
      startedAnalysis: "2025-06-15T10:00:00Z",
      endedAnalysis: "2025-06-15T10:05:00Z",
      coverageStatus: "Waiting",
      // The bug this fixes: a waiting repository still reports a (stale)
      // percentage, so the heuristic reads it as healthy and says nothing.
      // The authoritative status has to win over that.
      expectsCoverage: true,
      hasCoverageData: true,
    });
    expect(result).toContain("Waiting for coverage reports...");
    expect(result).toContain("wait123");
  });

  it("shows 'Stopped receiving coverage reports' from an authoritative Stopped status", () => {
    const result = formatAnalysisStatus({
      commitSha: "stop123456789",
      startedAnalysis: "2025-06-15T10:00:00Z",
      endedAnalysis: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      coverageStatus: "Stopped",
      expectsCoverage: true,
      hasCoverageData: false,
    });
    expect(result).toContain("Stopped receiving coverage reports");
    // The vaguer heuristic wording must not leak through.
    expect(result).not.toContain("Missing coverage reports");
  });

  it("appends nothing for an authoritative UpToDate or None status", () => {
    for (const coverageStatus of ["UpToDate", "None"] as const) {
      const result = formatAnalysisStatus({
        commitSha: "ok01234567890",
        startedAnalysis: "2025-06-15T10:00:00Z",
        endedAnalysis: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
        coverageStatus,
        // Would otherwise trip the heuristic into "Missing coverage reports".
        expectsCoverage: true,
        hasCoverageData: false,
      });
      expect(result).toContain("Finished");
      expect(result).not.toContain("coverage");
    }
  });

  it("falls back to the heuristic when no coverage status is available", () => {
    const result = formatAnalysisStatus({
      commitSha: "old1234567890",
      startedAnalysis: "2025-06-15T10:00:00Z",
      endedAnalysis: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      coverageStatus: undefined,
      expectsCoverage: true,
      hasCoverageData: false,
    });
    expect(result).toContain("Missing coverage reports");
  });

  it("appends no coverage state when neither source says anything", () => {
    const result = formatAnalysisStatus({
      commitSha: "bare123456789",
      startedAnalysis: "2025-06-15T10:00:00Z",
      endedAnalysis: "2025-06-15T10:05:00Z",
    });
    expect(result).toContain("Finished");
    expect(result).not.toContain("coverage");
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
    await expect(resolveToolUuids(["mark"], fetchTools)).rejects.toThrow(
      /ambiguous.*Markdownlint.*Remarklint/,
    );
  });

  it("should error when tool is not found", async () => {
    await expect(resolveToolUuids(["zzz"], fetchTools)).rejects.toThrow(
      'Tool "zzz" not found',
    );
  });

  it("should deduplicate resolved UUIDs", async () => {
    const result = await resolveToolUuids(["eslint", "eslint"], fetchTools);
    expect(result).toEqual(["uuid-eslint"]);
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

describe("formatDuration", () => {
  it("shows seconds only for sub-minute durations", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(999)).toBe("1s");
  });

  it("shows minutes and seconds", () => {
    expect(formatDuration(94_000)).toBe("1m 34s");
    expect(formatDuration(60_000)).toBe("1m 0s");
  });

  it("shows hours and minutes (dropping seconds)", () => {
    expect(formatDuration(7_380_000)).toBe("2h 3m");
  });

  it("clamps negatives to 0s", () => {
    expect(formatDuration(-5_000)).toBe("0s");
  });
});

describe("formatGrade", () => {
  // ansis is mocked to identity, so we assert on the letter and N/A fallback.
  it("returns the grade letter for A–F including E", () => {
    for (const g of ["A", "B", "C", "D", "E", "F"]) {
      expect(formatGrade(g)).toBe(g);
    }
  });

  it("returns N/A when the grade is missing", () => {
    expect(formatGrade(undefined)).toBe("N/A");
    expect(formatGrade("")).toBe("N/A");
  });
});

describe("formatCountCell", () => {
  it("abbreviates a count", () => {
    expect(formatCountCell(1200)).toBe("1.2k");
    expect(formatCountCell(0)).toBe("0");
  });

  it("renders a dash when the value is absent (undefined or null)", () => {
    expect(formatCountCell(undefined)).toBe("-");
    expect(formatCountCell(null)).toBe("-");
  });
});

describe("formatCoverageCell", () => {
  it("renders a one-decimal percentage", () => {
    expect(formatCoverageCell(76.3)).toBe("76.3%");
    expect(formatCoverageCell(0)).toBe("0.0%");
  });

  it("renders a dash when coverage is absent (undefined or null)", () => {
    expect(formatCoverageCell(undefined)).toBe("-");
    expect(formatCoverageCell(null)).toBe("-");
  });
});

describe("formatDelta", () => {
  it("signs the delta", () => {
    expect(formatDelta(21)).toBe("+21");
    expect(formatDelta(-3)).toBe("-3");
    expect(formatDelta(0)).toBe("0");
  });

  it("renders a dash when the delta is absent", () => {
    expect(formatDelta(undefined)).toBe("-");
  });
});

describe("formatPrCoverage", () => {
  it("renders diff coverage with the delta in parentheses", () => {
    expect(
      formatPrCoverage({
        coverage: { diffCoverage: { value: 85 }, deltaCoverage: -1.5 },
      } as any),
    ).toBe("85.0% (-1.5%)");
  });

  it("renders a dash when the repo reports no coverage numbers", () => {
    expect(
      formatPrCoverage({
        coverage: { diffCoverage: { cause: "MissingRequirements" } },
      } as any),
    ).toBe("-");
    expect(formatPrCoverage({} as any)).toBe("-");
  });
});

describe("formatPrIssues", () => {
  it("renders new / fixed issue counts", () => {
    expect(formatPrIssues({ newIssues: 3, fixedIssues: 1 } as any)).toBe(
      "+3 / -1",
    );
  });

  it("reads the counts from the nested quality object", () => {
    expect(
      formatPrIssues({ quality: { newIssues: 3, fixedIssues: 1 } } as any),
    ).toBe("+3 / -1");
  });

  it("renders zero without a sign", () => {
    expect(formatPrIssues({ newIssues: 0, fixedIssues: 0 } as any)).toBe(
      "0 / 0",
    );
    expect(formatPrIssues({ newIssues: 2, fixedIssues: 0 } as any)).toBe(
      "+2 / 0",
    );
  });

  it("renders dashes when the counts are absent", () => {
    expect(formatPrIssues({} as any)).toBe("- / -");
  });
});

describe("prQualityMetric", () => {
  it("prefers the nested quality value over the flat one", () => {
    expect(
      prQualityMetric(
        { deltaComplexity: 1, quality: { deltaComplexity: 21 } } as any,
        "deltaComplexity",
      ),
    ).toBe(21);
  });

  // The pull-request endpoints omit the top-level `deltaComplexity` entirely
  // while still populating `quality.deltaComplexity`.
  it("reads the nested value when the flat field is missing", () => {
    expect(
      prQualityMetric({ quality: { deltaComplexity: 21 } } as any, "deltaComplexity"),
    ).toBe(21);
  });

  it("falls back to the flat field when quality is absent", () => {
    expect(
      prQualityMetric({ deltaClonesCount: 2 } as any, "deltaClonesCount"),
    ).toBe(2);
  });

  it("is undefined when neither is present", () => {
    expect(prQualityMetric({} as any, "deltaComplexity")).toBeUndefined();
  });

  it("keeps a nested zero rather than falling through to the flat field", () => {
    expect(
      prQualityMetric(
        { deltaClonesCount: 5, quality: { deltaClonesCount: 0 } } as any,
        "deltaClonesCount",
      ),
    ).toBe(0);
  });
});

describe("hasAnyPrCoverage", () => {
  it("is true when at least one PR has a diff coverage value", () => {
    expect(
      hasAnyPrCoverage([
        { coverage: { diffCoverage: { cause: "MissingRequirements" } } },
        { coverage: { diffCoverage: { value: 85 } } },
      ] as any),
    ).toBe(true);
  });

  it("is true when a PR only has a coverage delta", () => {
    expect(hasAnyPrCoverage([{ coverage: { deltaCoverage: -1.5 } }] as any)).toBe(
      true,
    );
  });

  it("is false when no PR carries coverage numbers", () => {
    expect(
      hasAnyPrCoverage([
        { coverage: { diffCoverage: { cause: "MissingRequirements" } } },
        {},
      ] as any),
    ).toBe(false);
  });

  it("is false for an empty list", () => {
    expect(hasAnyPrCoverage([])).toBe(false);
  });
});

describe("isBeingAnalyzed", () => {
  it("is true when started but never finished", () => {
    expect(isBeingAnalyzed("2025-06-15T10:00:00Z", undefined)).toBe(true);
  });

  it("is true when started after the last finish (a fresh reanalysis)", () => {
    expect(
      isBeingAnalyzed("2025-06-15T10:10:00Z", "2025-06-15T10:05:00Z"),
    ).toBe(true);
  });

  it("is false when finished after it started", () => {
    expect(
      isBeingAnalyzed("2025-06-15T10:00:00Z", "2025-06-15T10:05:00Z"),
    ).toBe(false);
  });

  it("is false when never started", () => {
    expect(isBeingAnalyzed(undefined, undefined)).toBe(false);
  });
});

describe("formatVersionSegment", () => {
  it("returns null when there is no affected version", () => {
    expect(formatVersionSegment(undefined, ["1.0.1"])).toBeNull();
  });

  it("formats affected → fixed without a prefix by default", () => {
    expect(formatVersionSegment("1.0.0", ["1.0.1", "1.1.0"])).toBe(
      "1.0.0 → 1.0.1, 1.1.0",
    );
  });

  it("prepends 'Update ' when requested", () => {
    expect(
      formatVersionSegment("1.0.0", ["1.0.1"], { includeUpdatePrefix: true }),
    ).toBe("Update 1.0.0 → 1.0.1");
  });

  it("omits the fixed suffix when no fixed version is given", () => {
    expect(formatVersionSegment("1.0.0", [])).toBe("1.0.0");
    expect(formatVersionSegment("1.0.0")).toBe("1.0.0");
  });
});

describe("formatDependencyChain", () => {
  it("shows a 2-package chain in full", () => {
    expect(formatDependencyChain(["a@1", "m@0.1.2"])).toBe("a@1 → m@0.1.2");
  });

  it("shows a 3-package chain in full", () => {
    expect(formatDependencyChain(["a@1", "b@2", "m@0.1.2"])).toBe(
      "a@1 → b@2 → m@0.1.2",
    );
  });

  it("collapses the middle of a 4-package chain to '2 more'", () => {
    expect(formatDependencyChain(["a@1", "b@2", "c@3", "d@4"])).toBe(
      "a@1 → ... 2 more ... → d@4",
    );
  });

  it("collapses the middle of a 5-package chain to '3 more'", () => {
    expect(formatDependencyChain(["a@1", "b@2", "c@3", "d@4", "e@5"])).toBe(
      "a@1 → ... 3 more ... → e@5",
    );
  });

  it("shows a single-package chain as-is", () => {
    expect(formatDependencyChain(["m@0.1.2"])).toBe("m@0.1.2");
  });
});

describe("formatDependencyChainsLine", () => {
  it("returns null for empty/undefined chains", () => {
    expect(formatDependencyChainsLine([])).toBeNull();
    expect(formatDependencyChainsLine(undefined)).toBeNull();
  });

  it("renders a direct dependency as actionable update text", () => {
    expect(formatDependencyChainsLine([["minimatch@0.1.2"]], ["0.1.5"])).toBe(
      "Direct - Update minimatch@0.1.2 to 0.1.5",
    );
  });

  it("renders a transitive chain with the fixed version", () => {
    expect(
      formatDependencyChainsLine(
        [["package@1.0.0", "anotherPackage@0.5.2", "minimatch@0.1.2"]],
        ["0.1.5"],
      ),
    ).toBe(
      "Transitive - package@1.0.0 → anotherPackage@0.5.2 → minimatch@0.1.2 (Fixed in 0.1.5)",
    );
  });

  it("appends '... and N more' when there are extra chains", () => {
    expect(
      formatDependencyChainsLine(
        [
          ["a@1", "m@0.1.2"],
          ["b@1", "m@0.1.2"],
          ["c@1", "m@0.1.2"],
        ],
        ["0.1.5"],
      ),
    ).toBe("Transitive - a@1 → m@0.1.2 (Fixed in 0.1.5) ... and 2 more");
  });

  it("omits the fixed-version suffix when none is provided", () => {
    expect(formatDependencyChainsLine([["a@1", "m@0.1.2"]])).toBe(
      "Transitive - a@1 → m@0.1.2",
    );
    expect(formatDependencyChainsLine([["minimatch@0.1.2"]])).toBe(
      "Direct - Update minimatch@0.1.2",
    );
  });
});

describe("formatDependencyChainsBlock", () => {
  it("returns null for empty/undefined chains", () => {
    expect(formatDependencyChainsBlock([])).toBeNull();
    expect(formatDependencyChainsBlock(undefined)).toBeNull();
  });

  it("renders all chains with the label once and aligned continuation lines", () => {
    const block = formatDependencyChainsBlock(
      [
        ["package@1.0.0", "anotherPackage@0.5.2", "minimatch@0.1.2"],
        ["anotherPackage@1.0.0", "b@1", "c@2", "d@3", "e@4", "minimatch@0.1.1"],
      ],
      ["0.1.5"],
    );
    expect(block).toBe(
      "Transitive - package@1.0.0 → anotherPackage@0.5.2 → minimatch@0.1.2 (Fixed in 0.1.5)\n" +
        "           - anotherPackage@1.0.0 → ... 4 more ... → minimatch@0.1.1 (Fixed in 0.1.5)",
    );
  });

  it("aligns continuation lines under a shorter 'Direct' label", () => {
    const block = formatDependencyChainsBlock(
      [["minimatch@0.1.2"], ["minimatch@0.1.3"]],
      ["0.1.5"],
    );
    expect(block).toBe(
      "Direct - Update minimatch@0.1.2 to 0.1.5\n" +
        "       - Update minimatch@0.1.3 to 0.1.5",
    );
  });
});

// Fixtures mirror the four real payload shapes the API returns, which differ in
// more than just `status`: `Waiting` carries a *stale* percentage (from
// `lastCommitWithCoverage`, with `valueUpdatedAt` older than `statusUpdatedAt`),
// `Stopped` carries no percentage at all, and `None` carries nothing but the
// status. A large share of repositories also come back with no `status` — that
// is the common path, not an edge case, so it gets its own fixture.
const covUpToDate = {
  coveragePercentage: 81,
  coveragePercentageWithDecimals: 81.52,
  status: "UpToDate" as const,
  lastCommitWithCoverage: "92abbe5d63c88211ed2f2c7dfba261b0f4cbd3b9",
  statusUpdatedAt: "2026-09-10T11:46:23.542085Z",
  valueUpdatedAt: "2026-09-10T11:46:23.542085Z",
};
const covWaiting = {
  coveragePercentage: 19,
  coveragePercentageWithDecimals: 19.42,
  status: "Waiting" as const,
  lastCommitWithCoverage: "5474cbf195db8f6fb0704d2bc9a8dc4e16065dc9",
  statusUpdatedAt: "2026-09-10T10:44:04.440743Z",
  valueUpdatedAt: "2026-09-10T01:13:16.102431Z",
};
const covStopped = {
  status: "Stopped" as const,
  lastCommitWithCoverage: "8752dbd2bef1fab22db1197ae5e87de371ff2ead",
  statusUpdatedAt: "2026-08-26T11:08:31.090599Z",
};
const covNone = { status: "None" as const };
const covNoStatus = { coveragePercentage: 85 };

describe("coverageStatusGlyph", () => {
  it("marks only the two states worth flagging", () => {
    expect(coverageStatusGlyph(covWaiting)).toBe("⋯");
    expect(coverageStatusGlyph(covStopped)).toBe("⊘");
  });

  it("returns undefined for every other state", () => {
    expect(coverageStatusGlyph(covUpToDate)).toBeUndefined();
    expect(coverageStatusGlyph(covNone)).toBeUndefined();
    expect(coverageStatusGlyph(covNoStatus)).toBeUndefined();
    expect(coverageStatusGlyph(undefined)).toBeUndefined();
  });
});

describe("formatRepoCoverageCell", () => {
  it("appends the stale marker to a waiting repository's last known value", () => {
    expect(formatRepoCoverageCell(covWaiting, 60)).toBe("19.0% ⋯");
  });

  it("shows the stopped marker alone — there is no percentage to show", () => {
    const cell = formatRepoCoverageCell(covStopped, 60);
    expect(cell).toBe("⊘");
    expect(cell).not.toContain("%");
    expect(cell).not.toContain("N/A");
  });

  it("renders an up-to-date repository exactly as before", () => {
    expect(formatRepoCoverageCell(covUpToDate, 60)).toBe(
      colorMetric(81, 60, "min"),
    );
  });

  it("degrades to the plain metric when the status is absent", () => {
    // The common path: no status at all, or no coverage object.
    expect(formatRepoCoverageCell(covNoStatus, 60)).toBe(
      colorMetric(85, 60, "min"),
    );
    expect(formatRepoCoverageCell(undefined, 60)).toBe(
      colorMetric(undefined, 60, "min"),
    );
    expect(formatRepoCoverageCell(covNone, 60)).toBe(
      colorMetric(undefined, 60, "min"),
    );
  });

  it("keeps threshold coloring on a waiting repository's stale value", () => {
    // The glyph is what marks the value stale; the color still answers
    // "is this repository above its coverage goal", same as every other row.
    expect(formatRepoCoverageCell(covWaiting, 60)).toContain(
      colorMetric(19, 60, "min"),
    );
  });
});

describe("coverageStatusLegend", () => {
  it("explains nothing when there is nothing to explain", () => {
    expect(
      coverageStatusLegend([covUpToDate, covNone, covNoStatus, undefined]),
    ).toEqual([]);
  });

  it("explains only the statuses present in the listing", () => {
    const waitingOnly = coverageStatusLegend([covUpToDate, covWaiting]);
    expect(waitingOnly).toHaveLength(1);
    expect(waitingOnly[0]).toContain("⋯");

    const stoppedOnly = coverageStatusLegend([covStopped, covNone]);
    expect(stoppedOnly).toHaveLength(1);
    expect(stoppedOnly[0]).toContain("⊘");
  });

  it("deduplicates across a mixed listing", () => {
    const legend = coverageStatusLegend([
      covUpToDate, covWaiting, covStopped, covWaiting, covNone,
      covStopped, covNoStatus, undefined,
    ]);
    expect(legend).toHaveLength(2);
    expect(legend[0]).toContain("⋯");
    expect(legend[1]).toContain("⊘");
  });
});

describe("coverageStatusNote", () => {
  it("says a waiting repository's value is stale, and where it came from", () => {
    const note = coverageStatusNote(covWaiting);
    expect(note).toContain("Not reported yet for the latest commit");
    expect(note).toContain("value from");
    expect(note).toContain(formatFriendlyDate(covWaiting.valueUpdatedAt));
    expect(note).toContain("5474cbf");
    // Truncated to 7 characters, like every other commit in the CLI.
    expect(note).not.toContain("5474cbf1");
  });

  it("omits the provenance clause when the value has no timestamp", () => {
    const note = coverageStatusNote({ ...covWaiting, valueUpdatedAt: undefined });
    expect(note).toBe("Not reported yet for the latest commit");
  });

  it("says when a stopped repository stopped, and its last report", () => {
    const note = coverageStatusNote(covStopped);
    expect(note).toContain("Stopped receiving reports");
    expect(note).toContain(formatFriendlyDate(covStopped.statusUpdatedAt));
    expect(note).toContain("last report");
    expect(note).toContain("8752dbd");
  });

  it("degrades to a bare sentence when a stopped payload carries nothing else", () => {
    expect(coverageStatusNote({ status: "Stopped" })).toBe(
      "Stopped receiving reports",
    );
  });

  it("names the gate consequence only when a coverage gate is configured", () => {
    expect(coverageStatusNote(covStopped, { gateConfigured: true })).toContain(
      "coverage gate no longer enforced",
    );
    expect(coverageStatusNote(covStopped, { gateConfigured: false })).not.toContain(
      "gate",
    );
    expect(coverageStatusNote(covStopped)).not.toContain("gate");
  });

  it("distinguishes 'never set up' from an uncomputed metric", () => {
    expect(coverageStatusNote(covNone)).toBe("Not set up");
  });

  it("says nothing when there is nothing to say", () => {
    expect(coverageStatusNote(covUpToDate)).toBeUndefined();
    expect(coverageStatusNote(covNoStatus)).toBeUndefined();
    expect(coverageStatusNote(undefined)).toBeUndefined();
  });

  it("neutralizes control characters in the commit SHA (CWE-150)", () => {
    // ansis is mocked to identity in this file, so any ESC in the result can
    // only have come from the payload. Sanitizing before the 7-char slice also
    // stops the slice from ending mid-escape-sequence.
    const esc = String.fromCharCode(27);
    const note = coverageStatusNote({
      ...covStopped,
      lastCommitWithCoverage: `abc${esc}[31mdef0123456789`,
    });
    expect(note).not.toContain(esc);
  });
});

describe("formatRepoCoverageDetail", () => {
  it("shows a waiting repository's value and why it is stale", () => {
    const detail = formatRepoCoverageDetail(covWaiting, 60);
    expect(detail).toContain(colorMetric(19, 60, "min"));
    expect(detail).toContain("Not reported yet for the latest commit");
  });

  it("shows the note alone for the states that have no percentage", () => {
    const stopped = formatRepoCoverageDetail(covStopped, 60);
    expect(stopped).toContain("Stopped receiving reports");
    expect(stopped).not.toContain("%");
    expect(stopped).not.toContain("N/A");

    expect(formatRepoCoverageDetail(covNone, 60)).toBe("Not set up");
  });

  it("passes the gate consequence through from the threshold", () => {
    expect(formatRepoCoverageDetail(covStopped, 60)).toContain(
      "coverage gate no longer enforced",
    );
    expect(formatRepoCoverageDetail(covStopped, undefined)).not.toContain("gate");
  });

  it("is byte-identical to the plain metric when there is no status to add", () => {
    // The regression guard: everything without a Waiting/Stopped/None status
    // must render exactly as it did before this field existed.
    expect(formatRepoCoverageDetail(covUpToDate, 60)).toBe(
      colorMetric(81, 60, "min"),
    );
    expect(formatRepoCoverageDetail(covNoStatus, 60)).toBe(
      colorMetric(85, 60, "min"),
    );
    expect(formatRepoCoverageDetail(undefined, 60)).toBe(
      colorMetric(undefined, 60, "min"),
    );
  });
});
