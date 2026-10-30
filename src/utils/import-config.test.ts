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
      followsStandard: false,
      isCustom: false,
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
  it("should categorize tools correctly with local CLI info", () => {
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
    const preview = buildImportPreview(config, repoTools, allTools, [], "/test/path", localToolIds);

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

  it("should leave cloud-only tools unchanged", () => {
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
    const preview = buildImportPreview(config, repoTools, extendedAllTools, [], "/test/path", localToolIds);

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

  it("should not disable any tools when local CLI is unavailable", () => {
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
    const preview = buildImportPreview(config, repoTools, allTools, [], "/test/path", null);

    expect(preview.toolsToDisable).toHaveLength(0);
    expect(preview.cloudOnlyTools).toHaveLength(0);
    expect(preview.localCliAvailable).toBe(false);
    expect(preview.toolsToReconfigure).toHaveLength(1);
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

    const preview = buildImportPreview(
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

    const preview = buildImportPreview(config, [], allTools, [], "/test/path");

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

  describe("after unlinking coding standards", () => {
    // The config keeps Checkov; the standard governed the tools the preview saw.
    const config: CodacyConfig = {
      version: 1,
      metadata: {
        repositoryId: null,
        repositoryName: null,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
        languages: [],
      },
      tools: [{ toolId: "checkov", patterns: [{ patternId: "CKV_1" }] }],
    };
    const standards = [{ id: 100, name: "Our Default" }];
    const localToolIds = ["ESLint", "checkov", "Pylint"];

    beforeEach(() => {
      vi.mocked(AnalysisService.updateRepositoryToolPatterns).mockResolvedValue(undefined as any);
      vi.mocked(AnalysisService.configureTool).mockResolvedValue(undefined as any);
      vi.mocked(CodingStandardsService.applyCodingStandardToRepositories).mockResolvedValue({} as any);
    });

    it("disables a locally supported tool the unlink enabled, which the preview never saw", async () => {
      // Before the unlink: only Checkov (from the standard) and Pylint (not in config).
      const preview = buildImportPreview(
        config,
        [makeRepoTool("uuid-checkov", "Checkov", true), makeRepoTool("uuid-pylint", "Pylint", true)],
        allTools,
        standards,
        "/test/path",
        localToolIds,
      );
      expect(preview.toolsToDisable.map((t) => t.name)).toEqual(["Pylint"]);

      // After the unlink Codacy's defaults switch ESLint on, and Remarklint (cloud-only here).
      vi.mocked(AnalysisService.listRepositoryTools).mockResolvedValue({
        data: [
          makeRepoTool("uuid-checkov", "Checkov", true),
          makeRepoTool("uuid-pylint", "Pylint", true),
          makeRepoTool("uuid-eslint", "ESLint", true),
          makeRepoTool("uuid-remarklint", "Remarklint", true),
        ],
      } as any);

      const result = await executeImport(
        "gh", "test-org", "test-repo",
        preview, config, allTools,
        mockSpinner as any,
        true,
      );

      expect(AnalysisService.listRepositoryTools).toHaveBeenCalledWith("gh", "test-org", "test-repo");
      const disabled = vi
        .mocked(AnalysisService.configureTool)
        .mock.calls.filter(([, , , , body]) => body.enabled === false)
        .map(([, , , uuid]) => uuid);
      // Pylint once (no duplicate), ESLint added; Checkov is in the config and
      // Remarklint is not supported locally, so both are left alone.
      expect(disabled).toEqual(["uuid-pylint", "uuid-eslint"]);
      expect(result.succeeded).toContain("ESLint (disabled)");
      expect(result.failed).toHaveLength(0);
      // Only what the unlink changed, beyond the confirmed preview (Pylint was in it).
      expect(result.afterUnlink).toEqual({ disabled: ["ESLint"], leftEnabled: ["Remarklint"] });
    });

    it("does not report a post-unlink disable that failed as disabled", async () => {
      const preview = buildImportPreview(config, [], allTools, standards, "/test/path", localToolIds);
      vi.mocked(AnalysisService.listRepositoryTools).mockResolvedValue({
        data: [makeRepoTool("uuid-eslint", "ESLint", true)],
      } as any);
      vi.mocked(AnalysisService.configureTool).mockImplementation(
        (async (_p: string, _o: string, _r: string, uuid: string, body: { enabled?: boolean }) => {
          if (uuid === "uuid-eslint" && body.enabled === false) throw new Error("boom");
          return undefined as any;
        }) as any,
      );

      const result = await executeImport(
        "gh", "test-org", "test-repo",
        preview, config, allTools,
        mockSpinner as any,
        true,
      );

      expect(result.afterUnlink.disabled).toEqual([]);
      expect(result.failed.map((f) => f.tool)).toEqual(["ESLint"]);
    });

    it("does not re-read the tools when no standard was unlinked", async () => {
      vi.mocked(CodingStandardsService.applyCodingStandardToRepositories).mockRejectedValue(
        new Error("forbidden"),
      );
      const preview = buildImportPreview(config, [], allTools, standards, "/test/path", localToolIds);

      const result = await executeImport(
        "gh", "test-org", "test-repo",
        preview, config, allTools,
        mockSpinner as any,
        true,
      );

      expect(AnalysisService.listRepositoryTools).not.toHaveBeenCalled();
      expect(result.failed.map((f) => f.tool)).toEqual(["Standard: Our Default"]);
    });

    it("does not re-read the tools without local CLI information, since it would disable nothing", async () => {
      const preview = buildImportPreview(config, [], allTools, standards, "/test/path", null);

      await executeImport(
        "gh", "test-org", "test-repo",
        preview, config, allTools,
        mockSpinner as any,
        true,
      );

      expect(AnalysisService.listRepositoryTools).not.toHaveBeenCalled();
    });

    it("reports a failed re-read and still applies the import", async () => {
      vi.mocked(AnalysisService.listRepositoryTools).mockRejectedValue(new Error("network down"));
      const preview = buildImportPreview(config, [], allTools, standards, "/test/path", localToolIds);

      const result = await executeImport(
        "gh", "test-org", "test-repo",
        preview, config, allTools,
        mockSpinner as any,
        true,
      );

      expect(result.succeeded).toContain("Checkov");
      expect(result.failed).toEqual([
        expect.objectContaining({
          tool: "Re-reading repository tools after unlinking standards",
          error: "network down",
        }),
      ]);
    });
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

    const preview = buildImportPreview(config, [], allTools, [], "/test/path");
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

    const preview = buildImportPreview(config, [], allTools, [], "/test/path");
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

    const preview = buildImportPreview(config, [], allTools, [], "/test/path");
    const result = await executeImport("gh", "org", "repo", preview, config, allTools, mockSpinner as any);

    expect(result.failed[0].status).toBe(500);
    expect(result.failed[0].details).toEqual(["Unexpected failure in tool configuration"]);
  });
});
