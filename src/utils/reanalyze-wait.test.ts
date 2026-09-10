import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  snapshotFromOverview,
  snapshotFromPrIssues,
  diffSnapshots,
  durationFromStatus,
  pollForAnalysis,
  renderReanalyzeReport,
  reanalyzeJson,
  timers,
  AnalysisStatus,
  IssueSnapshot,
} from "./reanalyze-wait";

// Render colors as raw text so output assertions stay readable.
vi.mock("ansis", () => ({
  default: {
    dim: (s: string) => s,
    bold: (s: string) => s,
    red: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    blue: (s: string) => s,
    blueBright: (s: string) => s,
    hex: () => (s: string) => s,
    white: (s: string) => s,
    magenta: (s: string) => s,
  },
}));

const overviewCounts = {
  categories: [
    { name: "Security", total: 10 },
    { name: "CodeStyle", total: 5 },
  ],
  languages: [{ name: "TypeScript", total: 15 }],
  levels: [
    { name: "Error", total: 4 },
    { name: "Warning", total: 11 },
  ],
  tags: [],
  patterns: [
    { id: "p.secret", title: "Hardcoded Secret", total: 8 },
    { id: "p.params", title: "Too many parameters", total: 7 },
  ],
  authors: [],
  potentialFalsePositives: [],
} as any;

function prIssue(
  id: string,
  title: string,
  category: string,
  severityLevel: string,
): any {
  return {
    deltaType: "Added",
    commitIssue: {
      patternInfo: { id, title, category, severityLevel },
    },
  };
}

describe("snapshotFromOverview", () => {
  it("maps levels/categories/patterns and sums the total", () => {
    const snap = snapshotFromOverview(overviewCounts);
    expect(snap.total).toBe(15); // 4 + 11
    expect(snap.bySeverity).toEqual({ Error: 4, Warning: 11 });
    expect(snap.byCategory).toEqual({ Security: 10, CodeStyle: 5 });
    expect(snap.byPattern["p.secret"]).toEqual({
      title: "Hardcoded Secret",
      count: 8,
    });
    // overview patterns carry no category/severity
    expect(snap.byPattern["p.secret"].category).toBeUndefined();
    expect(snap.byPattern["p.secret"].severity).toBeUndefined();
  });
});

describe("snapshotFromPrIssues", () => {
  it("tallies dimensions and annotates pattern buckets", () => {
    const snap = snapshotFromPrIssues([
      prIssue("p.secret", "Hardcoded Secret", "Security", "Error"),
      prIssue("p.secret", "Hardcoded Secret", "Security", "Error"),
      prIssue("p.params", "Too many parameters", "Complexity", "Warning"),
    ]);
    expect(snap.total).toBe(3);
    expect(snap.bySeverity).toEqual({ Error: 2, Warning: 1 });
    expect(snap.byCategory).toEqual({ Security: 2, Complexity: 1 });
    expect(snap.byPattern["p.secret"]).toEqual({
      title: "Hardcoded Secret",
      category: "Security",
      severity: "Error",
      count: 2,
    });
  });
});

describe("diffSnapshots", () => {
  it("computes nonzero net deltas per dimension", () => {
    const before = snapshotFromOverview(overviewCounts);
    const after = snapshotFromOverview({
      ...overviewCounts,
      levels: [
        { name: "Error", total: 6 }, // +2
        { name: "Warning", total: 11 }, // 0 (dropped)
        { name: "Info", total: 3 }, // +3 (new)
      ],
      categories: [
        { name: "Security", total: 12 }, // +2
        { name: "CodeStyle", total: 5 }, // 0 (dropped)
      ],
      patterns: [
        { id: "p.secret", title: "Hardcoded Secret", total: 13 }, // +5
        { id: "p.params", title: "Too many parameters", total: 4 }, // -3
      ],
    } as any);

    const delta = diffSnapshots(before, after);

    expect(delta.totalBefore).toBe(15);
    expect(delta.totalAfter).toBe(20);
    expect(delta.netTotal).toBe(5);

    // severity sorted Critical→Minor (Error, then Info); Warning dropped (0)
    expect(delta.bySeverity.map((e) => [e.key, e.delta])).toEqual([
      ["Error", 2],
      ["Info", 3],
    ]);
    // category: only Security changed
    expect(delta.byCategory.map((e) => [e.key, e.delta])).toEqual([
      ["Security", 2],
    ]);
    // pattern sorted by |delta| desc
    expect(delta.byPattern.map((e) => [e.label, e.delta])).toEqual([
      ["Hardcoded Secret", 5],
      ["Too many parameters", -3],
    ]);
  });

  it("annotates pattern deltas when category/severity present (PR path)", () => {
    const before = snapshotFromPrIssues([
      prIssue("p.secret", "Hardcoded Secret", "Security", "Error"),
    ]);
    const after = snapshotFromPrIssues([
      prIssue("p.secret", "Hardcoded Secret", "Security", "Error"),
      prIssue("p.secret", "Hardcoded Secret", "Security", "Error"),
    ]);
    const delta = diffSnapshots(before, after);
    expect(delta.byPattern[0]).toMatchObject({
      label: "Hardcoded Secret",
      delta: 1,
      category: "Security",
      severity: "Error",
    });
  });

  it("sorts unknown severities last instead of first", () => {
    // A severity outside the canonical order must not jump ahead of known ones.
    const before: any = {
      total: 0,
      bySeverity: {},
      byCategory: {},
      byPattern: {},
    };
    const after: any = {
      total: 3,
      bySeverity: { Mystery: 1, Error: 1, Info: 1 },
      byCategory: {},
      byPattern: {},
    };
    const delta = diffSnapshots(before, after);
    expect(delta.bySeverity.map((e) => e.key)).toEqual([
      "Error",
      "Info",
      "Mystery",
    ]);
  });
});

