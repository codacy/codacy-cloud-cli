import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerFindingCommand } from "./finding";
import { SecurityService } from "../api/client/services/SecurityService";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { ToolsService } from "../api/client/services/ToolsService";
import { FileService } from "../api/client/services/FileService";

vi.mock("../api/client/services/SecurityService");
vi.mock("../api/client/services/AnalysisService");
vi.mock("../api/client/services/ToolsService");
vi.mock("../api/client/services/FileService");
vi.mock("../utils/credentials", () => ({ loadCredentials: vi.fn(() => null) }));
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

// Mock global fetch for CVE API calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockFetchSuccess(data: unknown): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => data,
  });
}

function mockFetchFailure(): void {
  mockFetch.mockResolvedValue({ ok: false });
}

const mockCveRecord = {
  dataType: "CVE_RECORD",
  dataVersion: "5.0",
  cveMetadata: {
    cveId: "CVE-2021-23337",
    assignerOrgId: "00000000-0000-0000-0000-000000000000",
    state: "PUBLISHED",
    datePublished: "2021-02-15T00:00:00Z",
    dateUpdated: "2021-02-18T00:00:00Z",
  },
  containers: {
    cna: {
      providerMetadata: {
        orgId: "00000000-0000-0000-0000-000000000000",
        dateUpdated: "2021-02-18T00:00:00Z",
      },
      title: "Prototype Pollution via the merge function",
      descriptions: [
        { lang: "en", value: "lodash prior to 4.17.21 is vulnerable to Prototype Pollution." },
      ],
      metrics: [
        {
          format: "CVSS",
          cvssV3_1: {
            version: "3.1",
            vectorString: "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H",
            baseScore: 7.2,
            baseSeverity: "High",
          },
        },
      ],
      references: [
        { url: "https://nvd.nist.gov/vuln/detail/CVE-2021-23337" },
        { url: "https://github.com/lodash/lodash/commit/ded9bc67a" },
      ],
    },
    adp: [
      {
        providerMetadata: {
          orgId: "af854a3a-2127-422b-91ae-364da2661108",
          dateUpdated: "2024-08-04T01:00:00Z",
        },
        references: [
          // duplicate of cna ref — should be deduplicated
          { url: "https://nvd.nist.gov/vuln/detail/CVE-2021-23337" },
          { url: "https://security.snyk.io/vuln/SNYK-JS-LODASH-1040724" },
        ],
      },
    ],
  },
};

function createProgram(): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  registerFindingCommand(program);
  return program;
}

// A non-Codacy finding (SCA source with CVE)
const mockScaFinding = {
  id: "abc-123-sca",
  itemSource: "SCA" as any,
  itemSourceId: "npm-lodash-123",
  title: "Prototype Pollution in lodash",
  repository: "my-repo",
  openedAt: "2025-01-01T00:00:00Z",
  dueAt: "2025-06-01T00:00:00Z",
  priority: "High",
  status: "OnTrack",
  securityCategory: "Injection",
  scanType: "SCA",
  cve: "CVE-2021-23337",
  affectedVersion: "4.17.20",
  fixedVersion: ["4.17.21"],
  summary: "lodash has a prototype pollution vulnerability",
  remediation: "Upgrade to lodash >= 4.17.21",
};

// A Codacy-source finding linked to a quality issue
const mockCodacyFinding = {
  id: "def-456-codacy",
  itemSource: "Codacy" as any,
  itemSourceId: "42",
  title: "SQL Injection vulnerability detected",
  repository: "my-repo",
  openedAt: "2025-01-01T00:00:00Z",
  dueAt: "2025-07-01T00:00:00Z",
  priority: "Critical",
  status: "Overdue",
  securityCategory: "Injection",
  scanType: "SAST",
};

// An ignored finding
const mockIgnoredFinding = {
  ...mockScaFinding,
  id: "ghi-789-ignored",
  status: "Ignored",
  ignored: {
    at: "2025-03-15T10:00:00Z",
    authorId: 1,
    authorName: "alice",
    reason: "False positive — internal tool only",
  },
};

// A finding with penetration testing fields
const mockPenTestFinding = {
  id: "jkl-012-pentest",
  itemSource: "PenTest" as any,
  itemSourceId: "pentest-001",
  title: "Cross-Site Scripting via unescaped user input",
  repository: "my-repo",
  openedAt: "2025-01-01T00:00:00Z",
  dueAt: "2025-08-01T00:00:00Z",
  priority: "Medium",
  status: "DueSoon",
  securityCategory: "XSS",
  scanType: "PenTesting",
  likelihood: "High",
  effortToFix: "Low",
  additionalInfo: "Found via manual penetration test session",
};

