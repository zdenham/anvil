import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test/helpers";
import { TextBlock } from "./text-block";

// Mock the useCodeHighlight hook (used by CodeBlock via MarkdownRenderer)
vi.mock("@/hooks/use-code-highlight", () => ({
  useCodeHighlight: vi.fn(),
}));

import { useCodeHighlight } from "@/hooks/use-code-highlight";
const mockUseCodeHighlight = vi.mocked(useCodeHighlight);

describe("TextBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCodeHighlight.mockReturnValue({
      tokens: [[{ content: "code content", color: "#e1e4e8", offset: 0 }]],
      isLoading: false,
    });
  });

  // ============================================================================
  // Streaming Mode Tests
  // ============================================================================

  describe("Streaming Mode", () => {
    it("renders content during streaming", () => {
      render(<TextBlock content="Hello world" isStreaming={true} />);

      expect(screen.getByText(/Hello world/)).toBeInTheDocument();
    });

    it("shows inline cursor character during streaming", () => {
      render(<TextBlock content="Hello world" isStreaming={true} />);

      // Cursor character is appended inline to the markdown content
      expect(screen.getByText(/●/)).toBeInTheDocument();
    });

    it("has prose styles in MarkdownRenderer during streaming", () => {
      const { container } = render(
        <TextBlock content="test" isStreaming={true} />
      );

      // Prose classes are now inside MarkdownRenderer, not on outer wrapper
      const proseDiv = container.querySelector(".prose");
      expect(proseDiv).toBeInTheDocument();
      expect(proseDiv).toHaveClass("prose-invert");
      expect(proseDiv).toHaveClass("prose-sm");
      expect(proseDiv).toHaveClass("max-w-none");
    });
  });

  // ============================================================================
  // Complete Mode Tests
  // ============================================================================

  describe("Complete Mode", () => {
    it("uses MarkdownRenderer when not streaming", () => {
      render(<TextBlock content="Hello world" isStreaming={false} />);

      // Content should still render
      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });

    it("does not show cursor character when complete", () => {
      render(<TextBlock content="Hello world" isStreaming={false} />);

      // Cursor character should not be appended when not streaming
      expect(screen.queryByText(/●/)).not.toBeInTheDocument();
    });

    it("code blocks are syntax-highlighted in non-streaming mode", () => {
      const markdown = `\`\`\`typescript
const x = 1;
\`\`\``;

      render(<TextBlock content={markdown} isStreaming={false} />);

      // MarkdownRenderer with CodeBlock shows language label
      expect(screen.getByText("typescript")).toBeInTheDocument();
    });

    it("prose styles are inside MarkdownRenderer (not on outer container)", () => {
      const { container } = render(
        <TextBlock content="test" isStreaming={false} />
      );

      // The outer div should have 'relative', not prose classes
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass("relative");
      expect(wrapper).not.toHaveClass("prose");

      // Prose classes are inside MarkdownRenderer
      const proseDiv = container.querySelector(".prose");
      expect(proseDiv).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Default Props Tests
  // ============================================================================

  describe("Default Props", () => {
    it("defaults to non-streaming mode (uses MarkdownRenderer)", () => {
      render(<TextBlock content="Hello world" />);

      // Should not show cursor character (default is not streaming)
      expect(screen.queryByText(/●/)).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Custom className Tests
  // ============================================================================

  describe("Custom className", () => {
    it("applies custom className to container", () => {
      const { container } = render(
        <TextBlock content="test" className="custom-class" />
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass("custom-class");
    });

    it("applies custom className alongside default styles", () => {
      const { container } = render(
        <TextBlock content="test" isStreaming={true} className="custom-class" />
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass("custom-class");
      expect(wrapper).toHaveClass("relative");
    });
  });
});
