import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import {
  registerFileCommand,
  parseLineRange,
  resolveFilePath,
  renderSource,
  coverageGutter,
} from "./file";
import { RepositoryService } from "../api/client/services/RepositoryService";
import { FileService } from "../api/client/services/FileService";
import { consoleOutput } from "../test-support";
import { getCwdRepoRelativePath } from "../utils/repo-tree";
import { ApiError } from "../api/client/core/ApiError";
import { encodePathSegment } from "../utils/api-path";

function apiError(status: number, statusText: string): ApiError {
  return new ApiError(
    { method: "GET", url: "/x" } as any,
    { url: "/x", ok: false, status, statusText, body: { message: statusText } } as any,
    statusText,
  );
}

vi.mock("../api/client/services/RepositoryService");
vi.mock("../api/client/services/FileService");
vi.mock("../utils/credentials", () => ({ loadCredentials: vi.fn(() => null) }));
vi.mock("../utils/git-remote", () => ({
  detectRepoContext: vi.fn(() => ({
    provider: "gh",
    organization: "auto-org",
    repository: "auto-repo",
  })),
}));
vi.mock("../utils/repo-tree", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/repo-tree")>();
  return { ...actual, getCwdRepoRelativePath: vi.fn(() => "") };
});
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

function createProgram(): Command {
  const program = new Command();
  program.option("-o, --output <format>", "output format", "table");
  registerFileCommand(program);
  return program;
}

const FILE_PATH = "src/app.ts";
const FILE_ID = 42;

const fileInfo = {
  file: {
    fileId: FILE_ID,
    fileDataId: 7,
    commitId: 1,
    commitSha: "abcdef1234567890",
    path: FILE_PATH,
    language: "TypeScript",
    gitProviderUrl: "https://example.com",
    ignored: false,
  },
  quality: {
    totalIssues: 1,
    complexity: 12,
    grade: 80,
    gradeLetter: "B",
    duplication: 1,
    duplicatedLinesOfCode: 6,
  },
  coverage: { coverage: 66.67, coverableLines: 3, coveredLines: 2 },
};

const issue = {
  issueId: "uuid",
  resultDataId: 1001,
  filePath: FILE_PATH,
  lineNumber: 2,
  lineText: "eval(input);",
  message: "Avoid eval",
  falsePositiveThreshold: 80,
  patternInfo: {
    id: "no-eval",
    category: "Security",
    severityLevel: "Error",
  },
  toolInfo: { uuid: "t", name: "ESLint" },
  commitInfo: { sha: "abc" },
  language: "TypeScript",
};

const clone = {
  id: 9,
  occurrences: [
    { path: FILE_PATH, fileId: FILE_ID, fileDataId: 7, fromLine: 10, toLine: 15 },
    { path: "src/other.ts", fileId: 99, fileDataId: 8, fromLine: 3, toLine: 8 },
  ],
};

const source = [
  { number: 1, content: "const a = 1;" },
  { number: 2, content: "eval(input);" },
  { number: 3, content: "// comment" },
  { number: 4, content: "return a;" },
];

function mockApi(overrides: { files?: unknown[]; coverage?: unknown; content?: unknown } = {}) {
  vi.mocked(RepositoryService.listFiles).mockResolvedValue({
    data: overrides.files ?? [
      { fileId: 1, path: "src/app.test.ts" },
      { fileId: FILE_ID, path: FILE_PATH },
    ],
  } as any);
  vi.mocked(RepositoryService.getFileWithAnalysis).mockResolvedValue(fileInfo as any);
  vi.mocked(RepositoryService.getFileIssues).mockResolvedValue({ data: [issue] } as any);
  vi.mocked(RepositoryService.getFileClones).mockResolvedValue({ data: [clone] } as any);
  if (overrides.coverage instanceof Error) {
    vi.mocked(RepositoryService.getFileCoverage).mockRejectedValue(overrides.coverage);
  } else {
    vi.mocked(RepositoryService.getFileCoverage).mockResolvedValue(
      (overrides.coverage ?? {
        data: [
          { line: 1, hits: 3 },
          { line: 2, hits: 0 },
          { line: 4, hits: 1 },
        ],
      }) as any,
    );
  }
  if (overrides.content instanceof Error) {
    vi.mocked(FileService.getFileContent).mockRejectedValue(overrides.content);
  } else {
    vi.mocked(FileService.getFileContent).mockResolvedValue(
      (overrides.content ?? { data: source }) as any,
    );
  }
}

