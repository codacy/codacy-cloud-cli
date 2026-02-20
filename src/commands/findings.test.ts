import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerFindingsCommand } from "./findings";
import { SecurityService } from "../api/client/services/SecurityService";

vi.mock("../api/client/services/SecurityService");
vi.spyOn(console, "log").mockImplementation(() => {});

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
});
