import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerRepositoryCommand } from "./repository";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { RepositoryService } from "../api/client/services/RepositoryService";

vi.mock("../api/client/services/AnalysisService");
vi.mock("../api/client/services/RepositoryService");
vi.mock("../utils/credentials", () => ({ loadCredentials: vi.fn(() => null) }));
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
  vi.mocked(RepositoryService.listCoverageReports).mockResolvedValue({
    data: { hasCoverageOverview: false },
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
  coverage: { coveragePercentage: 78 },
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
      data: { counts: { categories: [], levels: [], languages: [], tags: [], patterns: [], authors: [] } },
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

  it("should filter JSON output with pickDeep", async () => {
    vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
      data: mockRepoData as any,
    });
    vi.mocked(AnalysisService.listRepositoryPullRequests).mockResolvedValue({
      data: [] as any,
    });
    vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
      data: { counts: { categories: [], levels: [], languages: [], tags: [], patterns: [], authors: [] } },
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
});
