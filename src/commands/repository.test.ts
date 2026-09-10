import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerRepositoryCommand } from "./repository";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { RepositoryService } from "../api/client/services/RepositoryService";
import { CodingStandardsService } from "../api/client/services/CodingStandardsService";
import { timers } from "../utils/reanalyze-wait";

vi.mock("../api/client/services/AnalysisService");
vi.mock("../api/client/services/RepositoryService");
vi.mock("../api/client/services/CodingStandardsService");
vi.mock("../utils/credentials", () => ({ loadCredentials: vi.fn(() => null) }));
vi.mock("../utils/git-remote", () => ({
  detectRepoContext: vi.fn(() => ({
    provider: "gh",
    organization: "auto-org",
    repository: "auto-repo",
  })),
}));
vi.spyOn(console, "log").mockImplementation(() => {});

// Default mocks for analysis status API calls (overridden in specific tests)
function setupDefaultMocks() {
  vi.mocked(AnalysisService.listRepositoryCommits).mockResolvedValue({
    data: [{
      commit: {
        sha: "abc1234567890",
        id: 1,
        commitTimestamp: "2025-06-15T10:00:00Z",
        authorName: "Test",
        authorEmail: "test@test.com",
        message: "fix things",
        startedAnalysis: "2025-06-15T10:00:00Z",
        endedAnalysis: "2025-06-15T10:05:00Z",
      },
    }],
  } as any);
}

function createProgram(): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  registerRepositoryCommand(program);
  return program;
}

const mockRepoData = {
  lastAnalysedCommit: {
    sha: "abc1234567890",
    id: 1,
    commitTimestamp: "2025-06-15T10:00:00Z",
    authorName: "Test",
    authorEmail: "test@test.com",
    message: "fix things",
    endedAnalysis: "2025-06-15T10:05:00Z",
  },
  gradeLetter: "B",
  grade: 80,
  issuesCount: 25,
  issuesPercentage: 5.0,
  loc: 10000,
  complexFilesPercentage: 12.5,
  complexFilesCount: 3,
  duplicationPercentage: 4.2,
  repository: {
    repositoryId: 1,
    provider: "gh",
    owner: "test-org",
    name: "test-repo",
    fullPath: "test-org/test-repo",
    visibility: "Private" as const,
    lastUpdated: "2025-06-15T10:00:00Z",
    problems: [],
    languages: ["TypeScript", "JavaScript"],
    defaultBranch: {
      id: 1,
      name: "main",
      isDefault: true,
      isEnabled: true,
      branchType: "Branch" as const,
    },
    standards: [{ id: 1, name: "Codacy Standard" }],
    addedState: "Added",
    gatePolicyName: "Codacy recommended",
  },
  coverage: { coveragePercentage: 78, numberTotalFiles: 83 },
  goals: {
    maxComplexFilesPercentage: 25,
    maxDuplicatedFilesPercentage: 10,
    minCoveragePercentage: 80,
  },
};

const mockPullRequests = [
  {
    isUpToStandards: true,
    isAnalysing: false,
    pullRequest: {
      id: 1,
      number: 42,
      updated: "2025-06-14T10:00:00Z",
      status: "open",
      repository: "test-repo",
      title: "Add new feature",
      owner: { id: 1, name: "dev" },
      headCommitSha: "def456",
      commonAncestorCommitSha: "ghi789",
      originBranch: "feature/new",
      targetBranch: "main",
      gitHref: "https://github.com/test-org/test-repo/pull/42",
    },
    newIssues: 2,
    fixedIssues: 5,
    deltaComplexity: 3,
    deltaClonesCount: -1,
    coverage: {
      deltaCoverage: -2.5,
      diffCoverage: { value: 85.5, cause: "ValueIsPresent" },
      isUpToStandards: true,
    },
    quality: {
      isUpToStandards: true,
    },
    meta: {},
  },
];

const mockIssuesCounts = {
  categories: [
    { name: "Security", total: 3 },
    { name: "Error Prone", total: 10 },
  ],
  levels: [
    { name: "Error", total: 5 },
    { name: "Warning", total: 8 },
  ],
  languages: [
    { name: "TypeScript", total: 10 },
    { name: "JavaScript", total: 3 },
  ],
  tags: [],
  patterns: [],
  authors: [],
  potentialFalsePositives: [],
};