describe("durationFromStatus", () => {
  it("computes elapsed ms between started and ended", () => {
    expect(
      durationFromStatus({
        startedAnalysis: "2025-06-15T10:00:00Z",
        endedAnalysis: "2025-06-15T10:01:34Z",
      }),
    ).toBe(94_000);
  });

  it("returns null when a timestamp is missing or inverted", () => {
    expect(durationFromStatus({ startedAnalysis: "x" })).toBeNull();
    expect(
      durationFromStatus({
        startedAnalysis: "2025-06-15T10:05:00Z",
        endedAnalysis: "2025-06-15T10:00:00Z",
      }),
    ).toBeNull();
  });
});

describe("pollForAnalysis", () => {
  beforeEach(() => {
    vi.spyOn(timers, "sleep").mockResolvedValue(undefined);
  });

  // t0 between the "old" timestamps (before) and the "new" ones (after).
  const T0 = Date.parse("2025-06-15T10:00:30Z");

  it("waits for start then completion, transitioning the spinner text", async () => {
    const spinner = { text: "" };
    const getStatus = vi
      .fn<() => Promise<AnalysisStatus>>()
      // old finished analysis (both timestamps before t0) → keep waiting
      .mockResolvedValueOnce({
        startedAnalysis: "2025-06-15T09:55:00Z",
        endedAnalysis: "2025-06-15T10:00:00Z",
      })
      // new analysis running (started after t0, after its old finish)
      .mockResolvedValueOnce({
        startedAnalysis: "2025-06-15T10:01:00Z",
        endedAnalysis: "2025-06-15T10:00:00Z",
      })
      // new analysis finished (ended after started)
      .mockResolvedValueOnce({
        startedAnalysis: "2025-06-15T10:01:00Z",
        endedAnalysis: "2025-06-15T10:02:00Z",
      });

    const result = await pollForAnalysis(getStatus, {
      triggeredAt: T0,
      spinner,
    });

    expect(result.timedOut).toBe(false);
    expect(result.status.endedAnalysis).toBe("2025-06-15T10:02:00Z");
    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(spinner.text).toBe(
      "Analysis in progress. This may take a few minutes...",
    );
  });

  it("returns immediately if analysis already finished before we saw it run", async () => {
    const spinner = { text: "" };
    const getStatus = vi.fn<() => Promise<AnalysisStatus>>().mockResolvedValue({
      startedAnalysis: "2025-06-15T10:01:00Z", // after t0
      endedAnalysis: "2025-06-15T10:02:00Z", // already finished
    });

    const result = await pollForAnalysis(getStatus, {
      triggeredAt: T0,
      spinner,
    });

    expect(result.timedOut).toBe(false);
    expect(getStatus).toHaveBeenCalledTimes(1);
    // never transitioned to the "in progress" message
    expect(spinner.text).toBe("Analysis requested. Waiting for it to start...");
  });

  it("ignores an analysis that started before we triggered (t0)", async () => {
    const spinner = { text: "" };
    let t = 0;
    const now = () => {
      const v = t;
      t += 5_000;
      return v;
    };
    // started before t0 → not our analysis, so it should keep waiting (and time out)
    const getStatus = vi.fn<() => Promise<AnalysisStatus>>().mockResolvedValue({
      startedAnalysis: "2025-06-15T10:00:10Z", // before t0 (10:00:30)
      endedAnalysis: "2025-06-15T10:00:05Z",
    });

    const result = await pollForAnalysis(getStatus, {
      triggeredAt: T0,
      spinner,
      maxWaitMs: 1_000,
      now,
    });

    expect(result.timedOut).toBe(true);
  });

  it("times out when analysis never finishes", async () => {
    const spinner = { text: "" };
    let t = 0;
    const now = () => {
      const v = t;
      t += 5_000;
      return v;
    };
    const getStatus = vi.fn<() => Promise<AnalysisStatus>>().mockResolvedValue({
      startedAnalysis: "2025-06-15T10:01:00Z", // after t0, never ends
      endedAnalysis: "2025-06-15T10:00:00Z",
    });

    const result = await pollForAnalysis(getStatus, {
      triggeredAt: T0,
      spinner,
      maxWaitMs: 1_000,
      now,
    });

    expect(result.timedOut).toBe(true);
  });

  describe("non-TTY progress line", () => {
    let writeSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    });
    afterEach(() => {
      writeSpy.mockRestore();
    });

    // Advances `now()` by one poll interval (10s) per call, still waiting to start.
    function tickingClock(pollMs: number) {
      let t = 0;
      return () => {
        const v = t;
        t += pollMs;
        return v;
      };
    }

    it("prints nothing before 60s have elapsed", async () => {
      const spinner = { text: "" };
      const now = tickingClock(10_000);
      const getStatus = vi.fn<() => Promise<AnalysisStatus>>().mockResolvedValue({
        startedAnalysis: "2025-06-15T10:01:00Z", // after t0, never ends
        endedAnalysis: "2025-06-15T10:00:00Z",
      });

      await pollForAnalysis(getStatus, {
        triggeredAt: T0,
        spinner,
        maxWaitMs: 15_000,
        now,
        isTTY: false,
      });

      expect(writeSpy).not.toHaveBeenCalled();
    });

    it("prints a line at 60s and 120s with status=waiting while not yet started", async () => {
      const spinner = { text: "" };
      const now = tickingClock(10_000);
      // No startedAnalysis at all: the reanalysis hasn't been picked up yet.
      const getStatus = vi.fn<() => Promise<AnalysisStatus>>().mockResolvedValue({});

      await pollForAnalysis(getStatus, {
        triggeredAt: T0,
        spinner,
        maxWaitMs: 200_000,
        now,
        isTTY: false,
      });

      const lines = writeSpy.mock.calls.map((c: any) => c[0]);
      expect(lines).toContain("elapsed 1m, status=waiting\n");
      expect(lines).toContain("elapsed 2m, status=waiting\n");
    });

    it("prints status=inProgress once the analysis has started", async () => {
      const spinner = { text: "" };
      const now = tickingClock(10_000);
      const getStatus = vi
        .fn<() => Promise<AnalysisStatus>>()
        // in progress from the very first check onward
        .mockResolvedValue({
          startedAnalysis: "2025-06-15T10:01:00Z", // after t0
          endedAnalysis: "2025-06-15T10:00:00Z", // not finished
        });

      await pollForAnalysis(getStatus, {
        triggeredAt: T0,
        spinner,
        maxWaitMs: 70_000,
        now,
        isTTY: false,
      });

      const lines = writeSpy.mock.calls.map((c: any) => c[0]);
      expect(lines).toContain("elapsed 1m, status=inProgress\n");
    });

    it("prints nothing when stderr is a TTY", async () => {
      const spinner = { text: "" };
      const now = tickingClock(10_000);
      const getStatus = vi.fn<() => Promise<AnalysisStatus>>().mockResolvedValue({
        startedAnalysis: "2025-06-15T10:01:00Z",
        endedAnalysis: "2025-06-15T10:00:00Z",
      });

      await pollForAnalysis(getStatus, {
        triggeredAt: T0,
        spinner,
        maxWaitMs: 130_000,
        now,
        isTTY: true,
      });

      expect(writeSpy).not.toHaveBeenCalled();
    });
  });
});

