import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerPullRequestCommand } from "./pull-request";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { CoverageService } from "../api/client/services/CoverageService";
import { ToolsService } from "../api/client/services/ToolsService";
import { FileService } from "../api/client/services/FileService";
import { RepositoryService } from "../api/client/services/RepositoryService";

vi.mock("../api/client/services/AnalysisService");
vi.mock("../api/client/services/CoverageService");
vi.mock("../api/client/services/RepositoryService");
vi.mock("../api/client/services/ToolsService");
vi.mock("../api/client/services/FileService");
vi.mock("../utils/credentials", () => ({ loadCredentials: vi.fn(() => null) }));
vi.spyOn(console, "log").mockImplementation(() => {});

function createProgram(): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  registerPullRequestCommand(program);
  return program;
}

const mockPrData = {
  isUpToStandards: true,
  isAnalysing: false,
  pullRequest: {
    id: 1,
    number: 42,
    updated: "2025-06-14T10:00:00Z",
    status: "Open",
    repository: "test-repo",
    title: "Add new feature",
    owner: { id: 1, name: "dev-user" },
    headCommitSha: "abc1234567890",
    commonAncestorCommitSha: "def456",
    originBranch: "feature/new",
    targetBranch: "main",
    gitHref: "https://github.com/test-org/test-repo/pull/42",
  },
  newIssues: 3,
  fixedIssues: 1,
  deltaComplexity: 2,
  deltaClonesCount: -1,
  coverage: {
    deltaCoverage: -1.5,
    diffCoverage: { value: 85.0, cause: "ValueIsPresent" },
    isUpToStandards: true,
    resultReasons: [
      {
        gate: "diffCoverageThreshold",
        isUpToStandards: true,
        expectedThreshold: { threshold: 70 },
      },
    ],
  },
  quality: {
    isUpToStandards: true,
    resultReasons: [
      {
        gate: "issueThreshold",
        isUpToStandards: true,
        expectedThreshold: { threshold: 5, minimumSeverity: "Warning" },
      },
      {
        gate: "complexityThreshold",
        isUpToStandards: true,
        expectedThreshold: { threshold: 10 },
      },
    ],
  },
  meta: {},
};

const mockNewIssues = {
  analyzed: true,
  data: [
    {
      commitIssue: {
        issueId: "issue-1",
        resultDataId: 1,
        filePath: "src/index.ts",
        fileId: 1,
        patternInfo: {
          id: "no-undef",
          title: "no undef vars",
          category: "Error Prone",
          severityLevel: "Error",
          level: "Error",
        },
        toolInfo: { uuid: "tool-1", name: "ESLint" },
        lineNumber: 10,
        message: "Variable 'x' is not defined",
        language: "TypeScript",
        lineText: "  console.log(x);",
        falsePositiveThreshold: 0.5,
      },
      deltaType: "Added",
    },
    {
      commitIssue: {
        issueId: "issue-2",
        resultDataId: 2,
        filePath: "src/utils.ts",
        fileId: 2,
        patternInfo: {
          id: "no-unused",
          title: "no unused variables",
          category: "Code Style",
          severityLevel: "Warning",
          level: "Warning",
        },
        toolInfo: { uuid: "tool-1", name: "ESLint" },
        lineNumber: 5,
        message: "'helper' is assigned but never used",
        language: "TypeScript",
        lineText: "  const helper = 42;",
        falsePositiveThreshold: 0.5,
      },
      deltaType: "Added",
    },
    {
      commitIssue: {
        issueId: "issue-3",
        resultDataId: 3,
        filePath: "src/auth.ts",
        fileId: 3,
        patternInfo: {
          id: "sql-injection",
          title: "SQL Injection",
          category: "Security",
          subCategory: "Injection",
          severityLevel: "Error",
          level: "Error",
        },
        toolInfo: { uuid: "tool-2", name: "Semgrep" },
        lineNumber: 20,
        message: "Potential SQL injection vulnerability",
        language: "TypeScript",
        lineText: "  db.query(`SELECT * FROM users WHERE id = ${id}`);",
        falsePositiveThreshold: 0.3,
      },
      deltaType: "Added",
    },
  ],
};

const mockPotentialIssues = {
  analyzed: true,
  data: [
    {
      commitIssue: {
        issueId: "issue-p1",
        resultDataId: 10,
        filePath: "src/config.ts",
        fileId: 10,
        patternInfo: {
          id: "prefer-const",
          title: "prefer const",
          category: "Code Style",
          severityLevel: "Info",
          level: "Info",
        },
        toolInfo: { uuid: "tool-1", name: "ESLint" },
        lineNumber: 3,
        message: "'config' is never reassigned. Use 'const' instead.",
        language: "TypeScript",
        lineText: "  let config = {};",
        falsePositiveThreshold: 0.8,
      },
      deltaType: "Added",
    },
  ],
};

