import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerPatternCommand } from "./pattern";
import { AnalysisService } from "../api/client/services/AnalysisService";

vi.mock("../api/client/services/AnalysisService");
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

function createProgram(): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  registerPatternCommand(program);
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

const mockConfiguredPattern = {
  patternDefinition: {
    id: "no-unused-vars",
    title: "No Unused Variables",
    category: "ErrorProne",
    severityLevel: "Warning",
    enabled: true,
  },
  enabled: false, // currently disabled
  parameters: [],
};

function getAllOutput(): string {
  return (console.log as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0])
    .join("\n");
}

describe("pattern command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
    vi.mocked(AnalysisService.listRepositoryTools).mockResolvedValue({
      data: mockTools,
      pagination: undefined,
    } as any);
    vi.mocked(AnalysisService.listRepositoryToolPatterns).mockResolvedValue({
      data: [mockConfiguredPattern],
      pagination: undefined,
    } as any);
    vi.mocked(AnalysisService.configureTool).mockResolvedValue(undefined as any);
  });

  it("should enable a pattern", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pattern",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
      "no-unused-vars",
      "--enable",
    ]);

    expect(AnalysisService.configureTool).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "uuid-eslint",
      {
        patterns: [
          {
            id: "no-unused-vars",
            enabled: true,
          },
        ],
      },
    );

    // Should NOT fetch patterns when enable is specified
    expect(AnalysisService.listRepositoryToolPatterns).not.toHaveBeenCalled();

    const output = getAllOutput();
    expect(output).toContain("enabled");
    expect(output).toContain("no-unused-vars");
  });

  it("should disable a pattern", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pattern",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
      "no-unused-vars",
      "--disable",
    ]);

    expect(AnalysisService.configureTool).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "uuid-eslint",
      {
        patterns: [
          {
            id: "no-unused-vars",
            enabled: false,
          },
        ],
      },
    );

    const output = getAllOutput();
    expect(output).toContain("disabled");
  });

  it("should set parameters (fetches current enabled state)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pattern",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
      "no-unused-vars",
      "--parameter",
      "max=3",
    ]);

    // Should fetch patterns to determine current enabled state
    expect(AnalysisService.listRepositoryToolPatterns).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "uuid-eslint",
      undefined,
      undefined,
      undefined,
      undefined,
      "no-unused-vars",
    );

    expect(AnalysisService.configureTool).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "uuid-eslint",
      {
        patterns: [
          {
            id: "no-unused-vars",
            enabled: false, // current state from mock (disabled)
            parameters: [{ name: "max", value: "3" }],
          },
        ],
      },
    );

    const output = getAllOutput();
    expect(output).toContain("max");
    expect(output).toContain("3");
  });

  it("should enable a pattern and set parameters in one command", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "pattern",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
      "no-unused-vars",
      "--enable",
      "--parameter",
      "max=5",
      "--parameter",
      "min=1",
    ]);

    expect(AnalysisService.configureTool).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "uuid-eslint",
      {
        patterns: [
          {
            id: "no-unused-vars",
            enabled: true,
            parameters: [
              { name: "max", value: "5" },
              { name: "min", value: "1" },
            ],
          },
        ],
      },
    );

    // Should NOT fetch patterns when enable is specified
    expect(AnalysisService.listRepositoryToolPatterns).not.toHaveBeenCalled();
  });

  it("should exit with error when no option is specified", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "test",
        "pattern",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
        "no-unused-vars",
      ]),
    ).rejects.toThrow("process.exit called");

    expect(AnalysisService.configureTool).not.toHaveBeenCalled();
    mockExit.mockRestore();
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
        "pattern",
        "gh",
        "test-org",
        "test-repo",
        "nonexistent-tool",
        "some-pattern",
        "--enable",
      ]),
    ).rejects.toThrow("process.exit called");

    expect(AnalysisService.configureTool).not.toHaveBeenCalled();
    mockExit.mockRestore();
  });

  it("should exit with error when pattern is not found (parameters-only mode)", async () => {
    vi.mocked(AnalysisService.listRepositoryToolPatterns).mockResolvedValue({
      data: [],
      pagination: undefined,
    } as any);

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "test",
        "pattern",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
        "nonexistent-pattern",
        "--parameter",
        "max=3",
      ]),
    ).rejects.toThrow("process.exit called");

    expect(AnalysisService.configureTool).not.toHaveBeenCalled();
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
        "pattern",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
        "no-unused-vars",
        "--enable",
      ]),
    ).rejects.toThrow("process.exit called");

    mockExit.mockRestore();
  });
});
