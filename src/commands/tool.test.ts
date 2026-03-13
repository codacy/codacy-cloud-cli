import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerToolCommand } from "./tool";
import { AnalysisService } from "../api/client/services/AnalysisService";

vi.mock("../api/client/services/AnalysisService");
vi.mock("../utils/credentials", () => ({ loadCredentials: vi.fn(() => null) }));
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

function createProgram(): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  registerToolCommand(program);
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
  {
    uuid: "uuid-eslint-deprecated",
    name: "ESLint (deprecated)",
    isClientSide: false,
    settings: {
      isEnabled: false,
      followsStandard: false,
      isCustom: false,
      hasConfigurationFile: false,
      usesConfigurationFile: false,
      enabledBy: [],
    },
  },
];

function getAllOutput(): string {
  return (console.log as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0])
    .join("\n");
}

describe("tool command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
    vi.mocked(AnalysisService.listRepositoryTools).mockResolvedValue({
      data: mockTools,
      pagination: undefined,
    } as any);
    vi.mocked(AnalysisService.configureTool).mockResolvedValue(undefined as any);
  });

  it("should enable a tool", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "tool",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
      "--enable",
    ]);

    expect(AnalysisService.configureTool).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "uuid-eslint",
      { enabled: true },
    );

    const output = getAllOutput();
    expect(output).toContain("enabled");
  });

  it("should disable a tool", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "tool",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
      "--disable",
    ]);

    expect(AnalysisService.configureTool).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "uuid-eslint",
      { enabled: false },
    );

    const output = getAllOutput();
    expect(output).toContain("disabled");
  });

  it("should set configuration file to true", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "tool",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
      "--configuration-file",
      "true",
    ]);

    expect(AnalysisService.configureTool).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "uuid-eslint",
      { useConfigurationFile: true },
    );

    const output = getAllOutput();
    expect(output).toContain("now uses");
  });

  it("should set configuration file to false", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "tool",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
      "--configuration-file",
      "false",
    ]);

    expect(AnalysisService.configureTool).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "uuid-eslint",
      { useConfigurationFile: false },
    );

    const output = getAllOutput();
    expect(output).toContain("no longer uses");
  });

  it("should enable and set configuration file in one command", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "tool",
      "gh",
      "test-org",
      "test-repo",
      "eslint",
      "--enable",
      "--configuration-file",
      "true",
    ]);

    expect(AnalysisService.configureTool).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "uuid-eslint",
      { enabled: true, useConfigurationFile: true },
    );
  });

  it("should match tool by hyphenated name (eslint-(deprecated))", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "tool",
      "gh",
      "test-org",
      "test-repo",
      "eslint-(deprecated)",
      "--enable",
    ]);

    expect(AnalysisService.configureTool).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
      "uuid-eslint-deprecated",
      expect.any(Object),
    );
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
        "tool",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
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
        "tool",
        "gh",
        "test-org",
        "test-repo",
        "nonexistent-tool",
        "--enable",
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
        "tool",
        "gh",
        "test-org",
        "test-repo",
        "eslint",
        "--enable",
      ]),
    ).rejects.toThrow("process.exit called");

    mockExit.mockRestore();
  });
});
