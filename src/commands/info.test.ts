import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerInfoCommand } from "./info";
import { AccountService } from "../api/client/services/AccountService";

vi.mock("../api/client/services/AccountService");
// Suppress console output during tests
vi.spyOn(console, "log").mockImplementation(() => {});

function createProgram(): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  registerInfoCommand(program);
  return program;
}

const mockUser = {
  id: 1,
  name: "Test User",
  mainEmail: "test@example.com",
  otherEmails: ["other@example.com"],
  isAdmin: true,
  isActive: true,
  created: "2024-01-01",
};

const mockOrgs = [
  {
    name: "test-org",
    provider: "gh",
    type: "Organization",
    joinStatus: "member",
    singleProviderLogin: false,
    hasDastAccess: false,
    hasScaEnabled: false,
    imageSbomEnabled: false,
    remoteIdentifier: "123",
  },
];

describe("info command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
  });

  it("should fetch and display user info in table format", async () => {
    vi.mocked(AccountService.getUser).mockResolvedValue({ data: mockUser });
    vi.mocked(AccountService.listUserOrganizations).mockResolvedValue({
      data: mockOrgs as any,
    });

    const program = createProgram();
    await program.parseAsync(["node", "test", "info"]);

    expect(AccountService.getUser).toHaveBeenCalledOnce();
    expect(AccountService.listUserOrganizations).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalled();
  });

  it("should output JSON when --output json is specified", async () => {
    vi.mocked(AccountService.getUser).mockResolvedValue({ data: mockUser });
    vi.mocked(AccountService.listUserOrganizations).mockResolvedValue({
      data: mockOrgs as any,
    });

    const program = createProgram();
    await program.parseAsync(["node", "test", "--output", "json", "info"]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"name": "Test User"')
    );
  });

  it("should show message when no organizations found", async () => {
    vi.mocked(AccountService.getUser).mockResolvedValue({ data: mockUser });
    vi.mocked(AccountService.listUserOrganizations).mockResolvedValue({
      data: [],
    });

    const program = createProgram();
    await program.parseAsync(["node", "test", "info"]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("No organizations found")
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
      program.parseAsync(["node", "test", "info"])
    ).rejects.toThrow("process.exit called");

    mockExit.mockRestore();
  });
});
