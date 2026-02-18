import Table, { TableConstructorOptions } from "cli-table3";
import { Command } from "commander";
import ansis from "ansis";
import dayjs from "dayjs";
import { PaginationInfo } from "../api/client/models/PaginationInfo";

export type OutputFormat = "table" | "json";

/**
 * Get the output format from the root program's global options.
 */
export function getOutputFormat(command: Command): OutputFormat {
  const root = command.optsWithGlobals();
  return root.output || "table";
}

/**
 * Print data as JSON to stdout.
 */
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Default table output options.
 */
export const defaultTableOptions: TableConstructorOptions = {
  chars: {
    top: "",
    "top-mid": "",
    "top-left": "",
    "top-right": "",
    bottom: "",
    "bottom-mid": "",
    "bottom-left": "",
    "bottom-right": "",
    left: "",
    "left-mid": "",
    mid: "",
    "mid-mid": "",
    right: "",
    "right-mid": "",
    middle: " ",
  },
  style: { "padding-left": 0, "padding-right": 0, head: ["bold", "white"] },
};

/**
 * Table constructor wrapper to pass default options.
 */
export function createTable(options?: TableConstructorOptions) {
  return new Table({ ...defaultTableOptions, ...(options ?? {}) });
}

/**
 * Print a pagination warning when the API response has more pages.
 * @param pagination - The pagination info from the API response
 * @param hint - A suggestion for how to narrow down results (e.g. "Use --search <query> to filter by name.")
 */
export function printPaginationWarning(
  pagination: PaginationInfo | undefined,
  hint: string,
): void {
  if (!pagination?.cursor) return;
  console.log(
    ansis.yellow(
      `\nShowing the first ${pagination.limit ?? 100} results. ${hint}`,
    ),
  );
}

/**
 * Format a date string in a friendly way:
 * - Same day: relative (e.g. "10 minutes ago")
 * - Yesterday: "Yesterday"
 * - Older: "YYYY-MM-DD"
 */
export function formatFriendlyDate(dateStr: string): string {
  const date = dayjs(dateStr);
  const now = dayjs();

  if (!date.isValid()) return "N/A";

  const startOfToday = now.startOf("day");
  const startOfYesterday = startOfToday.subtract(1, "day");

  if (date.isAfter(startOfToday)) {
    // Same day — show relative time
    const diffMinutes = now.diff(date, "minute");
    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes} min ago`;
    const diffHours = now.diff(date, "hour");
    return `${diffHours}h ago`;
  }

  if (date.isAfter(startOfYesterday)) {
    return "Yesterday";
  }

  return date.format("YYYY-MM-DD");
}
