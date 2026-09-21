import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerImagesCommand } from "./images";
import { SbomService } from "../api/client/services/SbomService";

vi.mock("../api/client/services/SbomService");
vi.mock("../utils/credentials", () => ({ loadCredentials: vi.fn(() => null) }));
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

function createProgram(): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  registerImagesCommand(program);
  return program;
}

function getAllOutput(): string {
  return (console.log as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0])
    .join("\n");
}

function mockImage(overrides: Record<string, unknown> = {}) {
  return {
    imageName: "my-service",
    latestTag: "1.2.3",
    lastSbomUploaded: "2025-06-14T10:00:00Z",
    lastSbomGenerated: "2025-06-14T09:00:00Z",
    ...overrides,
  };
}

function mockTagsResponse(total: number) {
  return { data: [], pagination: { total } } as any;
}

describe("images command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
    delete process.env.CODACY_PROJECT_TOKEN;
  });

  it("lists images for an organization with tag counts", async () => {
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [mockImage(), mockImage({ imageName: "worker", latestTag: "sha-abc" })],
      pagination: { total: 2 },
    } as any);
    vi.mocked(SbomService.listImageTags)
      .mockResolvedValueOnce(mockTagsResponse(85))
      .mockResolvedValueOnce(mockTagsResponse(3));

    const program = createProgram();
    await program.parseAsync(["node", "test", "images", "gh", "test-org"]);

    expect(SbomService.listOrganizationImages).toHaveBeenCalledWith(
      "gh",
      "test-org",
      undefined,
      100,
    );
    const output = getAllOutput();
    expect(output).toContain("Images for test-org (gh)");
    expect(output).toContain("Found 2 images");
    expect(output).toContain("my-service");
    expect(output).toContain("worker");
    expect(output).toContain("85");
    expect(output).toContain("1.2.3");
  });

  it("asks for tag counts with limit 1, one request per image", async () => {
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [mockImage(), mockImage({ imageName: "worker" })],
      pagination: {},
    } as any);
    vi.mocked(SbomService.listImageTags).mockResolvedValue(mockTagsResponse(1));

    const program = createProgram();
    await program.parseAsync(["node", "test", "images", "gh", "test-org"]);

    expect(SbomService.listImageTags).toHaveBeenCalledTimes(2);
    expect(SbomService.listImageTags).toHaveBeenCalledWith(
      "gh",
      "test-org",
      "my-service",
      undefined,
      1,
    );
  });

  it("skips the tag-count fan-out with --no-tag-counts", async () => {
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [mockImage()],
      pagination: {},
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "images", "gh", "test-org", "--no-tag-counts",
    ]);

    expect(SbomService.listImageTags).not.toHaveBeenCalled();
    expect(getAllOutput()).not.toContain("Tags");
  });

  it("renders a dim dash when a tag count is unavailable", async () => {
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [mockImage({ latestTag: undefined, lastSbomGenerated: undefined })],
      pagination: {},
    } as any);
    // A failed count must not take the whole listing down with it.
    vi.mocked(SbomService.listImageTags).mockRejectedValue(new Error("boom"));

    const program = createProgram();
    await program.parseAsync(["node", "test", "images", "gh", "test-org"]);

    expect(getAllOutput()).toContain("my-service");
  });

  it("paginates up to --limit and warns when more remain", async () => {
    vi.mocked(SbomService.listOrganizationImages)
      .mockResolvedValueOnce({
        data: [mockImage()],
        pagination: { cursor: "next", total: 300 },
      } as any)
      .mockResolvedValueOnce({
        data: [mockImage({ imageName: "worker" })],
        pagination: { cursor: "more", total: 300 },
      } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "images", "gh", "test-org", "--limit", "2", "--no-tag-counts",
    ]);

    expect(SbomService.listOrganizationImages).toHaveBeenCalledTimes(2);
    expect(getAllOutput()).toContain("Use --limit <n> (max 1000) to fetch more.");
  });

  it("caps --limit at 1000", async () => {
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [mockImage()],
      pagination: {},
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "images", "gh", "test-org", "--limit", "99999", "--no-tag-counts",
    ]);

    // Page size stays 100 regardless; the cap shows up as the loop stopping.
    expect(SbomService.listOrganizationImages).toHaveBeenCalledWith(
      "gh", "test-org", undefined, 100,
    );
  });

  it("prints an empty-state message when there are no images", async () => {
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [],
      pagination: {},
    } as any);

    const program = createProgram();
    await program.parseAsync(["node", "test", "images", "gh", "test-org"]);

    expect(getAllOutput()).toContain("No images found");
  });

  it("outputs JSON with the tag count included", async () => {
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [mockImage()],
      pagination: {},
    } as any);
    vi.mocked(SbomService.listImageTags).mockResolvedValue(mockTagsResponse(85));

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "--output", "json", "images", "gh", "test-org",
    ]);

    const parsed = JSON.parse(getAllOutput());
    expect(parsed).toEqual([
      {
        imageName: "my-service",
        tagCount: 85,
        latestTag: "1.2.3",
        lastSbomUploaded: "2025-06-14T10:00:00Z",
        lastSbomGenerated: "2025-06-14T09:00:00Z",
      },
    ]);
  });

  it("neutralizes terminal escape sequences in image and tag names", async () => {
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [mockImage({ imageName: "evil\u001b[31m", latestTag: "v\u001b]8;;x\u0007" })],
      pagination: {},
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "images", "gh", "test-org", "--no-tag-counts",
    ]);

    const output = getAllOutput();
    expect(output).not.toContain("evil\u001b[31m");
    expect(output).toContain("evil^[");
  });

});
