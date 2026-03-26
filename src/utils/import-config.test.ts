import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import {
  readConfigFile,
  resolveToolId,
  buildImportPreview,
  executeImport,
} from "./import-config";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { CodingStandardsService } from "../api/client/services/CodingStandardsService";
import { Tool } from "../api/client/models/Tool";
import { AnalysisTool } from "../api/client/models/AnalysisTool";
import { CodacyConfig } from "../types/codacy-config";

vi.mock("../api/client/services/AnalysisService");
vi.mock("../api/client/services/ToolsService");
vi.mock("../api/client/services/CodingStandardsService");

// ─── Test fixtures ────────────────────────────────────────────────────

function makeTool(overrides: Partial<Tool> & { uuid: string; name: string; shortName: string }): Tool {
  return {
    version: "1.0",
    documentationUrl: "",
    sourceCodeUrl: "",
    needsCompilation: false,
    configurationFilenames: [],
    dockerImage: "docker/image",
    languages: ["TypeScript"],
    clientSide: false,
    standalone: false,
    enabledByDefault: false,
    configurable: true,
    ...overrides,
  } as Tool;
}

function makeRepoTool(uuid: string, name: string, isEnabled: boolean): AnalysisTool {
  return {
    uuid,
    name,
    isClientSide: false,
    settings: {
      isEnabled,
      enabledBy: [],
      hasConfigurationFile: false,
      usesConfigurationFile: false,
    },
  } as AnalysisTool;
}

const eslintTool = makeTool({ uuid: "uuid-eslint", name: "ESLint", shortName: "eslint", prefix: "ESLint_" });
const pylintTool = makeTool({ uuid: "uuid-pylint", name: "Pylint", shortName: "pylint", prefix: "Pylint_" });
const checkovTool = makeTool({ uuid: "uuid-checkov", name: "Checkov", shortName: "checkov" });
const remarklintTool = makeTool({ uuid: "uuid-remarklint", name: "Remarklint", shortName: "remarklint", prefix: "remarklint_" });

const allTools: Tool[] = [eslintTool, pylintTool, checkovTool, remarklintTool];

// ─── readConfigFile ───────────────────────────────────────────────────

describe("readConfigFile", () => {
  it("should parse a valid config file", () => {
    const config: CodacyConfig = {
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
    };
    const tmpPath = "/tmp/test-codacy-config.json";
    fs.writeFileSync(tmpPath, JSON.stringify(config));
    const result = readConfigFile(tmpPath);
    expect(result.version).toBe(1);
    expect(result.tools).toHaveLength(1);
    fs.unlinkSync(tmpPath);
  });

  it("should throw for missing file", () => {
    expect(() => readConfigFile("/tmp/nonexistent.json")).toThrow("not found");
  });

  it("should throw for invalid JSON", () => {
    const tmpPath = "/tmp/test-invalid.json";
    fs.writeFileSync(tmpPath, "not json {{{");
    expect(() => readConfigFile(tmpPath)).toThrow("Invalid JSON");
    fs.unlinkSync(tmpPath);
  });

  it("should throw for missing required fields", () => {
    const tmpPath = "/tmp/test-missing-fields.json";
    fs.writeFileSync(tmpPath, JSON.stringify({ foo: "bar" }));
    expect(() => readConfigFile(tmpPath)).toThrow("missing");
    fs.unlinkSync(tmpPath);
  });
});

// ─── resolveToolId ────────────────────────────────────────────────────

describe("resolveToolId", () => {
  it("should match by prefix without trailing underscore (case-insensitive)", () => {
    const result = resolveToolId("ESLint", allTools);
    expect(result?.uuid).toBe("uuid-eslint");
  });

  it("should match by prefix case-insensitively", () => {
    const result = resolveToolId("eslint", allTools);
    expect(result?.uuid).toBe("uuid-eslint");
  });

  it("should fall back to shortName when prefix doesn't match", () => {
    const result = resolveToolId("checkov", allTools);
    expect(result?.uuid).toBe("uuid-checkov");
  });

  it("should prefer prefix over shortName", () => {
    // remarklint has both prefix "remarklint_" and shortName "remarklint"
    const result = resolveToolId("remarklint", allTools);
    expect(result?.uuid).toBe("uuid-remarklint");
  });

  it("should return undefined for unresolvable tool", () => {
    const result = resolveToolId("nonexistent", allTools);
    expect(result).toBeUndefined();
  });
});

