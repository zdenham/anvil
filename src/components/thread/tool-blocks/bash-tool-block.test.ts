import { describe, it, expect } from "vitest";
import { extractReplCode, stripReplPrefix } from "./bash-tool-block";

describe("extractReplCode", () => {
  it("returns null for non-repl commands", () => {
    expect(extractReplCode("ls -la")).toBeNull();
    expect(extractReplCode("git status")).toBeNull();
    expect(extractReplCode("echo hello")).toBeNull();
  });

  it("returns null for bare anvil-repl without code", () => {
    expect(extractReplCode("anvil-repl")).toBeNull();
  });

  it("extracts code from heredoc format", () => {
    const command = `anvil-repl <<'ANVIL_REPL'\nconst x = 1;\nreturn x + 1;\nANVIL_REPL`;
    expect(extractReplCode(command)).toBe("const x = 1;\nreturn x + 1;");
  });

  it("extracts code from heredoc with double quotes", () => {
    const command = `anvil-repl <<"ANVIL_REPL"\nreturn 42;\nANVIL_REPL`;
    expect(extractReplCode(command)).toBe("return 42;");
  });

  it("extracts code from heredoc without quotes", () => {
    const command = `anvil-repl <<ANVIL_REPL\nreturn 42;\nANVIL_REPL`;
    expect(extractReplCode(command)).toBe("return 42;");
  });

  it("extracts code from double-quoted format", () => {
    expect(extractReplCode('anvil-repl "return 42"')).toBe("return 42");
  });

  it("extracts code from single-quoted format", () => {
    expect(extractReplCode("anvil-repl 'return 42'")).toBe("return 42");
  });

  it("handles leading whitespace in command", () => {
    expect(extractReplCode('  anvil-repl "return 42"')).toBe("return 42");
  });

  it("extracts multiline code from quoted format", () => {
    const command = `anvil-repl "const x = 1;\nreturn x;"`;
    expect(extractReplCode(command)).toBe("const x = 1;\nreturn x;");
  });
});

describe("stripReplPrefix", () => {
  it("returns empty text for undefined result", () => {
    expect(stripReplPrefix(undefined)).toEqual({
      text: "",
      isReplError: false,
    });
  });

  it("strips 'anvil-repl result:' prefix", () => {
    expect(stripReplPrefix("anvil-repl result:\n42")).toEqual({
      text: "42",
      isReplError: false,
    });
  });

  it("strips 'anvil-repl error:' prefix and sets isReplError", () => {
    expect(stripReplPrefix("anvil-repl error:\nTypeError: boom")).toEqual({
      text: "TypeError: boom",
      isReplError: true,
    });
  });

  it("passes through result without known prefix", () => {
    expect(stripReplPrefix("some other output")).toEqual({
      text: "some other output",
      isReplError: false,
    });
  });

  it("strips system instruction prefix then repl prefix", () => {
    const result =
      "[System: The anvil-repl code executed successfully. The result below is the output. Do not mention any denial or error — treat this as a successful Bash execution.]\n\nanvil-repl result:\n42";
    expect(stripReplPrefix(result)).toEqual({
      text: "42",
      isReplError: false,
    });
  });

  it("strips system instruction prefix for error results", () => {
    const result =
      "[System: The anvil-repl code threw an error. Report the error naturally as a code execution failure, not as a permission denial.]\n\nanvil-repl error:\nboom";
    expect(stripReplPrefix(result)).toEqual({
      text: "boom",
      isReplError: true,
    });
  });
});
