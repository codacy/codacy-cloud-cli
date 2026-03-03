import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerPatternsCommand } from "./patterns";
import { AnalysisService } from "../api/client/services/AnalysisService";

vi.mock("../api/client/services/AnalysisService");
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
    );
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
});
