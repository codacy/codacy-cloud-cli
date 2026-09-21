import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerImageCommand } from "./image";
import { SbomService } from "../api/client/services/SbomService";
import * as prompt from "../utils/prompt";

vi.mock("../api/client/services/SbomService");
vi.mock("../utils/credentials", () => ({ loadCredentials: vi.fn(() => null) }));
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

function createProgram(): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  registerImageCommand(program);
  return program;
}

function getAllOutput(): string {
  return (console.log as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0])
    .join("\n");
}

function mockTag(overrides: Record<string, unknown> = {}) {
  return {
    imageName: "my-service",
    tag: "1.2.3",
    environment: "production",
    repositoryId: 7,
    repositoryName: "my-repo",
    generatedAt: "2025-06-14T09:00:00Z",
    uploadedAt: "2025-06-14T10:00:00Z",
    lastAnalysedAt: "2025-06-15T00:00:00Z",
    ...overrides,
  };
}

describe("image command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
    delete process.env.CODACY_PROJECT_TOKEN;
  });

  describe("listing tags", () => {
    it("lists an image's tags", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: [mockTag(), mockTag({ tag: "1.2.2", environment: undefined })],
        pagination: { total: 2 },
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
      ]);

      expect(SbomService.listImageTags).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "my-service",
        undefined,
        100,
      );
      const output = getAllOutput();
      expect(output).toContain("Tags for my-service in test-org (gh)");
      expect(output).toContain("Found 2 tags");
      expect(output).toContain("1.2.3");
      expect(output).toContain("production");
      expect(output).toContain("my-repo");
    });

    it("paginates up to --limit and warns when more remain", async () => {
      vi.mocked(SbomService.listImageTags)
        .mockResolvedValueOnce({
          data: [mockTag()],
          pagination: { cursor: "next", total: 300 },
        } as any)
        .mockResolvedValueOnce({
          data: [mockTag({ tag: "1.2.2" })],
          pagination: { cursor: "more", total: 300 },
        } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service", "--limit", "2",
      ]);

      expect(SbomService.listImageTags).toHaveBeenCalledTimes(2);
      expect(getAllOutput()).toContain(
        "Use --limit <n> (max 1000) to fetch more.",
      );
    });

    it("prints an empty-state message when the image has no tags", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: [],
        pagination: {},
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
      ]);

      expect(getAllOutput()).toContain("No tags found for my-service.");
    });

    it("outputs JSON, projecting lastAnalysedAt and not the deprecated scanStatus", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: [mockTag({ scanStatus: "2025-01-01T00:00:00Z" })],
        pagination: {},
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "--output", "json",
        "image", "gh", "test-org", "my-service",
      ]);

      const parsed = JSON.parse(getAllOutput());
      expect(parsed).toEqual([
        {
          imageName: "my-service",
          tag: "1.2.3",
          environment: "production",
          repositoryId: 7,
          repositoryName: "my-repo",
          generatedAt: "2025-06-14T09:00:00Z",
          uploadedAt: "2025-06-14T10:00:00Z",
          lastAnalysedAt: "2025-06-15T00:00:00Z",
        },
      ]);
      expect(parsed[0]).not.toHaveProperty("scanStatus");
    });

    it("neutralizes terminal escape sequences in tag metadata", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: [mockTag({ tag: "evil\u001b[31m", environment: "prod\u001b[0m" })],
        pagination: {},
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
      ]);

      const output = getAllOutput();
      expect(output).not.toContain("evil\u001b[31m");
      expect(output).toContain("evil^[");
    });
  });

  describe("--tag (no action)", () => {
    it("shows one tag's details, paging until it is found", async () => {
      vi.mocked(SbomService.listImageTags)
        .mockResolvedValueOnce({
          data: [mockTag({ tag: "1.2.2" })],
          pagination: { cursor: "next" },
        } as any)
        .mockResolvedValueOnce({
          data: [mockTag({ tag: "1.2.3", environment: "staging" })],
          pagination: {},
        } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service", "--tag", "1.2.3",
      ]);

      // The tags endpoint has no per-tag filter, so the lookup keeps paging.
      expect(SbomService.listImageTags).toHaveBeenCalledTimes(2);
      const output = getAllOutput();
      expect(output).toContain("my-service:1.2.3");
      expect(output).toContain("staging");
    });

    it("errors when the tag does not exist", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: [mockTag({ tag: "1.2.2" })],
        pagination: {},
      } as any);

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "image", "gh", "test-org", "my-service",
          "--tag", "9.9.9",
        ]),
      ).rejects.toThrow("process.exit called");

      const errors = (console.error as ReturnType<typeof vi.fn>).mock.calls
        .flat()
        .join("\n");
      expect(errors).toContain("Tag '9.9.9' not found on image 'my-service'");
      exit.mockRestore();
    });

    it("outputs a single object in JSON, not an array", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: [mockTag()],
        pagination: {},
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "--output", "json",
        "image", "gh", "test-org", "my-service", "--tag", "1.2.3",
      ]);

      expect(JSON.parse(getAllOutput())).toMatchObject({
        imageName: "my-service",
        tag: "1.2.3",
      });
    });
  });

  describe("--delete --tag <tag>", () => {
    it("confirms, warns about the metrics wipe, then deletes just that tag", async () => {
      const confirm = vi.spyOn(prompt, "confirmAction").mockResolvedValue(true);
      vi.mocked(SbomService.deleteImageTag).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--tag", "1.2.3", "--delete",
      ]);

      expect(getAllOutput()).toContain(
        "zeroes Container Scanning metrics for the whole organization",
      );
      expect(confirm).toHaveBeenCalledWith(
        "Delete the SBOM for my-service:1.2.3? This cannot be undone.",
      );
      expect(SbomService.deleteImageTag).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "my-service",
        "1.2.3",
      );
      // Scoped to a tag: the whole-image delete must never fire.
      expect(SbomService.deleteImageSboms).not.toHaveBeenCalled();
    });

    it("deletes nothing when the confirmation is declined", async () => {
      vi.spyOn(prompt, "confirmAction").mockResolvedValue(false);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--tag", "1.2.3", "--delete",
      ]);

      expect(SbomService.deleteImageTag).not.toHaveBeenCalled();
      expect(getAllOutput()).toContain("nothing was deleted");
    });

    it("skips the prompt with --skip-confirmation", async () => {
      const confirm = vi.spyOn(prompt, "confirmAction");
      vi.mocked(SbomService.deleteImageTag).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--tag", "1.2.3", "--delete", "--skip-confirmation",
      ]);

      expect(confirm).not.toHaveBeenCalled();
      expect(SbomService.deleteImageTag).toHaveBeenCalledOnce();
    });

    it("never lists tags when deleting one", async () => {
      vi.spyOn(prompt, "confirmAction").mockResolvedValue(true);
      vi.mocked(SbomService.deleteImageTag).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--tag", "1.2.3", "--delete",
      ]);

      expect(SbomService.listImageTags).not.toHaveBeenCalled();
    });
  });

  describe("--delete (whole image)", () => {
    it("names the tag count in the confirmation, then deletes the image", async () => {
      const confirm = vi.spyOn(prompt, "confirmAction").mockResolvedValue(true);
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: [],
        pagination: { total: 85 },
      } as any);
      vi.mocked(SbomService.deleteImageSboms).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service", "--delete",
      ]);

      // Cheapest shape that answers "how many": one row, read from the total.
      expect(SbomService.listImageTags).toHaveBeenCalledWith(
        "gh", "test-org", "my-service", undefined, 1,
      );
      expect(confirm).toHaveBeenCalledWith(
        "Delete my-service and all 85 of its tags? This cannot be undone.",
      );
      expect(SbomService.deleteImageSboms).toHaveBeenCalledWith(
        "gh",
        "test-org",
        "my-service",
      );
    });

    it("still offers the delete when the tag count can't be fetched", async () => {
      const confirm = vi.spyOn(prompt, "confirmAction").mockResolvedValue(true);
      vi.mocked(SbomService.listImageTags).mockRejectedValue(new Error("boom"));
      vi.mocked(SbomService.deleteImageSboms).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service", "--delete",
      ]);

      expect(confirm).toHaveBeenCalledWith(
        "Delete my-service and all of its tags? This cannot be undone.",
      );
      expect(SbomService.deleteImageSboms).toHaveBeenCalledOnce();
    });

    it("deletes nothing when the confirmation is declined", async () => {
      vi.spyOn(prompt, "confirmAction").mockResolvedValue(false);
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: [],
        pagination: { total: 2 },
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service", "--delete",
      ]);

      expect(SbomService.deleteImageSboms).not.toHaveBeenCalled();
      expect(getAllOutput()).toContain("nothing was deleted");
    });

    it("skips both the count lookup and the prompt with --skip-confirmation", async () => {
      const confirm = vi.spyOn(prompt, "confirmAction");
      vi.mocked(SbomService.deleteImageSboms).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--delete", "--skip-confirmation",
      ]);

      expect(confirm).not.toHaveBeenCalled();
      expect(SbomService.listImageTags).not.toHaveBeenCalled();
      expect(SbomService.deleteImageSboms).toHaveBeenCalledOnce();
    });
  });
});