describe("renderReanalyzeReport", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  function output(): string {
    return logSpy.mock.calls.map((c: any) => c[0]).join("\n");
  }

  it("prints duration headline, sections, and totals", () => {
    const before = snapshotFromPrIssues([
      prIssue("p.params", "Too many parameters", "Complexity", "Warning"),
    ]);
    const after = snapshotFromPrIssues([
      prIssue("p.secret", "Hardcoded Secret", "Security", "Error"),
    ]);
    renderReanalyzeReport(diffSnapshots(before, after), 94_000);
    const out = output();
    expect(out).toContain("Analysis finished in 1m 34s");
    expect(out).toContain("By pattern:");
    expect(out).toContain("Hardcoded Secret");
    expect(out).toContain("(Security · Critical)"); // annotation present for PR data
    expect(out).toContain("By severity:");
    expect(out).toContain("In total: 1 → 1 issues  (net 0)");
  });

  it("reports no change when snapshots are identical", () => {
    const snap = snapshotFromOverview(overviewCounts);
    renderReanalyzeReport(diffSnapshots(snap, snap), 1000);
    expect(output()).toContain("No change in issues.");
  });
});

describe("reanalyzeJson", () => {
  it("bundles totals and per-dimension deltas", () => {
    const before: IssueSnapshot = snapshotFromOverview(overviewCounts);
    const after = snapshotFromOverview({
      ...overviewCounts,
      levels: [{ name: "Error", total: 6 }, { name: "Warning", total: 11 }],
    } as any);
    const delta = diffSnapshots(before, after);
    const json = reanalyzeJson(before, after, delta, 94_000) as any;
    expect(json.durationHuman).toBe("1m 34s");
    expect(json.totals).toEqual({ before: 15, after: 17, net: 2 });
    expect(json.deltas.bySeverity).toEqual([
      { key: "Error", label: "Critical", delta: 2, severity: "Error" },
    ]);
  });
});