async function run(...args: string[]) {
  await createProgram().parseAsync(["node", "test", "file", ...args]);
}

describe("parseLineRange", () => {
  it("parses from-to, open-ended and single-line ranges", () => {
    expect(parseLineRange("40-120")).toEqual({ from: 40, to: 120 });
    expect(parseLineRange("40-")).toEqual({ from: 40, to: undefined });
    expect(parseLineRange("7")).toEqual({ from: 7, to: 7 });
  });

  it("rejects malformed or inverted ranges", () => {
    expect(() => parseLineRange("abc")).toThrow("Invalid --lines");
    expect(() => parseLineRange("0-3")).toThrow("lines start at 1");
    expect(() => parseLineRange("10-5")).toThrow("must not exceed");
    expect(() => parseLineRange("-5")).toThrow("Invalid --lines");
  });
});

describe("resolveFilePath", () => {
  beforeEach(() => vi.clearAllMocks());

  it("joins the cwd when the repository is auto-detected", () => {
    vi.mocked(getCwdRepoRelativePath).mockReturnValueOnce("src/utils");
    expect(resolveFilePath("../app.ts", true)).toBe("src/app.ts");
  });

  it("treats the path as repo-relative when the repository is explicit", () => {
    expect(resolveFilePath("./src/app.ts", false)).toBe("src/app.ts");
    expect(getCwdRepoRelativePath).not.toHaveBeenCalled();
  });
});

describe("coverageGutter", () => {
  // Colors are off under the test env (NO_COLOR), so this checks the glyph
  // placement; green vs red was verified against a live repository.
  it("marks coverable lines (covered or not) and leaves the rest blank", () => {
    const coverage = new Map([
      [1, 3],
      [2, 0],
    ]);
    expect(coverageGutter(1, coverage)).toContain("▌");
    expect(coverageGutter(2, coverage)).toContain("▌");
    expect(coverageGutter(3, coverage)).toBe(" ");
    expect(coverageGutter(1, null)).toBe(" ");
  });
});

describe("renderSource", () => {
  it("neutralizes control characters in inline issue messages", () => {
    const out = renderSource(
      [{ number: 2, content: "x" }],
      null,
      [{ ...issue, message: "bad\x1b[2Jmsg" } as any],
    ).join("\n");
    expect(out).not.toContain("\x1b[2J");
  });

  it("handles a very long file without overflowing Math.max", () => {
    const many = Array.from({ length: 200_000 }, (_, i) => ({ number: i + 1, content: "x" }));
    const out = renderSource(many, null);
    expect(out).toHaveLength(200_000);
    expect(out[0]).toMatch(/^ {5}1 /);
  });

  it("neutralizes control characters in file content", () => {
    const [line] = renderSource([{ number: 1, content: "evil\x1b]52;c;aGk=\x07" }], null);
    expect(line).not.toContain("\x1b]52");
    expect(line).not.toContain("\x07");
  });
});

