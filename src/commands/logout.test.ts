import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerLogoutCommand } from "./logout";

vi.mock("../utils/credentials", () => ({
  deleteCredentials: vi.fn(),
  getCredentialsPath: vi.fn(() => "/home/test/.codacy/credentials"),
}));

vi.spyOn(console, "log").mockImplementation(() => {});

import { deleteCredentials } from "../utils/credentials";

function createProgram(): Command {
  const program = new Command();
  registerLogoutCommand(program);
  return program;
}

describe("logout command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should delete credentials and show confirmation", async () => {
    vi.mocked(deleteCredentials).mockReturnValue(true);

    const program = createProgram();
    await program.parseAsync(["node", "test", "logout"]);

    expect(deleteCredentials).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Logged out"),
    );
  });

  it("should show message when no credentials exist", async () => {
    vi.mocked(deleteCredentials).mockReturnValue(false);

    const program = createProgram();
    await program.parseAsync(["node", "test", "logout"]);

    expect(deleteCredentials).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith("No stored credentials found.");
  });
});
