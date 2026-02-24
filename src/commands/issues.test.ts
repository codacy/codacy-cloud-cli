import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerIssuesCommand } from "./issues";
import { AnalysisService } from "../api/client/services/AnalysisService";

vi.mock("../api/client/services/AnalysisService");
vi.spyOn(console, "log").mockImplementation(() => {});

function createProgram(): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  registerIssuesCommand(program);
  return program;
}

const mockIssues = [
  {
    issueId: "issue-1",
    resultDataId: 9901,
    filePath: "src/auth.ts",
    fileId: 1,
    patternInfo: {
      id: "sql-injection",
      title: "SQL Injection",
      category: "Security",
      subCategory: "Injection",
      severityLevel: "Error",
      level: "Error",
    },
    toolInfo: { uuid: "tool-1", name: "Semgrep" },
    lineNumber: 20,
    message: "Potential SQL injection vulnerability",
    language: "TypeScript",
    lineText: '  db.query(`SELECT * FROM users WHERE id = ${id}`);',
    falsePositiveThreshold: 0.3,
  },
  {
    issueId: "issue-2",
    resultDataId: 9902,
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
    message: "Unused variable 'helper'",
    language: "TypeScript",
    lineText: "  const helper = 42;",
    falsePositiveThreshold: 0.5,
  },
];

const mockOverview = {
  data: {
    counts: {
      categories: [
        { name: "Security", total: 5 },
        { name: "Code Style", total: 3 },
      ],
      levels: [
        { name: "Error", total: 5 },
        { name: "Warning", total: 3 },
      ],
      languages: [{ name: "TypeScript", total: 8 }],
      tags: [{ name: "owasp", total: 5 }],
      patterns: [
        { id: "sql-injection", title: "SQL Injection", total: 5 },
        { id: "no-undef", title: "No Undefined Variables", total: 3 },
      ],
      authors: [{ name: "dev@example.com", total: 4 }],
    },
  },
};

function getAllOutput(): string {
  return (console.log as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0])
    .join("\n");
}