const mockFiles = {
  data: [
    {
      file: {
        commitId: 1,
        commitSha: "abc123",
        fileId: 1,
        fileDataId: 1,
        path: "src/index.ts",
        language: "TypeScript",
        gitProviderUrl:
          "https://github.com/test-org/test-repo/blob/abc123/src/index.ts",
        ignored: false,
      },
      quality: {
        deltaNewIssues: 2,
        deltaFixedIssues: 0,
        deltaComplexity: 3,
        deltaClonesCount: 0,
      },
      coverage: {
        deltaCoverage: -2.5,
        totalCoverage: 75.0,
      },
    },
    {
      file: {
        commitId: 1,
        commitSha: "abc123",
        fileId: 2,
        fileDataId: 2,
        path: "src/utils.ts",
        language: "TypeScript",
        gitProviderUrl:
          "https://github.com/test-org/test-repo/blob/abc123/src/utils.ts",
        ignored: false,
      },
      quality: {
        deltaNewIssues: 0,
        deltaFixedIssues: 0,
        deltaComplexity: 0,
        deltaClonesCount: 0,
      },
      coverage: {
        deltaCoverage: 0,
        totalCoverage: 90.0,
      },
    },
  ],
};

const mockPattern = {
  id: "sql-injection",
  title: "SQL Injection",
  category: "Security",
  subCategory: "Injection",
  severityLevel: "Error",
  level: "Error",
  enabled: true,
  parameters: [],
  description: "Detects SQL injection vulnerabilities.",
  rationale: "Attackers can manipulate queries to access unauthorized data.",
  solution: "Use parameterized queries or prepared statements.",
  tags: ["security", "owasp-a1"],
};

const mockFileLines = [
  { number: 15, content: "function getUser(id: string) {" },
  { number: 16, content: "  const conn = db.connect();" },
  { number: 17, content: "  // TODO: fix this" },
  { number: 18, content: "  try {" },
  { number: 19, content: "    const result = await" },
  {
    number: 20,
    content: "  db.query(`SELECT * FROM users WHERE id = ${id}`);",
  },
  { number: 21, content: "  } catch (e) {" },
  { number: 22, content: "    throw e;" },
  { number: 23, content: "  }" },
  { number: 24, content: "  return result;" },
  { number: 25, content: "}" },
];

function getAllOutput(): string {
  return (console.log as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0])
    .join("\n");
}