// ─── buildImportPreview ───────────────────────────────────────────────

describe("buildImportPreview", () => {
  it("should categorize tools correctly", () => {
    const repoTools: AnalysisTool[] = [
      makeRepoTool("uuid-eslint", "ESLint", true),
      makeRepoTool("uuid-checkov", "Checkov", true),
      makeRepoTool("uuid-pylint", "Pylint", false),
    ];

    const config: CodacyConfig = {
      version: 1,
      metadata: {
        repositoryId: null,
        repositoryName: null,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
        languages: [],
      },
      tools: [
        { toolId: "ESLint", patterns: [{ patternId: "p1" }] },
        { toolId: "Pylint", patterns: [{ patternId: "p2" }, { patternId: "p3" }] },
      ],
    };

    const preview = buildImportPreview(config, repoTools, allTools, [], "/test/path");

    // ESLint is enabled and in config → reconfigure
    expect(preview.toolsToReconfigure).toHaveLength(1);
    expect(preview.toolsToReconfigure[0].tool.name).toBe("ESLint");

    // Pylint is disabled and in config → enable
    expect(preview.toolsToEnable).toHaveLength(1);
    expect(preview.toolsToEnable[0].tool.name).toBe("Pylint");

    // Checkov is enabled but NOT in config → disable
    expect(preview.toolsToDisable).toHaveLength(1);
    expect(preview.toolsToDisable[0].name).toBe("Checkov");

    expect(preview.totalPatterns).toBe(3);
    expect(preview.unresolvedTools).toHaveLength(0);
  });

  it("should report unresolved tools", () => {
    const config: CodacyConfig = {
      version: 1,
      metadata: {
        repositoryId: null,
        repositoryName: null,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
        languages: [],
      },
      tools: [
        { toolId: "nonexistent_tool", patterns: [] },
      ],
    };

    const preview = buildImportPreview(config, [], allTools, [], "/test/path");
    expect(preview.unresolvedTools).toEqual(["nonexistent_tool"]);
  });

  it("should include standards in preview", () => {
    const standards = [{ id: 1, name: "Security" }, { id: 2, name: "OWASP" }];
    const config: CodacyConfig = {
      version: 1,
      metadata: {
        repositoryId: null,
        repositoryName: null,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
        languages: [],
      },
      tools: [],
    };

    const preview = buildImportPreview(config, [], allTools, standards, "/test/path");
    expect(preview.standards).toHaveLength(2);
  });
});

// ─── executeImport ────────────────────────────────────────────────────