describe("issues command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
  });

  it("should fetch and display issues in card format", async () => {
    vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
      data: mockIssues,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "gh",
      "test-org",
      "test-repo",
    ]);

    expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      undefined,
      100,
      {},
    );

    const output = getAllOutput();
    // Section title includes count
    expect(output).toContain("Issues — Found 2 issues");
    expect(output).toContain("Potential SQL injection vulnerability");
    expect(output).toContain("src/auth.ts:20");
    expect(output).toContain("Unused variable 'helper'");
    expect(output).toContain("src/utils.ts:5");
    // Each card shows the stable issue ID on the first line
    expect(output).toContain("#9901");
    expect(output).toContain("#9902");
  });

  it("should show 'No issues found' when there are no issues", async () => {
    vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain("No issues found");
  });

  it("should show overview when --overview flag is set", async () => {
    vi.mocked(AnalysisService.issuesOverview).mockResolvedValue(
      mockOverview as any,
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "gh",
      "test-org",
      "test-repo",
      "--overview",
    ]);

    expect(AnalysisService.issuesOverview).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      {},
    );

    const output = getAllOutput();
    expect(output).toContain("Issues Overview");
    expect(output).toContain("Security");
    expect(output).toContain("Category");
    expect(output).toContain("Severity");
    expect(output).toContain("Language");
    expect(output).toContain("Tag");
    expect(output).toContain("Pattern");
    expect(output).toContain("SQL Injection");
    expect(output).toContain("sql-injection");
    expect(output).toContain("Author");
    expect(output).toContain("dev@example.com");
  });

  it("should pass filter options to the API body", async () => {
    vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "gh",
      "test-org",
      "test-repo",
      "--branch",
      "main",
      "--severities",
      "Error,Warning",
      "--categories",
      "Security",
      "--languages",
      "TypeScript",
      "--tags",
      "owasp",
      "--authors",
      "dev@example.com",
    ]);

    expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      undefined,
      100,
      {
        branchName: "main",
        levels: ["Error", "Warning"],
        categories: ["Security"],
        languages: ["TypeScript"],
        tags: ["owasp"],
        authorEmails: ["dev@example.com"],
      },
    );
  });

  it("should normalize severity display labels to enum values (case-insensitive)", async () => {
    vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    // "critical" → Error, "medium" → Warning, "minor" → Info
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "gh",
      "test-org",
      "test-repo",
      "--severities",
      "Critical,medium,MINOR",
    ]);

    expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      undefined,
      100,
      { levels: ["Error", "Warning", "Info"] },
    );
  });

  it("should normalize category names case-insensitively and accept spaces", async () => {
    vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    // "security" → "Security", "code style" isn't supported as multi-word via CLI
    // but "codestyle" → "CodeStyle", "error prone" → but spaces stripped → "errorprone" → "ErrorProne"
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "gh",
      "test-org",
      "test-repo",
      "--categories",
      "security,ErrorProne,bestpractice",
    ]);

    expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      undefined,
      100,
      { categories: ["Security", "ErrorProne", "BestPractice"] },
    );
  });

  it("should pass pattern filter to the API body", async () => {
    vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "gh",
      "test-org",
      "test-repo",
      "--patterns",
      "no-undef,no-unused",
    ]);

    expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      undefined,
      100,
      { patternIds: ["no-undef", "no-unused"] },
    );
  });

  it("should sort issues by severity (Error before Warning)", async () => {
    const unsortedIssues = [
      {
        issueId: "i1",
        resultDataId: 1,
        filePath: "a.ts",
        fileId: 1,
        patternInfo: {
          id: "p1",
          category: "Style",
          severityLevel: "Warning",
          level: "Warning",
        },
        toolInfo: { uuid: "t1", name: "Tool" },
        lineNumber: 1,
        message: "Warning issue",
        language: "TypeScript",
        lineText: "let x = 1;",
        falsePositiveThreshold: 0.5,
      },
      {
        issueId: "i2",
        resultDataId: 2,
        filePath: "b.ts",
        fileId: 2,
        patternInfo: {
          id: "p2",
          category: "Error Prone",
          severityLevel: "Error",
          level: "Error",
        },
        toolInfo: { uuid: "t1", name: "Tool" },
        lineNumber: 2,
        message: "Error issue",
        language: "TypeScript",
        lineText: "let y = 2;",
        falsePositiveThreshold: 0.5,
      },
    ];

    vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
      data: unsortedIssues,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    const errorIdx = output.indexOf("Error issue");
    const warningIdx = output.indexOf("Warning issue");
    expect(errorIdx).toBeLessThan(warningIdx);
  });

  it("should show subcategory for security issues", async () => {
    vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
      data: mockIssues,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Security");
    expect(output).toContain("Injection");
  });

  it("should show false positive warning when probability exceeds threshold", async () => {
    const issueWithFalsePositive = {
      issueId: "fp1",
      resultDataId: 100,
      filePath: "src/fp.ts",
      fileId: 100,
      patternInfo: {
        id: "rule1",
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
    };

    vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
      data: [issueWithFalsePositive],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Potential false positive");
    expect(output).toContain("Common pattern that is usually intentional");
  });

  it("should show pagination total in Issues section title", async () => {
    vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
      data: mockIssues,
      pagination: { cursor: "next-cursor", limit: 100, total: 45000 },
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Issues — Found 45k issues");
    // Pagination warning should also appear
    expect(output).toContain("Showing the first 100 results");
  });

  it("should output JSON for issues list when --output json is specified", async () => {
    vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
      data: mockIssues,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "--output",
      "json",
      "issues",
      "gh",
      "test-org",
      "test-repo",
    ]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"Potential SQL injection vulnerability"'),
    );
  });

  it("should output JSON for overview when --overview --output json is specified", async () => {
    vi.mocked(AnalysisService.issuesOverview).mockResolvedValue(
      mockOverview as any,
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "--output",
      "json",
      "issues",
      "gh",
      "test-org",
      "test-repo",
      "--overview",
    ]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"Security"'),
    );
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
        "issues",
        "gh",
        "test-org",
        "test-repo",
      ]),
    ).rejects.toThrow("process.exit called");

    mockExit.mockRestore();
  });
});
