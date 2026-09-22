import * as readline from "readline";

/**
 * Ask a yes/no question, resolving `true` only on an explicit `y`.
 *
 * **The prompt is written to stderr, not stdout.** A confirmation is
 * interaction, not program output, so it belongs on the same stream as the
 * spinners and the error lines. This is not cosmetic: `--output json` promises
 * that stdout carries exactly one JSON document, and `process.stdin.isTTY` is
 * still true when stdout is a pipe — so `codacy image … --delete --output json
 * | jq` used to send the question *and the echoed keystroke* into `jq` and fail
 * there. Routing to stderr keeps the question in front of the user who has to
 * answer it, in both modes, without a command having to thread its output
 * format down here.
 *
 * A non-TTY **stdin** still declines outright: a pipeline that never had a way
 * to answer must abort rather than delete by accident. `-y` is how a caller
 * says yes ahead of time.
 */
export function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(false);
      return;
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}
