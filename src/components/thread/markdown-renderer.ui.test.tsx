import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test/helpers";
import { MarkdownRenderer } from "./markdown-renderer";

// Mock the useCodeHighlight hook
vi.mock("@/hooks/use-code-highlight", () => ({
  useCodeHighlight: vi.fn(),
}));

import { useCodeHighlight } from "@/hooks/use-code-highlight";
const mockUseCodeHighlight = vi.mocked(useCodeHighlight);

describe("MarkdownRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCodeHighlight.mockReturnValue({
      tokens: [[{ content: "code content", color: "#e1e4e8", offset: 0 }]],
      isLoading: false,
    });
  });

  // ============================================================================
  // Inline Code Tests
  // ============================================================================

  describe("Inline Code", () => {
    it("renders inline code with InlineCode component", () => {
      render(<MarkdownRenderer content="Use `console.log` for debugging" />);

      const codeElement = screen.getByText("console.log");
      expect(codeElement).toBeInTheDocument();
      expect(codeElement.tagName).toBe("CODE");
      // InlineCode component applies amber color styling
      expect(codeElement).toHaveClass("text-amber-400");
    });
  });

  // ============================================================================
  // Code Blocks Tests
  // ============================================================================

  describe("Code Blocks", () => {
    it("renders fenced code blocks with syntax highlighting", () => {
      const markdown = `\`\`\`typescript
const x = 1;
\`\`\``;

      render(<MarkdownRenderer content={markdown} />);

      // CodeBlock displays the language label
      expect(screen.getByText("typescript")).toBeInTheDocument();
    });

    it("handles code blocks without language specified", () => {
      const markdown = `\`\`\`
some code here
\`\`\``;

      render(<MarkdownRenderer content={markdown} />);

      // Should default to plaintext when no language specified
      expect(screen.getByText("plaintext")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Mixed Content Tests
  // ============================================================================

  describe("Mixed Content", () => {
    it("renders paragraphs, inline code, and code blocks together correctly", () => {
      const markdown = `Here is some text with \`inline code\` in it.

\`\`\`javascript
const hello = "world";
\`\`\`

And more text after.`;

      render(<MarkdownRenderer content={markdown} />);

      // Paragraph text
      expect(screen.getByText(/Here is some text with/)).toBeInTheDocument();
      expect(screen.getByText(/And more text after/)).toBeInTheDocument();

      // Inline code with InlineCode styling
      const inlineCode = screen.getByText("inline code");
      expect(inlineCode).toHaveClass("text-amber-400");

      // Code block with language label
      expect(screen.getByText("javascript")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Props Tests
  // ============================================================================

  describe("Props", () => {
    it("applies custom className to container", () => {
      const { container } = render(
        <MarkdownRenderer content="test" className="custom-class" />
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass("custom-class");
      expect(wrapper).toHaveClass("prose");
      expect(wrapper).toHaveClass("prose-invert");
    });

    it("applies prose styling to container", () => {
      const { container } = render(<MarkdownRenderer content="test" />);

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass("prose");
      expect(wrapper).toHaveClass("prose-invert");
      expect(wrapper).toHaveClass("prose-sm");
      expect(wrapper).toHaveClass("max-w-none");
    });
  });
});
