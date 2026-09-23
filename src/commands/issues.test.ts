import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerIssuesCommand } from "./issues";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { ToolsService } from "../api/client/services/ToolsService";
import * as prompt from "../utils/prompt";

vi.mock("../api/client/services/AnalysisService");
vi.mock("../api/client/services/ToolsService");
vi.mock("../utils/credentials", () => ({ loadCredentials: vi.fn(() => null) }));
vi.mock("../utils/git-remote", () => ({
  detectRepoContext: vi.fn(() => ({
    provider: "gh",
    organization: "auto-org",
    repository: "auto-repo",
  })),
}));
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
      potentialFalsePositives: [
        { name: "equalOrAboveThreshold", total: 2 },
        { name: "belowThreshold", total: 6 },
      ],
    },
  },
};

const mockIgnoredIssues = [
  {
    issueId: "ign-uuid-1",
    reason: "FalsePositive",
    comment: "Reviewed, not exploitable",
    ignoredByName: "Jane Dev",
    ignoredTimestamp: "2026-06-01T10:00:00Z",
    filePath: "src/auth.ts",
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
    lineText: "  db.query(`SELECT * FROM users WHERE id = ${id}`);",
    falsePositiveThreshold: 0.3,
  },
  {
    issueId: "ign-uuid-2",
    reason: "AcceptedUse",
    ignoredByName: "John Ops",
    ignoredTimestamp: "2026-05-20T12:00:00Z",
    filePath: "src/utils.ts",
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

function getAllOutput(): string {
  return (console.log as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0])
    .join("\n");
}

describe("issues command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
    // Default: no tools. Overrides per-test when a suggestion needs resolving.
    vi.mocked(ToolsService.listTools).mockResolvedValue({ data: [] } as any);
    // The overview noise path also reads repo tools; default to none so tests
    // that don't exercise suggestions don't need to mock it.
    vi.mocked(AnalysisService.listRepositoryTools).mockResolvedValue({
      data: [],
    } as any);
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
    expect(output).toContain("False Positives");
    // Raw API bucket names are relabeled to human-friendly terms.
    expect(output).toContain("Potential False Positive");
    expect(output).toContain("Not a False Positive");
    expect(output).not.toContain("equalOrAboveThreshold");
    expect(output).not.toContain("belowThreshold");
  });

  describe("overview noise suggestions", () => {
    // One dominant pattern plus nine small ones: total 2950, median 50.
    // Bandit_B101 (2500) clears the per-pattern floor (100) and is >=3x the
    // median (150) → noisy. (With only 10 patterns the share rule is off, so the
    // median rule is what flags it here.)
    function noisyOverview() {
      const patterns = [
        { id: "Bandit_B101", title: "Use of assert detected", total: 2500 },
      ];
      for (let i = 0; i < 9; i++) {
        patterns.push({ id: `Other_${i}`, title: `Pattern ${i}`, total: 50 });
      }
      return {
        data: {
          counts: {
            categories: [{ name: "Security", total: 2950 }],
            levels: [{ name: "Warning", total: 2950 }],
            languages: [],
            tags: [],
            patterns,
            authors: [],
            potentialFalsePositives: [],
          },
        },
      };
    }

    const banditTool = {
      data: [
        { uuid: "uuid-bandit", name: "Bandit", shortName: "bandit", prefix: "Bandit_" },
      ],
      pagination: undefined,
    };

    // Repo-scoped Bandit tool, matched to the global one by UUID. Helpers build
    // variants for the config-file and coding-standard cases.
    function banditRepoTool(overrides: Record<string, any> = {}) {
      return {
        data: [
          {
            uuid: "uuid-bandit",
            name: "Bandit",
            isClientSide: false,
            settings: {
              isEnabled: true,
              followsStandard: false,
              isCustom: false,
              hasConfigurationFile: false,
              usesConfigurationFile: false,
              enabledBy: [],
              ...overrides,
            },
          },
        ],
        pagination: undefined,
      };
    }

    // A configured pattern for Bandit_B101 with the given enforcing standards.
    function banditPattern(enabledBy: Array<{ id: number; name: string }> = []) {
      return {
        data: [
          {
            patternDefinition: { id: "Bandit_B101", title: "Use of assert detected" },
            enabled: true,
            parameters: [],
            enabledBy,
          },
        ],
        pagination: undefined,
      };
    }

    it("suggests disabling a noisy pattern with a runnable command", async () => {
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue(
        noisyOverview() as any,
      );
      vi.mocked(ToolsService.listTools).mockResolvedValue(banditTool as any);
      vi.mocked(AnalysisService.listRepositoryTools).mockResolvedValue(
        banditRepoTool() as any,
      );
      vi.mocked(AnalysisService.listRepositoryToolPatterns).mockResolvedValue(
        banditPattern() as any,
      );

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo", "--overview",
      ]);

      // Strip ANSI codes so bold/color don't break substring matches.
      const output = getAllOutput().replace(/\x1b\[[0-9;]*m/g, "");
      expect(output).toContain("Suggested actions to reduce noise");
      expect(output).toContain('Disable "Use of assert detected"');
      expect(output).toContain("(-2.5k issues)");
      expect(output).toContain("codacy pattern Bandit Bandit_B101 --disable");
      // The small patterns are listed in the table but never suggested.
      expect(output).not.toContain('Disable "Pattern 0"');
    });

    it("suggests updating the config file when the tool uses one", async () => {
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue(
        noisyOverview() as any,
      );
      vi.mocked(ToolsService.listTools).mockResolvedValue(banditTool as any);
      vi.mocked(AnalysisService.listRepositoryTools).mockResolvedValue(
        banditRepoTool({ usesConfigurationFile: true }) as any,
      );

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo", "--overview",
      ]);

      const output = getAllOutput().replace(/\x1b\[[0-9;]*m/g, "");
      expect(output).toContain("Suggested actions to reduce noise");
      expect(output).toContain(
        "Update your local Bandit configuration file to disable the pattern",
      );
      // No runnable command, and no need to look up the pattern's enforcement.
      expect(output).not.toContain("codacy pattern");
      expect(AnalysisService.listRepositoryToolPatterns).not.toHaveBeenCalled();
    });

    it("suggests updating the coding standard when the pattern is enforced", async () => {
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue(
        noisyOverview() as any,
      );
      vi.mocked(ToolsService.listTools).mockResolvedValue(banditTool as any);
      vi.mocked(AnalysisService.listRepositoryTools).mockResolvedValue(
        banditRepoTool() as any,
      );
      vi.mocked(AnalysisService.listRepositoryToolPatterns).mockResolvedValue(
        banditPattern([{ id: 1, name: "OWASP Top 10" }]) as any,
      );

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo", "--overview",
      ]);

      const output = getAllOutput().replace(/\x1b\[[0-9;]*m/g, "");
      expect(output).toContain("Update OWASP Top 10 to disable the pattern");
      expect(output).not.toContain("codacy pattern");
    });

    it("discards suggestions whose owning tool can't be resolved", async () => {
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue(
        noisyOverview() as any,
      );
      // No tool prefix matches "Bandit_" → suggestion silently dropped.
      vi.mocked(ToolsService.listTools).mockResolvedValue({
        data: [{ uuid: "u", name: "ESLint", shortName: "eslint", prefix: "ESLint_" }],
        pagination: undefined,
      } as any);
      vi.mocked(AnalysisService.listRepositoryTools).mockResolvedValue({
        data: [],
        pagination: undefined,
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo", "--overview",
      ]);

      const output = getAllOutput();
      expect(output).not.toContain("Suggested actions to reduce noise");
    });

    it("shows no suggestions and skips the tools fetch when nothing is noisy", async () => {
      // Twelve evenly-sized patterns: each is ~8.3% of total (below the >=10%
      // share floor of 120) and equal to the median (below the >=3x-median floor
      // of 300), so none crosses either threshold.
      const patterns = Array.from({ length: 12 }, (_, i) => ({
        id: `Tool_${i}`,
        title: `Pattern ${i}`,
        total: 100,
      }));
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
        data: {
          counts: {
            categories: [],
            levels: [{ name: "Warning", total: 1200 }],
            languages: [],
            tags: [],
            patterns,
            authors: [],
            potentialFalsePositives: [],
          },
        },
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo", "--overview",
      ]);

      const output = getAllOutput();
      expect(output).not.toContain("Suggested actions to reduce noise");
      expect(ToolsService.listTools).not.toHaveBeenCalled();
    });

    it("does not flag every pattern in a perfectly balanced repo", async () => {
      // Ten evenly-distributed patterns of 100 (total 1000): each is exactly 10%
      // of the total and clears the per-pattern floor, so a share threshold of 10
      // would flag ALL of them. NOISE_MIN_PATTERNS_FOR_SHARE (11) disables the
      // share rule here (10 < 11), and the median rule can't fire on a flat
      // distribution (100 < 3x median 100), so nothing is flagged.
      const patterns = Array.from({ length: 10 }, (_, i) => ({
        id: `Tool_${i}`,
        title: `Pattern ${i}`,
        total: 100,
      }));
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
        data: {
          counts: {
            categories: [],
            levels: [{ name: "Warning", total: 1000 }],
            languages: [],
            tags: [],
            patterns,
            authors: [],
            potentialFalsePositives: [],
          },
        },
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo", "--overview",
      ]);

      const output = getAllOutput();
      expect(output).not.toContain("Suggested actions to reduce noise");
      expect(ToolsService.listTools).not.toHaveBeenCalled();
    });

    it("makes no suggestions below the absolute total floor", async () => {
      // A single pattern of 120 that clears the per-pattern floor (100) and is
      // disproportionate (median 6, 3x = 18; 80% share), so everything except the
      // total floor would flag it. But the repo has only 150 issues total, below
      // NOISE_MIN_TOTAL (200) — so the whole section is suppressed regardless.
      const patterns = [
        { id: "Bandit_B101", title: "Use of assert detected", total: 120 },
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `Other_${i}`,
          title: `Pattern ${i}`,
          total: 6,
        })),
      ];
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
        data: {
          counts: {
            categories: [],
            levels: [{ name: "Warning", total: 150 }],
            languages: [],
            tags: [],
            patterns,
            authors: [],
            potentialFalsePositives: [],
          },
        },
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo", "--overview",
      ]);

      const output = getAllOutput();
      expect(output).not.toContain("Suggested actions to reduce noise");
      // Nothing is noisy, so the tools lookup is skipped entirely.
      expect(ToolsService.listTools).not.toHaveBeenCalled();
    });

    it("does not apply the share rule when there are too few patterns", async () => {
      // Five patterns of comparable size: {120, 80, 80, 80, 80}, total 440.
      // The 120 is 27% of the total, but with only 5 patterns an even split is
      // already 20% each, so the share rule is disabled. And 120 < 3x median(80)
      // = 240, so the multiple rule doesn't fire either → nothing is noisy.
      const patterns = [
        { id: "Bandit_B101", title: "Use of assert detected", total: 120 },
        ...Array.from({ length: 4 }, (_, i) => ({
          id: `Other_${i}`,
          title: `Pattern ${i}`,
          total: 80,
        })),
      ];
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
        data: {
          counts: {
            categories: [],
            levels: [{ name: "Warning", total: 440 }],
            languages: [],
            tags: [],
            patterns,
            authors: [],
            potentialFalsePositives: [],
          },
        },
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo", "--overview",
      ]);

      const output = getAllOutput();
      expect(output).not.toContain("Suggested actions to reduce noise");
      expect(ToolsService.listTools).not.toHaveBeenCalled();
    });

    it("flags a secondary pattern a mean baseline would have masked", async () => {
      // A mega-outlier (5000) drags the *mean* to 512, so the old 3x-mean floor
      // of 1536 would have hidden the genuinely-disproportionate 120-issue pattern
      // (24x the typical 5). The median floor (3x median 5 = 15) catches both, and
      // 120 clears the absolute per-pattern floor of 100.
      const patterns = [
        { id: "Bandit_B608", title: "Possible SQL injection", total: 5000 },
        { id: "Bandit_B101", title: "Use of assert detected", total: 120 },
        ...Array.from({ length: 8 }, (_, i) => ({
          id: `Other_${i}`,
          title: `Pattern ${i}`,
          total: 5,
        })),
      ];
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
        data: {
          counts: {
            categories: [],
            levels: [{ name: "Warning", total: 5160 }],
            languages: [],
            tags: [],
            patterns,
            authors: [],
            potentialFalsePositives: [],
          },
        },
      } as any);
      vi.mocked(ToolsService.listTools).mockResolvedValue(banditTool as any);
      vi.mocked(AnalysisService.listRepositoryTools).mockResolvedValue(
        banditRepoTool() as any,
      );
      vi.mocked(AnalysisService.listRepositoryToolPatterns).mockResolvedValue(
        banditPattern() as any,
      );

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo", "--overview",
      ]);

      const output = getAllOutput().replace(/\x1b\[[0-9;]*m/g, "");
      expect(output).toContain("Suggested actions to reduce noise");
      // The mega-outlier and the secondary pattern are both suggested.
      expect(output).toContain("codacy pattern Bandit Bandit_B608 --disable");
      expect(output).toContain("codacy pattern Bandit Bandit_B101 --disable");
      // The typical 5-issue patterns are not.
      expect(output).not.toContain('Disable "Pattern 0"');
    });

    it("does not flag a disproportionate pattern below the per-pattern floor", async () => {
      // A repo of 210 issues (above NOISE_MIN_TOTAL) where one pattern of 90 is
      // dominant — 43% share, and well above 3x the median of 8 (24). It clears
      // every gate except the per-pattern floor: 90 < NOISE_MIN_PATTERN (100). A
      // rule producing 90 issues isn't a flood worth disabling, so despite being
      // disproportionate it must not be suggested.
      const patterns = [
        { id: "Bandit_B101", title: "Use of assert detected", total: 90 },
        ...Array.from({ length: 15 }, (_, i) => ({
          id: `Other_${i}`,
          title: `Pattern ${i}`,
          total: 8,
        })),
      ];
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue({
        data: {
          counts: {
            categories: [],
            levels: [{ name: "Warning", total: 210 }],
            languages: [],
            tags: [],
            patterns,
            authors: [],
            potentialFalsePositives: [],
          },
        },
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo", "--overview",
      ]);

      const output = getAllOutput();
      expect(output).not.toContain("Suggested actions to reduce noise");
      // Nothing clears the absolute floor, so the tools lookup is skipped.
      expect(ToolsService.listTools).not.toHaveBeenCalled();
    });
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

    const jsonOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonOutput).toContain('"Potential SQL injection vulnerability"');
    expect(jsonOutput).toContain('"sql-injection"');
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

  it("should pass a custom limit <= 100 directly to the API", async () => {
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
      "--limit",
      "50",
    ]);

    expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      undefined,
      50,
      {},
    );
  });

  it("should paginate when limit > 100", async () => {
    const page1Issues = Array.from({ length: 100 }, (_, i) => ({
      issueId: `issue-${i}`,
      resultDataId: i,
      filePath: `file-${i}.ts`,
      fileId: i,
      patternInfo: { id: "p1", category: "Style", severityLevel: "Warning", level: "Warning" },
      toolInfo: { uuid: "t1", name: "Tool" },
      lineNumber: 1,
      message: `Issue ${i}`,
      language: "TypeScript",
      lineText: "x",
      falsePositiveThreshold: 0.5,
    }));
    const page2Issues = Array.from({ length: 50 }, (_, i) => ({
      issueId: `issue-${100 + i}`,
      resultDataId: 100 + i,
      filePath: `file-${100 + i}.ts`,
      fileId: 100 + i,
      patternInfo: { id: "p1", category: "Style", severityLevel: "Warning", level: "Warning" },
      toolInfo: { uuid: "t1", name: "Tool" },
      lineNumber: 1,
      message: `Issue ${100 + i}`,
      language: "TypeScript",
      lineText: "x",
      falsePositiveThreshold: 0.5,
    }));

    vi.mocked(AnalysisService.searchRepositoryIssues)
      .mockResolvedValueOnce({
        data: page1Issues,
        pagination: { cursor: "cursor-2", limit: 100, total: 250 },
      } as any)
      .mockResolvedValueOnce({
        data: page2Issues,
        pagination: { cursor: undefined, limit: 100, total: 250 },
      } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "gh",
      "test-org",
      "test-repo",
      "--limit",
      "150",
    ]);

    expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledTimes(2);
    // First call: no cursor
    expect(AnalysisService.searchRepositoryIssues).toHaveBeenNthCalledWith(
      1, "gh", "test-org", "test-repo", undefined, 100, {},
    );
    // Second call: with cursor from first response
    expect(AnalysisService.searchRepositoryIssues).toHaveBeenNthCalledWith(
      2, "gh", "test-org", "test-repo", "cursor-2", 100, {},
    );

    const output = getAllOutput();
    expect(output).toContain("Issues — Found 250 issues");
  });

  it("should cap limit at 1000", async () => {
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
      "--limit",
      "5000",
    ]);

    // Should use pageSize 100 (min of 1000, 100)
    expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
      "gh", "test-org", "test-repo", undefined, 100, {},
    );
  });

  describe("--tools filter", () => {
    const mockToolList = {
      data: [
        { uuid: "uuid-eslint", name: "ESLint", shortName: "eslint", prefix: "ESLint_" },
        { uuid: "uuid-eslint9", name: "ESLint 9", shortName: "eslint9", prefix: "ESLint9_" },
        { uuid: "uuid-semgrep", name: "Semgrep", shortName: "semgrep", prefix: "Semgrep_" },
        { uuid: "uuid-markdownlint", name: "Markdownlint", shortName: "markdownlint", prefix: "Markdownlint_" },
        { uuid: "uuid-remarklint", name: "Remarklint", shortName: "remarklint", prefix: "Remarklint_" },
      ],
      pagination: undefined,
    };

    it("should pass a UUID directly to body.toolUuids", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--tools", "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      ]);

      expect(ToolsService.listTools).not.toHaveBeenCalled();
      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo", undefined, 100,
        { toolUuids: ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"] },
      );
    });

    it("should resolve an exact tool name to its UUID", async () => {
      vi.mocked(ToolsService.listTools).mockResolvedValue(mockToolList as any);
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--tools", "eslint",
      ]);

      expect(ToolsService.listTools).toHaveBeenCalled();
      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo", undefined, 100,
        { toolUuids: ["uuid-eslint"] },
      );
    });

    it("should resolve a shortName match to its UUID", async () => {
      vi.mocked(ToolsService.listTools).mockResolvedValue(mockToolList as any);
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--tools", "semgrep",
      ]);

      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo", undefined, 100,
        { toolUuids: ["uuid-semgrep"] },
      );
    });

    it("should resolve an exact shortName match (eslint9)", async () => {
      vi.mocked(ToolsService.listTools).mockResolvedValue(mockToolList as any);
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--tools", "eslint9",
      ]);

      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo", undefined, 100,
        { toolUuids: ["uuid-eslint9"] },
      );
    });

    it("should resolve a unique substring match via prefix", async () => {
      vi.mocked(ToolsService.listTools).mockResolvedValue(mockToolList as any);
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [],
      } as any);

      const program = createProgram();
      // "semgr" is not an exact name or shortName, but substring-matches only Semgrep
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--tools", "semgr",
      ]);

      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo", undefined, 100,
        { toolUuids: ["uuid-semgrep"] },
      );
    });

    it("should error when tool name is ambiguous", async () => {
      vi.mocked(ToolsService.listTools).mockResolvedValue(mockToolList as any);

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });
      const mockStderr = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "issues", "gh", "test-org", "test-repo",
          "--tools", "mark",
        ]),
      ).rejects.toThrow("process.exit called");

      expect(mockStderr).toHaveBeenCalledWith(
        expect.stringContaining("ambiguous"),
      );

      mockExit.mockRestore();
      mockStderr.mockRestore();
    });

    it("should error when tool name is not found", async () => {
      vi.mocked(ToolsService.listTools).mockResolvedValue(mockToolList as any);

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });
      const mockStderr = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "issues", "gh", "test-org", "test-repo",
          "--tools", "nonexistent",
        ]),
      ).rejects.toThrow("process.exit called");

      expect(mockStderr).toHaveBeenCalledWith(
        expect.stringContaining("not found"),
      );

      mockExit.mockRestore();
      mockStderr.mockRestore();
    });

    it("should handle mixed UUIDs and tool names", async () => {
      vi.mocked(ToolsService.listTools).mockResolvedValue(mockToolList as any);
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--tools", "a1b2c3d4-e5f6-7890-abcd-ef1234567890,semgrep",
      ]);

      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo", undefined, 100,
        { toolUuids: ["a1b2c3d4-e5f6-7890-abcd-ef1234567890", "uuid-semgrep"] },
      );
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
        "issues",
        "gh",
        "test-org",
        "test-repo",
      ]),
    ).rejects.toThrow("process.exit called");

    mockExit.mockRestore();
  });

  describe("--false-positives flag", () => {
    it("should pass potentialFalsePositives: true in the body", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--false-positives",
      ]);

      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo", undefined, 100,
        { potentialFalsePositives: true },
      );
    });

    it("should combine potentialFalsePositives with other filters (--patterns)", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--false-positives",
        "--patterns", "no-undef,sql-injection",
        "--branch", "main",
      ]);

      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo", undefined, 100,
        {
          potentialFalsePositives: true,
          patternIds: ["no-undef", "sql-injection"],
          branchName: "main",
        },
      );
    });

    it("should pass potentialFalsePositives: false when --false-positives false", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--false-positives", "false",
      ]);

      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo", undefined, 100,
        { potentialFalsePositives: false },
      );
    });

    it("should pass potentialFalsePositives: true when --false-positives true", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--false-positives", "true",
      ]);

      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo", undefined, 100,
        { potentialFalsePositives: true },
      );
    });

    it("should display false positive issues in list format", async () => {
      const fpIssue = {
        ...mockIssues[0],
        falsePositiveProbability: 0.9,
        falsePositiveThreshold: 0.5,
        falsePositiveReason: "Common safe pattern",
      };
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [fpIssue],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--false-positives",
      ]);

      const output = getAllOutput();
      expect(output).toContain("Potential SQL injection vulnerability");
      expect(output).toContain("Potential false positive");
    });
  });

  describe("--ignore flag", () => {
    beforeEach(() => {
      // Bulk-ignore now confirms first. Default the prompt to "yes" so the
      // behavioral tests below exercise the ignore path; the confirmation tests
      // further down override this to assert on the prompt itself.
      vi.spyOn(prompt, "confirmAction").mockResolvedValue(true);
    });

    it("should error when --overview is combined with --ignore", async () => {
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "issues", "gh", "test-org", "test-repo",
          "--ignore", "--overview",
        ]),
      ).rejects.toThrow("process.exit called");

      expect(AnalysisService.bulkIgnoreIssues).not.toHaveBeenCalled();
      expect(AnalysisService.searchRepositoryIssues).not.toHaveBeenCalled();

      mockExit.mockRestore();
    });

    it("should error when --limit is explicitly combined with --ignore", async () => {
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "issues", "gh", "test-org", "test-repo",
          "--ignore", "--limit", "10",
        ]),
      ).rejects.toThrow("process.exit called");

      expect(AnalysisService.bulkIgnoreIssues).not.toHaveBeenCalled();
      expect(AnalysisService.searchRepositoryIssues).not.toHaveBeenCalled();

      mockExit.mockRestore();
    });

    it("should fetch all issues and call bulkIgnoreIssues with default reason AcceptedUse", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: mockIssues,
      } as any);
      vi.mocked(AnalysisService.bulkIgnoreIssues).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignore",
      ]);

      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo", undefined, 100,
        {},
      );
      expect(AnalysisService.bulkIgnoreIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo",
        {
          issueIds: [mockIssues[0].issueId, mockIssues[1].issueId],
          reason: "AcceptedUse",
          comment: undefined,
        },
      );
    });

    it("should show 'No issues found' when API returns empty list", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignore",
      ]);

      expect(AnalysisService.bulkIgnoreIssues).not.toHaveBeenCalled();
      const output = getAllOutput();
      expect(output).toContain("No issues found matching the current filters");
    });

    it("should batch bulkIgnoreIssues calls when there are more than 100 issues", async () => {
      // 150 issues across two pages
      const page1 = Array.from({ length: 100 }, (_, i) => ({
        ...mockIssues[0],
        issueId: `fp-${i}`,
        resultDataId: i,
      }));
      const page2 = Array.from({ length: 50 }, (_, i) => ({
        ...mockIssues[0],
        issueId: `fp-${100 + i}`,
        resultDataId: 100 + i,
      }));

      vi.mocked(AnalysisService.searchRepositoryIssues)
        .mockResolvedValueOnce({
          data: page1,
          pagination: { cursor: "cursor-2", limit: 100, total: 150 },
        } as any)
        .mockResolvedValueOnce({
          data: page2,
          pagination: { cursor: undefined, limit: 100, total: 150 },
        } as any);
      vi.mocked(AnalysisService.bulkIgnoreIssues).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignore",
      ]);

      // Should have made 2 search calls (paginated)
      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledTimes(2);
      // Should have made 2 bulk-ignore calls: one with 100 IDs, one with 50 IDs
      expect(AnalysisService.bulkIgnoreIssues).toHaveBeenCalledTimes(2);
      expect(AnalysisService.bulkIgnoreIssues).toHaveBeenNthCalledWith(
        1, "gh", "test-org", "test-repo",
        expect.objectContaining({ issueIds: expect.arrayContaining([expect.stringMatching(/^fp-/)]) }),
      );
      const firstCallIds: string[] = (AnalysisService.bulkIgnoreIssues as ReturnType<typeof vi.fn>).mock.calls[0][3].issueIds;
      expect(firstCallIds).toHaveLength(100);
      const secondCallIds: string[] = (AnalysisService.bulkIgnoreIssues as ReturnType<typeof vi.fn>).mock.calls[1][3].issueIds;
      expect(secondCallIds).toHaveLength(50);
    });

    it("should forward --ignore-comment to bulkIgnoreIssues", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [mockIssues[0]],
      } as any);
      vi.mocked(AnalysisService.bulkIgnoreIssues).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignore",
        "--ignore-comment", "Verified by security team",
      ]);

      expect(AnalysisService.bulkIgnoreIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo",
        {
          issueIds: [mockIssues[0].issueId],
          reason: "AcceptedUse",
          comment: "Verified by security team",
        },
      );
    });

    it("should combine --ignore with other filters (--branch, --patterns)", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignore",
        "--branch", "develop",
        "--patterns", "sql-injection",
      ]);

      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo", undefined, 100,
        {
          branchName: "develop",
          patternIds: ["sql-injection"],
        },
      );
    });

    it("should pass --ignore-reason to bulkIgnoreIssues", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [mockIssues[0]],
      } as any);
      vi.mocked(AnalysisService.bulkIgnoreIssues).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignore",
        "--ignore-reason", "FalsePositive",
      ]);

      expect(AnalysisService.bulkIgnoreIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo",
        {
          issueIds: [mockIssues[0].issueId],
          reason: "FalsePositive",
          comment: undefined,
        },
      );
    });

    it("should combine --ignore with --false-positives to ignore only FP issues", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [mockIssues[0]],
      } as any);
      vi.mocked(AnalysisService.bulkIgnoreIssues).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignore",
        "--false-positives",
      ]);

      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo", undefined, 100,
        { potentialFalsePositives: true },
      );
      expect(AnalysisService.bulkIgnoreIssues).toHaveBeenCalledWith(
        "gh", "test-org", "test-repo",
        {
          issueIds: [mockIssues[0].issueId],
          reason: "AcceptedUse",
          comment: undefined,
        },
      );
    });

    it("prompts for confirmation (with the count) and ignores when confirmed", async () => {
      vi.spyOn(prompt, "confirmAction").mockResolvedValue(true);
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: mockIssues,
      } as any);
      vi.mocked(AnalysisService.bulkIgnoreIssues).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignore",
      ]);

      expect(prompt.confirmAction).toHaveBeenCalledTimes(1);
      // The prompt must state how many issues will be ignored.
      expect((prompt.confirmAction as any).mock.calls[0][0]).toContain("2");
      expect(AnalysisService.bulkIgnoreIssues).toHaveBeenCalled();
    });

    it("aborts without ignoring when the user declines the confirmation", async () => {
      vi.spyOn(prompt, "confirmAction").mockResolvedValue(false);
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: mockIssues,
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignore",
      ]);

      expect(prompt.confirmAction).toHaveBeenCalledTimes(1);
      expect(AnalysisService.bulkIgnoreIssues).not.toHaveBeenCalled();
      expect(getAllOutput()).toContain("Aborted");
    });

    it("skips the confirmation prompt with --skip-confirmation", async () => {
      vi.spyOn(prompt, "confirmAction").mockResolvedValue(true);
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: mockIssues,
      } as any);
      vi.mocked(AnalysisService.bulkIgnoreIssues).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignore", "--skip-confirmation",
      ]);

      expect(prompt.confirmAction).not.toHaveBeenCalled();
      expect(AnalysisService.bulkIgnoreIssues).toHaveBeenCalled();
    });
  });

  describe("advisory information (vulnerable functions)", () => {
    const mockAdvisoryInformation = {
      advisoryId: "GHSA-xxxx-yyyy-zzzz",
      vulnerableFunctions: ["pkg.Class.method", "pkg.Class.otherMethod"],
      publishedAt: "2024-01-15T00:00:00.000Z",
    };

    it("should show a compact vulnerable functions line on the card when present", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [{ ...mockIssues[0], advisoryInformation: mockAdvisoryInformation }],
      } as any);

      const program = createProgram();
      await program.parseAsync(["node", "test", "issues", "gh", "test-org", "test-repo"]);

      const output = getAllOutput();
      expect(output).toContain(
        "Vulnerable functions: pkg.Class.method, pkg.Class.otherMethod",
      );
    });

    it("should truncate long vulnerable functions lists on the card", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [{
          ...mockIssues[0],
          advisoryInformation: {
            ...mockAdvisoryInformation,
            vulnerableFunctions: ["fn1", "fn2", "fn3", "fn4", "fn5"],
          },
        }],
      } as any);

      const program = createProgram();
      await program.parseAsync(["node", "test", "issues", "gh", "test-org", "test-repo"]);

      const output = getAllOutput();
      expect(output).toContain("Vulnerable functions: fn1, fn2, fn3 (+2 more)");
    });

    it("should not show the vulnerable functions line when absent", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: mockIssues,
      } as any);

      const program = createProgram();
      await program.parseAsync(["node", "test", "issues", "gh", "test-org", "test-repo"]);

      const output = getAllOutput();
      expect(output).not.toContain("Vulnerable functions:");
    });

    it("should include advisoryInformation in JSON output", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [{ ...mockIssues[0], advisoryInformation: mockAdvisoryInformation }],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "--output", "json", "issues", "gh", "test-org", "test-repo",
      ]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('"GHSA-xxxx-yyyy-zzzz"'),
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('"pkg.Class.method"'),
      );
    });
  });

  describe("dependency chains (SCA)", () => {
    it("should show a dependency chain line on the card when present", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [{ ...mockIssues[0], dependencyChains: [["root-app", "lodash", "vulnerable-pkg"]] }],
      } as any);

      const program = createProgram();
      await program.parseAsync(["node", "test", "issues", "gh", "test-org", "test-repo"]);

      const output = getAllOutput();
      expect(output).toContain("Transitive - root-app → lodash → vulnerable-pkg");
    });

    it("should not show a dependency chain line when absent", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: mockIssues,
      } as any);

      const program = createProgram();
      await program.parseAsync(["node", "test", "issues", "gh", "test-org", "test-repo"]);

      const output = getAllOutput();
      expect(output).not.toContain("Transitive -");
      expect(output).not.toContain("Direct -");
    });

    it("should include dependencyChains in JSON output", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [{ ...mockIssues[0], dependencyChains: [["root-app", "lodash", "vulnerable-pkg"]] }],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "--output", "json", "issues", "gh", "test-org", "test-repo",
      ]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('"dependencyChains"'),
      );
    });
  });

  describe("auto-detect from git remote", () => {
    it("should auto-detect repo when no positional args are provided", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: mockIssues,
      } as any);

      const program = createProgram();
      await program.parseAsync(["node", "test", "issues"]);

      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
        "gh",
        "auto-org",
        "auto-repo",
        undefined,
        100,
        {},
      );
    });

    it("should still work with explicit args", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "issues",
        "gl",
        "explicit-org",
        "explicit-repo",
      ]);

      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalledWith(
        "gl",
        "explicit-org",
        "explicit-repo",
        undefined,
        100,
        {},
      );
    });
  });

  describe("--ignored", () => {
    it("lists ignored issues with ignore metadata and comment", async () => {
      vi.mocked(
        AnalysisService.searchRepositoryIgnoredIssues,
      ).mockResolvedValue({
        data: mockIgnoredIssues,
        pagination: undefined,
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignored",
      ]);

      expect(
        AnalysisService.searchRepositoryIgnoredIssues,
      ).toHaveBeenCalledWith("gh", "test-org", "test-repo", undefined, 100, {});
      // The active-issue endpoint must not be touched.
      expect(AnalysisService.searchRepositoryIssues).not.toHaveBeenCalled();

      const output = getAllOutput();
      expect(output).toContain("Ignored Issues");
      expect(output).toContain("Potential SQL injection vulnerability");
      expect(output).toContain("ign-uuid-1");
      expect(output).toContain("Ignored as FalsePositive by Jane Dev");
      expect(output).toContain("2026-06-01");
      expect(output).toContain("Comment: Reviewed, not exploitable");
    });

    it("omits the comment line when an ignored issue has no comment", async () => {
      vi.mocked(
        AnalysisService.searchRepositoryIgnoredIssues,
      ).mockResolvedValue({
        data: [mockIgnoredIssues[1]],
        pagination: undefined,
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignored",
      ]);

      const output = getAllOutput();
      expect(output).toContain("Ignored as AcceptedUse by John Ops");
      expect(output).not.toContain("Comment:");
    });

    it("does not render a dependency chain even if the API sends one on an ignored issue", async () => {
      vi.mocked(
        AnalysisService.searchRepositoryIgnoredIssues,
      ).mockResolvedValue({
        data: [
          {
            ...mockIgnoredIssues[0],
            dependencyChains: [["root-app", "lodash", "vulnerable-pkg"]],
          },
        ],
        pagination: undefined,
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignored",
      ]);

      const output = getAllOutput();
      expect(output).not.toContain("Transitive -");
      expect(output).not.toContain("Direct -");
    });

    it("shows an empty message when there are no ignored issues", async () => {
      vi.mocked(
        AnalysisService.searchRepositoryIgnoredIssues,
      ).mockResolvedValue({ data: [], pagination: undefined } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignored",
      ]);

      expect(getAllOutput()).toContain("No ignored issues found.");
    });

    it("passes filters through to the ignored-issues endpoint", async () => {
      vi.mocked(
        AnalysisService.searchRepositoryIgnoredIssues,
      ).mockResolvedValue({ data: [], pagination: undefined } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignored",
        "--severities", "Critical",
        "--categories", "Security",
      ]);

      expect(
        AnalysisService.searchRepositoryIgnoredIssues,
      ).toHaveBeenCalledWith("gh", "test-org", "test-repo", undefined, 100, {
        levels: ["Error"],
        categories: ["Security"],
      });
    });

    it("allows --false-positives together with --ignored", async () => {
      vi.mocked(
        AnalysisService.searchRepositoryIgnoredIssues,
      ).mockResolvedValue({ data: [], pagination: undefined } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignored", "--false-positives",
      ]);

      expect(
        AnalysisService.searchRepositoryIgnoredIssues,
      ).toHaveBeenCalledWith("gh", "test-org", "test-repo", undefined, 100, {
        potentialFalsePositives: true,
      });
    });

    it("paginates across pages and warns when more remain", async () => {
      vi.mocked(AnalysisService.searchRepositoryIgnoredIssues)
        .mockResolvedValueOnce({
          data: [mockIgnoredIssues[0]],
          pagination: { cursor: "cursor-2", limit: 100, total: 250 },
        } as any)
        .mockResolvedValueOnce({
          data: [mockIgnoredIssues[1]],
          pagination: { cursor: undefined, limit: 100, total: 250 },
        } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignored", "--limit", "200",
      ]);

      expect(
        AnalysisService.searchRepositoryIgnoredIssues,
      ).toHaveBeenCalledTimes(2);
      expect(getAllOutput()).toContain("Ignored Issues");
    });

    it("emits JSON with only the projected fields", async () => {
      vi.mocked(
        AnalysisService.searchRepositoryIgnoredIssues,
      ).mockResolvedValue({
        data: [mockIgnoredIssues[0]],
        pagination: undefined,
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--ignored", "--output", "json",
      ]);

      const output = getAllOutput();
      const parsed = JSON.parse(output);
      expect(parsed.ignoredIssues).toHaveLength(1);
      const item = parsed.ignoredIssues[0];
      expect(item.issueId).toBe("ign-uuid-1");
      expect(item.reason).toBe("FalsePositive");
      expect(item.ignoredByName).toBe("Jane Dev");
      expect(item.ignoredTimestamp).toBe("2026-06-01T10:00:00Z");
      expect(item.patternInfo.category).toBe("Security");
      // Fields not shown in the card must be stripped.
      expect(item.toolInfo).toBeUndefined();
      expect(item.language).toBeUndefined();
    });

    it("errors when --ignored is combined with --overview", async () => {
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "issues", "gh", "test-org", "test-repo",
          "--ignored", "--overview",
        ]),
      ).rejects.toThrow("process.exit called");

      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });

    it("errors when --ignored is combined with --ignore", async () => {
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "issues", "gh", "test-org", "test-repo",
          "--ignored", "--ignore",
        ]),
      ).rejects.toThrow("process.exit called");

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(AnalysisService.bulkIgnoreIssues).not.toHaveBeenCalled();
      mockExit.mockRestore();
    });

    it("default (no --ignored) still uses the active-issues endpoint", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: [],
        pagination: undefined,
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
      ]);

      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalled();
      expect(
        AnalysisService.searchRepositoryIgnoredIssues,
      ).not.toHaveBeenCalled();
    });
  });

  describe("with a repository token", () => {
    function expectRefusal(argv: string[]) {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const program = createProgram();
      return expect(
        program.parseAsync([
          "node", "test", "issues", "gh", "test-org", "test-repo",
          ...argv, "--repository-token", "rt",
        ]),
      ).rejects.toThrow("process.exit called");
    }

    it("lists issues — searchRepositoryIssues accepts a repository token", async () => {
      vi.mocked(AnalysisService.searchRepositoryIssues).mockResolvedValue({
        data: mockIssues as any,
        pagination: undefined,
      });

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--repository-token", "rt",
      ]);

      expect(AnalysisService.searchRepositoryIssues).toHaveBeenCalled();
    });

    it("shows the overview — issuesOverview accepts a repository token", async () => {
      vi.mocked(AnalysisService.issuesOverview).mockResolvedValue(
        mockOverview as any,
      );

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "issues", "gh", "test-org", "test-repo",
        "--overview", "--repository-token", "rt",
      ]);

      expect(AnalysisService.issuesOverview).toHaveBeenCalled();
    });

    it("refuses --ignored without querying the ignored-issues endpoint", async () => {
      await expectRefusal(["--ignored"]);

      expect(
        AnalysisService.searchRepositoryIgnoredIssues,
      ).not.toHaveBeenCalled();
    });

    it("refuses --ignore before fetching anything to ignore", async () => {
      await expectRefusal(["--ignore", "-y"]);

      // The refusal must land before the fetch-all sweep, not just before the
      // bulk call — otherwise a repository token pages the whole issue list
      // only to be rejected at the end.
      expect(AnalysisService.searchRepositoryIssues).not.toHaveBeenCalled();
      expect(AnalysisService.bulkIgnoreIssues).not.toHaveBeenCalled();
    });
  });
});
