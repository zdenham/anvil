import { describe, it, expect } from "vitest";
import { parseEnvFile } from "../parse-env-file";

describe("parseEnvFile", () => {
  it("returns empty object for empty content", () => {
    expect(parseEnvFile("")).toEqual({});
  });

  it("parses basic KEY=VALUE pairs", () => {
    expect(parseEnvFile("FOO=bar\nBAZ=qux")).toEqual({
      FOO: "bar",
      BAZ: "qux",
    });
  });

  it("skips comments and blank lines", () => {
    const content = `
# This is a comment
FOO=bar

# Another comment
BAZ=qux
    `;
    expect(parseEnvFile(content)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("splits on first = only (values can contain =)", () => {
    expect(parseEnvFile("URL=https://example.com?a=1&b=2")).toEqual({
      URL: "https://example.com?a=1&b=2",
    });
  });

  it("strips matching double quotes from values", () => {
    expect(parseEnvFile('KEY="hello world"')).toEqual({
      KEY: "hello world",
    });
  });

  it("strips matching single quotes from values", () => {
    expect(parseEnvFile("KEY='hello world'")).toEqual({
      KEY: "hello world",
    });
  });

  it("does not strip mismatched quotes", () => {
    expect(parseEnvFile("KEY=\"hello'")).toEqual({
      KEY: "\"hello'",
    });
  });

  it("trims whitespace from keys", () => {
    expect(parseEnvFile("  FOO  =bar")).toEqual({ FOO: "bar" });
  });

  it("skips lines without =", () => {
    expect(parseEnvFile("NOEQUALSSIGN\nFOO=bar")).toEqual({ FOO: "bar" });
  });

  it("handles empty values", () => {
    expect(parseEnvFile("EMPTY=")).toEqual({ EMPTY: "" });
  });

  it("handles values with spaces", () => {
    expect(parseEnvFile("MSG=hello world")).toEqual({ MSG: "hello world" });
  });

  it("handles Windows-style line endings", () => {
    expect(parseEnvFile("A=1\r\nB=2\r\n")).toEqual({ A: "1", B: "2" });
  });
});
