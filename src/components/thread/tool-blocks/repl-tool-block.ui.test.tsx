import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { extractReplCode, stripReplPrefix, ReplToolBlock } from "./repl-tool-block";

// ── Pure function tests ─────────────────────────────────────

describe("extractReplCode", () => {
  it("extracts code from heredoc format", () => {
    const command = `mort-repl <<'MORT_REPL'\nconst x = 42;\nreturn x;\nMORT_REPL`;
    expect(extractReplCode(command)).toBe("const x = 42;\nreturn x;");
  });

  it("extracts code from quoted format", () => {
    expect(extractReplCode(`mort-repl "return 42"`)).toBe("return 42");
    expect(extractReplCode(`mort-repl 'return 42'`)).toBe("return 42");
  });

  it("returns null for non-repl commands", () => {
    expect(extractReplCode("ls -la")).toBeNull();
    expect(extractReplCode("git status")).toBeNull();
    expect(extractReplCode("echo mort-repl")).toBeNull();
  });

  it("handles leading whitespace", () => {
    expect(extractReplCode("  mort-repl 'return 1'")).toBe("return 1");
  });
});

describe("stripReplPrefix", () => {
  it("strips 'mort-repl result:' prefix", () => {
    const { text, isReplError } = stripReplPrefix("mort-repl result:\n42");
    expect(text).toBe("42");
    expect(isReplError).toBe(false);
  });

  it("strips 'mort-repl error:' prefix and flags error", () => {
    const { text, isReplError } = stripReplPrefix("mort-repl error:\nReferenceError: x is not defined");
    expect(text).toBe("ReferenceError: x is not defined");
    expect(isReplError).toBe(true);
  });

  it("passes through unrecognized format", () => {
    const { text, isReplError } = stripReplPrefix("some other output");
    expect(text).toBe("some other output");
    expect(isReplError).toBe(false);
  });

  it("handles undefined result", () => {
    const { text, isReplError } = stripReplPrefix(undefined);
    expect(text).toBe("");
    expect(isReplError).toBe(false);
  });

  it("strips system instruction prefix then repl prefix", () => {
    // The hook now prepends a [System: ...] block — stripReplPrefix
    // operates on the raw result which still has the mort-repl prefix
    const raw = "mort-repl result:\n{foo: 1}";
    const { text, isReplError } = stripReplPrefix(raw);
    expect(text).toBe("{foo: 1}");
    expect(isReplError).toBe(false);
  });
});

// ── Component render tests ──────────────────────────────────

describe("ReplToolBlock", () => {
  const defaultProps = {
    id: "toolu_repl_01",
    threadId: "thread-1",
    code: 'const x = 42;\nreturn x;',
    result: "mort-repl result:\n42",
    isRunning: false,
  };

  it("renders mort-repl label", () => {
    render(<ReplToolBlock {...defaultProps} />);
    expect(screen.getByText("mort-repl")).toBeInTheDocument();
  });

  it("shows first line of code as preview", () => {
    render(<ReplToolBlock {...defaultProps} />);
    expect(screen.getByText("const x = 42;")).toBeInTheDocument();
  });

  it("does not show error styling for successful results", () => {
    render(<ReplToolBlock {...defaultProps} />);
    const container = screen.getByTestId(`repl-tool-${defaultProps.id}`);
    expect(container.querySelector('[class*="text-red"]')).toBeNull();
  });

  it("shows code block when expanded", async () => {
    const user = userEvent.setup();
    render(<ReplToolBlock {...defaultProps} />);

    const block = screen.getByTestId(`repl-tool-${defaultProps.id}`);
    const expandButton = block.querySelector('[role="button"]') as HTMLElement;
    await user.click(expandButton);

    // Should show the typescript language label
    expect(screen.getByText("typescript")).toBeInTheDocument();
  });

  it("shows shimmer text while running", () => {
    render(<ReplToolBlock {...defaultProps} isRunning={true} result={undefined} />);
    expect(screen.getByText("mort-repl")).toHaveClass("animate-shimmer");
  });

  it("shows error indicator for repl errors", () => {
    const errorResult = "mort-repl error:\nReferenceError: x is not defined";
    render(
      <ReplToolBlock
        {...defaultProps}
        result={errorResult}
      />,
    );
    // The header shows an "error" label when isReplError is true
    const container = screen.getByTestId(`repl-tool-${defaultProps.id}`);
    expect(container.querySelector(".text-red-400")).toBeInTheDocument();
  });
});
