import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@/test/helpers";
import { CodeBlock } from "./code-block";

// Mock the useCodeHighlight hook
vi.mock("@/hooks/use-code-highlight", () => ({
  useCodeHighlight: vi.fn(),
}));

import { useCodeHighlight } from "@/hooks/use-code-highlight";
const mockUseCodeHighlight = vi.mocked(useCodeHighlight);

describe("CodeBlock Edge Cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCodeHighlight.mockReturnValue({
      tokens: [[{ content: "test", color: "#e1e4e8", offset: 0 }]],
      isLoading: false,
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  it("handles empty code", () => {
    mockUseCodeHighlight.mockReturnValue({
      tokens: [],
      isLoading: false,
    });

    render(<CodeBlock code="" language="typescript" />);

    // Should render without crashing
    expect(screen.getByText("typescript")).toBeInTheDocument();
  });

  it("handles unknown language", () => {
    mockUseCodeHighlight.mockReturnValue({
      tokens: [[{ content: "some code", color: "#e1e4e8", offset: 0 }]],
      isLoading: false,
    });

    render(<CodeBlock code="some code" language="unknown-lang-xyz" />);

    // Should display the unknown language label
    expect(screen.getByText("unknown-lang-xyz")).toBeInTheDocument();
    // Code should still be visible
    expect(screen.getByText("some code")).toBeInTheDocument();
  });

  it("handles very long lines without breaking layout", () => {
    const longLine = "x".repeat(500);
    mockUseCodeHighlight.mockReturnValue({
      tokens: [[{ content: longLine, color: "#e1e4e8", offset: 0 }]],
      isLoading: false,
    });

    const { container } = render(<CodeBlock code={longLine} language="typescript" />);

    // The code container should have overflow-x-auto for horizontal scrolling
    const codeContainer = container.querySelector(".overflow-x-auto");
    expect(codeContainer).toBeInTheDocument();
  });

  it("handles code with special characters (XSS prevention)", () => {
    const xssCode = '<script>alert("xss")</script>';
    mockUseCodeHighlight.mockReturnValue({
      tokens: [[{ content: xssCode, color: "#e1e4e8", offset: 0 }]],
      isLoading: false,
    });

    render(<CodeBlock code={xssCode} language="html" />);

    // The special characters should be escaped and displayed as text
    expect(screen.getByText(xssCode)).toBeInTheDocument();

    // Verify it's rendered as text content, not as actual HTML elements
    const scriptElements = document.querySelectorAll("script");
    // There should be no script elements (except any from test setup)
    const codeBlockScripts = Array.from(scriptElements).filter(
      (el) => el.textContent === 'alert("xss")'
    );
    expect(codeBlockScripts).toHaveLength(0);
  });

  it("handles code with unicode characters", () => {
    const unicodeCode = 'const emoji = "🚀🎉🔥";\nconst chinese = "你好世界";';
    mockUseCodeHighlight.mockReturnValue({
      tokens: [
        [{ content: 'const emoji = "🚀🎉🔥";', color: "#e1e4e8", offset: 0 }],
        [{ content: 'const chinese = "你好世界";', color: "#e1e4e8", offset: 25 }],
      ],
      isLoading: false,
    });

    render(<CodeBlock code={unicodeCode} language="javascript" />);

    expect(screen.getByText('const emoji = "🚀🎉🔥";')).toBeInTheDocument();
    expect(screen.getByText('const chinese = "你好世界";')).toBeInTheDocument();
  });

  it("handles rapid content updates gracefully", async () => {
    vi.useFakeTimers();

    const { rerender } = render(<CodeBlock code="version 1" language="typescript" />);

    // Rapid updates
    rerender(<CodeBlock code="version 2" language="typescript" />);
    rerender(<CodeBlock code="version 3" language="typescript" />);
    rerender(<CodeBlock code="version 4" language="typescript" />);

    // Should handle rapid updates without errors
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // The hook was called multiple times
    expect(mockUseCodeHighlight).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("handles code with only whitespace", () => {
    const whitespaceCode = "   \n\t\t\n  ";
    mockUseCodeHighlight.mockReturnValue({
      tokens: [
        [{ content: "   ", color: undefined, offset: 0 }],
        [{ content: "\t\t", color: undefined, offset: 4 }],
        [{ content: "  ", color: undefined, offset: 7 }],
      ],
      isLoading: false,
    });

    render(<CodeBlock code={whitespaceCode} language="text" />);

    // Should render without crashing
    expect(screen.getByText("text")).toBeInTheDocument();
  });

  it("handles code with mixed line endings", () => {
    const mixedLineEndings = "line1\r\nline2\nline3\rline4";
    mockUseCodeHighlight.mockReturnValue({
      tokens: [
        [{ content: "line1", color: "#e1e4e8", offset: 0 }],
        [{ content: "line2", color: "#e1e4e8", offset: 7 }],
        [{ content: "line3", color: "#e1e4e8", offset: 13 }],
        [{ content: "line4", color: "#e1e4e8", offset: 19 }],
      ],
      isLoading: false,
    });

    render(<CodeBlock code={mixedLineEndings} language="text" />);

    // Should render without crashing
    expect(screen.getByText("line1")).toBeInTheDocument();
  });

  it("handles null tokens from hook", () => {
    mockUseCodeHighlight.mockReturnValue({
      tokens: null,
      isLoading: false,
    });

    render(<CodeBlock code="fallback code" language="typescript" />);

    // Should fall back to unstyled code display
    expect(screen.getByText("fallback code")).toBeInTheDocument();
  });
});
