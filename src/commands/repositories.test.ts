import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerRepositoriesCommand } from "./repositories";
import { AnalysisService } from "../api/client/services/AnalysisService";

vi.mock("../api/client/services/AnalysisService");
vi.mock("../utils/credentials", () => ({ loadCredentials: vi.fn(() => null) }));
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

  describe("coverage status", () => {
    // A separate fixture rather than mutating `mockRepos`, so the existing
    // tests keep asserting against unchanged rows.
    function repoWithCoverage(name: string, coverage: any) {
      return {
        repository: {
          name,
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
        coverage,
        goals: { minCoveragePercentage: 60 },
      };
    }

    const waitingRepo = repoWithCoverage("waiting-repo", {
      coveragePercentage: 19,
      status: "Waiting",
      lastCommitWithCoverage: "5474cbf195db8f6fb0704d2bc9a8dc4e16065dc9",
      statusUpdatedAt: "2026-09-10T10:44:04.440743Z",
      valueUpdatedAt: "2026-09-10T01:13:16.102431Z",
    });
    const stoppedRepo = repoWithCoverage("stopped-repo", {
      status: "Stopped",
      lastCommitWithCoverage: "8752dbd2bef1fab22db1197ae5e87de371ff2ead",
      statusUpdatedAt: "2026-08-26T11:08:31.090599Z",
    });
    const upToDateRepo = repoWithCoverage("uptodate-repo", {
      coveragePercentage: 81,
      status: "UpToDate",
    });
    const noStatusRepo = repoWithCoverage("nostatus-repo", {
      coveragePercentage: 85,
    });
    const noCoverageRepo = repoWithCoverage("nocoverage-repo", undefined);

    async function run(repos: any[]): Promise<string> {
      vi.mocked(
        AnalysisService.listOrganizationRepositoriesWithAnalysis
      ).mockResolvedValue({ data: repos as any });

      const program = createProgram();
      await program.parseAsync(["node", "test", "repositories", "gh", "test-org"]);

      return (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
    }

    /**
     * The output line for one repository. Row-scoped, so an assertion can't be
     * satisfied by a marker that actually belongs to a different repository.
     */
    function rowFor(output: string, name: string): string {
      const row = output.split("\n").find((line) => line.includes(name));
      expect(row, `no row for ${name}`).toBeDefined();
      return row!;
    }

    it("marks a waiting repository's value as stale and explains the marker", async () => {
      const output = await run([upToDateRepo, waitingRepo]);

      const row = rowFor(output, "waiting-repo");
      expect(row).toContain("19.0%");
      expect(row).toContain("⋯");

      expect(output).toContain(
        "⋯ no coverage report for the latest commit yet",
      );
      // The other repository is healthy, so only one legend line is warranted.
      expect(output).not.toContain("⊘");
    });

    it("replaces a stopped repository's missing value with the marker", async () => {
      const output = await run([upToDateRepo, stoppedRepo]);

      const row = rowFor(output, "stopped-repo");
      expect(row).toContain("⊘");
      // There is no percentage in a Stopped payload, and no "N/A" either — the
      // marker itself says why the cell carries no number. Counted rather than
      // matched, since complexity and duplication put their own % on the row:
      // the stopped row must have one fewer than an up-to-date one.
      const percents = (r: string) => (r.match(/%/g) || []).length;
      expect(percents(row)).toBe(
        percents(rowFor(output, "uptodate-repo")) - 1,
      );
      expect(row).not.toContain("N/A");

      expect(output).toContain("⊘ stopped receiving coverage reports");
      expect(output).not.toContain("⋯");
    });

    it("prints no markers and no legend for a healthy listing", async () => {
      const output = await run([upToDateRepo, noStatusRepo, noCoverageRepo]);

      expect(output).not.toContain("⋯");
      expect(output).not.toContain("⊘");
      expect(output).not.toContain("coverage report");
      // Unchanged rendering for the two states this feature doesn't touch.
      expect(rowFor(output, "uptodate-repo")).toContain("81.0%");
      expect(rowFor(output, "nostatus-repo")).toContain("85.0%");
      expect(rowFor(output, "nocoverage-repo")).toContain("N/A");
    });

    it("includes the coverage status fields in JSON output", async () => {
      vi.mocked(
        AnalysisService.listOrganizationRepositoriesWithAnalysis
      ).mockResolvedValue({ data: [waitingRepo, noStatusRepo] as any });

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "repositories", "gh", "test-org", "--output", "json",
      ]);

      const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
      const parsed = JSON.parse(calls[calls.length - 1][0]);

      expect(parsed[0].coverage).toEqual({
        coveragePercentage: 19,
        status: "Waiting",
        lastCommitWithCoverage: "5474cbf195db8f6fb0704d2bc9a8dc4e16065dc9",
        statusUpdatedAt: "2026-09-10T10:44:04.440743Z",
        valueUpdatedAt: "2026-09-10T01:13:16.102431Z",
      });
      // pickDeep drops undefined, so a status-less repository gains no keys.
      expect(parsed[1].coverage).not.toHaveProperty("status");
    });
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