const mockQualityIssue = {
  issueId: "uuid-sql-001",
  resultDataId: 42,
  filePath: "src/db.ts",
  fileId: 10,
  patternInfo: {
    id: "sql-injection",
    title: "SQL Injection",
    category: "Security",
    subCategory: "Injection",
    severityLevel: "Error",
    level: "Error",
  },
  toolInfo: { uuid: "tool-uuid-semgrep", name: "Semgrep" },
  lineNumber: 30,
  message: "Potential SQL injection vulnerability",
  language: "TypeScript",
  lineText: '  db.query(`SELECT * FROM users WHERE id = ${id}`);',
  falsePositiveThreshold: 0.5,
};

const mockPattern = {
  id: "sql-injection",
  title: "SQL Injection",
  category: "Security",
  subCategory: "Injection",
  severityLevel: "Error",
  level: "Error",
  enabled: true,
  parameters: [],
  description: "Detects SQL injection vulnerabilities.",
  rationale: "Attackers can manipulate queries to access unauthorized data.",
  solution: "Use parameterized queries or prepared statements.",
  tags: ["security", "owasp-a1"],
};

const mockFileLines = [
  { number: 25, content: "function getUser(id: string) {" },
  { number: 30, content: '  db.query(`SELECT * FROM users WHERE id = ${id}`);' },
  { number: 35, content: "}" },
];

function getAllOutput(): string {
  return (console.log as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0])
    .join("\n");
}

