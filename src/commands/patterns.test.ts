import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerPatternsCommand } from "./patterns";
import { AnalysisService } from "../api/client/services/AnalysisService";

vi.mock("../api/client/services/AnalysisService");
vi.mock("../utils/credentials", () => ({ loadCredentials: vi.fn(() => null) }));
vi.mock("../utils/git-remote", () => ({
  detectRepoContext: vi.fn(() => ({
    provider: "gh",
    organization: "auto-org",
    repository: "auto-repo",
  })),
}));
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

function createProgram(): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  registerPatternsCommand(program);
  return program;
}

const mockTools = [
  {
    uuid: "uuid-eslint",
    name: "ESLint",
    isClientSide: false,
    settings: {
      isEnabled: true,
      followsStandard: false,
      isCustom: false,
      hasConfigurationFile: false,
      usesConfigurationFile: false,
      enabledBy: [],
    },
  },
];

// A tool whose patterns are driven by a local configuration file.
const mockConfigFileTools = [
  {
    uuid: "uuid-eslint",
    name: "ESLint",
    isClientSide: false,
    settings: {
      isEnabled: true,
      followsStandard: false,
      isCustom: false,
      hasConfigurationFile: true,
      usesConfigurationFile: true,
      enabledBy: [],
    },
  },
];

const mockPatterns = [
  {
    patternDefinition: {
      id: "no-unused-vars",
      title: "No Unused Variables",
      category: "ErrorProne",
      subCategory: "UnusedCode",
      severityLevel: "Warning",
      enabled: true,
      languages: ["JavaScript", "TypeScript"],
      tags: ["best-practices"],
      description: "Disallows unused variables.",
      rationale: "Unused variables clutter the code.",
      solution: "Remove unused variables.",
    },
    enabled: true,
    isCustom: false,
    parameters: [],
    enabledBy: [],
  },
  {
    patternDefinition: {
      id: "no-eval",
      title: "No Eval",
      category: "Security",
      subCategory: undefined,
      severityLevel: "Error",
      enabled: false,
      languages: ["JavaScript"],
      tags: ["security"],
      description: "Disallows eval().",
      rationale: undefined,
      solution: undefined,
    },
    enabled: false,
    isCustom: false,
    parameters: [],
    enabledBy: [],
  },
  {
    patternDefinition: {
      id: "max-len",
      title: "Maximum Line Length",
      category: "CodeStyle",
      subCategory: undefined,
      severityLevel: "Info",
      enabled: false,
      languages: undefined,
      tags: undefined,
      description: "Enforces maximum line length.",
      rationale: undefined,
      solution: undefined,
    },
    enabled: true,
    isCustom: false,
    parameters: [{ name: "max", value: "120" }],
    enabledBy: [],
  },
  {
    patternDefinition: {
      id: "no-hardcoded-credentials",
      title: "No Hardcoded Credentials",
      category: "Security",
      subCategory: undefined,
      severityLevel: "Error",
      enabled: true,
      languages: ["JavaScript", "TypeScript"],
      tags: ["security"],
      description: "Disallows hardcoded credentials.",
      rationale: undefined,
      solution: undefined,
    },
    enabled: true,
    isCustom: false,
    parameters: [],
    enabledBy: [
      { id: 1, name: "OWASP Top 10" },
      { id: 2, name: "SOC 2" },
    ],
  },
];

function getAllOutput(): string {
  return (console.log as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0])
    .join("\n");
}