describe("repository command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
    setupDefaultMocks();
  });

  it("should fetch and display repository details in table format", async () => {
    vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
      data: mockRepoData as any,
    });
    vi.mocked(AnalysisService.listRepositoryPullRequests).mockResolvedValue({
      data: mockPullRequests as any,
    });
    vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
      data: { counts: mockIssuesCounts },
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "repository",
      "gh",
      "test-org",
      "test-repo",
    ]);

    expect(AnalysisService.getRepositoryWithAnalysis).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
    );
    expect(AnalysisService.listRepositoryPullRequests).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
    );
    expect(AnalysisService.issuesOverview).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
    );

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");

    // About section
    expect(allOutput).toContain("test-repo");
    expect(allOutput).toContain("main");
    expect(allOutput).toContain("abc1234");

    // Setup section
    expect(allOutput).toContain("TypeScript");
    expect(allOutput).toContain("Codacy Standard");
    expect(allOutput).toContain("Codacy recommended");

    // Metrics section
    expect(allOutput).toContain("25");
    expect(allOutput).toContain("kLoC");

    // Pull Requests section
    expect(allOutput).toContain("Add new feature");
    expect(allOutput).toContain("42");
    expect(allOutput).toContain("+2");
    expect(allOutput).toContain("-5");
    expect(allOutput).toContain("85.5%");
    expect(allOutput).toContain("-2.5%");
    expect(allOutput).toContain("✓");

    // Issues overview
    expect(allOutput).toContain("Security");
    expect(allOutput).toContain("Error Prone");
    expect(allOutput).toContain("Warning");
  });

  it("should output JSON when --output json is specified", async () => {
    vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
      data: mockRepoData as any,
    });
    vi.mocked(AnalysisService.listRepositoryPullRequests).mockResolvedValue({
      data: mockPullRequests as any,
    });
    vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
      data: { counts: mockIssuesCounts },
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "--output",
      "json",
      "repository",
      "gh",
      "test-org",
      "test-repo",
    ]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"name": "test-repo"'),
    );

    const jsonCall = (console.log as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].startsWith("{"),
    );
    const parsed = JSON.parse(jsonCall![0]);
    expect(parsed.repository.fileCount).toBe(83);
  });

  it("omits fileCount from JSON when coverage.numberTotalFiles is absent", async () => {
    vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
      data: { ...mockRepoData, coverage: {} } as any,
    });
    vi.mocked(AnalysisService.listRepositoryPullRequests).mockResolvedValue({
      data: [],
    });
    vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
      data: { counts: mockIssuesCounts },
    });

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "--output", "json",
      "repository", "gh", "test-org", "test-repo",
    ]);

    const jsonCall = (console.log as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].startsWith("{"),
    );
    const parsed = JSON.parse(jsonCall![0]);
    expect(parsed.repository.fileCount).toBeUndefined();
  });

  it("should handle repository with no PRs and no issues", async () => {
    vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
      data: mockRepoData as any,
    });
    vi.mocked(AnalysisService.listRepositoryPullRequests).mockResolvedValue({
      data: [],
    });
    vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
      data: {
        counts: {
          categories: [],
          levels: [],
          languages: [],
          tags: [],
          patterns: [],
          authors: [],
          potentialFalsePositives: [],
        },
      },
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "repository",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");
    expect(allOutput).toContain("No open pull requests");
    expect(allOutput).toContain("No issues data available");
  });

  it("should handle repository with problems", async () => {
    const dataWithProblems = {
      ...mockRepoData,
      repository: {
        ...mockRepoData.repository,
        problems: [
          {
            message: "SSH key not configured",
            actions: [],
            code: "no_ssh_key",
            severity: "warning",
          },
        ],
      },
    };

    vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
      data: dataWithProblems as any,
    });
    vi.mocked(AnalysisService.listRepositoryPullRequests).mockResolvedValue({
      data: [],
    });
    vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
      data: {
        counts: {
          categories: [],
          levels: [],
          languages: [],
          tags: [],
          patterns: [],
          authors: [],
          potentialFalsePositives: [],
        },
      },
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "repository",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");
    expect(allOutput).toContain("SSH key not configured");
  });

  it("should show ✗ when quality or coverage is not up to standards", async () => {
    const prNotUpToStandards = [
      {
        ...mockPullRequests[0],
        isUpToStandards: true, // global field is ignored
        quality: {
          isUpToStandards: false,
          resultReasons: [
            {
              gate: "issueThreshold",
              isUpToStandards: false,
              expectedThreshold: { threshold: 0 },
            },
            {
              gate: "complexityThreshold",
              isUpToStandards: true,
              expectedThreshold: { threshold: 10 },
            },
          ],
        },
        coverage: {
          ...mockPullRequests[0].coverage,
          isUpToStandards: false,
          resultReasons: [
            {
              gate: "diffCoverageThreshold",
              isUpToStandards: false,
              expectedThreshold: { threshold: 70 },
            },
          ],
        },
      },
    ];

    vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
      data: mockRepoData as any,
    });
    vi.mocked(AnalysisService.listRepositoryPullRequests).mockResolvedValue({
      data: prNotUpToStandards as any,
    });
    vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
      data: { counts: mockIssuesCounts },
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "repository",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");
    // Should show red ✗ for not up to standards
    expect(allOutput).toContain("✗");
  });

  it("should sort issues overview counts descending", async () => {
    const unsortedCounts = {
      categories: [
        { name: "Style", total: 1 },
        { name: "Security", total: 50 },
        { name: "Error Prone", total: 10 },
      ],
      levels: [],
      languages: [],
      tags: [],
      patterns: [],
      authors: [],
      potentialFalsePositives: [],
    };

    vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
      data: mockRepoData as any,
    });
    vi.mocked(AnalysisService.listRepositoryPullRequests).mockResolvedValue({
      data: [],
    });
    vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
      data: { counts: unsortedCounts },
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "repository",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");
    // Security (50) should come before Error Prone (10) which comes before Style (1)
    const secIdx = allOutput.indexOf("Security");
    const errIdx = allOutput.indexOf("Error Prone");
    const styleIdx = allOutput.indexOf("Style");
    expect(secIdx).toBeLessThan(errIdx);
    expect(errIdx).toBeLessThan(styleIdx);
  });

  it("should truncate long branch names to 20 characters", async () => {
    const prLongBranch = [
      {
        ...mockPullRequests[0],
        pullRequest: {
          ...mockPullRequests[0].pullRequest,
          originBranch: "feature/very-long-branch-name-here",
        },
      },
    ];

    vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
      data: mockRepoData as any,
    });
    vi.mocked(AnalysisService.listRepositoryPullRequests).mockResolvedValue({
      data: prLongBranch as any,
    });
    vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
      data: { counts: mockIssuesCounts },
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "repository",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");
    // Full branch name should NOT appear (it was truncated to 20)
    expect(allOutput).not.toContain("feature/very-long-branch-name-here");
    // Truncated to 17 chars + "..." = 20
    expect(allOutput).toContain("feature/very-long...");
  });

  describe("coverage status", () => {
    const waitingCoverage = {
      coveragePercentage: 19,
      numberTotalFiles: 83,
      status: "Waiting",
      lastCommitWithCoverage: "5474cbf195db8f6fb0704d2bc9a8dc4e16065dc9",
      statusUpdatedAt: "2026-09-10T10:44:04.440743Z",
      valueUpdatedAt: "2026-09-10T01:13:16.102431Z",
    };
    const stoppedCoverage = {
      status: "Stopped",
      lastCommitWithCoverage: "8752dbd2bef1fab22db1197ae5e87de371ff2ead",
      statusUpdatedAt: "2026-08-26T11:08:31.090599Z",
    };

    async function run(
      coverage: any,
      opts: { goals?: any; json?: boolean } = {},
    ): Promise<string> {
      // Called more than once in a single test, so don't inherit the previous
      // run's output.
      (console.log as ReturnType<typeof vi.fn>).mockClear();

      vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
        data: {
          ...mockRepoData,
          coverage,
          ...(opts.goals !== undefined ? { goals: opts.goals } : {}),
        } as any,
      });
      vi.mocked(AnalysisService.listRepositoryPullRequests).mockResolvedValue({
        data: [],
      });
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
        data: { counts: mockIssuesCounts },
      });

      const program = createProgram();
      await program.parseAsync([
        "node", "test",
        ...(opts.json ? ["--output", "json"] : []),
        "repository", "gh", "test-org", "test-repo",
      ]);

      return (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
    }

    /** The `--output json` payload, which spans lines and so isn't one of them. */
    function lastJson(): any {
      const call = (console.log as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].startsWith("{"),
      );
      return JSON.parse(call![0]);
    }

    /** The Metrics section's Coverage row, so a match can't come from elsewhere. */
    function coverageRow(output: string): string {
      const row = output
        .split("\n")
        .find((line) => /^\s*Coverage\s/.test(line));
      expect(row, "no Coverage row in Metrics").toBeDefined();
      return row!;
    }

    it("explains that a waiting repository's value is stale", async () => {
      const output = await run(waitingCoverage);

      const row = coverageRow(output);
      expect(row).toContain("19.0%");
      expect(row).toContain("Not reported yet for the latest commit");
      expect(row).toContain("5474cbf");
    });

    it("replaces a stopped repository's absent value with the reason", async () => {
      const output = await run(stoppedCoverage);

      const row = coverageRow(output);
      expect(row).toContain("Stopped receiving reports");
      expect(row).toContain("8752dbd");
      // No percentage exists in a Stopped payload, and "N/A" would say less.
      expect(row).not.toContain("%");
      expect(row).not.toContain("N/A");
    });

    it("names the gate consequence only when a coverage goal is set", async () => {
      const withGoal = await run(stoppedCoverage);
      expect(coverageRow(withGoal)).toContain(
        "coverage gate no longer enforced",
      );

      const withoutGoal = await run(stoppedCoverage, { goals: {} });
      expect(coverageRow(withoutGoal)).not.toContain("gate");
    });

    it("distinguishes a repository that never had coverage", async () => {
      const output = await run({ status: "None" });
      expect(coverageRow(output)).toContain("Not set up");
    });

    it("reads the Analysis row's coverage state from the status", async () => {
      // The bug this fixes: a waiting repository reports a stale percentage, so
      // the old heuristic ("a coverage number is present") read it as healthy
      // and the Analysis row said nothing at all.
      const waiting = await run(waitingCoverage);
      expect(waiting).toContain("Waiting for coverage reports...");

      const stopped = await run(stoppedCoverage);
      expect(stopped).toContain("Stopped receiving coverage reports");
      expect(stopped).not.toContain("Missing coverage reports");

      const upToDate = await run({ coveragePercentage: 78, status: "UpToDate" });
      expect(upToDate).not.toContain("coverage reports");
    });

    it("never calls listCoverageReports — the status supersedes it", async () => {
      await run(waitingCoverage);
      // The state used to be inferred from this call; it now rides along on the
      // analysis response, which is also what makes it reach repository tokens.
      expect(RepositoryService.listCoverageReports).not.toHaveBeenCalled();
    });

    it("includes the coverage status fields in JSON output", async () => {
      await run(waitingCoverage, { json: true });

      expect(lastJson().repository.coverage).toEqual({
        coveragePercentage: 19,
        status: "Waiting",
        lastCommitWithCoverage: "5474cbf195db8f6fb0704d2bc9a8dc4e16065dc9",
        statusUpdatedAt: "2026-09-10T10:44:04.440743Z",
        valueUpdatedAt: "2026-09-10T01:13:16.102431Z",
      });
    });

    it("emits only the status for a repository that never had coverage", async () => {
      await run({ status: "None" }, { json: true });

      // pickDeep drops undefined, so nothing is invented for the absent fields.
      expect(lastJson().repository.coverage).toEqual({ status: "None" });
    });
  });

  it("should fail when CODACY_API_TOKEN is not set", async () => {
    delete process.env.CODACY_API_TOKEN;

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "test",
        "repository",
        "gh",
        "test-org",
        "test-repo",
      ]),
    ).rejects.toThrow("process.exit called");

    mockExit.mockRestore();
  });

  // ─── Actions ─────────────────────────────────────────────────────────────

  it("should add repository to Codacy with --add", async () => {
    vi.mocked(RepositoryService.addRepository).mockResolvedValue({} as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "repository", "gh", "test-org", "test-repo", "--add",
    ]);

    expect(RepositoryService.addRepository).toHaveBeenCalledWith({
      repositoryFullPath: "test-org/test-repo",
      provider: "gh",
    });

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");
    expect(allOutput).toContain("test-repo");
    expect(allOutput).toContain("added");
    expect(allOutput).toContain("few minutes");
  });

  it("should remove repository from Codacy with --remove", async () => {
    vi.mocked(RepositoryService.deleteRepository).mockResolvedValue(undefined as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "repository", "gh", "test-org", "test-repo", "--remove",
    ]);

    expect(RepositoryService.deleteRepository).toHaveBeenCalledWith(
      "gh", "test-org", "test-repo",
    );

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");
    expect(allOutput).toContain("test-repo");
    expect(allOutput).toContain("removed");
  });

  it("should follow repository with --follow", async () => {
    vi.mocked(RepositoryService.followAddedRepository).mockResolvedValue({} as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "repository", "gh", "test-org", "test-repo", "--follow",
    ]);

    expect(RepositoryService.followAddedRepository).toHaveBeenCalledWith(
      "gh", "test-org", "test-repo",
    );

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");
    expect(allOutput).toContain("test-repo");
    expect(allOutput).toContain("following");
  });

  it("should unfollow repository with --unfollow", async () => {
    vi.mocked(RepositoryService.unfollowRepository).mockResolvedValue(undefined as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "repository", "gh", "test-org", "test-repo", "--unfollow",
    ]);

    expect(RepositoryService.unfollowRepository).toHaveBeenCalledWith(
      "gh", "test-org", "test-repo",
    );

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");
    expect(allOutput).toContain("test-repo");
    expect(allOutput).toContain("Unfollowed");
  });

  // ─── Reanalyze ──────────────────────────────────────────────────────────

  it("should request reanalysis with --reanalyze", async () => {
    vi.mocked(AnalysisService.listRepositoryCommits).mockResolvedValue({
      data: [{
        commit: {
          sha: "abc1234567890",
          id: 1,
          commitTimestamp: "2025-06-15T10:00:00Z",
          authorName: "Test",
          authorEmail: "test@test.com",
          message: "fix things",
          startedAnalysis: "2025-06-15T10:00:00Z",
          endedAnalysis: "2025-06-15T10:05:00Z",
        },
      }],
    } as any);
    vi.mocked(RepositoryService.reanalyzeCommitById).mockResolvedValue(undefined as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "repository", "gh", "test-org", "test-repo", "--reanalyze",
    ]);

    expect(RepositoryService.reanalyzeCommitById).toHaveBeenCalledWith(
      "gh", "test-org", "test-repo", { commitUuid: "abc1234567890" },
    );
  });

  it("should show error when reanalysis fails with no commits", async () => {
    vi.mocked(AnalysisService.listRepositoryCommits).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "repository", "gh", "test-org", "test-repo", "--reanalyze",
    ]);

    // Should not call reanalyze
    expect(RepositoryService.reanalyzeCommitById).not.toHaveBeenCalled();
  });

  // ─── Analysis status ────────────────────────────────────────────────────

  it("should show analysis status in About section", async () => {
    vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
      data: mockRepoData as any,
    });
    vi.mocked(AnalysisService.listRepositoryPullRequests).mockResolvedValue({
      data: [] as any,
    });
    vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
      data: { counts: { categories: [], levels: [], languages: [], tags: [], patterns: [], authors: [], potentialFalsePositives: [] } },
    });
    // Head commit with finished analysis
    vi.mocked(AnalysisService.listRepositoryCommits).mockResolvedValue({
      data: [{
        commit: {
          sha: "head123456789",
          id: 1,
          commitTimestamp: "2025-06-15T10:00:00Z",
          authorName: "Test",
          authorEmail: "test@test.com",
          message: "fix things",
          startedAnalysis: "2025-06-15T10:00:00Z",
          endedAnalysis: "2025-06-15T10:05:00Z",
        },
      }],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "repository", "gh", "test-org", "test-repo",
    ]);

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");
    expect(allOutput).toContain("Finished");
    expect(allOutput).toContain("head123");
  });

  // ─── Standards display ──────────────────────────────────────────────

  it("should display coding standard IDs alongside names", async () => {
    const dataWithMultipleStandards = {
      ...mockRepoData,
      repository: {
        ...mockRepoData.repository,
        standards: [
          { id: 100, name: "Security" },
          { id: 200, name: "OWASP10" },
        ],
      },
    };

    vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
      data: dataWithMultipleStandards as any,
    });
    vi.mocked(AnalysisService.listRepositoryPullRequests).mockResolvedValue({
      data: [] as any,
    });
    vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
      data: { counts: { categories: [], levels: [], languages: [], tags: [], patterns: [], authors: [], potentialFalsePositives: [] } },
    });

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "repository", "gh", "test-org", "test-repo",
    ]);

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");
    expect(allOutput).toContain("Security (#100)");
    expect(allOutput).toContain("OWASP10 (#200)");
  });

  // ─── Link / Unlink standard ────────────────────────────────────────

  it("should link a coding standard with --link-standard", async () => {
    vi.mocked(CodingStandardsService.applyCodingStandardToRepositories).mockResolvedValue({} as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "repository", "gh", "test-org", "test-repo", "--link-standard", "12345",
    ]);

    expect(CodingStandardsService.applyCodingStandardToRepositories).toHaveBeenCalledWith(
      "gh", "test-org", 12345, { link: ["test-repo"], unlink: [] },
    );

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");
    expect(allOutput).toContain("#12345");
    expect(allOutput).toContain("linked");
    expect(allOutput).toContain("test-repo");
  });

  it("should unlink a coding standard with --unlink-standard", async () => {
    vi.mocked(CodingStandardsService.applyCodingStandardToRepositories).mockResolvedValue({} as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "repository", "gh", "test-org", "test-repo", "--unlink-standard", "67890",
    ]);

    expect(CodingStandardsService.applyCodingStandardToRepositories).toHaveBeenCalledWith(
      "gh", "test-org", 67890, { link: [], unlink: ["test-repo"] },
    );

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");
    expect(allOutput).toContain("#67890");
    expect(allOutput).toContain("unlinked");
    expect(allOutput).toContain("test-repo");
  });

  it("should filter JSON output with pickDeep", async () => {
    vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
      data: mockRepoData as any,
    });
    vi.mocked(AnalysisService.listRepositoryPullRequests).mockResolvedValue({
      data: [] as any,
    });
    vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
      data: { counts: { categories: [], levels: [], languages: [], tags: [], patterns: [], authors: [], potentialFalsePositives: [] } },
    });

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "--output", "json", "repository", "gh", "test-org", "test-repo",
    ]);

    const jsonCall = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const parsed = JSON.parse(jsonCall);
    // Should include filtered fields
    expect(parsed.repository.repository.name).toBe("test-repo");
    expect(parsed.repository.issuesCount).toBe(25);
    // Should NOT include non-picked fields
    expect(parsed.repository.gradeLetter).toBeUndefined();
    expect(parsed.repository.grade).toBeUndefined();
    expect(parsed.repository.repository.repositoryId).toBeUndefined();
  });

  describe("auto-detect from git remote", () => {
    it("should auto-detect provider/org/repo when no positional args are provided", async () => {
      vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
        data: mockRepoData as any,
      });
      vi.mocked(AnalysisService.listRepositoryPullRequests).mockResolvedValue({
        data: [] as any,
      });
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
        data: { counts: { categories: [], levels: [], languages: [], tags: [], patterns: [], authors: [], potentialFalsePositives: [] } },
      });

      const program = createProgram();
      await program.parseAsync(["node", "test", "repository"]);

      expect(AnalysisService.getRepositoryWithAnalysis).toHaveBeenCalledWith(
        "gh",
        "auto-org",
        "auto-repo",
      );
    });
  });

  // ─── Reanalyze and wait ───────────────────────────────────────────────────

  describe("--reanalyze-and-wait", () => {
    beforeEach(() => {
      vi.spyOn(timers, "sleep").mockResolvedValue(undefined);
    });

    function overview(errorTotal: number, secretTotal: number) {
      return {
        data: {
          counts: {
            categories: [{ name: "Security", total: secretTotal }],
            levels: [
              { name: "Error", total: errorTotal },
              { name: "Warning", total: 11 },
            ],
            languages: [],
            tags: [],
            patterns: [
              { id: "p.secret", title: "Hardcoded Secret", total: secretTotal },
            ],
            authors: [],
            potentialFalsePositives: [],
          },
        },
      };
    }

    // Old timestamps are before t0 (Date.now); "new" ones are far in the future
    // so they're reliably more recent than the real trigger time.
    const OLD_S = "2000-01-01T00:00:00Z";
    const OLD_E = "2000-01-01T00:05:00Z";
    const NEW_S = "2999-01-01T00:01:00Z";
    const NEW_E = "2999-01-01T00:02:00Z"; // 60s after NEW_S → "1m 0s"

    function commits(startedAnalysis?: string, endedAnalysis?: string) {
      return {
        data: [
          { commit: { sha: "abc1234567890", startedAnalysis, endedAnalysis } },
        ],
      } as any;
    }

    it("triggers reanalysis, waits, and prints deltas", async () => {
      vi.mocked(AnalysisService.listRepositoryCommits)
        .mockResolvedValueOnce(commits(OLD_S, OLD_E)) // head sha
        .mockResolvedValueOnce(commits(OLD_S, OLD_E)) // poll: waiting (before t0)
        .mockResolvedValueOnce(commits(NEW_S, OLD_E)) // poll: in progress
        .mockResolvedValueOnce(commits(NEW_S, NEW_E)); // poll: done
      vi.mocked(AnalysisService.issuesOverview)
        .mockResolvedValueOnce(overview(4, 8) as any) // baseline: 15 issues
        .mockResolvedValueOnce(overview(6, 13) as any); // after: 17 issues
      vi.mocked(RepositoryService.reanalyzeCommitById).mockResolvedValue(
        undefined as any,
      );

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "repository", "gh", "test-org", "test-repo", "--reanalyze-and-wait",
      ]);

      expect(RepositoryService.reanalyzeCommitById).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo", { commitUuid: "abc1234567890" },
      );
      const out = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(out).toContain("Analysis finished in 1m 0s");
      expect(out).toContain("Hardcoded Secret");
      expect(out).toContain("In total: 15 → 17 issues");
    });

    it("fails when there are no commits to reanalyze", async () => {
      vi.mocked(AnalysisService.listRepositoryCommits).mockResolvedValue({
        data: [],
      } as any);
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue(
        overview(4, 8) as any,
      );

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "repository", "gh", "test-org", "test-repo", "--reanalyze-and-wait",
      ]);

      expect(RepositoryService.reanalyzeCommitById).not.toHaveBeenCalled();
    });

    it("emits structured JSON with --output json", async () => {
      vi.mocked(AnalysisService.listRepositoryCommits)
        .mockResolvedValueOnce(commits(OLD_S, OLD_E)) // head sha
        .mockResolvedValueOnce(commits(NEW_S, NEW_E)); // poll: already done
      vi.mocked(AnalysisService.issuesOverview)
        .mockResolvedValueOnce(overview(4, 8) as any)
        .mockResolvedValueOnce(overview(6, 13) as any);
      vi.mocked(RepositoryService.reanalyzeCommitById).mockResolvedValue(
        undefined as any,
      );

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "repository", "gh", "test-org", "test-repo",
        "--reanalyze-and-wait", "--output", "json",
      ]);

      const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
      const parsed = JSON.parse(calls[calls.length - 1][0]);
      expect(parsed.durationHuman).toBe("1m 0s");
      expect(parsed.totals).toEqual({ before: 15, after: 17, net: 2 });
    });
  });

  describe("with a repository token", () => {
    /**
     * Mocks the two dashboard calls whose data these tests assert on. The third
     * whitelisted call, `listRepositoryCommits`, is already mocked file-wide by
     * `setupDefaultMocks()`.
     */
    function mockWhitelistedDashboardCalls() {
      vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
        data: mockRepoData as any,
      });
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
        data: { counts: mockIssuesCounts },
      });
    }

    function getAllOutput(): string {
      return (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
    }

    it("skips the pull request call entirely", async () => {
      mockWhitelistedDashboardCalls();

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "repository", "gh", "test-org", "test-repo",
        "--repository-token", "rt",
      ]);

      // Outside a repository token's scope: don't even try.
      expect(AnalysisService.listRepositoryPullRequests).not.toHaveBeenCalled();
      // The whitelisted calls still run, so the dashboard is still worth showing.
      expect(AnalysisService.getRepositoryWithAnalysis).toHaveBeenCalled();
      expect(AnalysisService.issuesOverview).toHaveBeenCalled();
    });

    it("keeps the pull request section header and explains the omission", async () => {
      mockWhitelistedDashboardCalls();

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "repository", "gh", "test-org", "test-repo",
        "--repository-token", "rt",
      ]);

      const output = getAllOutput();
      expect(output).toContain("Open Pull Requests");
      expect(output).toContain("Not shown with a repository token");
      // "No open pull requests" would be a different, and false, claim.
      expect(output).not.toContain("No open pull requests");
      // The note is derived from the token kind, so without this the test would
      // still pass if the skip were removed and the doomed call issued anyway.
      expect(AnalysisService.listRepositoryPullRequests).not.toHaveBeenCalled();
    });

    it("emits pullRequests as an empty array plus an unavailable marker in JSON", async () => {
      mockWhitelistedDashboardCalls();

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "repository", "gh", "test-org", "test-repo",
        "--repository-token", "rt", "--output", "json",
      ]);

      const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
      const parsed = JSON.parse(calls[calls.length - 1][0]);
      // Present and iterable, so `jq '.pullRequests[]'` and `| length` still work.
      expect(parsed.pullRequests).toEqual([]);
      // Pull requests are the only section a repository token can't reach —
      // coverage state now rides along on the whitelisted analysis call.
      expect(parsed.unavailable).toEqual(["pullRequests"]);
      // The fields the auto-configuration skill reads are unaffected.
      expect(parsed.repository.fileCount).toBe(83);
      expect(parsed.repository.repository.standards).toBeDefined();
      // Same reason as above: `unavailable` follows the token kind, so assert
      // the call really was skipped rather than merely reported as skipped.
      expect(AnalysisService.listRepositoryPullRequests).not.toHaveBeenCalled();
    });

    it("still supports --reanalyze", async () => {
      vi.mocked(RepositoryService.reanalyzeCommitById).mockResolvedValue(
        undefined as any,
      );

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "repository", "gh", "test-org", "test-repo",
        "--reanalyze", "--repository-token", "rt",
      ]);

      expect(RepositoryService.reanalyzeCommitById).toHaveBeenCalled();
    });

    it.each([
      ["--add", () => RepositoryService.addRepository],
      ["--remove", () => RepositoryService.deleteRepository],
      ["--follow", () => RepositoryService.followAddedRepository],
      ["--unfollow", () => RepositoryService.unfollowRepository],
    ])("refuses %s without calling the API", async (flag, service) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "repository", "gh", "test-org", "test-repo",
          flag, "--repository-token", "rt",
        ]),
      ).rejects.toThrow("process.exit called");

      expect(service()).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalled();
    });

    it.each(["--link-standard", "--unlink-standard"])(
      "refuses %s without calling the coding standards API",
      async (flag) => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(process, "exit").mockImplementation(() => {
          throw new Error("process.exit called");
        });

        const program = createProgram();
        await expect(
          program.parseAsync([
            "node", "test", "repository", "gh", "test-org", "test-repo",
            flag, "12345", "--repository-token", "rt",
          ]),
        ).rejects.toThrow("process.exit called");

        expect(
          CodingStandardsService.applyCodingStandardToRepositories,
        ).not.toHaveBeenCalled();
      },
    );
  });

  describe("with an account token", () => {
    it("renders the dashboard even when the pull request call fails", async () => {
      vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
        data: mockRepoData as any,
      });
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
        data: { counts: mockIssuesCounts },
      });
      vi.mocked(AnalysisService.listRepositoryPullRequests).mockRejectedValue(
        Object.assign(new Error("Forbidden"), { status: 403 }),
      );

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "repository", "gh", "test-org", "test-repo",
      ]);

      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      // The rest of the dashboard survives; the PR section says so plainly, and
      // does not blame a repository token that isn't in use.
      expect(output).toContain("test-repo");
      expect(output).toContain("Could not load pull requests.");
      expect(output).not.toContain("Not shown with a repository token");
    });

    it("marks pull requests unavailable in JSON when the call fails", async () => {
      vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
        data: mockRepoData as any,
      });
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
        data: { counts: mockIssuesCounts },
      });
      vi.mocked(AnalysisService.listRepositoryPullRequests).mockRejectedValue(
        Object.assign(new Error("Forbidden"), { status: 403 }),
      );

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "repository", "gh", "test-org", "test-repo",
        "--output", "json",
      ]);

      const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
      const parsed = JSON.parse(calls[calls.length - 1][0]);
      // The marker tracks "couldn't look", whatever the cause — a failed call
      // under an account token, not just a skipped one under a repo token.
      expect(parsed.unavailable).toEqual(["pullRequests"]);
      expect(parsed.pullRequests).toEqual([]);
    });

    it("omits the unavailable marker from JSON", async () => {
      vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
        data: mockRepoData as any,
      });
      vi.mocked(AnalysisService.listRepositoryPullRequests).mockResolvedValue({
        data: mockPullRequests as any,
      });
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
        data: { counts: mockIssuesCounts },
      });

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "repository", "gh", "test-org", "test-repo",
        "--output", "json",
      ]);

      const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
      const parsed = JSON.parse(calls[calls.length - 1][0]);
      expect(parsed).not.toHaveProperty("unavailable");
      expect(Array.isArray(parsed.pullRequests)).toBe(true);
    });
  });
});
