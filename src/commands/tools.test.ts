import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerToolsCommand } from "./tools";
import { AnalysisService } from "../api/client/services/AnalysisService";

vi.mock("../api/client/services/AnalysisService");
vi.mock("../utils/credentials", () => ({ loadCredentials: vi.fn(() => null) }));
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

function createProgram(): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  registerToolsCommand(program);
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
      hasConfigurationFile: true,
      usesConfigurationFile: true,
      enabledBy: [{ name: "OWASP Top 10" }],
    },
  },
  {
    uuid: "uuid-semgrep",
    name: "Semgrep",
    isClientSide: false,
    settings: {
      isEnabled: true,
      followsStandard: false,
      isCustom: false,
      hasConfigurationFile: false,
      usesConfigurationFile: false,
      enabledBy: [{ name: "OWASP Top 10" }],
    },
  },
  {
    uuid: "uuid-trivy",
    name: "Trivy",
    isClientSide: true,
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

describe("tools command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
    vi.mocked(AnalysisService.listRepositoryTools).mockResolvedValue({
      data: mockTools,
      pagination: undefined,
    } as any);
  });

  it("should list enabled and disabled tool groups", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "tools",
      "gh",
      "test-org",
      "test-repo",
    ]);

    expect(AnalysisService.listRepositoryTools).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "test-repo",
    );

    const output = getAllOutput();
    expect(output).toContain("Enabled tools");
    expect(output).toContain("Disabled tools");
    expect(output).toContain("ESLint");
    expect(output).toContain("Semgrep");
    expect(output).toContain("Trivy");
  });

  it("should show config file status correctly", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "tools",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    // ESLint uses a config file → Applied
    expect(output).toContain("Applied");
    // ESLint uses a config file → Applied; Semgrep has no config file → "—" (dim dash)
    expect(output).not.toContain("Not Available");
  });

  it("should show coding standards in Via Standard column", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "tools",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain("OWASP Top 10");
  });

  it("should show client-side note for client-side tools", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "tools",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Client-side tool");
  });

  it("should output JSON when --output json is specified", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "--output",
      "json",
      "tools",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain('"ESLint"');
    expect(output).toContain('"uuid-eslint"');
  });

  it("should show 'Overwritten by file' in Via Standard when config file is applied", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "tools",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    // ESLint uses a config file → Via Standard shows "Overwritten by file"
    expect(output).toContain("Overwritten by file");
  });

  it("should show 'Available' for tool with config file not applied", async () => {
    vi.mocked(AnalysisService.listRepositoryTools).mockResolvedValue({
      data: [
        {
          uuid: "uuid-pylint",
          name: "Pylint",
          isClientSide: false,
          settings: {
            isEnabled: true,
            followsStandard: false,
            isCustom: false,
            hasConfigurationFile: true,
            usesConfigurationFile: false,
            enabledBy: [],
          },
        },
      ],
      pagination: undefined,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "tools",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Available");
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
        "tools",
        "gh",
        "test-org",
        "test-repo",
      ]),
    ).rejects.toThrow("process.exit called");

    mockExit.mockRestore();
  });
});
