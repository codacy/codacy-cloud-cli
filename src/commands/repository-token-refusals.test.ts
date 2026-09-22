/**
 * Cross-cutting coverage for the commands Codacy does not accept a repository
 * (project) token on. Kept in one file rather than spread across nine command
 * suites: the guarantee under test is a single rule applied uniformly ("refuse
 * before any request"), and asserting it in one place is what makes a newly
 * added account-only command's missing guard obvious.
 *
 * Per-command behaviour that *does* work under a repository token lives in each
 * command's own suite.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerInfoCommand } from "./info";
import { registerRepositoriesCommand } from "./repositories";
import { registerLsCommand } from "./ls";
import { registerDirectoriesCommand } from "./directories";
import { registerPullRequestCommand } from "./pull-request";
import { registerPullRequestsCommand } from "./pull-requests";
import { registerIssueCommand } from "./issue";
import { registerFindingsCommand } from "./findings";
import { registerFindingCommand } from "./finding";
import { registerImagesCommand } from "./images";
import { registerImageCommand } from "./image";
import { AccountService } from "../api/client/services/AccountService";
import { AnalysisService } from "../api/client/services/AnalysisService";
import { RepositoryService } from "../api/client/services/RepositoryService";
import { SecurityService } from "../api/client/services/SecurityService";
import { SbomService } from "../api/client/services/SbomService";

vi.mock("../api/client/services/AccountService");
vi.mock("../api/client/services/AnalysisService");
vi.mock("../api/client/services/RepositoryService");
vi.mock("../api/client/services/SecurityService");
vi.mock("../api/client/services/SbomService");
vi.mock("../api/client/services/CoverageService");
vi.mock("../api/client/services/FileService");
vi.mock("../api/client/services/ToolsService");
vi.mock("../utils/credentials", () => ({ loadCredentials: vi.fn(() => null) }));
vi.mock("../utils/git-remote", () => ({
  detectRepoContext: vi.fn(() => ({
    provider: "gh",
    organization: "auto-org",
    repository: "auto-repo",
  })),
}));

/**
 * Every account-only command, with the argv that invokes it and the service call
 * that must never happen. `register` is per-case so each test builds a program
 * containing only the command under test.
 */
const ACCOUNT_ONLY_COMMANDS = [
  {
    name: "info",
    register: registerInfoCommand,
    argv: ["info"],
    neverCalled: () => AccountService.getUser,
  },
  {
    name: "repositories",
    register: registerRepositoriesCommand,
    argv: ["repositories", "gh", "test-org"],
    neverCalled: () => AnalysisService.listOrganizationRepositoriesWithAnalysis,
  },
  {
    name: "ls",
    register: registerLsCommand,
    argv: ["ls"],
    neverCalled: () => RepositoryService.listDirectories,
  },
  {
    name: "directories",
    register: registerDirectoriesCommand,
    argv: ["directories"],
    neverCalled: () => RepositoryService.listDirectories,
  },
  {
    name: "pull-request",
    register: registerPullRequestCommand,
    argv: ["pull-request", "1"],
    neverCalled: () => AnalysisService.getRepositoryPullRequest,
  },
  {
    name: "pull-requests",
    register: registerPullRequestsCommand,
    argv: ["pull-requests"],
    neverCalled: () => AnalysisService.listRepositoryPullRequests,
  },
  {
    name: "issue",
    register: registerIssueCommand,
    argv: ["issue", "12345"],
    neverCalled: () => AnalysisService.getIssue,
  },
  {
    name: "findings",
    register: registerFindingsCommand,
    argv: ["findings"],
    neverCalled: () => SecurityService.searchSecurityItems,
  },
  {
    name: "finding",
    register: registerFindingCommand,
    argv: ["finding", "gh", "test-org", "00000000-0000-0000-0000-000000000000"],
    neverCalled: () => SecurityService.getSecurityItem,
  },
  {
    name: "images",
    register: registerImagesCommand,
    argv: ["images", "gh", "test-org"],
    neverCalled: () => SbomService.listOrganizationImages,
  },
  {
    name: "image",
    register: registerImageCommand,
    argv: ["image", "gh", "test-org", "my-service"],
    neverCalled: () => SbomService.listImageTags,
  },
  // `image` has five modes behind one action callback. The guard is that
  // callback's first statement, ahead of the dispatch, so one row would cover
  // them all — but "covered by construction" is what stops being true the day
  // someone moves a mode's validation above it, and the two destructive modes
  // are the ones where that would matter.
  {
    name: "image --tag",
    register: registerImageCommand,
    argv: ["image", "gh", "test-org", "my-service", "--tag", "1.2.3"],
    neverCalled: () => SbomService.listImageTags,
  },
  {
    name: "image --tag --delete",
    register: registerImageCommand,
    argv: [
      "image", "gh", "test-org", "my-service",
      "--tag", "1.2.3", "--delete", "--skip-confirmation",
    ],
    neverCalled: () => SbomService.deleteImageTag,
  },
  {
    name: "image --delete",
    register: registerImageCommand,
    argv: [
      "image", "gh", "test-org", "my-service",
      "--delete", "--skip-confirmation",
    ],
    neverCalled: () => SbomService.deleteImageSboms,
  },
  {
    name: "image --delete --keep-latest",
    register: registerImageCommand,
    argv: [
      "image", "gh", "test-org", "my-service",
      "--delete", "--keep-latest", "1", "--skip-confirmation",
    ],
    neverCalled: () => SbomService.deleteImageTag,
  },
  {
    name: "image --upload",
    register: registerImageCommand,
    argv: [
      "image", "gh", "test-org", "my-service",
      "--tag", "1.2.3", "--upload", "./sbom.json",
    ],
    neverCalled: () => SbomService.uploadImageSbom,
  },
] as const;

