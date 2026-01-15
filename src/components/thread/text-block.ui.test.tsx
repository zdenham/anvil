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
    it("uses Streamdown during streaming", () => {
      const { container } = render(
        <TextBlock content="Hello world" isStreaming={true} />
      );

      // Streamdown renders content directly in the DOM
      expect(screen.getByText("Hello world")).toBeInTheDocument();
      // Should have prose classes on container when streaming
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass("prose");
    });

    it("shows streaming cursor during streaming", () => {
      render(<TextBlock content="Hello world" isStreaming={true} />);

      // StreamingCursor has aria-hidden cursor and sr-only text
      expect(screen.getByText("Assistant is typing")).toBeInTheDocument();
    });

    it("applies prose styles to container when streaming", () => {
      const { container } = render(
        <TextBlock content="test" isStreaming={true} />
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass("prose");
      expect(wrapper).toHaveClass("prose-invert");
      expect(wrapper).toHaveClass("prose-sm");
      expect(wrapper).toHaveClass("max-w-none");
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

    it("does not show streaming cursor when complete", () => {
      render(<TextBlock content="Hello world" isStreaming={false} />);

      // StreamingCursor's sr-only text should not be present
      expect(screen.queryByText("Assistant is typing")).not.toBeInTheDocument();
    });

    it("code blocks are syntax-highlighted in non-streaming mode", () => {
      const markdown = `\`\`\`typescript
const x = 1;
\`\`\``;

      render(<TextBlock content={markdown} isStreaming={false} />);

      // MarkdownRenderer with CodeBlock shows language label
      expect(screen.getByText("typescript")).toBeInTheDocument();
    });

    it("does not apply prose styles to outer container when complete (delegated to MarkdownRenderer)", () => {
      const { container } = render(
        <TextBlock content="test" isStreaming={false} />
      );

      // The outer div should not have prose classes (MarkdownRenderer owns them)
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).not.toHaveClass("prose");
    });
  });

  // ============================================================================
  // Default Props Tests
  // ============================================================================

  describe("Default Props", () => {
    it("defaults to non-streaming mode (uses MarkdownRenderer)", () => {
      render(<TextBlock content="Hello world" />);

      // Should not show streaming cursor (default is not streaming)
      expect(screen.queryByText("Assistant is typing")).not.toBeInTheDocument();
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

    it("applies custom className alongside streaming prose styles", () => {
      const { container } = render(
        <TextBlock content="test" isStreaming={true} className="custom-class" />
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass("custom-class");
      expect(wrapper).toHaveClass("prose");
    });
  });
});
