import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerIssueCommand } from "./issue";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { ToolsService } from "../api/client/services/ToolsService";
import { FileService } from "../api/client/services/FileService";
import { IssueStateBody } from "../api/client/models/IssueStateBody";

vi.mock("../api/client/services/AnalysisService");
vi.mock("../api/client/services/ToolsService");
vi.mock("../api/client/services/FileService");
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

function createProgram(): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  registerIssueCommand(program);
  return program;
}

const mockIssue = {
  issueId: "uuid-abc-123",
  resultDataId: 42,
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
  toolInfo: { uuid: "tool-uuid-1", name: "Semgrep" },
  lineNumber: 20,
  message: "Potential SQL injection vulnerability",
  suggestion: "Use parameterized queries",
  language: "TypeScript",
  lineText: "  db.query(`SELECT * FROM users WHERE id = ${id}`);",
  falsePositiveThreshold: 0.5,
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
  explanation: "SQL injection occurs when user input is embedded in queries.",
  rationale: "Attackers can manipulate queries to access unauthorized data.",
  solution: "Use parameterized queries or prepared statements.",
  tags: ["security", "owasp-a1"],
};

const mockLines = [
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

describe("issue command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
    vi.mocked(AnalysisService.getIssue).mockResolvedValue({
      data: mockIssue,
    } as any);
    vi.mocked(ToolsService.getPattern).mockResolvedValue({
      data: mockPattern,
    } as any);
    vi.mocked(FileService.getFileContent).mockResolvedValue({
      data: mockLines,
    } as any);
  });

  it("should fetch and display issue details", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issue",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    expect(AnalysisService.getIssue).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      42,
    );
    expect(ToolsService.getPattern).toHaveBeenCalledWith(
      "tool-uuid-1",
      "sql-injection",
    );
    expect(FileService.getFileContent).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "src%2Fauth.ts",
      15,
      25,
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
    expect(output).toContain("Tags: security, owasp-a1");
    expect(output).toContain("Detected by: Semgrep");
    expect(output).toContain("SQL Injection (sql-injection)");
  });

  it("should show the issue line in context and the suggestion", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issue",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    const output = getAllOutput();
    // The issue line (20) should appear in the output
    expect(output).toContain("20 |");
    // The suggestion should appear (same line number)
    expect(output).toContain("Use parameterized queries");
    // Context lines should also appear
    expect(output).toContain("15 |");
    expect(output).toContain("25 |");
  });

  it("should show subcategory in the header", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issue",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Security");
    expect(output).toContain("Injection");
  });

  it("should show false positive warning when probability exceeds threshold", async () => {
    vi.mocked(AnalysisService.getIssue).mockResolvedValue({
      data: {
        ...mockIssue,
        falsePositiveProbability: 0.9,
        falsePositiveThreshold: 0.5,
        falsePositiveReason: "Common pattern usually intentional",
      },
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issue",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Potential false positive");
    expect(output).toContain("Common pattern usually intentional");
  });

  it("should fall back to lineText when file content fetch fails", async () => {
    vi.mocked(FileService.getFileContent).mockRejectedValue(
      new Error("File not found"),
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issue",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    const output = getAllOutput();
    // Should still show the issue message and the lineText fallback
    expect(output).toContain("Potential SQL injection vulnerability");
    expect(output).toContain("SELECT * FROM users");
  });

  it("should still show issue when pattern fetch fails", async () => {
    vi.mocked(ToolsService.getPattern).mockRejectedValue(
      new Error("Pattern not found"),
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issue",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    const output = getAllOutput();
    // Issue message and file context still shown
    expect(output).toContain("Potential SQL injection vulnerability");
    // Pattern section not shown
    expect(output).not.toContain("Why is this a problem?");
  });

  it("should output JSON when --output json is specified", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "--output",
      "json",
      "issue",
      "gh",
      "test-org",
      "test-repo",
      "42",
    ]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"Potential SQL injection vulnerability"'),
    );
  });

  it("should fail with an error for a non-numeric issue ID", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "test",
        "issue",
        "gh",
        "test-org",
        "test-repo",
        "abc",
      ]),
    ).rejects.toThrow("process.exit called");

    mockExit.mockRestore();
  });

  it("should fail when CODACY_API_TOKEN is not set", async () => {
    delete process.env.CODACY_API_TOKEN;

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "test",
        "issue",
        "gh",
        "test-org",
        "test-repo",
        "42",
      ]),
    ).rejects.toThrow("process.exit called");

    mockExit.mockRestore();
  });

  describe("--ignore option", () => {
    beforeEach(() => {
      vi.mocked(AnalysisService.updateIssueState).mockResolvedValue(
        undefined as any,
      );
    });

    it("should call updateIssueState with default reason when --ignore is specified", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issue", "gh", "test-org", "test-repo", "42",
        "--ignore",
      ]);

      expect(AnalysisService.updateIssueState).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "uuid-abc-123",
        { ignored: true, reason: "AcceptedUse", comment: undefined } satisfies IssueStateBody,
      );
      // Issue details should NOT be shown when --ignore is passed
      const output = getAllOutput();
      expect(output).not.toContain("Potential SQL injection vulnerability");
    });

    it("should call updateIssueState with specified reason", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issue", "gh", "test-org", "test-repo", "42",
        "--ignore", "--ignore-reason", "FalsePositive",
      ]);

      expect(AnalysisService.updateIssueState).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "uuid-abc-123",
        { ignored: true, reason: "FalsePositive", comment: undefined } satisfies IssueStateBody,
      );
    });

    it("should pass ignore comment when --ignore-comment is specified", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issue", "gh", "test-org", "test-repo", "42",
        "--ignore", "--ignore-comment", "Reviewed and accepted",
      ]);

      expect(AnalysisService.updateIssueState).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "uuid-abc-123",
        { ignored: true, reason: "AcceptedUse", comment: "Reviewed and accepted" } satisfies IssueStateBody,
      );
    });

    it("should not call updateIssueState when --ignore is not specified", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issue", "gh", "test-org", "test-repo", "42",
      ]);

      expect(AnalysisService.updateIssueState).not.toHaveBeenCalled();
    });
  });

  describe("--unignore option", () => {
    beforeEach(() => {
      vi.mocked(AnalysisService.updateIssueState).mockResolvedValue(
        undefined as any,
      );
    });

    it("should call updateIssueState with ignored:false when --unignore is specified", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issue", "gh", "test-org", "test-repo", "42",
        "--unignore",
      ]);

      expect(AnalysisService.updateIssueState).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "uuid-abc-123",
        { ignored: false },
      );
    });

    it("should not render issue details when --unignore is specified", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issue", "gh", "test-org", "test-repo", "42",
        "--unignore",
      ]);

      const output = getAllOutput();
      expect(output).not.toContain("Potential SQL injection vulnerability");
    });

    it("should not call updateIssueState when --unignore is not specified", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issue", "gh", "test-org", "test-repo", "42",
      ]);

      expect(AnalysisService.updateIssueState).not.toHaveBeenCalled();
    });
  });
});
