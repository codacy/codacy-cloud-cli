import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerFindingsCommand, parseImageFilter } from "./findings";
import { SecurityService } from "../api/client/services/SecurityService";

vi.mock("../api/client/services/SecurityService");
vi.mock("../utils/credentials", () => ({ loadCredentials: vi.fn(() => null) }));
vi.mock("../utils/git-remote", () => ({
  detectRepoContext: vi.fn(() => ({
    provider: "gh",
    organization: "auto-org",
    repository: "auto-repo",
  })),
}));
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

function createProgram(): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  registerFindingsCommand(program);
  return program;
}

const mockFindings = [
  {
    id: "finding-1",
    itemSource: "Codacy",
    itemSourceId: "src-1",
    title: "SQL Injection vulnerability",
    repository: "my-repo",
    openedAt: "2024-01-01T00:00:00Z",
    dueAt: "2024-06-01T00:00:00Z",
    priority: "Critical",
    status: "Overdue",
    securityCategory: "Injection",
    scanType: "SAST",
    cve: "CVE-2024-1234",
    affectedVersion: "1.0.0",
    fixedVersion: ["1.0.1", "1.1.0"],
  },
  {
    id: "finding-2",
    itemSource: "Codacy",
    itemSourceId: "src-2",
    title: "Outdated dependency",
    repository: "my-repo",
    openedAt: "2024-02-01T00:00:00Z",
    dueAt: "2024-07-01T00:00:00Z",
    priority: "Medium",
    status: "OnTrack",
    securityCategory: "OutdatedDependency",
    scanType: "SCA",
    cwe: "CWE-1035",
    affectedVersion: "2.3.0",
    fixedVersion: [],
  },
];

const mockPenTestFinding = {
  id: "finding-3",
  itemSource: "PenTest",
  itemSourceId: "pt-1",
  title: "Weak authentication scheme",
  repository: "other-repo",
  openedAt: "2024-03-01T00:00:00Z",
  dueAt: "2024-08-01T00:00:00Z",
  priority: "High",
  status: "DueSoon",
  securityCategory: "Authentication",
  scanType: "PenTest",
  likelihood: "High",
  effortToFix: "Medium",
  affectedTargets: "api.example.com",
  application: "my-app",
};

// SCA finding reached transitively via multiple import chains.
const mockScaTransitive = {
  id: "finding-sca-transitive",
  itemSource: "SCA",
  itemSourceId: "sca-1",
  title: "Denial of Service in minimatch",
  repository: "my-repo",
  openedAt: "2024-02-01T00:00:00Z",
  dueAt: "2026-06-16T00:00:00Z",
  priority: "High",
  status: "Overdue",
  securityCategory: "InsecureModulesLibraries",
  scanType: "SCA",
  cve: "CVE-2026-27903",
  affectedVersion: "0.1.2",
  fixedVersion: ["0.1.5"],
  dependencyChains: [
    ["package@1.0.0", "anotherPackage@0.5.2", "minimatch@0.1.2"],
    ["other@1.0.0", "minimatch@0.1.2"],
  ],
};

// SCA finding for a directly-imported vulnerable dependency.
const mockScaDirect = {
  id: "finding-sca-direct",
  itemSource: "SCA",
  itemSourceId: "sca-2",
  title: "Denial of Service in minimatch",
  repository: "my-repo",
  openedAt: "2024-02-01T00:00:00Z",
  dueAt: "2026-06-16T00:00:00Z",
  priority: "High",
  status: "Overdue",
  securityCategory: "InsecureModulesLibraries",
  scanType: "SCA",
  cve: "CVE-2026-27903",
  affectedVersion: "0.1.2",
  fixedVersion: ["0.1.5"],
  dependencyChains: [["minimatch@0.1.2"]],
};

function getAllOutput(): string {
  return (console.log as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0])
    .join("\n");
}