describe("patterns command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
    vi.mocked(AnalysisService.listRepositoryTools).mockResolvedValue({
      data: mockTools,
      pagination: undefined,
    } as any);
    vi.mocked(AnalysisService.listRepositoryToolPatterns).mockResolvedValue({
      data: mockPatterns,
      pagination: undefined,
    } as any);
  });

  it("should list patterns in card format", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "patterns",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
    ]);

    expect(AnalysisService.listRepositoryTools).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
    );
    expect(AnalysisService.listRepositoryToolPatterns).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "uuid-eslint",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    const output = getAllOutput();
    expect(output).toContain("No Unused Variables");
    expect(output).toContain("no-unused-vars");
    expect(output).toContain("No Eval");
    expect(output).toContain("Maximum Line Length");
  });

  it("should sort patterns by severity (Error > Warning > Info)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "patterns",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
    ]);

    const output = getAllOutput();
    const errorIdx = output.indexOf("No Eval"); // Error severity
    const warningIdx = output.indexOf("No Unused Variables"); // Warning severity
    const infoIdx = output.indexOf("Maximum Line Length"); // Info severity
    expect(errorIdx).toBeLessThan(warningIdx);
    expect(warningIdx).toBeLessThan(infoIdx);
  });

  it("should show description when present", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "patterns",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Disallows unused variables.");
    expect(output).toContain("Disallows eval().");
  });

  it("should show rationale when present", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "patterns",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Unused variables clutter the code.");
  });

  it("should show parameters for enabled patterns", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "patterns",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
    ]);

    const output = getAllOutput();
    expect(output).toContain("max = 120");
  });

  it("should pass filter options to the API", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "patterns",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
      "--severities",
      "Critical,High",
      "--categories",
      "Security",
      "--search",
      "sql injection",
      "--enabled",
    ]);

    expect(AnalysisService.listRepositoryToolPatterns).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "uuid-eslint",
      undefined,
      "Security",
      "Error,High",
      undefined,
      "sql injection",
      true,
      undefined,
      undefined,
    );
  });

  it("should normalize category names case-insensitively", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "patterns",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
      "--categories",
      "security,code style,error-prone",
    ]);

    expect(AnalysisService.listRepositoryToolPatterns).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "uuid-eslint",
      undefined,
      "Security,CodeStyle,ErrorProne",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it("should pass --recommended filter to the API", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "patterns",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
      "--recommended",
    ]);

    expect(AnalysisService.listRepositoryToolPatterns).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "uuid-eslint",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      undefined,
    );
  });

  // `--matches-stack [value]` is a tri-state: the bare flag and an explicit
  // `true` both opt in, `false` opts out, and omitting it sends nothing.
  describe("--matches-stack", () => {
    const expectMatchesStack = (value: boolean | undefined) =>
      expect(AnalysisService.listRepositoryToolPatterns).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "uuid-eslint",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        value,
      );

    const run = async (...extraArgs: string[]) => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "patterns",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
        ...extraArgs,
      ]);
    };

    it("sends matchesStack=true for the bare flag", async () => {
      await run("--matches-stack");
      expectMatchesStack(true);
    });

    it("sends matchesStack=true for --matches-stack true", async () => {
      await run("--matches-stack", "true");
      expectMatchesStack(true);
    });

    it("sends matchesStack=false for --matches-stack false", async () => {
      await run("--matches-stack", "false");
      expectMatchesStack(false);
    });

    it("sends nothing when the flag is omitted", async () => {
      await run();
      expectMatchesStack(undefined);
    });

    it("accepts the -k short flag", async () => {
      await run("-k", "false");
      expectMatchesStack(false);
    });
  });

  it("should show ☑️ icon for patterns enforced by a coding standard", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "patterns",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
    ]);

    const output = getAllOutput();
    expect(output).toContain("☑️");
    expect(output).toContain("No Hardcoded Credentials");
  });

  it("should show 'Enforced by' line with coding standard names", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "patterns",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Enforced by: OWASP Top 10, SOC 2");
  });

  it("should show ✅ icon for enabled patterns not enforced by a standard", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "patterns",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
    ]);

    const output = getAllOutput();
    const lines = output.split("\n");
    const unusedVarsLine = lines.find((l: string) =>
      l.includes("No Unused Variables"),
    );
    expect(unusedVarsLine).toContain("✅");
  });

  it("should not show 'Enforced by' for patterns with empty enabledBy", async () => {
    vi.mocked(AnalysisService.listRepositoryToolPatterns).mockResolvedValue({
      data: [mockPatterns[0]],
      pagination: undefined,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "patterns",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
    ]);

    const output = getAllOutput();
    expect(output).not.toContain("Enforced by:");
  });

  it("should include enabledBy in JSON output", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "--output",
      "json",
      "patterns",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
    ]);

    const output = getAllOutput();
    const parsed = JSON.parse(output);
    const enforced = parsed.find(
      (p: any) => p.patternDefinition.id === "no-hardcoded-credentials",
    );
    expect(enforced.enabledBy).toEqual([
      { id: 1, name: "OWASP Top 10" },
      { id: 2, name: "SOC 2" },
    ]);
  });

  it("should show 'No patterns found' when result is empty", async () => {
    vi.mocked(AnalysisService.listRepositoryToolPatterns).mockResolvedValue({
      data: [],
      pagination: undefined,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "patterns",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
    ]);

    const output = getAllOutput();
    expect(output).toContain("No patterns found");
  });

  it("should output JSON when --output json is specified", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "--output",
      "json",
      "patterns",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
    ]);

    const output = getAllOutput();
    expect(output).toContain('"no-unused-vars"');
    expect(output).toContain('"No Unused Variables"');
  });

  it("should exit with error when tool is not found", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "test",
        "patterns",
        "gh",
        "test-org",
        "test-repo",
        "nonexistent-tool",
      ]),
    ).rejects.toThrow("process.exit called");

    expect(AnalysisService.listRepositoryToolPatterns).not.toHaveBeenCalled();
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
        "patterns",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
      ]),
    ).rejects.toThrow("process.exit called");

    mockExit.mockRestore();
  });

  describe("--enable-all / --disable-all", () => {
    const mockOverview = {
      data: {
        counts: {
          totalEnabled: 120,
          totalRecommended: 80,
          categories: [
            { name: "Security", total: 50 },
            { name: "ErrorProne", total: 100 },
            { name: "CodeStyle", total: 50 },
          ],
          severities: [],
          languages: [],
          tags: [],
        },
      },
    };

    beforeEach(() => {
      vi.mocked(
        AnalysisService.updateRepositoryToolPatterns,
      ).mockResolvedValue(undefined as any);
      vi.mocked(AnalysisService.toolPatternsOverview).mockResolvedValue(
        mockOverview as any,
      );
    });

    it("should call updateRepositoryToolPatterns with enabled=true for --enable-all", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "patterns",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
        "--enable-all",
      ]);

      expect(
        AnalysisService.updateRepositoryToolPatterns,
      ).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "uuid-eslint",
        { enabled: true },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      expect(AnalysisService.toolPatternsOverview).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "uuid-eslint",
      );
      expect(AnalysisService.listRepositoryToolPatterns).not.toHaveBeenCalled();
    });

    it("should call updateRepositoryToolPatterns with enabled=false for --disable-all", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "patterns",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
        "--disable-all",
      ]);

      expect(
        AnalysisService.updateRepositoryToolPatterns,
      ).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "uuid-eslint",
        { enabled: false },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it("should pass filters to updateRepositoryToolPatterns", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "patterns",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
        "--enable-all",
        "--categories",
        "Security",
        "--severities",
        "Critical,High",
        "--languages",
        "JavaScript",
        "--tags",
        "security",
        "--search",
        "injection",
        "--recommended",
      ]);

      expect(
        AnalysisService.updateRepositoryToolPatterns,
      ).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "uuid-eslint",
        { enabled: true },
        "JavaScript",
        "Security",
        "Error,High",
        "security",
        "injection",
        true,
        undefined,
      );
    });

    // `matchesStack` is the 12th positional argument of
    // updateRepositoryToolPatterns, so the bulk path filters on the stack too.
    it("should pass --matches-stack to updateRepositoryToolPatterns", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "patterns",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
        "--enable-all",
        "--matches-stack",
        "false",
      ]);

      expect(
        AnalysisService.updateRepositoryToolPatterns,
      ).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "uuid-eslint",
        { enabled: true },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
      );
    });

    it("should not scope the post-update overview to --matches-stack", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "patterns",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
        "--disable-all",
        "--matches-stack",
      ]);

      // The summary counts ("N/M patterns now enabled") describe the whole
      // tool, so the overview call deliberately carries no filters.
      expect(AnalysisService.toolPatternsOverview).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "uuid-eslint",
      );
    });

    it("should fetch overview after bulk update for summary counts", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "patterns",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
        "--enable-all",
      ]);

      expect(AnalysisService.toolPatternsOverview).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "test-repo",
        "uuid-eslint",
      );
    });

    it("should fail when both --enable-all and --disable-all are specified", async () => {
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node",
          "test",
          "patterns",
          "gh",
          "test-org",
          "test-repo",
          "eslint",
          "--enable-all",
          "--disable-all",
        ]),
      ).rejects.toThrow("process.exit called");

      expect(
        AnalysisService.updateRepositoryToolPatterns,
      ).not.toHaveBeenCalled();
      mockExit.mockRestore();
    });

    it("should not pass --enabled/--disabled filter to bulk update", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "patterns",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
        "--enable-all",
        "--enabled",
      ]);

      const call = vi.mocked(AnalysisService.updateRepositoryToolPatterns).mock
        .calls[0];
      expect(call[4]).toEqual({ enabled: true });
      // The enabled filter should not be passed to bulk update
      // updateRepositoryToolPatterns has no enabled query param
      expect(call).toHaveLength(12);
    });
  });

  describe("configuration file guard", () => {
    beforeEach(() => {
      vi.mocked(AnalysisService.listRepositoryTools).mockResolvedValue({
        data: mockConfigFileTools,
        pagination: undefined,
      } as any);
    });

    it("shows a notice and skips fetching patterns in list mode", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "patterns",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
      ]);

      const output = getAllOutput();
      expect(output).toContain("ESLint is using a local configuration file.");
      expect(AnalysisService.listRepositoryToolPatterns).not.toHaveBeenCalled();
    });

    it("emits a JSON marker in list mode with --output json", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "--output",
        "json",
        "patterns",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
      ]);

      const parsed = JSON.parse(getAllOutput());
      expect(parsed.usesConfigurationFile).toBe(true);
      expect(parsed.tool).toBe("ESLint");
      expect(AnalysisService.listRepositoryToolPatterns).not.toHaveBeenCalled();
    });

    it("refuses bulk update and exits 1", async () => {
      vi.mocked(
        AnalysisService.updateRepositoryToolPatterns,
      ).mockResolvedValue(undefined as any);

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node",
          "test",
          "patterns",
          "gh",
          "test-org",
          "test-repo",
          "eslint",
          "--disable-all",
        ]),
      ).rejects.toThrow("process.exit called");

      expect(
        AnalysisService.updateRepositoryToolPatterns,
      ).not.toHaveBeenCalled();
      mockExit.mockRestore();
    });
  });

  describe("auto-detect from git remote", () => {
    it("should auto-detect provider/org/repo when only toolName is provided", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "test", "patterns", "eslint"]);

      expect(AnalysisService.listRepositoryTools).toHaveBeenCalledWith(
        "gh",
        "auto-org",
        "auto-repo",
      );
      expect(AnalysisService.listRepositoryToolPatterns).toHaveBeenCalledWith(
        "gh",
        "auto-org",
        "auto-repo",
        "uuid-eslint",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });
  });

  // Every endpoint this command uses is on the repository-token whitelist
  // (listRepositoryTools, listRepositoryToolPatterns, updateRepositoryToolPatterns,
  // toolPatternsOverview), so no guard is needed and no account token either.
  it("lists patterns with only a repository token", async () => {
    delete process.env.CODACY_API_TOKEN;

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "patterns", "gh", "test-org", "test-repo", "eslint",
      "--repository-token", "rt",
    ]);

    expect(AnalysisService.listRepositoryTools).toHaveBeenCalled();
    expect(AnalysisService.listRepositoryToolPatterns).toHaveBeenCalled();
  });
});
