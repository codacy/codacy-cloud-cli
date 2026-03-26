import * as fs from "fs";
import ansis from "ansis";
import pluralize from "pluralize";
import { CodacyConfig, CodacyToolConfig } from "../types/codacy-config";
import { Tool } from "../api/client/models/Tool";
import { AnalysisTool } from "../api/client/models/AnalysisTool";
import { CodingStandardInfo } from "../api/client/models/CodingStandardInfo";
import { ConfigurePattern } from "../api/client/models/ConfigurePattern";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { ToolsService } from "../api/client/services/ToolsService";
import { CodingStandardsService } from "../api/client/services/CodingStandardsService";
import type ora from "ora";

export interface ResolvedTool {
  configTool: CodacyToolConfig;
  tool: Tool;
  repoTool?: AnalysisTool;
}

export interface ImportPreview {
  toolsToDisable: AnalysisTool[];
  toolsToEnable: ResolvedTool[];
  toolsToReconfigure: ResolvedTool[];
  unresolvedTools: string[];
  totalPatterns: number;
  standards: CodingStandardInfo[];
  configPath: string;
}

export function readConfigFile(filePath: string): CodacyConfig {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Configuration file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    const config = JSON.parse(raw) as CodacyConfig;
    if (!config.version || !Array.isArray(config.tools)) {
      throw new Error("Invalid configuration file: missing 'version' or 'tools' fields.");
    }
    return config;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON in configuration file: ${filePath}`);
    }
    throw err;
  }
}

export function resolveToolId(
  toolId: string,
  allTools: Tool[],
): Tool | undefined {
  const id = toolId.toLowerCase();

  // Match by prefix (strip trailing _ before comparing)
  const byPrefix = allTools.find(
    (t) => t.prefix && t.prefix.replace(/_$/, "").toLowerCase() === id,
  );
  if (byPrefix) return byPrefix;

  // Fall back to shortName
  return allTools.find((t) => t.shortName.toLowerCase() === id);
}

export async function fetchAllTools(): Promise<Tool[]> {
  const all: Tool[] = [];
  let cursor: string | undefined;
  do {
    const response = await ToolsService.listTools(cursor, 100);
    all.push(...response.data);
    cursor = response.pagination?.cursor;
  } while (cursor);
  return all;
}

export function buildImportPreview(
  config: CodacyConfig,
  repoTools: AnalysisTool[],
  allTools: Tool[],
  standards: CodingStandardInfo[],
  configPath: string,
): ImportPreview {
  const resolved: ResolvedTool[] = [];
  const unresolvedTools: string[] = [];

  for (const configTool of config.tools) {
    const tool = resolveToolId(configTool.toolId, allTools);
    if (!tool) {
      unresolvedTools.push(configTool.toolId);
      continue;
    }
    const repoTool = repoTools.find((rt) => rt.uuid === tool.uuid);
    resolved.push({ configTool, tool, repoTool });
  }

  // Tools in the config that need enabling (currently disabled or not present)
  const toolsToEnable = resolved.filter(
    (r) => !r.repoTool || !r.repoTool.settings.isEnabled,
  );

  // Tools in the config that are already enabled (need reconfiguration)
  const toolsToReconfigure = resolved.filter(
    (r) => r.repoTool && r.repoTool.settings.isEnabled,
  );

  // Repo tools that are currently enabled but NOT in the config → disable
  const resolvedUuids = new Set(resolved.map((r) => r.tool.uuid));
  const toolsToDisable = repoTools.filter(
    (rt) => rt.settings.isEnabled && !resolvedUuids.has(rt.uuid),
  );

  const totalPatterns = config.tools.reduce(
    (sum, t) => sum + t.patterns.length,
    0,
  );

  return {
    toolsToDisable,
    toolsToEnable,
    toolsToReconfigure,
    unresolvedTools,
    totalPatterns,
    standards,
    configPath,
  };
}

export function printImportPreview(
  preview: ImportPreview,
  repoName: string,
  force: boolean,
): void {
  console.log();

  // Standards
  if (preview.standards.length > 0) {
    const names = preview.standards.map((s) => s.name).join(", ");
    if (force) {
      console.log(
        `${repoName} will stop following ${preview.standards.length} ${pluralize("coding standard", preview.standards.length)}: ${names}`,
      );
    } else {
      console.log(
        ansis.yellow(
          `⚠ ${repoName} follows ${preview.standards.length} ${pluralize("coding standard", preview.standards.length)}: ${names}`,
        ),
      );
      console.log(
        ansis.yellow(
          "  Standards may override tool configuration. Use --force to unlink them, or --unlink-standard to remove them manually.",
        ),
      );
    }
    console.log();
  }

  // Unresolved tools warning
  if (preview.unresolvedTools.length > 0) {
    console.log(
      ansis.yellow(
        `⚠ ${preview.unresolvedTools.length} ${pluralize("tool", preview.unresolvedTools.length)} in the config could not be matched: ${preview.unresolvedTools.join(", ")}`,
      ),
    );
    console.log();
  }

  // Tools to disable
  if (preview.toolsToDisable.length > 0) {
    const names = preview.toolsToDisable.map((t) => t.name).join(", ");
    console.log(
      `${preview.toolsToDisable.length} ${pluralize("tool", preview.toolsToDisable.length)} will be disabled: ${names}`,
    );
  }

  // Tools to enable
  if (preview.toolsToEnable.length > 0) {
    const names = preview.toolsToEnable.map((r) => r.tool.name).join(", ");
    console.log(
      `${preview.toolsToEnable.length} ${pluralize("tool", preview.toolsToEnable.length)} will be enabled: ${names}`,
    );
  }

  // Tools to reconfigure
  if (preview.toolsToReconfigure.length > 0) {
    const names = preview.toolsToReconfigure.map((r) => r.tool.name).join(", ");
    console.log(
      `${preview.toolsToReconfigure.length} ${pluralize("tool", preview.toolsToReconfigure.length)} will be reconfigured: ${names}`,
    );
  }

  console.log();
  console.log(
    `All existing patterns in configured tools will be replaced with the patterns in ${ansis.bold(preview.configPath)}.`,
  );
  console.log();
  console.log(
    `${ansis.bold(String(preview.totalPatterns))} ${pluralize("pattern", preview.totalPatterns)} will be enabled.`,
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function buildConfigurePatterns(
  toolConfig: CodacyToolConfig,
): ConfigurePattern[] {
  return toolConfig.patterns.map((p) => ({
    id: p.patternId,
    enabled: true,
    parameters: p.parameters
      ? Object.entries(p.parameters).map(([name, value]) => ({
          name,
          value: String(value),
        }))
      : undefined,
  }));
}

export async function executeImport(
  provider: string,
  organization: string,
  repository: string,
  preview: ImportPreview,
  config: CodacyConfig,
  allTools: Tool[],
  spinner: ReturnType<typeof ora>,
  force: boolean = false,
): Promise<{ succeeded: string[]; failed: { tool: string; error: string }[] }> {
  const succeeded: string[] = [];
  const failed: { tool: string; error: string }[] = [];

  // Unlink coding standards when --force is used
  if (force) {
    for (const standard of preview.standards) {
      spinner.text = `Unlinking coding standard "${standard.name}"...`;
      try {
        await CodingStandardsService.applyCodingStandardToRepositories(
          provider,
          organization,
          standard.id,
          { link: [], unlink: [repository] },
        );
      } catch (err) {
        failed.push({
          tool: `Standard: ${standard.name}`,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Configure each tool from the config file
  const allResolved = [...preview.toolsToEnable, ...preview.toolsToReconfigure];
  for (const resolved of allResolved) {
    spinner.text = `Configuring ${resolved.tool.name}...`;
    try {
      // Disable all existing patterns first
      await AnalysisService.updateRepositoryToolPatterns(
        provider,
        organization,
        repository,
        resolved.tool.uuid,
        { enabled: false },
      );

      // Build patterns and batch
      const patterns = buildConfigurePatterns(resolved.configTool);
      const batches = chunk(patterns, 1000);

      for (const batch of batches) {
        await AnalysisService.configureTool(
          provider,
          organization,
          repository,
          resolved.tool.uuid,
          {
            enabled: true,
            useConfigurationFile:
              resolved.configTool.useLocalConfigurationFile ?? false,
            patterns: batch,
          },
        );
      }

      // If no patterns, still enable the tool with the config file setting
      if (batches.length === 0) {
        await AnalysisService.configureTool(
          provider,
          organization,
          repository,
          resolved.tool.uuid,
          {
            enabled: true,
            useConfigurationFile:
              resolved.configTool.useLocalConfigurationFile ?? false,
          },
        );
      }

      succeeded.push(resolved.tool.name);
    } catch (err) {
      failed.push({
        tool: resolved.tool.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Disable tools not in config
  for (const tool of preview.toolsToDisable) {
    spinner.text = `Disabling ${tool.name}...`;
    try {
      await AnalysisService.configureTool(
        provider,
        organization,
        repository,
        tool.uuid,
        { enabled: false },
      );
      succeeded.push(`${tool.name} (disabled)`);
    } catch (err) {
      failed.push({
        tool: tool.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { succeeded, failed };
}
