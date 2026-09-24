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
    tagCount: 12,
    latestTag: "1.2.3",
    lastSbomUploaded: "2025-06-14T10:00:00Z",
    lastSbomGenerated: "2025-06-14T09:00:00Z",
    ...overrides,
  };
}

const usage = { imageTags: 750, limit: 1000 };

describe("images command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
    delete process.env.CODACY_PROJECT_TOKEN;
  });

  it("lists images for an organization", async () => {
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [
        mockImage(),
        mockImage({ imageName: "worker", latestTag: "sha-abc" }),
      ],
      pagination: { total: 2 },
      usage,
    } as any);

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
    expect(output).toContain("1.2.3");
    expect(output).toContain("Image tags: 750 of 1,000 used");
    const row = output.split("\n").find((line) => line.includes("my-service"))!;
    expect(row).toContain("12");
  });

  it("flags an organization at the tag cap", async () => {
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [mockImage()],
      pagination: {},
      usage: { imageTags: 1000, limit: 1000 },
    } as any);

    const program = createProgram();
    await program.parseAsync(["node", "test", "images", "gh", "test-org"]);

    expect(getAllOutput()).toContain(
      "Image tags: 1,000 of 1,000 used — new tags will be rejected",
    );
  });

  it("still lists images when the API omits usage and tag counts", async () => {
    // A response from an API older than the client this was generated from.
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [mockImage({ tagCount: undefined })],
      pagination: {},
    } as any);

    const program = createProgram();
    await program.parseAsync(["node", "test", "images", "gh", "test-org"]);

    const output = getAllOutput();
    expect(output).toContain("my-service");
    expect(output).not.toContain("Image tags:");
    expect(output).not.toContain("undefined");
  });

  it("never fans out to the tags endpoint", async () => {
    // The tag count comes from `ImageSummary`; this listing must stay one request.
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [mockImage(), mockImage({ imageName: "worker" })],
      pagination: {},
      usage,
    } as any);

    const program = createProgram();
    await program.parseAsync(["node", "test", "images", "gh", "test-org"]);

    expect(SbomService.listImageTags).not.toHaveBeenCalled();
  });

  it("renders a dim dash for missing values", async () => {
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [
        mockImage({
          latestTag: undefined,
          lastSbomUploaded: undefined,
          lastSbomGenerated: undefined,
        }),
      ],
      pagination: {},
      usage,
    } as any);

    const program = createProgram();
    await program.parseAsync(["node", "test", "images", "gh", "test-org"]);

    const output = getAllOutput();
    expect(output).toContain("my-service");
    // The dash is the assertion: without it the three empty cells render as
    // the literal "undefined" (or as nothing at all), which is what this test
    // exists to catch. The image name carries a dash of its own, so it comes
    // out of the row before the dashes are counted.
    expect(output).not.toContain("undefined");
    const row = output.split("\n").find((line) => line.includes("my-service"))!;
    expect(row.replace("my-service", "").match(/-/g) ?? []).toHaveLength(3);
  });

  it("paginates up to --limit and warns when more remain", async () => {
    vi.mocked(SbomService.listOrganizationImages)
      .mockResolvedValueOnce({
        data: [mockImage()],
        pagination: { cursor: "next", total: 300 },
        usage,
      } as any)
      .mockResolvedValueOnce({
        data: [mockImage({ imageName: "worker" })],
        pagination: { cursor: "more", total: 300 },
        usage,
      } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "images", "gh", "test-org", "--limit", "2",
    ]);

    expect(SbomService.listOrganizationImages).toHaveBeenCalledTimes(2);
    expect(getAllOutput()).toContain("Use --limit <n> (max 1000) to fetch more.");
  });

  it("caps --limit at 1000", async () => {
    // A server that never stops handing out cursors: the only thing that ends
    // this loop is the clamp. Asserting the page size instead would pass for
    // any limit >= 100 and prove nothing about MAX_LIMIT.
    //
    // The ceiling is what makes a broken clamp *fail* rather than hang — with
    // MAX_LIMIT gone the loop runs 1000 times against this mock, and a test
    // that times out reads as flake rather than as the regression it is.
    let pages = 0;
    vi.mocked(SbomService.listOrganizationImages).mockImplementation(
      (async () => {
        if (++pages > 20) {
          throw new Error(
            `paged ${pages} times — the --limit clamp at ${1000} is not stopping the loop`,
          );
        }
        return {
          data: Array.from({ length: 100 }, (_, i) =>
            mockImage({ imageName: `svc-${i}` }),
          ),
          pagination: { cursor: "next", total: 99999 },
          usage,
        } as any;
      }) as any,
    );

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "images", "gh", "test-org", "--limit", "99999",
    ]);

    // 1000 clamped / 100 per page. Without the clamp this runs 1000 times.
    expect(SbomService.listOrganizationImages).toHaveBeenCalledTimes(10);
    expect(SbomService.listOrganizationImages).toHaveBeenLastCalledWith(
      "gh", "test-org", "next", 100,
    );
  });

  it("prints an empty-state message when there are no images", async () => {
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [],
      pagination: {},
      usage,
    } as any);

    const program = createProgram();
    await program.parseAsync(["node", "test", "images", "gh", "test-org"]);

    expect(getAllOutput()).toContain("No images found");
  });

  it("outputs JSON", async () => {
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [mockImage()],
      pagination: {},
      usage,
    } as any);

    const program = createProgram();
    await program.parseAsync([
      "node", "test", "--output", "json", "images", "gh", "test-org",
    ]);

    expect(JSON.parse(getAllOutput())).toEqual([
      {
        imageName: "my-service",
        tagCount: 12,
        latestTag: "1.2.3",
        lastSbomUploaded: "2025-06-14T10:00:00Z",
        lastSbomGenerated: "2025-06-14T09:00:00Z",
      },
    ]);
  });

  it("neutralizes terminal escape sequences in image and tag names", async () => {
    vi.mocked(SbomService.listOrganizationImages).mockResolvedValue({
      data: [
        mockImage({
          imageName: "evil\u001b[31m",
          latestTag: "v\u001b]8;;x\u0007",
        }),
      ],
      pagination: {},
      usage,
    } as any);

    const program = createProgram();
    await program.parseAsync(["node", "test", "images", "gh", "test-org"]);

    const output = getAllOutput();
    expect(output).not.toContain("evil\u001b[31m");
    expect(output).toContain("evil^[");
  });
});
