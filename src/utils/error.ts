import ansis from "ansis";

export function handleError(err: unknown): void {
  if (err instanceof Error) {
    console.error(ansis.red(`Error: ${err.message}`));
  } else {
    console.error(ansis.red("An unknown error occurred."));
  }
  process.exit(1);
}
