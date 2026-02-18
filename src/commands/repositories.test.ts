import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerRepositoriesCommand } from "./repositories";
import { AnalysisService } from "../api/client/services/AnalysisService";

vi.mock("../api/client/services/AnalysisService");
vi.spyOn(console, "log").mockImplementation(() => {});

function createProgram(): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  registerRepositoriesCommand(program);
  return program;
}

const mockRepos = [
  {
    repository: {
      name: "my-repo",
      visibility: "Private",
      lastUpdated: "2025-06-15T10:00:00Z",
      problems: [],
      languages: ["TypeScript"],
      standards: [],
      addedState: "Added",
    },
    gradeLetter: "A",
    issuesCount: 5,
    complexFilesPercentage: 10.5,
    duplicationPercentage: 3.2,
    coverage: { coveragePercentage: 85 },
    goals: {
      maxComplexFilesPercentage: 25,
      maxDuplicatedFilesPercentage: 10,
      minCoveragePercentage: 80,
    },
  },
  {
    repository: {
      name: "another-repo",
      visibility: "Public",
      lastUpdated: "2025-05-10T08:30:00Z",
      problems: [],
      languages: ["JavaScript"],
      standards: [],
      addedState: "Added",
    },
    gradeLetter: "D",
    issuesCount: 42,
    complexFilesPercentage: 30.0,
    duplicationPercentage: 15.7,
    coverage: { coveragePercentage: 50 },
    goals: {
      maxComplexFilesPercentage: 25,
      maxDuplicatedFilesPercentage: 10,
      minCoveragePercentage: 80,
    },
  },
];

describe("repositories command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
  });

  it("should fetch and display repositories in table format", async () => {
    vi.mocked(
      AnalysisService.listOrganizationRepositoriesWithAnalysis
    ).mockResolvedValue({ data: mockRepos as any });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "repositories",
      "gh",
      "test-org",
    ]);

    expect(
      AnalysisService.listOrganizationRepositoriesWithAnalysis
    ).toHaveBeenCalledWith("gh", "test-org", undefined, 100, undefined);
    expect(console.log).toHaveBeenCalled();
  });

  it("should pass search query to the API", async () => {
    vi.mocked(
      AnalysisService.listOrganizationRepositoriesWithAnalysis
    ).mockResolvedValue({ data: mockRepos as any });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "repositories",
      "gh",
      "test-org",
      "--search",
      "my-repo",
    ]);

    expect(
      AnalysisService.listOrganizationRepositoriesWithAnalysis
    ).toHaveBeenCalledWith("gh", "test-org", undefined, 100, "my-repo");
  });

  it("should output JSON when --output json is specified", async () => {
    vi.mocked(
      AnalysisService.listOrganizationRepositoriesWithAnalysis
    ).mockResolvedValue({ data: mockRepos as any });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "--output",
      "json",
      "repositories",
      "gh",
      "test-org",
    ]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"name": "my-repo"')
    );
  });

  it("should show message when no repositories found", async () => {
    vi.mocked(
      AnalysisService.listOrganizationRepositoriesWithAnalysis
    ).mockResolvedValue({ data: [] });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "repositories",
      "gh",
      "test-org",
    ]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("No repositories found")
    );
  });

  it("should show ⊙ indicator for public repos but not private", async () => {
    vi.mocked(
      AnalysisService.listOrganizationRepositoriesWithAnalysis
    ).mockResolvedValue({ data: mockRepos as any });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "repositories",
      "gh",
      "test-org",
    ]);

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join("\n");
    // Public repo "another-repo" should have ⊙
    expect(allOutput).toContain("another-repo");
    expect(allOutput).toContain("⊙");
    // Private repo "my-repo" should appear without ⊙ adjacent
    expect(allOutput).toMatch(/my-repo(?!.*⊙)/);
  });

  it("should fail when CODACY_API_TOKEN is not set", async () => {
    delete process.env.CODACY_API_TOKEN;

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "test",
        "repositories",
        "gh",
        "test-org",
      ])
    ).rejects.toThrow("process.exit called");

    mockExit.mockRestore();
  });
});