describe("file command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODACY_API_TOKEN = "test-token";
    delete process.env.CODACY_PROJECT_TOKEN;
  });

  it("resolves the fileId by listing the parent folder and matching exactly", async () => {
    mockApi();
    await run("gh", "org", "repo", FILE_PATH);

    const listCall = vi.mocked(RepositoryService.listFiles).mock.calls[0];
    expect(listCall.slice(0, 5)).toEqual(["gh", "org", "repo", undefined, "src"]);
    expect(vi.mocked(RepositoryService.getFileWithAnalysis).mock.calls[0][3]).toBe(FILE_ID);
  });

  it("lists the repository root for a top-level file", async () => {
    mockApi({ files: [{ fileId: FILE_ID, path: "README.md" }] });
    await run("gh", "org", "repo", "README.md");
    expect(vi.mocked(RepositoryService.listFiles).mock.calls[0][4]).toBe("");
  });

  it("resolves the repository from the git remote with a single argument", async () => {
    mockApi();
    await run(FILE_PATH);
    expect(vi.mocked(RepositoryService.listFiles).mock.calls[0].slice(0, 3)).toEqual([
      "gh",
      "auto-org",
      "auto-repo",
    ]);
  });

  it("errors when the file is not on Codacy", async () => {
    mockApi({ files: [{ fileId: 1, path: "src/other.ts" }] });
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    await expect(run("gh", "org", "repo", FILE_PATH)).rejects.toThrow("process.exit called");
    const err = vi.mocked(console.error).mock.calls.flat().join("\n");
    expect(err).toContain("not found on Codacy");
    expect(RepositoryService.getFileWithAnalysis).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("renders the summary, clones and source with issues inline", async () => {
    mockApi();
    await run("gh", "org", "repo", FILE_PATH);
    const out = consoleOutput();

    // Summary
    expect(out).toContain(FILE_PATH);
    expect(out).toContain("TypeScript · commit abcdef1");
    expect(out).toContain("1 clone · 6 duplicated lines");
    expect(out).toContain("66.7% (2/3 lines)");
    // With source, the issue is inline — no top Issues section
    expect(out).not.toContain("Issues —");
    expect(out).not.toContain("Issues outside");
    // Clones
    expect(out).toContain("Clones — Found 1 clone");
    expect(out).toContain("10-15");
    expect(out).toContain("src/other.ts:3-8");
    // Source
    expect(out).toContain("covered");
    expect(out).toMatch(/1 ▌ │ const a = 1;/);
    expect(out).toMatch(/3   │ \/\/ comment/);
    // Inline card right under line 2, before line 3
    const lines = out.split("\n");
    const at = lines.findIndex((l) => /^2 . │ eval\(input\);/.test(l));
    expect(lines[at + 1]).toBe("↳   • Critical | Security  #1001");
    expect(lines[at + 2]).toBe("      Avoid eval");
    expect(lines[at + 3]).toMatch(/^─+$/);
    expect(lines[at + 4]).toMatch(/^3   │/);
  });

  it("lists issues outside --lines at the top and the rest inline", async () => {
    mockApi({ content: { data: source.slice(0, 1) } });
    vi.mocked(RepositoryService.getFileIssues).mockResolvedValue({
      data: [
        { ...issue, resultDataId: 2001, lineNumber: 1, message: "Inline one" },
        issue,
      ],
    } as any);
    await run("gh", "org", "repo", FILE_PATH, "--lines", "1");
    const out = consoleOutput();
    expect(out).toContain("Issues outside the shown lines — Found 1 issue");
    // Full card (with file:line) for the outside issue
    expect(out).toContain(`${FILE_PATH}:2`);
    expect(out).toContain("↳   • Critical | Security  #2001");
    expect(out.indexOf("Avoid eval")).toBeLessThan(out.indexOf("Inline one"));
  });

  it("renders the inline false-positive note", async () => {
    mockApi();
    vi.mocked(RepositoryService.getFileIssues).mockResolvedValue({
      data: [{ ...issue, falsePositiveProbability: 90, falsePositiveReason: "test code" }],
    } as any);
    await run("gh", "org", "repo", FILE_PATH);
    expect(consoleOutput()).toContain("      Potential false positive: test code");
  });

  it("pins the source to the analysed commit and passes --lines", async () => {
    mockApi();
    await run("gh", "org", "repo", FILE_PATH, "--lines", "2-3");
    expect(vi.mocked(FileService.getFileContent).mock.calls[0]).toEqual([
      "gh",
      "org",
      "repo",
      FILE_PATH,
      2,
      3,
      "abcdef1234567890",
    ]);
  });

  it("validates --lines before any request", async () => {
    mockApi();
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    await expect(run("gh", "org", "repo", FILE_PATH, "--lines", "9-1")).rejects.toThrow(
      "process.exit called",
    );
    expect(RepositoryService.listFiles).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("skips the source with --no-source and lists issues at the top", async () => {
    mockApi();
    await run("gh", "org", "repo", FILE_PATH, "--no-source");
    expect(FileService.getFileContent).not.toHaveBeenCalled();
    expect(consoleOutput()).not.toContain("Source");
    expect(consoleOutput()).toContain("Issues — Found 1 issue");
  });

  it("shows the source without a gutter legend when there is no coverage", async () => {
    mockApi({ coverage: apiError(404, "Not Found") });
    await run("gh", "org", "repo", FILE_PATH);
    const out = consoleOutput();
    expect(out).not.toContain("not covered");
    expect(out).toMatch(/1   │ const a = 1;/);
  });

  it("surfaces a coverage failure other than 404 instead of hiding it", async () => {
    mockApi({ coverage: apiError(500, "Internal Server Error") });
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    await expect(run("gh", "org", "repo", FILE_PATH)).rejects.toThrow("process.exit called");
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toContain("Error:");
    exit.mockRestore();
  });

  it("passes the raw path so the client's encoder escapes it exactly once", async () => {
    const odd = "src/my dir/file #1%.ts";
    mockApi({ files: [{ fileId: FILE_ID, path: odd }] });
    await run("gh", "org", "repo", odd);
    const sent = vi.mocked(FileService.getFileContent).mock.calls[0][3];
    expect(sent).toBe(odd);
    // What the generated client puts in the URL (OpenAPI.ENCODE_PATH, set in index.ts)
    expect(encodePathSegment(sent)).toBe("src%2Fmy%20dir%2Ffile%20%231%25.ts");
  });

  it("notes when the source cannot be fetched", async () => {
    mockApi({ content: new Error("Payload Too Large") });
    await run("gh", "org", "repo", FILE_PATH);
    const out = consoleOutput();
    expect(out).toContain("Source not available (Payload Too Large)");
    // No source → the issues are listed at the top as full cards
    expect(out).toContain("Issues — Found 1 issue");
    expect(out).toContain(`${FILE_PATH}:2`);
    expect(out).not.toContain("↳");
  });

  it("follows pagination for issues and clones", async () => {
    mockApi();
    vi.mocked(RepositoryService.getFileIssues)
      .mockResolvedValueOnce({ data: [issue], pagination: { cursor: "c1", limit: 100 } } as any)
      .mockResolvedValueOnce({ data: [{ ...issue, resultDataId: 1002, lineNumber: 1 }] } as any);
    await run("gh", "org", "repo", FILE_PATH, "-o", "json");
    expect(RepositoryService.getFileIssues).toHaveBeenCalledTimes(2);
    expect(vi.mocked(RepositoryService.getFileIssues).mock.calls[1][4]).toBe("c1");
  });

  it("prints issues, clones and coverage as JSON, without source code", async () => {
    mockApi();
    await createProgram().parseAsync([
      "node", "test", "--output", "json", "file", "gh", "org", "repo", FILE_PATH,
    ]);
    // JSON carries no code, so the content endpoint isn't called at all.
    expect(FileService.getFileContent).not.toHaveBeenCalled();
    const json = JSON.parse(vi.mocked(console.log).mock.calls[0][0] as string);
    expect(Object.keys(json)).toEqual(["file", "issues", "clones", "coverage"]);
    expect(json.file).toMatchObject({
      path: FILE_PATH,
      fileId: FILE_ID,
      commitSha: "abcdef1234567890",
      quality: { gradeLetter: "B" },
    });
    expect(json.issues[0]).toMatchObject({ resultDataId: 1001, message: "Avoid eval" });
    expect(json.issues[0].toolInfo).toBeUndefined();
    expect(json.clones).toHaveLength(1);
    expect(json.coverage).toEqual({
      coverage: 66.67,
      coverableLines: 3,
      coveredLines: 2,
      lines: [
        { line: 1, hits: 3 },
        { line: 2, hits: 0 },
        { line: 4, hits: 1 },
      ],
    });
    expect(JSON.stringify(json)).not.toContain("const a = 1;");
  });

  it("prints coverage as null in JSON when the file has none", async () => {
    mockApi({ coverage: apiError(404, "Not Found") });
    vi.mocked(RepositoryService.getFileWithAnalysis).mockResolvedValue({
      ...fileInfo,
      coverage: undefined,
    } as any);
    await run("gh", "org", "repo", FILE_PATH, "-o", "json");
    const json = JSON.parse(vi.mocked(console.log).mock.calls[0][0] as string);
    expect(json.coverage).toBeNull();
  });

  it("sanitizes a crafted file path in the human output", async () => {
    const evil = "src/\x1b[2Jevil.ts";
    mockApi({ files: [{ fileId: FILE_ID, path: evil }] });
    vi.mocked(RepositoryService.getFileWithAnalysis).mockResolvedValue({
      ...fileInfo,
      file: { ...fileInfo.file, path: evil },
    } as any);
    await run("gh", "org", "repo", evil);
    const raw = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join("\n");
    expect(raw).not.toContain("\x1b[2J");
  });
});
