import { describe, it, expect } from "vitest";
import { InvalidArgumentError } from "commander";
import { parseBooleanOption, strictBooleanOption } from "./options";

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

describe("strictBooleanOption", () => {
  const parse = strictBooleanOption("--matches-stack");

  it('accepts "true" and "false"', () => {
    expect(parse("true")).toBe(true);
    expect(parse("false")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(parse("TRUE")).toBe(true);
    expect(parse("False")).toBe(false);
  });

  it("rejects anything else", () => {
    // Commander's optional-value syntax would otherwise swallow a positional
    // argument as this option's value; rejecting it surfaces the mistake.
    expect(() => parse("eslint")).toThrow(InvalidArgumentError);
    expect(() => parse("")).toThrow(InvalidArgumentError);
  });

  it("names the flag and the offending value in the error", () => {
    expect(() => parse("eslint")).toThrow(/expected "true" or "false"/);
    expect(() => parse("eslint")).toThrow(/"eslint"/);
    expect(() => parse("eslint")).toThrow(/--matches-stack/);
  });
});
