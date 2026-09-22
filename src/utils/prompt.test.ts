import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as readline from "readline";
import { confirmAction } from "./prompt";

vi.mock("readline");

const originalIsTTY = process.stdin.isTTY;

/** Stand in for the readline interface, answering with `answer`. */
function mockInterface(answer: string) {
  const close = vi.fn();
  vi.mocked(readline.createInterface).mockReturnValue({
    question: (_q: string, cb: (a: string) => void) => cb(answer),
    close,
  } as any);
  return close;
}

describe("confirmAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.stdin.isTTY = true;
  });

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY;
  });

  // The whole point of the stderr routing: `--output json` promises stdout
  // carries one JSON document, and stdin is still a TTY when stdout is a pipe.
  it("writes the prompt to stderr, never stdout", async () => {
    mockInterface("y");

    await confirmAction("Delete everything?");

    expect(readline.createInterface).toHaveBeenCalledWith({
      input: process.stdin,
      output: process.stderr,
    });
    const { output } = vi.mocked(readline.createInterface).mock
      .calls[0][0] as unknown as { output: NodeJS.WritableStream };
    expect(output).not.toBe(process.stdout);
  });

  it("resolves true on an explicit y, whatever the case and padding", async () => {
    for (const answer of ["y", "Y", " y ", "\ty\n"]) {
      mockInterface(answer);
      expect(await confirmAction("Go ahead?")).toBe(true);
    }
  });

  it("resolves false on anything else, including yes and an empty answer", async () => {
    for (const answer of ["", "n", "N", "yes", "yep", "no"]) {
      mockInterface(answer);
      expect(await confirmAction("Go ahead?")).toBe(false);
    }
  });

  it("closes the interface once answered", async () => {
    const close = mockInterface("y");

    await confirmAction("Go ahead?");

    expect(close).toHaveBeenCalledTimes(1);
  });

  // A pipeline that never had a way to answer must abort, not proceed.
  it("declines without prompting when stdin is not a TTY", async () => {
    process.stdin.isTTY = false as unknown as true;

    expect(await confirmAction("Delete everything?")).toBe(false);
    expect(readline.createInterface).not.toHaveBeenCalled();
  });
});