describe("finding command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
    // Default: CVE fetch returns not-found so existing tests aren't affected
    mockFetchFailure();
  });

  it("should fetch and display a non-Codacy finding with CVE and remediation", async () => {
    vi.mocked(SecurityService.getSecurityItem).mockResolvedValue({
      data: mockScaFinding,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "finding", "gh", "test-org", "abc-123-sca",
    ]);

    expect(SecurityService.getSecurityItem).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "abc-123-sca",
    );
    // getIssue should NOT be called (not Codacy source)
    expect(AnalysisService.getIssue).not.toHaveBeenCalled();

    const output = getAllOutput();
    expect(output).toContain("Prototype Pollution in lodash");
    expect(output).toContain("CVE-2021-23337");
    expect(output).toContain("4.17.20");
    expect(output).toContain("4.17.21");
    expect(output).toContain("lodash has a prototype pollution vulnerability");
    expect(output).toContain("Remediation:");
    expect(output).toContain("Upgrade to lodash");
    expect(output).toContain("abc-123-sca");
  });

  it("should show pattern info for Codacy-source findings", async () => {
    vi.mocked(SecurityService.getSecurityItem).mockResolvedValue({
      data: mockCodacyFinding,
    } as any);
    vi.mocked(AnalysisService.getIssue).mockResolvedValue({
      data: mockQualityIssue,
    } as any);
    vi.mocked(ToolsService.getPattern).mockResolvedValue({
      data: mockPattern,
    } as any);
    vi.mocked(FileService.getFileContent).mockResolvedValue({
      data: mockFileLines,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "finding", "gh", "test-org", "def-456-codacy",
    ]);

    expect(AnalysisService.getIssue).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "my-repo",
      42,
    );
    expect(ToolsService.getPattern).toHaveBeenCalledWith(
      "tool-uuid-semgrep",
      "sql-injection",
    );
    expect(FileService.getFileContent).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "my-repo",
      "src%2Fdb.ts",
      25,
      35,
    );

    const output = getAllOutput();
    expect(output).toContain("SQL Injection vulnerability detected");
    expect(output).toContain("src/db.ts:30");
    expect(output).toContain("About this pattern");
    expect(output).toContain("Detects SQL injection vulnerabilities.");
    expect(output).toContain("Why is this a problem?");
    expect(output).toContain("Attackers can manipulate queries");
    expect(output).toContain("How to fix it?");
    expect(output).toContain("Use parameterized queries or prepared statements.");
    expect(output).toContain("Detected by: Semgrep");
    expect(output).toContain("SQL Injection (sql-injection)");
    expect(output).toContain("def-456-codacy");
  });

  it("should show ignored info when finding is ignored", async () => {
    vi.mocked(SecurityService.getSecurityItem).mockResolvedValue({
      data: mockIgnoredFinding,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "finding", "gh", "test-org", "ghi-789-ignored",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Ignored by alice on 2025-03-15");
    expect(output).toContain("False positive — internal tool only");
  });

  it("should show penetration testing fields (likelihood, effortToFix, additionalInfo)", async () => {
    vi.mocked(SecurityService.getSecurityItem).mockResolvedValue({
      data: mockPenTestFinding,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "finding", "gh", "test-org", "jkl-012-pentest",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Cross-Site Scripting via unescaped user input");
    expect(output).toContain("High");   // likelihood
    expect(output).toContain("Low");    // effortToFix
    expect(output).toContain("Found via manual penetration test session");
  });

  it("should still show finding when issue fetch fails for Codacy source", async () => {
    vi.mocked(SecurityService.getSecurityItem).mockResolvedValue({
      data: mockCodacyFinding,
    } as any);
    vi.mocked(AnalysisService.getIssue).mockRejectedValue(
      new Error("Issue not found"),
    );

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "finding", "gh", "test-org", "def-456-codacy",
    ]);

    const output = getAllOutput();
    // Finding title still shown
    expect(output).toContain("SQL Injection vulnerability detected");
    // Pattern info NOT shown (issue fetch failed)
    expect(output).not.toContain("Why is this a problem?");
  });

  it("should still show finding when pattern fetch fails for Codacy source", async () => {
    vi.mocked(SecurityService.getSecurityItem).mockResolvedValue({
      data: mockCodacyFinding,
    } as any);
    vi.mocked(AnalysisService.getIssue).mockResolvedValue({
      data: mockQualityIssue,
    } as any);
    vi.mocked(ToolsService.getPattern).mockRejectedValue(
      new Error("Pattern not found"),
    );
    vi.mocked(FileService.getFileContent).mockResolvedValue({
      data: mockFileLines,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "finding", "gh", "test-org", "def-456-codacy",
    ]);

    const output = getAllOutput();
    expect(output).toContain("SQL Injection vulnerability detected");
    // File context still shown even without pattern
    expect(output).toContain("src/db.ts:30");
    // But pattern docs not shown
    expect(output).not.toContain("Why is this a problem?");
  });

  it("should output JSON when --output json is specified", async () => {
    vi.mocked(SecurityService.getSecurityItem).mockResolvedValue({
      data: mockScaFinding,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "--output", "json",
      "finding", "gh", "test-org", "abc-123-sca",
    ]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"Prototype Pollution in lodash"'),
    );
  });

  it("should output JSON including issue and pattern for Codacy source", async () => {
    vi.mocked(SecurityService.getSecurityItem).mockResolvedValue({
      data: mockCodacyFinding,
    } as any);
    vi.mocked(AnalysisService.getIssue).mockResolvedValue({
      data: mockQualityIssue,
    } as any);
    vi.mocked(ToolsService.getPattern).mockResolvedValue({
      data: mockPattern,
    } as any);
    vi.mocked(FileService.getFileContent).mockResolvedValue({
      data: mockFileLines,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "--output", "json",
      "finding", "gh", "test-org", "def-456-codacy",
    ]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"SQL Injection vulnerability detected"'),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"Detects SQL injection vulnerabilities."'),
    );
  });

  it("should fetch and display CVE enrichment when cve field is present", async () => {
    vi.mocked(SecurityService.getSecurityItem).mockResolvedValue({
      data: mockScaFinding, // has cve: "CVE-2021-23337"
    } as any);
    mockFetchSuccess(mockCveRecord);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "finding", "gh", "test-org", "abc-123-sca",
    ]);

    // fetch should have been called with the CVE URL
    expect(mockFetch).toHaveBeenCalledWith(
      "https://cveawg.mitre.org/api/cve/CVE-2021-23337",
    );

    const output = getAllOutput();
    expect(output).toContain("About CVE-2021-23337");  // heading
    expect(output).toContain("7.2");               // CVSS score
    expect(output).toContain("High");              // CVSS severity
    expect(output).toContain("2021-02-15");        // datePublished
    expect(output).toContain("Prototype Pollution via the merge function"); // cna.title
    expect(output).toContain("lodash prior to 4.17.21");                   // description
    expect(output).toContain("References:");
    expect(output).toContain("https://nvd.nist.gov/vuln/detail/CVE-2021-23337");
    expect(output).toContain("https://github.com/lodash/lodash/commit/ded9bc67a");
    // adp-only ref should appear; duplicated nvd ref should appear only once
    expect(output).toContain("https://security.snyk.io/vuln/SNYK-JS-LODASH-1040724");
    const nvdCount = (output.match(/nvd\.nist\.gov/g) || []).length;
    expect(nvdCount).toBe(1); // deduplicated
  });

  it("should skip CVE block when fetch fails", async () => {
    vi.mocked(SecurityService.getSecurityItem).mockResolvedValue({
      data: mockScaFinding,
    } as any);
    mockFetchFailure(); // already the default, but be explicit

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "finding", "gh", "test-org", "abc-123-sca",
    ]);

    const output = getAllOutput();
    // Finding is still shown
    expect(output).toContain("Prototype Pollution in lodash");
    // But CVE block is absent
    expect(output).not.toContain("References:");
    expect(output).not.toContain("CVSS:");
  });

  it("should skip CVE block when fetch throws a network error", async () => {
    vi.mocked(SecurityService.getSecurityItem).mockResolvedValue({
      data: mockScaFinding,
    } as any);
    mockFetch.mockRejectedValue(new Error("Network error"));

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "finding", "gh", "test-org", "abc-123-sca",
    ]);

    const output = getAllOutput();
    expect(output).toContain("Prototype Pollution in lodash");
    expect(output).not.toContain("CVSS:");
  });

  it("should not call CVE fetch when finding has no cve field", async () => {
    vi.mocked(SecurityService.getSecurityItem).mockResolvedValue({
      data: mockCodacyFinding, // no cve field
    } as any);
    vi.mocked(AnalysisService.getIssue).mockResolvedValue({
      data: mockQualityIssue,
    } as any);
    vi.mocked(ToolsService.getPattern).mockResolvedValue({
      data: mockPattern,
    } as any);
    vi.mocked(FileService.getFileContent).mockResolvedValue({
      data: mockFileLines,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "finding", "gh", "test-org", "def-456-codacy",
    ]);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should include cve data in JSON output when present", async () => {
    vi.mocked(SecurityService.getSecurityItem).mockResolvedValue({
      data: mockScaFinding,
    } as any);
    mockFetchSuccess(mockCveRecord);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "--output", "json",
      "finding", "gh", "test-org", "abc-123-sca",
    ]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"CVE-2021-23337"'),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"Prototype Pollution via the merge function"'),
    );
  });

  it("should fail when CODACY_API_TOKEN is not set", async () => {
    delete process.env.CODACY_API_TOKEN;

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    const program = createProgram();
    await expect(
      program.parseAsync([
        "node", "test", "finding", "gh", "test-org", "abc-123",
      ]),
    ).rejects.toThrow("process.exit called");

    mockExit.mockRestore();
  });

  describe("--ignore option", () => {
    beforeEach(() => {
      vi.mocked(SecurityService.getSecurityItem).mockResolvedValue({
        data: mockScaFinding,
      } as any);
      vi.mocked(SecurityService.ignoreSecurityItem).mockResolvedValue({
        data: mockScaFinding,
      } as any);
    });

    it("should call ignoreSecurityItem with default reason when --ignore is specified", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "finding", "gh", "test-org", "abc-123-sca",
        "--ignore",
      ]);

      expect(SecurityService.ignoreSecurityItem).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "abc-123-sca",
        { reason: "AcceptedUse", comment: undefined },
      );
      // Finding details should NOT be shown when --ignore is passed
      const output = getAllOutput();
      expect(output).not.toContain("Prototype Pollution in lodash");
    });

    it("should call ignoreSecurityItem with specified reason", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "finding", "gh", "test-org", "abc-123-sca",
        "--ignore", "--ignore-reason", "FalsePositive",
      ]);

      expect(SecurityService.ignoreSecurityItem).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "abc-123-sca",
        { reason: "FalsePositive", comment: undefined },
      );
    });

    it("should pass ignore comment when --ignore-comment is specified", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "finding", "gh", "test-org", "abc-123-sca",
        "--ignore", "--ignore-comment", "Verified safe in this context",
      ]);

      expect(SecurityService.ignoreSecurityItem).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "abc-123-sca",
        { reason: "AcceptedUse", comment: "Verified safe in this context" },
      );
    });

    it("should not call ignoreSecurityItem when --ignore is not specified", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "finding", "gh", "test-org", "abc-123-sca",
      ]);

      expect(SecurityService.ignoreSecurityItem).not.toHaveBeenCalled();
    });
  });

  describe("--unignore option", () => {
    beforeEach(() => {
      vi.mocked(SecurityService.getSecurityItem).mockResolvedValue({
        data: mockScaFinding,
      } as any);
      vi.mocked(SecurityService.unignoreSecurityItem).mockResolvedValue({
        data: mockScaFinding,
      } as any);
    });

    it("should call unignoreSecurityItem when --unignore is specified", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "finding", "gh", "test-org", "abc-123-sca",
        "--unignore",
      ]);

      expect(SecurityService.unignoreSecurityItem).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "abc-123-sca",
      );
    });

    it("should not render finding details when --unignore is specified", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "finding", "gh", "test-org", "abc-123-sca",
        "--unignore",
      ]);

      const output = getAllOutput();
      expect(output).not.toContain("Prototype Pollution in lodash");
    });

    it("should not call unignoreSecurityItem when --unignore is not specified", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "finding", "gh", "test-org", "abc-123-sca",
      ]);

      expect(SecurityService.unignoreSecurityItem).not.toHaveBeenCalled();
    });
  });
});