describe("pull-request command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
    // Default CoverageService mocks so existing tests don't break
    vi.mocked(
      CoverageService.getRepositoryPullRequestFilesCoverage,
    ).mockResolvedValue({ data: [] } as any);
    vi.mocked(RepositoryService.getPullRequestDiff).mockResolvedValue({
      diff: "",
    } as any);
    // Default mocks for analysis status
    vi.mocked(AnalysisService.getPullRequestCommits).mockResolvedValue({
      data: [{
        commit: {
          sha: "abc1234567890",
          id: 1,
          commitTimestamp: "2025-06-14T10:00:00Z",
          authorName: "Test",
          authorEmail: "test@test.com",
          message: "fix things",
          startedAnalysis: "2025-06-14T09:55:00Z",
          endedAnalysis: "2025-06-14T10:00:00Z",
        },
      }],
    } as any);
    vi.mocked(RepositoryService.listCoverageReports).mockResolvedValue({
      data: { hasCoverageOverview: false },
    } as any);
  });

  it("should fetch and display PR details in table format", async () => {
    vi.mocked(AnalysisService.getRepositoryPullRequest).mockResolvedValue(
      mockPrData as any,
    );
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce(mockNewIssues as any)
      .mockResolvedValueOnce(mockPotentialIssues as any);
    vi.mocked(AnalysisService.listPullRequestFiles).mockResolvedValue(
      mockFiles as any,
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    expect(AnalysisService.getRepositoryPullRequest).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      42,
    );
    expect(AnalysisService.listPullRequestIssues).toHaveBeenCalledTimes(2);
    expect(AnalysisService.listPullRequestFiles).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      42,
    );

    const output = getAllOutput();

    // About section
    expect(output).toContain("GitHub / test-org / test-repo");
    expect(output).toContain("#42");
    expect(output).toContain("Add new feature");
    expect(output).toContain("dev-user");
    expect(output).toContain("feature/new");
    expect(output).toContain("main");
    expect(output).toContain("abc1234");

    // Analysis section
    expect(output).toContain("Analysis");
    expect(output).toContain("✓");

    // Issues section (merged — no separate "New Issues" / "New Potential Issues")
    expect(output).toContain("Issues");
    expect(output).toContain("Variable 'x' is not defined");
    expect(output).toContain("src/index.ts:10");

    // Potential issues merged in, tagged with POTENTIAL
    expect(output).toContain("never reassigned");
    expect(output).toContain("POTENTIAL");

    // Files section
    expect(output).toContain("Files");
    expect(output).toContain("src/index.ts");
  });

  it("should output JSON when --output json is specified", async () => {
    vi.mocked(AnalysisService.getRepositoryPullRequest).mockResolvedValue(
      mockPrData as any,
    );
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce(mockNewIssues as any)
      .mockResolvedValueOnce(mockPotentialIssues as any);
    vi.mocked(AnalysisService.listPullRequestFiles).mockResolvedValue(
      mockFiles as any,
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "--output",
      "json",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"Add new feature"'),
    );
  });

  it("should show 'No issues' when there are no new issues", async () => {
    vi.mocked(AnalysisService.getRepositoryPullRequest).mockResolvedValue(
      mockPrData as any,
    );
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any);
    vi.mocked(AnalysisService.listPullRequestFiles).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    const output = getAllOutput();
    expect(output).toContain("No issues");
  });

  it("should show red ✗ and gate failure reasons when not up to standards", async () => {
    const prNotUpToStandards = {
      ...mockPrData,
      quality: {
        isUpToStandards: false,
        resultReasons: [
          {
            gate: "issueThreshold",
            isUpToStandards: false,
            expectedThreshold: { threshold: 2, minimumSeverity: "Warning" },
          },
        ],
      },
      coverage: {
        ...mockPrData.coverage,
        isUpToStandards: false,
        resultReasons: [
          {
            gate: "diffCoverageThreshold",
            isUpToStandards: false,
            expectedThreshold: { threshold: 80 },
          },
        ],
      },
    };

    vi.mocked(AnalysisService.getRepositoryPullRequest).mockResolvedValue(
      prNotUpToStandards as any,
    );
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any);
    vi.mocked(AnalysisService.listPullRequestFiles).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    const output = getAllOutput();
    expect(output).toContain("✗");
    expect(output).toContain("Fails");
    expect(output).toContain("2 warning issues");
    expect(output).toContain("80% coverage");
  });

  it("should show 'To check' hint when gate has no data yet", async () => {
    const prNoData = {
      ...mockPrData,
      newIssues: undefined,
      fixedIssues: undefined,
      deltaComplexity: undefined,
      deltaClonesCount: undefined,
      coverage: {
        isUpToStandards: undefined,
        resultReasons: [
          {
            gate: "diffCoverageThreshold",
            isUpToStandards: true,
            expectedThreshold: { threshold: 50 },
          },
        ],
      },
      quality: {
        isUpToStandards: undefined,
        resultReasons: [
          {
            gate: "issueThreshold",
            isUpToStandards: true,
            expectedThreshold: { threshold: 5 },
          },
        ],
      },
    };

    vi.mocked(AnalysisService.getRepositoryPullRequest).mockResolvedValue(
      prNoData as any,
    );
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any);
    vi.mocked(AnalysisService.listPullRequestFiles).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    const output = getAllOutput();
    expect(output).toContain("To check");
    expect(output).toContain("50% coverage");
    expect(output).toContain("5");
  });

  it("should sort issues by severity (Error before Warning before Info)", async () => {
    // Issues are in reverse order: Info, Warning, Error
    const unsortedIssues = {
      analyzed: true,
      data: [
        {
          commitIssue: {
            issueId: "i1",
            resultDataId: 1,
            filePath: "a.ts",
            fileId: 1,
            patternInfo: {
              id: "p1",
              title: "info rule",
              category: "Style",
              severityLevel: "Info",
              level: "Info",
            },
            toolInfo: { uuid: "t1", name: "Tool" },
            lineNumber: 1,
            message: "Info issue",
            language: "TypeScript",
            lineText: "let x = 1;",
            falsePositiveThreshold: 0.5,
          },
          deltaType: "Added",
        },
        {
          commitIssue: {
            issueId: "i2",
            resultDataId: 2,
            filePath: "b.ts",
            fileId: 2,
            patternInfo: {
              id: "p2",
              title: "warn rule",
              category: "Style",
              severityLevel: "Warning",
              level: "Warning",
            },
            toolInfo: { uuid: "t1", name: "Tool" },
            lineNumber: 2,
            message: "Warning issue",
            language: "TypeScript",
            lineText: "let y = 2;",
            falsePositiveThreshold: 0.5,
          },
          deltaType: "Added",
        },
        {
          commitIssue: {
            issueId: "i3",
            resultDataId: 3,
            filePath: "c.ts",
            fileId: 3,
            patternInfo: {
              id: "p3",
              title: "error rule",
              category: "Error Prone",
              severityLevel: "Error",
              level: "Error",
            },
            toolInfo: { uuid: "t1", name: "Tool" },
            lineNumber: 3,
            message: "Error issue",
            language: "TypeScript",
            lineText: "let z = 3;",
            falsePositiveThreshold: 0.5,
          },
          deltaType: "Added",
        },
      ],
    };

    vi.mocked(AnalysisService.getRepositoryPullRequest).mockResolvedValue(
      mockPrData as any,
    );
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce(unsortedIssues as any)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any);
    vi.mocked(AnalysisService.listPullRequestFiles).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    const output = getAllOutput();
    const errorIdx = output.indexOf("Error issue");
    const warningIdx = output.indexOf("Warning issue");
    const infoIdx = output.indexOf("Info issue");
    expect(errorIdx).toBeLessThan(warningIdx);
    expect(warningIdx).toBeLessThan(infoIdx);
  });

  it("should filter files list to only show files with metric changes", async () => {
    vi.mocked(AnalysisService.getRepositoryPullRequest).mockResolvedValue(
      mockPrData as any,
    );
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any);
    vi.mocked(AnalysisService.listPullRequestFiles).mockResolvedValue(
      mockFiles as any,
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    const output = getAllOutput();
    // src/index.ts has changes (deltaNewIssues: 2, deltaComplexity: 3, deltaCoverage: -2.5)
    expect(output).toContain("src/index.ts");
    // src/utils.ts has NO changes (all zeros) — should be filtered out
    expect(output).not.toContain("src/utils.ts");
  });

  it("should show security subcategory for security issues", async () => {
    vi.mocked(AnalysisService.getRepositoryPullRequest).mockResolvedValue(
      mockPrData as any,
    );
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce(mockNewIssues as any)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any);
    vi.mocked(AnalysisService.listPullRequestFiles).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    const output = getAllOutput();
    // The security issue has subCategory "Injection" (tool name no longer shown)
    expect(output).toContain("Security");
    expect(output).toContain("Injection");
    expect(output).toContain("Potential SQL injection vulnerability");
  });

  it("should show false positive warning when probability exceeds threshold", async () => {
    const issuesWithFalsePositive = {
      analyzed: true,
      data: [
        {
          commitIssue: {
            issueId: "fp1",
            resultDataId: 100,
            filePath: "src/fp.ts",
            fileId: 100,
            patternInfo: {
              id: "rule1",
              title: "some rule",
              category: "Error Prone",
              severityLevel: "Warning",
              level: "Warning",
            },
            toolInfo: { uuid: "t1", name: "Tool" },
            lineNumber: 5,
            message: "Possible issue here",
            language: "TypeScript",
            lineText: "  doSomething();",
            falsePositiveProbability: 0.9,
            falsePositiveThreshold: 0.5,
            falsePositiveReason: "Common pattern that is usually intentional",
          },
          deltaType: "Added",
        },
      ],
    };

    vi.mocked(AnalysisService.getRepositoryPullRequest).mockResolvedValue(
      mockPrData as any,
    );
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce(issuesWithFalsePositive as any)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any);
    vi.mocked(AnalysisService.listPullRequestFiles).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Potential false positive");
    expect(output).toContain("Common pattern that is usually intentional");
  });

  it("should format security gate failures correctly", async () => {
    const prWithSecurityGate = {
      ...mockPrData,
      quality: {
        isUpToStandards: false,
        resultReasons: [
          {
            gate: "securityIssueThreshold",
            isUpToStandards: false,
            expectedThreshold: { threshold: 0 },
          },
        ],
      },
    };

    vi.mocked(AnalysisService.getRepositoryPullRequest).mockResolvedValue(
      prWithSecurityGate as any,
    );
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any);
    vi.mocked(AnalysisService.listPullRequestFiles).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Fails");
    expect(output).toContain("security issues");
    // Should NOT contain raw gate name
    expect(output).not.toContain("securityIssueThreshold threshold");
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
        "pull-request",
        "gh",
        "test-org",
        "test-repo",
        "42",
      ]),
    ).rejects.toThrow("process.exit called");

    mockExit.mockRestore();
  });

  it("should show issue detail when --issue <id> is specified", async () => {
    // fetchAllPrIssues makes two paginated calls (non-potential + potential)
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce({
        data: mockNewIssues.data,
        pagination: undefined,
      } as any)
      .mockResolvedValueOnce({
        data: mockPotentialIssues.data,
        pagination: undefined,
      } as any);
    vi.mocked(ToolsService.getPattern).mockResolvedValue({
      data: mockPattern,
    } as any);
    vi.mocked(FileService.getFileContent).mockResolvedValue({
      data: mockFileLines,
    } as any);

    const program = createProgram();
    // Issue with resultDataId=3 is the SQL injection issue in mockNewIssues
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
      "--issue",
      "3",
    ]);

    expect(AnalysisService.listPullRequestIssues).toHaveBeenCalledTimes(2);
    expect(ToolsService.getPattern).toHaveBeenCalledWith(
      "tool-2",
      "sql-injection",
    );
    expect(FileService.getFileContent).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "src%2Fauth.ts",
      15,
      25,
      undefined, // issue.commitInfo?.sha — undefined when commitInfo not present
    );

    const output = getAllOutput();
    expect(output).toContain("Potential SQL injection vulnerability");
    expect(output).toContain("src/auth.ts:20");
    expect(output).toContain("Detects SQL injection vulnerabilities.");
    expect(output).toContain("Why is this a problem?");
    expect(output).toContain("Attackers can manipulate queries");
    expect(output).toContain("How to fix it?");
    expect(output).toContain(
      "Use parameterized queries or prepared statements.",
    );
    expect(output).toContain("security");
    expect(output).toContain("Detected by: Semgrep");
    expect(output).toContain("SQL Injection (sql-injection)");
  });

  it("should fail with error when --issue <id> is not found in the PR", async () => {
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce({
        data: mockNewIssues.data,
        pagination: undefined,
      } as any)
      .mockResolvedValueOnce({
        data: mockPotentialIssues.data,
        pagination: undefined,
      } as any);

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    const program = createProgram();
    // ID 999 does not exist in the mock issues
    await expect(
      program.parseAsync([
        "node",
        "test",
        "pull-request",
        "gh",
        "test-org",
        "test-repo",
        "42",
        "--issue",
        "999",
      ]),
    ).rejects.toThrow("process.exit called");

    mockExit.mockRestore();
  });

  it("should output JSON for --issue when --output json is specified", async () => {
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce({
        data: mockNewIssues.data,
        pagination: undefined,
      } as any)
      .mockResolvedValueOnce({
        data: mockPotentialIssues.data,
        pagination: undefined,
      } as any);
    vi.mocked(ToolsService.getPattern).mockResolvedValue({
      data: mockPattern,
    } as any);
    vi.mocked(FileService.getFileContent).mockResolvedValue({
      data: mockFileLines,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "--output",
      "json",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
      "--issue",
      "3",
    ]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"Potential SQL injection vulnerability"'),
    );
  });

  // ─── Diff Coverage Summary ─────────────────────────────────────────────

  it("should show Diff Coverage Summary when coverage data is available", async () => {
    vi.mocked(AnalysisService.getRepositoryPullRequest).mockResolvedValue(
      mockPrData as any,
    );
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any);
    vi.mocked(AnalysisService.listPullRequestFiles).mockResolvedValue({
      data: [],
    } as any);
    vi.mocked(
      CoverageService.getRepositoryPullRequestFilesCoverage,
    ).mockResolvedValue({
      data: [
        {
          fileName: "src/api.ts",
          coverage: 40,
          diffLineHits: [
            { lineNumber: "10", hits: 2 }, // covered
            { lineNumber: "11", hits: 0 }, // uncovered
            { lineNumber: "12", hits: 1 }, // covered
            { lineNumber: "15", hits: 0 }, // uncovered
            { lineNumber: "16", hits: 0 }, // uncovered
          ],
        },
      ],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Diff Coverage Summary");
    expect(output).toContain("src/api.ts");
    expect(output).toContain("40.0%"); // 2 covered out of 5 total
    expect(output).toContain("11,15-16"); // compressed uncovered line ranges
  });

  it("should not show Diff Coverage Summary when there is no coverage data", async () => {
    vi.mocked(AnalysisService.getRepositoryPullRequest).mockResolvedValue(
      mockPrData as any,
    );
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any)
      .mockResolvedValueOnce({ analyzed: true, data: [] } as any);
    vi.mocked(AnalysisService.listPullRequestFiles).mockResolvedValue({
      data: [],
    } as any);
    // Default beforeEach mock returns { data: [] } — no files with diffLineHits

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    const output = getAllOutput();
    expect(output).not.toContain("Diff Coverage Summary");
  });

  // ─── Annotated Diff (--diff) ─────────────────────────────────────────────

  // A minimal git diff with two inserted lines: line 3 (covered) and line 4 (uncovered)
  const testDiffText = [
    "diff --git a/src/index.ts b/src/index.ts",
    "index abc1234..def5678 100644",
    "--- a/src/index.ts",
    "+++ b/src/index.ts",
    "@@ -1,5 +1,7 @@",
    " function foo() {",
    "   const x = 1;",
    "+  const y = 2;",
    "+  const z = 3;",
    "   return x;",
    " }",
  ].join("\n");

  it("should fetch and display annotated diff with --diff", async () => {
    vi.mocked(RepositoryService.getPullRequestDiff).mockResolvedValue({
      diff: testDiffText,
    } as any);
    vi.mocked(
      CoverageService.getRepositoryPullRequestFilesCoverage,
    ).mockResolvedValue({
      data: [
        {
          fileName: "src/index.ts",
          coverage: 50,
          diffLineHits: [
            { lineNumber: "3", hits: 2 }, // covered
            { lineNumber: "4", hits: 0 }, // uncovered
          ],
        },
      ],
    } as any);
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce({ data: [], pagination: undefined } as any)
      .mockResolvedValueOnce({ data: [], pagination: undefined } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
      "--diff",
    ]);

    const output = getAllOutput();
    expect(output).toContain("src/index.ts");
    expect(output).toContain("✓"); // covered line symbol
    expect(output).toContain("✘"); // uncovered line symbol
  });

  it("should show issue annotations (┃ and ↳) in --diff mode", async () => {
    vi.mocked(RepositoryService.getPullRequestDiff).mockResolvedValue({
      diff: testDiffText,
    } as any);
    vi.mocked(
      CoverageService.getRepositoryPullRequestFilesCoverage,
    ).mockResolvedValue({ data: [] } as any);
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce({
        data: [
          {
            commitIssue: {
              issueId: "diff-issue-1",
              resultDataId: 77,
              filePath: "src/index.ts",
              fileId: 1,
              patternInfo: {
                id: "p1",
                title: "some rule",
                category: "Error Prone",
                severityLevel: "Error",
                level: "Error",
              },
              toolInfo: { uuid: "t1", name: "Tool" },
              lineNumber: 3, // same new-file line as the first inserted line
              message: "An annotated issue",
              language: "TypeScript",
              lineText: "  const y = 2;",
              falsePositiveThreshold: 0.5,
            },
            deltaType: "Added",
          },
        ],
        pagination: undefined,
      } as any)
      .mockResolvedValueOnce({ data: [], pagination: undefined } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
      "--diff",
    ]);

    const output = getAllOutput();
    expect(output).toContain("┃");
    expect(output).toContain("↳");
    expect(output).toContain("An annotated issue");
    expect(output).toContain("#77");
  });

  it("should show ellipsis for skipped lines in --diff mode", async () => {
    // A diff with 15 context lines before an insert — creates a gap at the start
    const bigDiffText = [
      "diff --git a/src/big.ts b/src/big.ts",
      "index abc..def 100644",
      "--- a/src/big.ts",
      "+++ b/src/big.ts",
      "@@ -1,15 +1,16 @@",
      " line1",
      " line2",
      " line3",
      " line4",
      " line5",
      " line6",
      " line7",
      " line8",
      " line9",
      " line10",
      "+new covered line",
      " line11",
      " line12",
      " line13",
      " line14",
      " line15",
    ].join("\n");

    vi.mocked(RepositoryService.getPullRequestDiff).mockResolvedValue({
      diff: bigDiffText,
    } as any);
    vi.mocked(
      CoverageService.getRepositoryPullRequestFilesCoverage,
    ).mockResolvedValue({
      data: [
        {
          fileName: "src/big.ts",
          coverage: 100,
          diffLineHits: [{ lineNumber: "11", hits: 2 }], // line 11 in new file is the insert
        },
      ],
    } as any);
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce({ data: [], pagination: undefined } as any)
      .mockResolvedValueOnce({ data: [], pagination: undefined } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
      "--diff",
    ]);

    const output = getAllOutput();
    expect(output).toContain("...");
    expect(output).toContain("✓");
  });

  it("should output JSON for --diff when --output json is specified", async () => {
    vi.mocked(RepositoryService.getPullRequestDiff).mockResolvedValue({
      diff: testDiffText,
    } as any);
    vi.mocked(
      CoverageService.getRepositoryPullRequestFilesCoverage,
    ).mockResolvedValue({ data: [] } as any);
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce({ data: [], pagination: undefined } as any)
      .mockResolvedValueOnce({ data: [], pagination: undefined } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "--output",
      "json",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
      "--diff",
    ]);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"diff"'));
  });

  it("should paginate through all PR issues when looking for --issue <id>", async () => {
    // Promise.all starts both fetchAllPrIssues(false) and fetchAllPrIssues(true) concurrently,
    // so the actual call order is:
    //   1: (false, undefined) — non-potential page 1
    //   2: (true, undefined)  — potential page 1 (started concurrently)
    //   3: (false, "page2-cursor") — non-potential page 2 (after page 1 resolves)
    const page1NonPotential = {
      data: [mockNewIssues.data[0], mockNewIssues.data[1]], // IDs 1 and 2
      pagination: { cursor: "page2-cursor", limit: 2, total: 3 },
    };
    const page2NonPotential = {
      data: [mockNewIssues.data[2]], // ID 3 (the SQL injection)
      pagination: undefined,
    };

    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce(page1NonPotential as any) // call 1: non-potential page 1
      .mockResolvedValueOnce({ data: [], pagination: undefined } as any) // call 2: potential
      .mockResolvedValueOnce(page2NonPotential as any); // call 3: non-potential page 2

    vi.mocked(ToolsService.getPattern).mockResolvedValue({
      data: mockPattern,
    } as any);
    vi.mocked(FileService.getFileContent).mockResolvedValue({
      data: mockFileLines,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pull-request",
      "gh",
      "test-org",
      "test-repo",
      "42",
      "--issue",
      "3",
    ]);

    // Should have been called 3 times: 2 pages for non-potential + 1 for potential
    expect(AnalysisService.listPullRequestIssues).toHaveBeenCalledTimes(3);
    // 3rd call (non-potential page 2) should use the cursor from page 1
    expect(AnalysisService.listPullRequestIssues).toHaveBeenNthCalledWith(
      3,
      "gh",
      "test-org",
      "test-repo",
      42,
      "new",
      false,
      "page2-cursor",
    );

    const output = getAllOutput();
    expect(output).toContain("Potential SQL injection vulnerability");
  });

  // ─── --ignore-issue ─────────────────────────────────────────────────────

  describe("--ignore-issue option", () => {
    beforeEach(() => {
      vi.mocked(AnalysisService.updateIssueState).mockResolvedValue(
        undefined as any,
      );
    });

    it("should find and ignore a specific issue by resultDataId", async () => {
      vi.mocked(AnalysisService.listPullRequestIssues)
        .mockResolvedValueOnce({ data: mockNewIssues.data, pagination: undefined } as any)
        .mockResolvedValueOnce({ data: mockPotentialIssues.data, pagination: undefined } as any);

      const program = createProgram();
      // Issue with resultDataId=2 is "issue-2" (UUID)
      await program.parseAsync([
        "node", "test", "pull-request", "gh", "test-org", "test-repo", "42",
        "--ignore-issue", "2",
      ]);

      expect(AnalysisService.updateIssueState).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "issue-2",
        { ignored: true, reason: "AcceptedUse", comment: undefined },
      );
    });

    it("should use specified ignore reason and comment", async () => {
      vi.mocked(AnalysisService.listPullRequestIssues)
        .mockResolvedValueOnce({ data: mockNewIssues.data, pagination: undefined } as any)
        .mockResolvedValueOnce({ data: mockPotentialIssues.data, pagination: undefined } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "pull-request", "gh", "test-org", "test-repo", "42",
        "--ignore-issue", "1",
        "--ignore-reason", "FalsePositive",
        "--ignore-comment", "Reviewed and confirmed safe",
      ]);

      expect(AnalysisService.updateIssueState).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "issue-1",
        { ignored: true, reason: "FalsePositive", comment: "Reviewed and confirmed safe" },
      );
    });

    it("should also find and ignore a potential issue by resultDataId", async () => {
      vi.mocked(AnalysisService.listPullRequestIssues)
        .mockResolvedValueOnce({ data: [], pagination: undefined } as any)
        .mockResolvedValueOnce({ data: mockPotentialIssues.data, pagination: undefined } as any);

      const program = createProgram();
      // resultDataId=10 is in mockPotentialIssues → "issue-p1"
      await program.parseAsync([
        "node", "test", "pull-request", "gh", "test-org", "test-repo", "42",
        "--ignore-issue", "10",
      ]);

      expect(AnalysisService.updateIssueState).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "issue-p1",
        { ignored: true, reason: "AcceptedUse", comment: undefined },
      );
    });

    it("should fail when --ignore-issue <id> is not found in the PR", async () => {
      vi.mocked(AnalysisService.listPullRequestIssues)
        .mockResolvedValueOnce({ data: mockNewIssues.data, pagination: undefined } as any)
        .mockResolvedValueOnce({ data: mockPotentialIssues.data, pagination: undefined } as any);

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "pull-request", "gh", "test-org", "test-repo", "42",
          "--ignore-issue", "9999",
        ]),
      ).rejects.toThrow("process.exit called");

      mockExit.mockRestore();
    });
  });

  // ─── --ignore-all-false-positives ───────────────────────────────────────

  describe("--ignore-all-false-positives option", () => {
    beforeEach(() => {
      vi.mocked(AnalysisService.updateIssueState).mockResolvedValue(
        undefined as any,
      );
    });

    it("should fetch potential issues and ignore them all with reason FalsePositive", async () => {
      vi.mocked(AnalysisService.listPullRequestIssues).mockResolvedValueOnce({
        data: mockPotentialIssues.data,
        pagination: undefined,
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "pull-request", "gh", "test-org", "test-repo", "42",
        "--ignore-all-false-positives",
      ]);

      // mockPotentialIssues has 1 issue: issue-p1
      expect(AnalysisService.updateIssueState).toHaveBeenCalledTimes(1);
      expect(AnalysisService.updateIssueState).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "issue-p1",
        { ignored: true, reason: "FalsePositive", comment: undefined },
      );
    });

    it("should apply --ignore-comment to all ignored issues", async () => {
      vi.mocked(AnalysisService.listPullRequestIssues).mockResolvedValueOnce({
        data: mockPotentialIssues.data,
        pagination: undefined,
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "pull-request", "gh", "test-org", "test-repo", "42",
        "--ignore-all-false-positives",
        "--ignore-comment", "Bulk ignored after review",
      ]);

      expect(AnalysisService.updateIssueState).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "issue-p1",
        { ignored: true, reason: "FalsePositive", comment: "Bulk ignored after review" },
      );
    });

    it("should show a message when no potential false positive issues are found", async () => {
      vi.mocked(AnalysisService.listPullRequestIssues).mockResolvedValueOnce({
        data: [],
        pagination: undefined,
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "pull-request", "gh", "test-org", "test-repo", "42",
        "--ignore-all-false-positives",
      ]);

      expect(AnalysisService.updateIssueState).not.toHaveBeenCalled();
    });
  });

  // ─── --unignore-issue ────────────────────────────────────────────────────

  describe("--unignore-issue option", () => {
    beforeEach(() => {
      vi.mocked(AnalysisService.updateIssueState).mockResolvedValue(
        undefined as any,
      );
    });

    it("should find and unignore a specific issue by resultDataId", async () => {
      vi.mocked(AnalysisService.listPullRequestIssues)
        .mockResolvedValueOnce({ data: mockNewIssues.data, pagination: undefined } as any)
        .mockResolvedValueOnce({ data: mockPotentialIssues.data, pagination: undefined } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "pull-request", "gh", "test-org", "test-repo", "42",
        "--unignore-issue", "3",
      ]);

      expect(AnalysisService.updateIssueState).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "issue-3",
        { ignored: false },
      );
    });

    it("should fail when --unignore-issue <id> is not found in the PR", async () => {
      vi.mocked(AnalysisService.listPullRequestIssues)
        .mockResolvedValueOnce({ data: mockNewIssues.data, pagination: undefined } as any)
        .mockResolvedValueOnce({ data: mockPotentialIssues.data, pagination: undefined } as any);

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "pull-request", "gh", "test-org", "test-repo", "42",
          "--unignore-issue", "9999",
        ]),
      ).rejects.toThrow("process.exit called");

      mockExit.mockRestore();
    });
  });

  // ─── Reanalyze ──────────────────────────────────────────────────────────

  describe("--reanalyze", () => {
    it("should request reanalysis of the PR HEAD commit", async () => {
      vi.mocked(AnalysisService.getRepositoryPullRequest).mockResolvedValue({
        ...mockPrData,
        pullRequest: { ...mockPrData.pullRequest, headCommitSha: "prhead123" },
      } as any);
      vi.mocked(RepositoryService.reanalyzeCommitById).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "pull-request", "gh", "test-org", "test-repo", "42", "--reanalyze",
      ]);

      expect(RepositoryService.reanalyzeCommitById).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo", { commitUuid: "prhead123" },
      );
    });

    it("should show success message on reanalyze", async () => {
      vi.mocked(AnalysisService.getRepositoryPullRequest).mockResolvedValue(
        mockPrData as any,
      );
      vi.mocked(RepositoryService.reanalyzeCommitById).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "pull-request", "gh", "test-org", "test-repo", "42", "--reanalyze",
      ]);

      expect(RepositoryService.reanalyzeCommitById).toHaveBeenCalled();
    });
  });

  // ─── Analysis status in About ───────────────────────────────────────────

  it("should show analysis status in About section", async () => {
    vi.mocked(AnalysisService.getRepositoryPullRequest).mockResolvedValue(
      mockPrData as any,
    );
    vi.mocked(AnalysisService.listPullRequestIssues)
      .mockResolvedValueOnce({ data: [], pagination: {} } as any)
      .mockResolvedValueOnce({ data: [], pagination: {} } as any);
    vi.mocked(AnalysisService.listPullRequestFiles).mockResolvedValue(
      { data: [], pagination: {} } as any,
    );
    vi.mocked(AnalysisService.getPullRequestCommits).mockResolvedValue({
      data: [{
        commit: {
          sha: "abc1234567890",
          id: 1,
          commitTimestamp: "2025-06-14T10:00:00Z",
          authorName: "Test",
          authorEmail: "test@test.com",
          message: "fix things",
          startedAnalysis: "2025-06-14T09:55:00Z",
          endedAnalysis: "2025-06-14T10:00:00Z",
        },
      }],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "pull-request", "gh", "test-org", "test-repo", "42",
    ]);

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");
    expect(allOutput).toContain("Finished");
    expect(allOutput).toContain("abc1234");
    // Should NOT contain old "Head Commit" label
    expect(allOutput).not.toContain("Head Commit");
  });
});
