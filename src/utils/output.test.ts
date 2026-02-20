import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  subSeconds,
  subMinutes,
  subHours,
  subDays,
  startOfDay,
  addHours,
  isSameDay,
} from "date-fns";
import { formatFriendlyDate, printPaginationWarning } from "./output";

vi.spyOn(console, "log").mockImplementation(() => {});

describe("formatFriendlyDate", () => {
  it("should return 'Just now' for dates less than a minute ago", () => {
    const now = subSeconds(new Date(), 30).toISOString();
    expect(formatFriendlyDate(now)).toBe("Just now");
  });

  it("should return minutes ago for dates within the last hour", () => {
    const thirtyMinAgo = subMinutes(new Date(), 30).toISOString();
    const result = formatFriendlyDate(thirtyMinAgo);
    expect(result).toMatch(/^\d+ min ago$/);
  });

  it("should return hours ago for dates earlier today", () => {
    const threeHoursAgo = subHours(new Date(), 3);
    // Only test if still the same calendar day
    if (isSameDay(threeHoursAgo, new Date())) {
      const result = formatFriendlyDate(threeHoursAgo.toISOString());
      expect(result).toMatch(/^\d+h ago$/);
    }
  });

  it("should return 'Yesterday' for dates from yesterday", () => {
    const yesterday = addHours(startOfDay(subDays(new Date(), 1)), 12);
    expect(formatFriendlyDate(yesterday.toISOString())).toBe("Yesterday");
  });

  it("should return yyyy-MM-dd for older dates", () => {
    expect(formatFriendlyDate("2024-01-15T10:00:00Z")).toBe("2024-01-15");
  });

  it("should return N/A for invalid dates", () => {
    expect(formatFriendlyDate("not-a-date")).toBe("N/A");
  });
});

describe("printPaginationWarning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should print a warning when cursor exists", () => {
    printPaginationWarning(
      { cursor: "abc123", limit: 100 },
      "Use --search to filter.",
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("first 100 results"),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Use --search to filter."),
    );
  });

  it("should not print anything when cursor is undefined", () => {
    printPaginationWarning({ limit: 100 }, "Use --search to filter.");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("should not print anything when pagination is undefined", () => {
    printPaginationWarning(undefined, "Use --search to filter.");
    expect(console.log).not.toHaveBeenCalled();
  });
});
