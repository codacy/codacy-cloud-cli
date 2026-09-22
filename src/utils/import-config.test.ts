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

// Default: no currently-enabled patterns, so buildImportPreview's per-tool pattern fetch is a no-op unless a test overrides it.
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(AnalysisService.listRepositoryToolPatterns).mockResolvedValue({
    data: [],
    pagination: undefined,
  } as any);
});

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

function makeRepoTool(
  uuid: string,
  name: string,
  isEnabled: boolean,
  enabledBy: { id: number; name: string }[] = [],
): AnalysisTool {
  return {
    uuid,
    name,
    isClientSide: false,
    settings: {
      isEnabled,
      enabledBy,
      hasConfigurationFile: false,
      usesConfigurationFile: false,
      followsStandard: false,
      isCustom: false,
    },
  } as AnalysisTool;
}

function makeConfiguredPattern(
  id: string,
  enabledBy: { id: number; name: string }[] = [],
): any {
  return {
    patternDefinition: { id },
    enabled: true,
    isCustom: false,
    parameters: [],
    enabledBy,
  };
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

  it("should throw when a tool entry is missing toolId", () => {
    const tmpPath = "/tmp/test-no-toolid.json";
    fs.writeFileSync(tmpPath, JSON.stringify({
      version: 1,
      tools: [{ patterns: [] }],
    }));
    expect(() => readConfigFile(tmpPath)).toThrow("tools[0] is missing a valid 'toolId'");
    fs.unlinkSync(tmpPath);
  });

  it("should default patterns to empty array when missing", () => {
    const tmpPath = "/tmp/test-no-patterns.json";
    fs.writeFileSync(tmpPath, JSON.stringify({
      version: 1,
      tools: [{ toolId: "eslint" }],
    }));
    const result = readConfigFile(tmpPath);
    expect(result.tools[0].patterns).toEqual([]);
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
  it("should categorize tools correctly with local CLI info", async () => {
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

    const localToolIds = ["ESLint", "Pylint", "checkov", "remarklint"];
    const preview = await buildImportPreview("gh", "org", "repo", config, repoTools, allTools, [], "/test/path", localToolIds);

    // ESLint is enabled and in config → reconfigure
    expect(preview.toolsToReconfigure).toHaveLength(1);
    expect(preview.toolsToReconfigure[0].tool.name).toBe("ESLint");

    // Pylint is disabled and in config → enable
    expect(preview.toolsToEnable).toHaveLength(1);
    expect(preview.toolsToEnable[0].tool.name).toBe("Pylint");

    // Checkov is enabled, locally supported, but NOT in config → disable
    expect(preview.toolsToDisable).toHaveLength(1);
    expect(preview.toolsToDisable[0].name).toBe("Checkov");

    expect(preview.cloudOnlyTools).toHaveLength(0);
    expect(preview.localCliAvailable).toBe(true);
    expect(preview.totalPatterns).toBe(3);
    expect(preview.unresolvedTools).toHaveLength(0);
  });

  it("should leave cloud-only tools unchanged", async () => {
    const sonarSharpTool = makeTool({ uuid: "uuid-sonarsharp", name: "SonarSharp", shortName: "sonarsharp", prefix: "SonarSharp_" });
    const extendedAllTools = [...allTools, sonarSharpTool];

    const repoTools: AnalysisTool[] = [
      makeRepoTool("uuid-eslint", "ESLint", true),
      makeRepoTool("uuid-checkov", "Checkov", true),
      makeRepoTool("uuid-sonarsharp", "SonarSharp", true),
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
      ],
    };

    // Local CLI supports ESLint and Checkov but NOT SonarSharp
    const localToolIds = ["ESLint", "checkov"];
    const preview = await buildImportPreview("gh", "org", "repo", config, repoTools, extendedAllTools, [], "/test/path", localToolIds);

    // ESLint is in config → reconfigure
    expect(preview.toolsToReconfigure).toHaveLength(1);
    expect(preview.toolsToReconfigure[0].tool.name).toBe("ESLint");

    // Checkov is locally supported but not in config → disable
    expect(preview.toolsToDisable).toHaveLength(1);
    expect(preview.toolsToDisable[0].name).toBe("Checkov");

    // SonarSharp is NOT locally supported → cloud-only, unchanged
    expect(preview.cloudOnlyTools).toHaveLength(1);
    expect(preview.cloudOnlyTools[0].name).toBe("SonarSharp");
  });

  it("should not disable any tools when local CLI is unavailable", async () => {
    const repoTools: AnalysisTool[] = [
      makeRepoTool("uuid-eslint", "ESLint", true),
      makeRepoTool("uuid-checkov", "Checkov", true),
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
      ],
    };

    // null = local CLI not available
    const preview = await buildImportPreview("gh", "org", "repo", config, repoTools, allTools, [], "/test/path", null);

    expect(preview.toolsToDisable).toHaveLength(0);
    expect(preview.cloudOnlyTools).toHaveLength(0);
    expect(preview.localCliAvailable).toBe(false);
    expect(preview.toolsToReconfigure).toHaveLength(1);
  });

  it("should report unresolved tools", async () => {
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

    const preview = await buildImportPreview("gh", "org", "repo", config, [], allTools, [], "/test/path");
    expect(preview.unresolvedTools).toEqual(["nonexistent_tool"]);
  });

  it("should include standards in preview", async () => {
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

    const preview = await buildImportPreview("gh", "org", "repo", config, [], allTools, standards, "/test/path");
    expect(preview.standards).toHaveLength(2);
  });

  // ── Standard-enforced skips ───────────────────────────────────────────

  it("should drop a standard-enforced tool from the disable set and report it as skipped", async () => {
    const repoTools: AnalysisTool[] = [
      makeRepoTool("uuid-checkov", "Checkov", true, [{ id: 1, name: "Security" }]),
    ];
    const config: CodacyConfig = {
      version: 1,
      metadata: { repositoryId: null, repositoryName: null, createdAt: "", updatedAt: "", languages: [] },
      tools: [],
    };

    const preview = await buildImportPreview(
      "gh", "org", "repo", config, repoTools, allTools, [], "/test/path", ["checkov"],
    );

    expect(preview.toolsToDisable).toHaveLength(0);
    expect(preview.skipped).toEqual([
      { tool: "Checkov", standards: ["Security"], reason: "enforced by coding standard" },
    ]);
  });

  it("should keep a standard-enforced tool in the disable set and skip nothing when force is true", async () => {
    const repoTools: AnalysisTool[] = [
      makeRepoTool("uuid-checkov", "Checkov", true, [{ id: 1, name: "Security" }]),
    ];
    const config: CodacyConfig = {
      version: 1,
      metadata: { repositoryId: null, repositoryName: null, createdAt: "", updatedAt: "", languages: [] },
      tools: [],
    };

    const preview = await buildImportPreview(
      "gh", "org", "repo", config, repoTools, allTools, [], "/test/path", ["checkov"], true,
    );

    expect(preview.toolsToDisable).toHaveLength(1);
    expect(preview.toolsToDisable[0].name).toBe("Checkov");
    expect(preview.skipped).toEqual([]);
    expect(AnalysisService.listRepositoryToolPatterns).not.toHaveBeenCalled();
  });

  it("should keep a standard-enforced pattern enabled and report it as skipped", async () => {
    vi.mocked(AnalysisService.listRepositoryToolPatterns).mockResolvedValue({
      data: [
        makeConfiguredPattern("p-locked", [{ id: 2, name: "OWASP" }]),
        makeConfiguredPattern("p-unlocked"),
      ],
      pagination: undefined,
    } as any);

    const repoTools: AnalysisTool[] = [makeRepoTool("uuid-eslint", "ESLint", true)];
    const config: CodacyConfig = {
      version: 1,
      metadata: { repositoryId: null, repositoryName: null, createdAt: "", updatedAt: "", languages: [] },
      tools: [{ toolId: "ESLint", patterns: [{ patternId: "p1" }] }],
    };

    const preview = await buildImportPreview("gh", "org", "repo", config, repoTools, allTools, [], "/test/path");

    expect(AnalysisService.listRepositoryToolPatterns).toHaveBeenCalledWith(
      "gh", "org", "repo", "uuid-eslint",
      undefined, undefined, undefined, undefined, undefined,
      true, undefined, undefined, undefined, undefined, 100,
    );
    expect(preview.skipped).toEqual([
      { tool: "ESLint", patternId: "p-locked", standards: ["OWASP"], reason: "enforced by coding standard" },
    ]);
  });

  it("should not fetch patterns for tools that are enabled, not reconfigured", async () => {
    const repoTools: AnalysisTool[] = [makeRepoTool("uuid-pylint", "Pylint", false)];
    const config: CodacyConfig = {
      version: 1,
      metadata: { repositoryId: null, repositoryName: null, createdAt: "", updatedAt: "", languages: [] },
      tools: [{ toolId: "Pylint", patterns: [{ patternId: "p1" }] }],
    };

    await buildImportPreview("gh", "org", "repo", config, repoTools, allTools, [], "/test/path");

    expect(AnalysisService.listRepositoryToolPatterns).not.toHaveBeenCalled();
  });

  it("should not fetch patterns for a reconfigured tool using a local configuration file", async () => {
    const repoTools: AnalysisTool[] = [makeRepoTool("uuid-eslint", "ESLint", true)];
    const config: CodacyConfig = {
      version: 1,
      metadata: { repositoryId: null, repositoryName: null, createdAt: "", updatedAt: "", languages: [] },
      tools: [{ toolId: "ESLint", useLocalConfigurationFile: true, patterns: [] }],
    };

    await buildImportPreview("gh", "org", "repo", config, repoTools, allTools, [], "/test/path");

    expect(AnalysisService.listRepositoryToolPatterns).not.toHaveBeenCalled();
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

  it("should configure tools from config and disable locally supported tools not in config", async () => {
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

    const preview = await buildImportPreview(
      "gh", "org", "repo",
      config,
      [
        makeRepoTool("uuid-eslint", "ESLint", true),
        makeRepoTool("uuid-checkov", "Checkov", true),
      ],
      allTools,
      [],
      "/test/path",
      ["ESLint", "checkov"],
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
    expect(result.skipped).toEqual([]);
  });

  it("should not re-enable locked patterns, but still pass skipped through", async () => {
    vi.mocked(AnalysisService.updateRepositoryToolPatterns).mockResolvedValue(undefined as any);
    vi.mocked(AnalysisService.configureTool).mockResolvedValue(undefined as any);

    const config: CodacyConfig = {
      version: 1,
      metadata: { repositoryId: null, repositoryName: null, createdAt: "", updatedAt: "", languages: [] },
      tools: [{ toolId: "ESLint", patterns: [{ patternId: "p1" }] }],
    };

    const preview = await buildImportPreview("gh", "org", "repo", config, [
      makeRepoTool("uuid-eslint", "ESLint", true),
    ], allTools, [], "/test/path");
    // Simulate what buildImportPreview computes when a pattern fetch finds a locked one.
    preview.skipped = [
      { tool: "ESLint", patternId: "p-locked", standards: ["OWASP"], reason: "enforced by coding standard" },
    ];

    const result = await executeImport(
      "gh", "test-org", "test-repo",
      preview, config, allTools,
      mockSpinner as any,
    );

    expect(AnalysisService.configureTool).toHaveBeenCalledWith(
      "gh", "test-org", "test-repo", "uuid-eslint",
      {
        enabled: true,
        useConfigurationFile: false,
        patterns: [
          { id: "p1", enabled: true, parameters: undefined },
        ],
      },
    );
    expect(result.skipped).toEqual(preview.skipped);
  });

  it("should skip pattern reset and use config file mode when useLocalConfigurationFile is true", async () => {
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

    const preview = await buildImportPreview("gh", "org", "repo", config, [], allTools, [], "/test/path");

    await executeImport(
      "gh", "test-org", "test-repo",
      preview, config, allTools,
      mockSpinner as any,
    );

    // Should NOT reset patterns when using config file mode
    expect(AnalysisService.updateRepositoryToolPatterns).not.toHaveBeenCalled();

    // Should enable with useConfigurationFile: true
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
    const preview = await buildImportPreview("gh", "org", "repo", config, [], allTools, standards, "/test/path");

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
    const preview = await buildImportPreview("gh", "org", "repo", config, [], allTools, standards, "/test/path");

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

    const preview = await buildImportPreview("gh", "org", "repo", config, [], allTools, [], "/test/path");

    const result = await executeImport(
      "gh", "test-org", "test-repo",
      preview, config, allTools,
      mockSpinner as any,
    );

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].tool).toBe("ESLint");
    expect(result.failed[0].error).toContain("Conflict");
    expect(result.failed[0].details).toEqual([]);
    expect(result.succeeded).toContain("Pylint");
  });

  it("should extract details from ApiError with body.message", async () => {
    const { ApiError } = await import("../api/client/core/ApiError");
    const apiError = new ApiError(
      { method: "PUT", url: "/test" } as any,
      { url: "/test", ok: false, status: 409, statusText: "Conflict", body: { message: "Tool is managed by coding standard 'Security'" } },
      "Conflict",
    );

    vi.mocked(AnalysisService.updateRepositoryToolPatterns).mockResolvedValue(undefined as any);
    vi.mocked(AnalysisService.configureTool).mockRejectedValueOnce(apiError);

    const config: CodacyConfig = {
      version: 1,
      metadata: { repositoryId: null, repositoryName: null, createdAt: "", updatedAt: "", languages: [] },
      tools: [{ toolId: "ESLint", patterns: [{ patternId: "p1" }] }],
    };

    const preview = await buildImportPreview("gh", "org", "repo", config, [], allTools, [], "/test/path");
    const result = await executeImport("gh", "org", "repo", preview, config, allTools, mockSpinner as any);

    expect(result.failed[0].status).toBe(409);
    expect(result.failed[0].error).toBe("Conflict");
    expect(result.failed[0].details).toEqual(["Tool is managed by coding standard 'Security'"]);
  });

  it("should extract details from ApiError with body.errors array", async () => {
    const { ApiError } = await import("../api/client/core/ApiError");
    const apiError = new ApiError(
      { method: "PUT", url: "/test" } as any,
      { url: "/test", ok: false, status: 400, statusText: "Bad Request", body: { errors: ["Pattern X not found", "Pattern Y is invalid"] } },
      "Bad Request",
    );

    vi.mocked(AnalysisService.updateRepositoryToolPatterns).mockResolvedValue(undefined as any);
    vi.mocked(AnalysisService.configureTool).mockRejectedValueOnce(apiError);

    const config: CodacyConfig = {
      version: 1,
      metadata: { repositoryId: null, repositoryName: null, createdAt: "", updatedAt: "", languages: [] },
      tools: [{ toolId: "ESLint", patterns: [{ patternId: "p1" }] }],
    };

    const preview = await buildImportPreview("gh", "org", "repo", config, [], allTools, [], "/test/path");
    const result = await executeImport("gh", "org", "repo", preview, config, allTools, mockSpinner as any);

    expect(result.failed[0].status).toBe(400);
    expect(result.failed[0].details).toEqual(["Pattern X not found", "Pattern Y is invalid"]);
  });

  it("should extract details from ApiError with string body", async () => {
    const { ApiError } = await import("../api/client/core/ApiError");
    const apiError = new ApiError(
      { method: "PUT", url: "/test" } as any,
      { url: "/test", ok: false, status: 500, statusText: "Internal Server Error", body: "Unexpected failure in tool configuration" },
      "Internal Server Error",
    );

    vi.mocked(AnalysisService.updateRepositoryToolPatterns).mockResolvedValue(undefined as any);
    vi.mocked(AnalysisService.configureTool).mockRejectedValueOnce(apiError);

    const config: CodacyConfig = {
      version: 1,
      metadata: { repositoryId: null, repositoryName: null, createdAt: "", updatedAt: "", languages: [] },
      tools: [{ toolId: "ESLint", patterns: [{ patternId: "p1" }] }],
    };

    const preview = await buildImportPreview("gh", "org", "repo", config, [], allTools, [], "/test/path");
    const result = await executeImport("gh", "org", "repo", preview, config, allTools, mockSpinner as any);

    expect(result.failed[0].status).toBe(500);
    expect(result.failed[0].details).toEqual(["Unexpected failure in tool configuration"]);
  });
});
