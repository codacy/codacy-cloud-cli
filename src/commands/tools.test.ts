import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerToolsCommand } from "./tools";
import * as fs from "fs";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { ToolsService } from "../api/client/services/ToolsService";
import { CodingStandardsService } from "../api/client/services/CodingStandardsService";
import * as importConfig from "../utils/import-config";
import * as prompt from "../utils/prompt";

vi.mock("../api/client/services/AnalysisService");
vi.mock("../api/client/services/CodingStandardsService");
vi.mock("../api/client/services/ToolsService");
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

  // ─── Import mode ──────────────────────────────────────────────────────

  describe("--import", () => {
    const configContent = JSON.stringify({
      version: 1,
      metadata: {
        repositoryId: null,
        repositoryName: null,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
        languages: ["TypeScript"],
      },
      tools: [
        {
          toolId: "ESLint",
          patterns: [{ patternId: "no-unused-vars" }],
        },
      ],
    });

    const tmpConfigPath = "/tmp/test-import-config.json";

    beforeEach(() => {
      fs.writeFileSync(tmpConfigPath, configContent);
      vi.mocked(AnalysisService.updateRepositoryToolPatterns).mockResolvedValue(undefined as any);
      vi.mocked(AnalysisService.configureTool).mockResolvedValue(undefined as any);
      vi.spyOn(importConfig, "fetchAllTools").mockResolvedValue([
        {
          uuid: "uuid-eslint",
          name: "ESLint",
          shortName: "eslint",
          prefix: "ESLint_",
          version: "1.0",
          needsCompilation: false,
          configurationFilenames: [],
          dockerImage: "docker/eslint",
          languages: ["TypeScript"],
          clientSide: false,
          standalone: false,
          enabledByDefault: false,
          configurable: true,
        },
      ] as any);
      vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
        data: {
          repository: {
            provider: "gh",
            owner: "test-org",
            name: "test-repo",
            standards: [],
            languages: [],
            problems: [],
          },
        },
      } as any);
    });

    afterEach(() => {
      if (fs.existsSync(tmpConfigPath)) fs.unlinkSync(tmpConfigPath);
    });

    it("should import config with --skip-approval", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "tools", "gh", "test-org", "test-repo",
        "--import", tmpConfigPath, "-y",
      ]);

      const output = getAllOutput();
      expect(output).toContain("imported successfully");
    });

    it("should cancel import when user declines confirmation", async () => {
      vi.spyOn(prompt, "confirmAction").mockResolvedValue(false);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "tools", "gh", "test-org", "test-repo",
        "--import", tmpConfigPath,
      ]);

      const output = getAllOutput();
      expect(output).toContain("cancelled");
      expect(AnalysisService.configureTool).not.toHaveBeenCalled();
    });

    it("should warn about coding standards", async () => {
      vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
        data: {
          repository: {
            provider: "gh",
            owner: "test-org",
            name: "test-repo",
            standards: [{ id: 1, name: "Security" }],
            languages: [],
            problems: [],
          },
        },
      } as any);

      vi.spyOn(prompt, "confirmAction").mockResolvedValue(false);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "tools", "gh", "test-org", "test-repo",
        "--import", tmpConfigPath,
      ]);

      const output = getAllOutput();
      expect(output).toContain("Security");
      expect(output).toContain("coding standard");
    });

    it("should unlink coding standards with --force", async () => {
      vi.mocked(CodingStandardsService.applyCodingStandardToRepositories).mockResolvedValue({} as any);
      vi.mocked(AnalysisService.getRepositoryWithAnalysis).mockResolvedValue({
        data: {
          repository: {
            provider: "gh",
            owner: "test-org",
            name: "test-repo",
            standards: [
              { id: 100, name: "Security" },
              { id: 200, name: "OWASP10" },
            ],
            languages: [],
            problems: [],
          },
        },
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "tools", "gh", "test-org", "test-repo",
        "--import", tmpConfigPath, "--force", "-y",
      ]);

      // Should unlink both standards
      expect(CodingStandardsService.applyCodingStandardToRepositories).toHaveBeenCalledWith(
        "gh", "test-org", 100, { link: [], unlink: ["test-repo"] },
      );
      expect(CodingStandardsService.applyCodingStandardToRepositories).toHaveBeenCalledWith(
        "gh", "test-org", 200, { link: [], unlink: ["test-repo"] },
      );

      const output = getAllOutput();
      expect(output).toContain("will stop following");
      expect(output).toContain("Security");
      expect(output).toContain("OWASP10");
      expect(output).toContain("imported successfully");
    });

    it("should report errors for failing tools", async () => {
      vi.mocked(AnalysisService.configureTool).mockRejectedValue(
        new Error("Conflict"),
      );

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "tools", "gh", "test-org", "test-repo",
        "--import", tmpConfigPath, "-y",
      ]);

      const output = getAllOutput();
      expect(output).toContain("error");
    });
  });
});
