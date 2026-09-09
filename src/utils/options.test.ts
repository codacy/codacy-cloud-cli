import { describe, it, expect } from "vitest";
import { parseBooleanOption } from "./options";

describe("parseBooleanOption", () => {
  it('coerces "true" to true', () => {
    expect(parseBooleanOption("true")).toBe(true);
  });

  it('coerces "false" to false', () => {
    expect(parseBooleanOption("false")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(parseBooleanOption("FALSE")).toBe(false);
    expect(parseBooleanOption("False")).toBe(false);
    expect(parseBooleanOption("TRUE")).toBe(true);
  });

  it('treats any value other than "false" as true', () => {
    // Commander only calls the parser when a value is supplied, so the bare
    // flag never reaches here; everything that does and isn't "false" opts in.
    expect(parseBooleanOption("yes")).toBe(true);
    expect(parseBooleanOption("1")).toBe(true);
    expect(parseBooleanOption("")).toBe(true);
  });
});
