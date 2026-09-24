import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { registerImageCommand } from "./image";
import { SbomService } from "../api/client/services/SbomService";
import { ApiError } from "../api/client/core/ApiError";
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

function errorOutput(): string {
  return (console.error as ReturnType<typeof vi.fn>).mock.calls
    .flat()
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
    it("confirms, then deletes just that tag", async () => {
      const confirm = vi.spyOn(prompt, "confirmAction").mockResolvedValue(true);
      vi.mocked(SbomService.deleteImageTag).mockResolvedValue(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--tag", "1.2.3", "--delete",
      ]);

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

    it("reports a declined confirmation as JSON under --output json", async () => {
      vi.spyOn(prompt, "confirmAction").mockResolvedValue(false);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "--output", "json", "image", "gh", "test-org",
        "my-service", "--tag", "1.2.3", "--delete",
      ]);

      expect(SbomService.deleteImageTag).not.toHaveBeenCalled();
      // Parseable, rather than a prose line a pipeline would choke on.
      expect(JSON.parse(getAllOutput())).toEqual({
        imageName: "my-service",
        tag: "1.2.3",
        deleted: false,
        aborted: true,
      });
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

  describe("--upload", () => {
    let dir: string;
    let sbomPath: string;

    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), "codacy-sbom-"));
      sbomPath = path.join(dir, "sbom.json");
      await fs.writeFile(sbomPath, JSON.stringify({ bomFormat: "CycloneDX" }));
      vi.mocked(SbomService.uploadImageSbom).mockResolvedValue(undefined as any);
    });

    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it("uploads the file for the given tag", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--tag", "1.2.3", "--upload", sbomPath,
      ]);

      expect(SbomService.uploadImageSbom).toHaveBeenCalledOnce();
      const [provider, org, formData] = vi.mocked(SbomService.uploadImageSbom)
        .mock.calls[0];
      expect(provider).toBe("gh");
      expect(org).toBe("test-org");
      expect(formData.imageName).toBe("my-service");
      expect(formData.tag).toBe("1.2.3");
      // Optional fields are omitted rather than sent as undefined.
      expect(formData).not.toHaveProperty("environment");
      expect(formData).not.toHaveProperty("repositoryName");
    });

    it("sends a File carrying the real filename and JSON media type", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--tag", "1.2.3", "--upload", sbomPath,
      ]);

      const sbom = vi.mocked(SbomService.uploadImageSbom).mock.calls[0][2]
        .sbom as File;
      // A bare Blob would be sent as filename="blob", which says nothing in a
      // request log.
      expect(sbom).toBeInstanceOf(File);
      expect(sbom.name).toBe("sbom.json");
      expect(sbom.type).toBe("application/json");
      expect(await sbom.text()).toContain("CycloneDX");
    });

    it("passes --environment and --repository through", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--tag", "1.2.3", "--upload", sbomPath,
        "--environment", "production", "--repository", "my-repo",
      ]);

      const formData = vi.mocked(SbomService.uploadImageSbom).mock.calls[0][2];
      expect(formData.environment).toBe("production");
      expect(formData.repositoryName).toBe("my-repo");
    });

    it("infers the XML media type from the extension", async () => {
      const xmlPath = path.join(dir, "sbom.xml");
      await fs.writeFile(xmlPath, "<bom/>");

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--tag", "1.2.3", "--upload", xmlPath,
      ]);

      const sbom = vi.mocked(SbomService.uploadImageSbom).mock.calls[0][2]
        .sbom as File;
      expect(sbom.type).toBe("application/xml");
    });

    it("requires --tag, before reading anything", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "image", "gh", "test-org", "my-service",
          "--upload", sbomPath,
        ]),
      ).rejects.toThrow("process.exit called");

      expect(SbomService.uploadImageSbom).not.toHaveBeenCalled();
      expect(errorOutput()).toContain("--upload requires --tag <tag>");
      exit.mockRestore();
    });

    it("fails locally on a missing file, without calling the API", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "image", "gh", "test-org", "my-service",
          "--tag", "1.2.3", "--upload", path.join(dir, "nope.json"),
        ]),
      ).rejects.toThrow("process.exit called");

      expect(SbomService.uploadImageSbom).not.toHaveBeenCalled();
      expect(errorOutput()).toContain("Could not read SBOM file");
      exit.mockRestore();
    });

    it("fails locally on an empty file", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });
      const emptyPath = path.join(dir, "empty.json");
      await fs.writeFile(emptyPath, "");

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "image", "gh", "test-org", "my-service",
          "--tag", "1.2.3", "--upload", emptyPath,
        ]),
      ).rejects.toThrow("process.exit called");

      expect(SbomService.uploadImageSbom).not.toHaveBeenCalled();
      expect(errorOutput()).toContain("is empty");
      exit.mockRestore();
    });

    it("refuses --upload combined with --delete, before either happens", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "image", "gh", "test-org", "my-service",
          "--tag", "1.2.3", "--upload", sbomPath, "--delete",
        ]),
      ).rejects.toThrow("process.exit called");

      expect(SbomService.uploadImageSbom).not.toHaveBeenCalled();
      expect(SbomService.deleteImageTag).not.toHaveBeenCalled();
      expect(errorOutput()).toContain(
        "--upload and --delete cannot be combined",
      );
      exit.mockRestore();
    });

    it("outputs JSON confirming what was uploaded", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "test", "--output", "json",
        "image", "gh", "test-org", "my-service",
        "--tag", "1.2.3", "--upload", sbomPath, "--environment", "production",
      ]);

      expect(JSON.parse(getAllOutput())).toEqual({
        imageName: "my-service",
        tag: "1.2.3",
        environment: "production",
        uploaded: true,
      });
    });
  });

  describe("--delete --keep-latest", () => {
    function tagsUploadedOn(days: number[]) {
      return days.map((d) =>
        mockTag({
          tag: `1.0.${d}`,
          uploadedAt: new Date(Date.UTC(2025, 0, d)).toISOString(),
        }),
      );
    }

    beforeEach(() => {
      vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
        data: [],
        pagination: { total: 7 },
        usage: { imageTags: 70, limit: 1000 },
      } as any);
      vi.mocked(SbomService.deleteImageTag).mockResolvedValue(undefined as any);
    });

    it("keeps the n most recently uploaded tags and deletes the rest", async () => {
      // Deliberately out of order: the command must sort, not trust the API.
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([3, 1, 5, 2, 4]),
        pagination: {},
      } as any);
      vi.spyOn(prompt, "confirmAction").mockResolvedValue(true);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "2",
      ]);

      const deletedTags = vi
        .mocked(SbomService.deleteImageTag)
        .mock.calls.map((c) => c[3]);
      expect(deletedTags).toEqual(["1.0.3", "1.0.2", "1.0.1"]);
    });

    it("orders by uploadedAt, not generatedAt", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: [
          // Built last, received first: what accumulates is the upload.
          mockTag({
            tag: "built-late",
            uploadedAt: "2025-01-01T00:00:00Z",
            generatedAt: "2025-12-31T00:00:00Z",
          }),
          mockTag({
            tag: "uploaded-late",
            uploadedAt: "2025-06-01T00:00:00Z",
            generatedAt: "2025-01-01T00:00:00Z",
          }),
        ],
        pagination: {},
      } as any);
      vi.spyOn(prompt, "confirmAction").mockResolvedValue(true);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "1",
      ]);

      expect(vi.mocked(SbomService.deleteImageTag).mock.calls[0][3]).toBe(
        "built-late",
      );
    });

    it("pages every tag before deciding what to delete", async () => {
      vi.mocked(SbomService.listImageTags)
        .mockResolvedValueOnce({
          data: tagsUploadedOn([5, 4]),
          pagination: { cursor: "next" },
        } as any)
        .mockResolvedValueOnce({
          data: tagsUploadedOn([3, 2, 1]),
          pagination: {},
        } as any);
      vi.spyOn(prompt, "confirmAction").mockResolvedValue(true);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "4",
      ]);

      // A tag on page 2 is as deletable as one on page 1.
      expect(SbomService.deleteImageTag).toHaveBeenCalledOnce();
      expect(vi.mocked(SbomService.deleteImageTag).mock.calls[0][3]).toBe("1.0.1");
    });

    it("does nothing, cleanly, when there are fewer tags than n", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([1, 2]),
        pagination: {},
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "10",
      ]);

      expect(SbomService.deleteImageTag).not.toHaveBeenCalled();
      expect(getAllOutput()).toContain("Nothing to delete");
    });

    it("--dry-run deletes nothing and never prompts", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([1, 2, 3]),
        pagination: {},
      } as any);
      const confirm = vi.spyOn(prompt, "confirmAction");

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "1", "--dry-run",
      ]);

      expect(SbomService.deleteImageTag).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      const output = getAllOutput();
      expect(output).toContain("Would delete 2 of 3 tags");
      expect(output).toContain("Dry run");
    });

    it("warns when n x the org's image count exceeds its tag limit", async () => {
      // Not 1,000, so a hardcoded fallback cap can't pass this.
      vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
        data: [],
        pagination: { total: 212 },
        usage: { imageTags: 400, limit: 1500 },
      } as any);
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([1, 2, 3]),
        pagination: {},
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "10", "--dry-run",
      ]);

      const output = getAllOutput();
      // Never a constant n without the image count beside it.
      expect(output).toContain("this organization has 212 images");
      expect(output).toContain("holds 2,120 image tags");
      // Exact figures, not formatCount's "2.1k"/"1.5k".
      expect(output).toContain("cap of 1,500");
      expect(output).toContain("allows 7 per image");
    });

    it("stays quiet about the budget when n x images fits the cap", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([1, 2, 3]),
        pagination: {},
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "10", "--dry-run",
      ]);

      expect(getAllOutput()).not.toContain("above the organization cap");
    });

    it("skips the budget warning, not the cleanup, when the budget lookup fails", async () => {
      vi.mocked(SbomService.listOrganizationImages).mockRejectedValue(
        new Error("boom"),
      );
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([1, 2, 3]),
        pagination: {},
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "1", "--dry-run",
      ]);

      const output = getAllOutput();
      expect(output).toContain("Dry run");
      expect(output).not.toContain("organization cap");
    });

    it("carries on past a failed delete and exits non-zero", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([1, 2, 3]),
        pagination: {},
      } as any);
      vi.spyOn(prompt, "confirmAction").mockResolvedValue(true);
      vi.mocked(SbomService.deleteImageTag)
        .mockRejectedValueOnce(new Error("Conflict"))
        .mockResolvedValueOnce(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "1",
      ]);

      // Giving up at the first failure leaves the org no better off.
      expect(SbomService.deleteImageTag).toHaveBeenCalledTimes(2);
      expect(getAllOutput()).toContain("Conflict");
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
    });

    it("aborts without deleting when the confirmation is declined", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([1, 2, 3]),
        pagination: {},
      } as any);
      vi.spyOn(prompt, "confirmAction").mockResolvedValue(false);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "1",
      ]);

      expect(SbomService.deleteImageTag).not.toHaveBeenCalled();
      expect(getAllOutput()).toContain("nothing was deleted");
    });

    it("refuses --keep-latest without --delete", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "image", "gh", "test-org", "my-service",
          "--keep-latest", "10",
        ]),
      ).rejects.toThrow("process.exit called");

      expect(SbomService.listImageTags).not.toHaveBeenCalled();
      expect(errorOutput()).toContain("--keep-latest only applies to --delete");
      exit.mockRestore();
    });

    it("refuses --tag combined with --keep-latest", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "image", "gh", "test-org", "my-service",
          "--delete", "--tag", "1.0.1", "--keep-latest", "10",
        ]),
      ).rejects.toThrow("process.exit called");

      expect(SbomService.deleteImageTag).not.toHaveBeenCalled();
      expect(errorOutput()).toContain("--tag and --keep-latest cannot be combined");
      exit.mockRestore();
    });

    it("rejects a non-integer --keep-latest instead of coercing it", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "image", "gh", "test-org", "my-service",
          "--delete", "--keep-latest", "ten",
        ]),
      ).rejects.toThrow("process.exit called");

      expect(SbomService.deleteImageTag).not.toHaveBeenCalled();
      expect(errorOutput()).toContain("non-negative whole number");
      exit.mockRestore();
    });

    // `Number("")` and `Number("   ")` are both 0, and 0 is a valid count, so
    // the integer guard alone waved these through and doomed every tag. This
    // is `--keep-latest "$KEEP_COUNT"` with the variable unset.
    it.each([
      ["an empty string", ""],
      ["whitespace only", "   "],
    ])("rejects %s rather than reading it as 0", async (_label, value) => {
      const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([1, 2, 3]),
        pagination: {},
      } as any);

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "test", "image", "gh", "test-org", "my-service",
          "--delete", "--keep-latest", value,
        ]),
      ).rejects.toThrow("process.exit called");

      expect(SbomService.deleteImageTag).not.toHaveBeenCalled();
      expect(errorOutput()).toContain("non-negative whole number");
      exit.mockRestore();
    });

    // The JSON path used to return before ever reaching the prompt, so
    // `--output json` deleted unconditionally — on the one path a release
    // pipeline actually runs. Both pre-existing JSON tests pass --dry-run or
    // --skip-confirmation, which is why nothing caught it.
    it("confirms before deleting under --output json, like the table path", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([1, 2, 3]),
        pagination: {},
      } as any);
      const confirm = vi
        .spyOn(prompt, "confirmAction")
        .mockResolvedValue(false);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "--output", "json",
        "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "1",
      ]);

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(SbomService.deleteImageTag).not.toHaveBeenCalled();
      // One document and no prose: `deleted` stays an array in this mode.
      const parsed = JSON.parse(getAllOutput());
      expect(parsed).toMatchObject({
        imageName: "my-service",
        keepLatest: 1,
        dryRun: false,
        kept: ["1.0.3"],
        deleted: [],
        aborted: true,
      });
      expect(process.exitCode).not.toBe(1);
    });

    it("proceeds under --output json once the prompt is answered", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([1, 2, 3]),
        pagination: {},
      } as any);
      vi.spyOn(prompt, "confirmAction").mockResolvedValue(true);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "--output", "json",
        "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "1",
      ]);

      expect(
        vi.mocked(SbomService.deleteImageTag).mock.calls.map((c) => c[3]),
      ).toEqual(["1.0.2", "1.0.1"]);
      expect(JSON.parse(getAllOutput())).toMatchObject({
        deleted: ["1.0.2", "1.0.1"],
      });
      expect(JSON.parse(getAllOutput()).aborted).toBeUndefined();
    });

    // A dry run has nothing to confirm, and neither does a run with nothing
    // doomed — prompting there would be a question with no consequence.
    // The existing failure test rejects with a plain Error, which masks this:
    // for an ApiError, `err.message` is the generated client's static status
    // table, so every failure in the report read "Bad Request" — on the one
    // path that swallows errors instead of routing them through handleError.
    it("reports the API's message for a failed tag, not the status name", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([1, 2, 3]),
        pagination: {},
      } as any);
      vi.mocked(SbomService.deleteImageTag).mockRejectedValueOnce(
        new ApiError(
          { method: "DELETE", url: "/x" } as any,
          {
            url: "/x",
            ok: false,
            status: 400,
            statusText: "Bad Request",
            body: { message: "Tag 1.0.2 is referenced by an active scan" },
          } as any,
          "Bad Request",
        ),
      );

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "--output", "json",
        "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "1", "--skip-confirmation",
      ]);

      expect(JSON.parse(getAllOutput()).failures).toEqual([
        { tag: "1.0.2", reason: "Tag 1.0.2 is referenced by an active scan" },
      ]);
      process.exitCode = 0;
    });

    it("does not prompt under --output json when nothing will be deleted", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([1, 2, 3]),
        pagination: {},
      } as any);
      const confirm = vi.spyOn(prompt, "confirmAction").mockResolvedValue(true);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "--output", "json",
        "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "10",
      ]);

      expect(confirm).not.toHaveBeenCalled();
      expect(SbomService.deleteImageTag).not.toHaveBeenCalled();
    });

    it("outputs JSON naming what was kept and deleted", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([1, 2, 3]),
        pagination: {},
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "--output", "json",
        "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "1", "--dry-run",
      ]);

      expect(JSON.parse(getAllOutput())).toMatchObject({
        imageName: "my-service",
        keepLatest: 1,
        dryRun: true,
        kept: ["1.0.3"],
        deleted: [],
        wouldDelete: ["1.0.2", "1.0.1"],
        organizationImageCount: 7,
      });
    });

    it("keeps the image count when the response has no usage", async () => {
      // An API older than the client: no `usage`, so no budget warning, but the
      // image count it does carry must still be reported.
      vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
        data: [],
        pagination: { total: 7 },
      } as any);
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([1, 2, 3]),
        pagination: {},
      } as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "--output", "json",
        "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "1", "--dry-run",
      ]);

      const result = JSON.parse(getAllOutput());
      expect(result.organizationImageCount).toBe(7);
      expect(result.warning).toBeUndefined();
    });

    it("outputs one JSON document naming the deletions that actually happened", async () => {
      vi.mocked(SbomService.listImageTags).mockResolvedValue({
        data: tagsUploadedOn([1, 2, 3]),
        pagination: {},
      } as any);
      vi.mocked(SbomService.deleteImageTag)
        .mockRejectedValueOnce(new Error("Conflict"))
        .mockResolvedValueOnce(undefined as any);

      const program = createProgram();
      await program.parseAsync([
        "node", "test", "--output", "json",
        "image", "gh", "test-org", "my-service",
        "--delete", "--keep-latest", "1", "--skip-confirmation",
      ]);

      // One document, not two: the failure report used to be printed as a
      // second JSON value on the same stdout.
      const parsed = JSON.parse(getAllOutput());
      expect(parsed).toMatchObject({
        dryRun: false,
        kept: ["1.0.3"],
        // 1.0.2 was attempted and failed, so it is not among the deletions.
        deleted: ["1.0.1"],
        failures: [{ tag: "1.0.2", reason: "Conflict" }],
      });
      expect(parsed.wouldDelete).toBeUndefined();
      // A release pipeline reading JSON must not see a clean exit after a
      // partial cleanup.
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
    });
  });
});