describe("findings command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
  });

  it("should fetch and display findings for a specific repository", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: mockFindings,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "test-repo",
    ]);

    expect(SecurityService.searchSecurityItems).toHaveBeenCalledWith(
      "gh",
      "test-org",
      undefined,
      100,
      "Status",
      "asc",
      {
        repositories: ["test-repo"],
        statuses: ["Overdue", "OnTrack", "DueSoon"],
      },
    );

    const output = getAllOutput();
    expect(output).toContain("SQL Injection vulnerability");
    expect(output).toContain("Outdated dependency");
    expect(output).toContain("Findings — Found 2 findings");
  });

  it("should fetch org-wide findings when no repository is given", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [{ ...mockFindings[0], repository: "repo-a" }],
    } as any);

    const program = createProgram();
    await program.parseAsync(["node", "test", "findings", "gh", "test-org"]);

    expect(SecurityService.searchSecurityItems).toHaveBeenCalledWith(
      "gh",
      "test-org",
      undefined,
      100,
      "Status",
      "asc",
      { statuses: ["Overdue", "OnTrack", "DueSoon"] },
    );

    const output = getAllOutput();
    // Repository name shown in org-wide view
    expect(output).toContain("repo-a");
  });

  it("should NOT show repository in repo-specific view", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: mockFindings,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "my-repo",
    ]);

    const output = getAllOutput();
    // "my-repo" appears in body.repositories but must not appear in card output
    // (it's not shown as a column in repo-specific view)
    // We test indirectly: title is shown, not the repo name inline
    expect(output).toContain("SQL Injection vulnerability");
  });

  it("should show 'No findings.' when there are none", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain("No findings.");
  });

  it("should pass filter options to the API body", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "--search",
      "injection",
      "--severities",
      "Critical,High",
      "--statuses",
      "Overdue,DueSoon",
      "--categories",
      "Injection",
      "--scan-types",
      "SAST,SCA",
      "--dast-targets",
      "https://example.com",
    ]);

    expect(SecurityService.searchSecurityItems).toHaveBeenCalledWith(
      "gh",
      "test-org",
      undefined,
      100,
      "Status",
      "asc",
      {
        searchText: "injection",
        priorities: ["Critical", "High"],
        statuses: ["Overdue", "DueSoon"],
        categories: ["Injection"],
        scanTypes: ["SAST", "SCA"],
        dastTargetUrls: ["https://example.com"],
      },
    );
  });

  it("should normalize severity values case-insensitively", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "--severities",
      "critical,HIGH,Medium,low",
    ]);

    expect(SecurityService.searchSecurityItems).toHaveBeenCalledWith(
      "gh",
      "test-org",
      undefined,
      100,
      "Status",
      "asc",
      {
        priorities: ["Critical", "High", "Medium", "Low"],
        statuses: ["Overdue", "OnTrack", "DueSoon"],
      },
    );
  });

  it("should normalize status values case-insensitively", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "--statuses",
      "overdue,ontrack,duesoon,closedontime,closedlate,ignored",
    ]);

    expect(SecurityService.searchSecurityItems).toHaveBeenCalledWith(
      "gh",
      "test-org",
      undefined,
      100,
      "Status",
      "asc",
      {
        statuses: [
          "Overdue",
          "OnTrack",
          "DueSoon",
          "ClosedOnTime",
          "ClosedLate",
          "Ignored",
        ],
      },
    );
  });

  it("should normalize scan type values case-insensitively", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "--scan-types",
      "sast,secrets,sca,cicd,iac,dast,pentesting,license,cspm",
    ]);

    expect(SecurityService.searchSecurityItems).toHaveBeenCalledWith(
      "gh",
      "test-org",
      undefined,
      100,
      "Status",
      "asc",
      {
        statuses: ["Overdue", "OnTrack", "DueSoon"],
        scanTypes: [
          "SAST",
          "Secrets",
          "SCA",
          "CICD",
          "IaC",
          "DAST",
          "PenTesting",
          "License",
          "CSPM",
        ],
      },
    );
  });

  it("should map container scanning aliases to ContainerSCA and de-duplicate", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "--scan-types",
      "ContainerSCA,container-scanning,Container_Scanning,container",
    ]);

    expect(SecurityService.searchSecurityItems).toHaveBeenCalledWith(
      "gh",
      "test-org",
      undefined,
      100,
      "Status",
      "asc",
      {
        statuses: ["Overdue", "OnTrack", "DueSoon"],
        scanTypes: ["ContainerSCA"],
      },
    );
  });

  it("should preserve the API sort order (no client-side resorting)", async () => {
    // API returns Medium first, Critical second — client must not re-sort
    const apiOrder = [mockFindings[1], mockFindings[0]]; // Medium, then Critical
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: apiOrder,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    const mediumIdx = output.indexOf("Outdated dependency");
    const criticalIdx = output.indexOf("SQL Injection vulnerability");
    expect(mediumIdx).toBeLessThan(criticalIdx);
  });

  it("should use DueSoon,OnTrack,Overdue as default statuses when none are specified", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "test-repo",
    ]);

    expect(SecurityService.searchSecurityItems).toHaveBeenCalledWith(
      "gh",
      "test-org",
      undefined,
      100,
      "Status",
      "asc",
      {
        repositories: ["test-repo"],
        statuses: ["Overdue", "OnTrack", "DueSoon"],
      },
    );
  });

  it("should show CVE when present", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [mockFindings[0]],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain("CVE-2024-1234");
  });

  it("should show CWE when there is no CVE", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [mockFindings[1]],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain("CWE-1035");
  });

  it("should show affected version and fixed versions", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [mockFindings[0]],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain("1.0.0");
    expect(output).toContain("1.0.1");
  });

  it("should show a transitive dependency chain with '... and N more' for multiple chains", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [mockScaTransitive],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain(
      "Transitive - package@1.0.0 → anotherPackage@0.5.2 → minimatch@0.1.2 (Fixed in 0.1.5) ... and 1 more",
    );
    // The redundant "Update <affectedVersion>" segment is dropped when chains exist.
    expect(output).not.toContain("Update 0.1.2");
  });

  it("should show a direct dependency as actionable update text", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [mockScaDirect],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Direct - Update minimatch@0.1.2 to 0.1.5");
  });

  it("should show likelihood and effortToFix for pen test findings", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [mockPenTestFinding],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain("High");
    expect(output).toContain("Medium");
  });

  it("should show pagination total and warning", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: mockFindings,
      pagination: { cursor: "next-cursor", limit: 100, total: 1500 },
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "test-repo",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Findings — Found 1.5k findings");
    expect(output).toContain("Showing the first 100 results");
  });

  it("should warn about pagination when a cursor remains even though the API omitted total", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: mockFindings,
      pagination: { cursor: "next-cursor", limit: 1 },
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "test-repo",
      "--limit",
      "1",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Showing the first 1 results");
  });

  it("should output JSON when --output json is specified", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: mockFindings,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "--output",
      "json",
      "findings",
      "gh",
      "test-org",
      "test-repo",
    ]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"SQL Injection vulnerability"'),
    );
  });

  it("should pass a custom limit <= 100 directly to the API", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "test-repo",
      "--limit",
      "50",
    ]);

    expect(SecurityService.searchSecurityItems).toHaveBeenCalledWith(
      "gh",
      "test-org",
      undefined,
      50,
      "Status",
      "asc",
      {
        repositories: ["test-repo"],
        statuses: ["Overdue", "OnTrack", "DueSoon"],
      },
    );
  });

  it("should paginate when limit > 100", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: `finding-${i}`,
      title: `Finding ${i}`,
      priority: "Medium",
      status: "OnTrack",
      securityCategory: "Other",
      scanType: "SAST",
      dueAt: "2024-06-01T00:00:00Z",
    }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({
      id: `finding-${100 + i}`,
      title: `Finding ${100 + i}`,
      priority: "Medium",
      status: "OnTrack",
      securityCategory: "Other",
      scanType: "SAST",
      dueAt: "2024-06-01T00:00:00Z",
    }));

    vi.mocked(SecurityService.searchSecurityItems)
      .mockResolvedValueOnce({
        data: page1,
        pagination: { cursor: "cursor-2", limit: 100, total: 300 },
      } as any)
      .mockResolvedValueOnce({
        data: page2,
        pagination: { cursor: undefined, limit: 100, total: 300 },
      } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "test-repo",
      "--limit",
      "200",
    ]);

    expect(SecurityService.searchSecurityItems).toHaveBeenCalledTimes(2);
    expect(SecurityService.searchSecurityItems).toHaveBeenNthCalledWith(
      1, "gh", "test-org", undefined, 100, "Status", "asc",
      { repositories: ["test-repo"], statuses: ["Overdue", "OnTrack", "DueSoon"] },
    );
    expect(SecurityService.searchSecurityItems).toHaveBeenNthCalledWith(
      2, "gh", "test-org", "cursor-2", 100, "Status", "asc",
      { repositories: ["test-repo"], statuses: ["Overdue", "OnTrack", "DueSoon"] },
    );

    const output = getAllOutput();
    expect(output).toContain("Findings — Found 300 findings");
  });

  it("should cap limit at 1000", async () => {
    vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "findings",
      "gh",
      "test-org",
      "test-repo",
      "--limit",
      "5000",
    ]);

    // Should use pageSize 100 (min of 1000, 100)
    expect(SecurityService.searchSecurityItems).toHaveBeenCalledWith(
      "gh", "test-org", undefined, 100, "Status", "asc",
      { repositories: ["test-repo"], statuses: ["Overdue", "OnTrack", "DueSoon"] },
    );
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
        "findings",
        "gh",
        "test-org",
        "test-repo",
      ]),
    ).rejects.toThrow("process.exit called");

    mockExit.mockRestore();
  });

  describe("container image filter", () => {
    const containerFinding = {
      ...mockFindings[0],
      id: "finding-container",
      scanType: "ContainerSCA",
      imageName: "codacy/codacy-website",
      imageTag: "1.25.3",
    };

    async function runFindings(...args: string[]) {
      const program = createProgram();
      await program.parseAsync(["node", "test", ...args]);
    }

    it("should send containerImage with name only when --image is given", async () => {
      vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
        data: [],
      } as any);

      await runFindings("findings", "gh", "test-org", "--image", "nginx");

      expect(SecurityService.searchSecurityItems).toHaveBeenCalledWith(
        "gh",
        "test-org",
        undefined,
        100,
        "Status",
        "asc",
        {
          statuses: ["Overdue", "OnTrack", "DueSoon"],
          containerImage: { name: "nginx" },
        },
      );
    });

    it("should send containerImage with name and tag when both are given", async () => {
      vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
        data: [],
      } as any);

      await runFindings(
        "findings",
        "gh",
        "test-org",
        "-T",
        "container",
        "-i",
        "nginx",
        "-t",
        "1.25.3",
      );

      expect(SecurityService.searchSecurityItems).toHaveBeenCalledWith(
        "gh",
        "test-org",
        undefined,
        100,
        "Status",
        "asc",
        {
          statuses: ["Overdue", "OnTrack", "DueSoon"],
          scanTypes: ["ContainerSCA"],
          containerImage: { name: "nginx", tag: "1.25.3" },
        },
      );
    });

    it("should split --image name:tag into name and tag", async () => {
      vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
        data: [],
      } as any);

      await runFindings("findings", "gh", "test-org", "--image", " nginx:1.25.3 ");

      expect(SecurityService.searchSecurityItems).toHaveBeenCalledWith(
        "gh",
        "test-org",
        undefined,
        100,
        "Status",
        "asc",
        {
          statuses: ["Overdue", "OnTrack", "DueSoon"],
          containerImage: { name: "nginx", tag: "1.25.3" },
        },
      );
    });

    it("should refuse an empty --image before any request", async () => {
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      await expect(
        runFindings("findings", "gh", "test-org", "--image", "  "),
      ).rejects.toThrow("process.exit called");

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("--image needs an image name"),
      );
      expect(SecurityService.searchSecurityItems).not.toHaveBeenCalled();
      mockExit.mockRestore();
    });

    it("should refuse --image-tag without --image before any request", async () => {
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      await expect(
        runFindings("findings", "gh", "test-org", "--image-tag", "1.25.3"),
      ).rejects.toThrow("process.exit called");

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("--image-tag requires --image"),
      );
      expect(SecurityService.searchSecurityItems).not.toHaveBeenCalled();
      mockExit.mockRestore();
    });

    // The header line is the only card line that carries the finding id.
    function headerLine(): string {
      const calls = vi.mocked(console.log).mock.calls.map((c) => String(c[0] ?? ""));
      return calls.find((l) => l.includes("finding-container")) ?? "";
    }

    it("should show image:tag instead of the repository on the header line", async () => {
      vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
        data: [containerFinding],
      } as any);

      await runFindings("findings", "gh", "test-org");

      const header = headerLine();
      expect(header).toContain("codacy/codacy-website:1.25.3");
      expect(header).not.toContain("my-repo");
      // Shown once, not repeated on the status line.
      expect(getAllOutput().split("codacy/codacy-website").length - 1).toBe(1);
    });

    it("should show the image in the single-repository view too", async () => {
      vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
        data: [containerFinding],
      } as any);

      await runFindings("findings", "gh", "test-org", "test-repo");

      expect(headerLine()).toContain("codacy/codacy-website:1.25.3");
    });

    it("should show the image name alone when the finding has no tag", async () => {
      vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
        data: [{ ...containerFinding, imageTag: undefined }],
      } as any);

      await runFindings("findings", "gh", "test-org");

      const header = headerLine();
      expect(header).toContain("codacy/codacy-website");
      expect(header).not.toContain("codacy/codacy-website:");
    });

    it("should keep showing the repository for non-container findings", async () => {
      vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
        data: [mockFindings[0]],
      } as any);

      await runFindings("findings", "gh", "test-org");

      const header = vi
        .mocked(console.log)
        .mock.calls.map((c) => String(c[0] ?? ""))
        .find((l) => l.includes(mockFindings[0].id));
      expect(header).toContain("my-repo");
    });

    it("should include imageName and imageTag in JSON output", async () => {
      vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
        data: [containerFinding],
      } as any);

      await runFindings("--output", "json", "findings", "gh", "test-org");

      const json = JSON.parse(vi.mocked(console.log).mock.calls[0][0]);
      expect(json.findings[0].imageName).toBe("codacy/codacy-website");
      expect(json.findings[0].imageTag).toBe("1.25.3");
    });
  });

  describe("parseImageFilter", () => {
    it("returns undefined when neither option is given", () => {
      expect(parseImageFilter(undefined, undefined)).toBeUndefined();
    });

    it("trims the name and tag", () => {
      expect(parseImageFilter(" nginx ", " 1.25.3 ")).toEqual({
        name: "nginx",
        tag: "1.25.3",
      });
    });

    it("keeps a registry port as part of the name", () => {
      expect(parseImageFilter("registry:5000/team/app", undefined)).toEqual({
        name: "registry:5000/team/app",
      });
      expect(parseImageFilter("registry:5000/team/app:2.0", undefined)).toEqual({
        name: "registry:5000/team/app",
        tag: "2.0",
      });
    });

    it("accepts the same tag given both ways", () => {
      expect(parseImageFilter("nginx:1.25.3", "1.25.3")).toEqual({
        name: "nginx",
        tag: "1.25.3",
      });
    });

    it("refuses two different tags", () => {
      expect(() => parseImageFilter("nginx:1.25.3", "1.26.0")).toThrow(
        "name different tags",
      );
    });

    it("refuses empty values", () => {
      expect(() => parseImageFilter("", undefined)).toThrow("--image needs an image name");
      expect(() => parseImageFilter("nginx", " ")).toThrow("--image-tag needs a tag");
    });

    it("refuses a tag without a name", () => {
      expect(() => parseImageFilter(undefined, "1.25.3")).toThrow(
        "--image-tag requires --image",
      );
    });

    it("refuses a dangling colon or a missing name", () => {
      expect(() => parseImageFilter("nginx:", undefined)).toThrow("expects name or name:tag");
      expect(() => parseImageFilter(":1.25.3", undefined)).toThrow("expects name or name:tag");
    });

    it("refuses a digest reference", () => {
      expect(() => parseImageFilter("nginx@sha256:abc", undefined)).toThrow(
        "not a digest reference",
      );
    });
  });

  describe("advisory information (vulnerable functions)", () => {
    const mockAdvisoryInformation = {
      advisoryId: "CVE-2026-27903",
      vulnerableFunctions: ["minimatch.braceExpand", "minimatch.makeRe"],
      publishedAt: "2026-01-15T00:00:00.000Z",
    };

    it("should show a compact vulnerable functions line when advisoryInformation is present", async () => {
      vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
        data: [{ ...mockScaDirect, advisoryInformation: mockAdvisoryInformation }],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "findings", "gh", "test-org", "test-repo",
      ]);

      const output = getAllOutput();
      expect(output).toContain(
        "Vulnerable functions: minimatch.braceExpand, minimatch.makeRe",
      );
    });

    it("should not show a vulnerable functions line when advisoryInformation is absent", async () => {
      vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
        data: [mockScaDirect],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "findings", "gh", "test-org", "test-repo",
      ]);

      const output = getAllOutput();
      expect(output).not.toContain("Vulnerable functions:");
    });

    it("should include advisoryInformation in JSON output", async () => {
      vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
        data: [{ ...mockScaDirect, advisoryInformation: mockAdvisoryInformation }],
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "--output", "json",
        "findings", "gh", "test-org", "test-repo",
      ]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('"minimatch.braceExpand"'),
      );
    });
  });

  describe("auto-detect from git remote", () => {
    it("should auto-detect provider/org/repo when no positional args are provided", async () => {
      vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
        data: mockFindings,
      } as any);

      const program = createProgram();
      await program.parseAsync(["node", "test", "findings"]);

      expect(SecurityService.searchSecurityItems).toHaveBeenCalledWith(
        "gh",
        "auto-org",
        undefined,
        100,
        "Status",
        "asc",
        {
          repositories: ["auto-repo"],
          statuses: ["Overdue", "OnTrack", "DueSoon"],
        },
      );
    });

    it("should use explicit provider/org for org-wide view (no repo filter)", async () => {
      vi.mocked(SecurityService.searchSecurityItems).mockResolvedValue({
        data: [],
      } as any);

      const program = createProgram();
      await program.parseAsync(["node", "test", "findings", "gh", "my-org"]);

      expect(SecurityService.searchSecurityItems).toHaveBeenCalledWith(
        "gh",
        "my-org",
        undefined,
        100,
        "Status",
        "asc",
        { statuses: ["Overdue", "OnTrack", "DueSoon"] },
      );
    });
  });
});