function createProgram(register: (program: Command) => void): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  register(program);
  return program;
}

describe("account-only commands refuse a repository token", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CODACY_API_TOKEN;
    delete process.env.CODACY_PROJECT_TOKEN;
    vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  for (const command of ACCOUNT_ONLY_COMMANDS) {
    it(`refuses \`codacy ${command.name}\` with --repository-token, before any request`, async () => {
      const program = createProgram(command.register);

      await expect(
        program.parseAsync([
          "node",
          "test",
          ...command.argv,
          "--repository-token",
          "rt",
        ]),
      ).rejects.toThrow("process.exit called");

      const output = errorSpy.mock.calls.flat().join("\n");
      expect(output).toContain("requires an account API token");
      expect(output).toContain("run 'codacy login'");
      // The whole point of failing fast: no doomed request is ever sent.
      expect(command.neverCalled()).not.toHaveBeenCalled();
    });
  }

  it("refuses a repository token supplied via CODACY_PROJECT_TOKEN", async () => {
    process.env.CODACY_PROJECT_TOKEN = "env-project-token";
    const program = createProgram(registerFindingsCommand);

    await expect(
      program.parseAsync(["node", "test", "findings"]),
    ).rejects.toThrow("process.exit called");

    const output = errorSpy.mock.calls.flat().join("\n");
    expect(output).toContain("requires an account API token");
    // Names the env var, so the surprise is debuggable without guessing.
    expect(output).toContain("from CODACY_PROJECT_TOKEN");
    expect(SecurityService.searchSecurityItems).not.toHaveBeenCalled();
  });

  it("still works with an account token from CODACY_API_TOKEN", async () => {
    process.env.CODACY_API_TOKEN = "account-token";
    vi.mocked(AccountService.getUser).mockResolvedValue({
      data: {
        name: "Test User",
        mainEmail: "test@example.com",
        otherEmails: [],
        isAdmin: false,
        isActive: true,
      },
    } as any);
    vi.mocked(AccountService.listUserOrganizations).mockResolvedValue({
      data: [],
    } as any);

    const program = createProgram(registerInfoCommand);
    await program.parseAsync(["node", "test", "info"]);

    expect(AccountService.getUser).toHaveBeenCalledOnce();
  });
});