describe("executeImport", () => {
  const mockSpinner = {
    text: "",
    start: vi.fn().mockReturnThis(),
    stop: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should configure tools from config and disable tools not in config", async () => {
    vi.mocked(AnalysisService.updateRepositoryToolPatterns).mockResolvedValue(undefined as any);
    vi.mocked(AnalysisService.configureTool).mockResolvedValue(undefined as any);

    const config: CodacyConfig = {
      version: 1,
      metadata: {
        repositoryId: null,
        repositoryName: null,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
        languages: [],
      },
      tools: [
        {
          toolId: "ESLint",
          patterns: [
            { patternId: "no-unused-vars", parameters: { severity: "error" } },
            { patternId: "no-console" },
          ],
        },
      ],
    };

    const preview = buildImportPreview(
      config,
      [
        makeRepoTool("uuid-eslint", "ESLint", true),
        makeRepoTool("uuid-checkov", "Checkov", true),
      ],
      allTools,
      [],
      "/test/path",
    );

    const result = await executeImport(
      "gh", "test-org", "test-repo",
      preview, config, allTools,
      mockSpinner as any,
    );

    // Should disable all ESLint patterns first
    expect(AnalysisService.updateRepositoryToolPatterns).toHaveBeenCalledWith(
      "gh", "test-org", "test-repo", "uuid-eslint", { enabled: false },
    );

    // Should configure ESLint with new patterns
    expect(AnalysisService.configureTool).toHaveBeenCalledWith(
      "gh", "test-org", "test-repo", "uuid-eslint",
      {
        enabled: true,
        useConfigurationFile: false,
        patterns: [
          {
            id: "no-unused-vars",
            enabled: true,
            parameters: [{ name: "severity", value: "error" }],
          },
          {
            id: "no-console",
            enabled: true,
            parameters: undefined,
          },
        ],
      },
    );

    // Should disable Checkov (not in config)
    expect(AnalysisService.configureTool).toHaveBeenCalledWith(
      "gh", "test-org", "test-repo", "uuid-checkov",
      { enabled: false },
    );

    expect(result.succeeded).toContain("ESLint");
    expect(result.succeeded).toContain("Checkov (disabled)");
    expect(result.failed).toHaveLength(0);
  });

  it("should pass useConfigurationFile when specified", async () => {
    vi.mocked(AnalysisService.updateRepositoryToolPatterns).mockResolvedValue(undefined as any);
    vi.mocked(AnalysisService.configureTool).mockResolvedValue(undefined as any);

    const config: CodacyConfig = {
      version: 1,
      metadata: {
        repositoryId: null,
        repositoryName: null,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
        languages: [],
      },
      tools: [
        {
          toolId: "ESLint",
          useLocalConfigurationFile: true,
          patterns: [],
        },
      ],
    };

    const preview = buildImportPreview(config, [], allTools, [], "/test/path");

    await executeImport(
      "gh", "test-org", "test-repo",
      preview, config, allTools,
      mockSpinner as any,
    );

    // When no patterns, should still enable with useConfigurationFile
    expect(AnalysisService.configureTool).toHaveBeenCalledWith(
      "gh", "test-org", "test-repo", "uuid-eslint",
      { enabled: true, useConfigurationFile: true },
    );
  });

  it("should unlink coding standards when force is true", async () => {
    vi.mocked(AnalysisService.updateRepositoryToolPatterns).mockResolvedValue(undefined as any);
    vi.mocked(AnalysisService.configureTool).mockResolvedValue(undefined as any);
    vi.mocked(CodingStandardsService.applyCodingStandardToRepositories).mockResolvedValue({} as any);

    const config: CodacyConfig = {
      version: 1,
      metadata: {
        repositoryId: null,
        repositoryName: null,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
        languages: [],
      },
      tools: [],
    };

    const standards = [{ id: 100, name: "Security" }, { id: 200, name: "OWASP" }];
    const preview = buildImportPreview(config, [], allTools, standards, "/test/path");

    const result = await executeImport(
      "gh", "test-org", "test-repo",
      preview, config, allTools,
      mockSpinner as any,
      true,
    );

    expect(CodingStandardsService.applyCodingStandardToRepositories).toHaveBeenCalledWith(
      "gh", "test-org", 100, { link: [], unlink: ["test-repo"] },
    );
    expect(CodingStandardsService.applyCodingStandardToRepositories).toHaveBeenCalledWith(
      "gh", "test-org", 200, { link: [], unlink: ["test-repo"] },
    );
    expect(result.failed).toHaveLength(0);
  });

  it("should not unlink coding standards when force is false", async () => {
    vi.mocked(AnalysisService.updateRepositoryToolPatterns).mockResolvedValue(undefined as any);
    vi.mocked(AnalysisService.configureTool).mockResolvedValue(undefined as any);

    const config: CodacyConfig = {
      version: 1,
      metadata: {
        repositoryId: null,
        repositoryName: null,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
        languages: [],
      },
      tools: [],
    };

    const standards = [{ id: 100, name: "Security" }];
    const preview = buildImportPreview(config, [], allTools, standards, "/test/path");

    await executeImport(
      "gh", "test-org", "test-repo",
      preview, config, allTools,
      mockSpinner as any,
      false,
    );

    expect(CodingStandardsService.applyCodingStandardToRepositories).not.toHaveBeenCalled();
  });

  it("should continue on error and report failures", async () => {
    vi.mocked(AnalysisService.updateRepositoryToolPatterns).mockResolvedValue(undefined as any);
    vi.mocked(AnalysisService.configureTool)
      .mockRejectedValueOnce(new Error("Conflict: managed by standard"))
      .mockResolvedValue(undefined as any);

    const config: CodacyConfig = {
      version: 1,
      metadata: {
        repositoryId: null,
        repositoryName: null,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
        languages: [],
      },
      tools: [
        { toolId: "ESLint", patterns: [{ patternId: "p1" }] },
        { toolId: "Pylint", patterns: [{ patternId: "p2" }] },
      ],
    };

    const preview = buildImportPreview(config, [], allTools, [], "/test/path");

    const result = await executeImport(
      "gh", "test-org", "test-repo",
      preview, config, allTools,
      mockSpinner as any,
    );

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].tool).toBe("ESLint");
    expect(result.failed[0].error).toContain("Conflict");
    expect(result.succeeded).toContain("Pylint");
  });
});
