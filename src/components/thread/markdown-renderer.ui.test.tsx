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
  // File Path Auto-Linking Tests
  // ============================================================================

  describe("File Path Linking", () => {
    it("renders bare file paths as clickable links", () => {
      render(
        <MarkdownRenderer
          content="The relative path of the README is README.md."
          workingDirectory="/home/user/project"
        />
      );

      const link = screen.getByRole("link", { name: "README.md" });
      expect(link).toBeInTheDocument();
      expect(link.tagName).toBe("A");
    });

    it("renders file paths with directories as clickable links", () => {
      render(
        <MarkdownRenderer
          content="Here's a random one: src/components/thread/thinking-block.tsx"
          workingDirectory="/home/user/project"
        />
      );

      const link = screen.getByRole("link", { name: "src/components/thread/thinking-block.tsx" });
      expect(link).toBeInTheDocument();
    });

    it("calls onFileClick with resolved path when bare file link is clicked", () => {
      const onFileClick = vi.fn();
      render(
        <MarkdownRenderer
          content="See README.md for details."
          workingDirectory="/home/user/project"
          onFileClick={onFileClick}
        />
      );

      const link = screen.getByRole("link", { name: "README.md" });
      link.click();
      expect(onFileClick).toHaveBeenCalledWith("/home/user/project/README.md");
    });

    it("makes inline code file paths clickable", () => {
      const onFileClick = vi.fn();
      render(
        <MarkdownRenderer
          content="Use `package.json` to configure."
          workingDirectory="/home/user/project"
          onFileClick={onFileClick}
        />
      );

      const codeElement = screen.getByText("package.json");
      expect(codeElement.tagName).toBe("CODE");
      expect(codeElement).toHaveClass("cursor-pointer");
      codeElement.click();
      expect(onFileClick).toHaveBeenCalledWith("/home/user/project/package.json");
    });

    it("does not auto-link file paths when no workingDirectory is provided", () => {
      render(
        <MarkdownRenderer content="See README.md for details." />
      );

      // Should not have a link role for README.md
      const links = screen.queryAllByRole("link");
      const readmeLink = links.find(l => l.textContent === "README.md");
      expect(readmeLink).toBeUndefined();
    });

    it("does not make non-file inline code clickable", () => {
      render(
        <MarkdownRenderer
          content="Use `console.log` for debugging"
          workingDirectory="/home/user/project"
        />
      );

      const codeElement = screen.getByText("console.log");
      expect(codeElement).not.toHaveClass("cursor-pointer");
    });

    it("handles the full bug report example", () => {
      const content = `The relative path of the README is README.md.

Let me find a TSX file for you.
Found 100 files
Here's a random one: src/components/thread/thinking-block.tsx`;

      render(
        <MarkdownRenderer
          content={content}
          workingDirectory="/home/user/project"
        />
      );

      const readmeLink = screen.getByRole("link", { name: "README.md" });
      expect(readmeLink).toBeInTheDocument();

      const tsxLink = screen.getByRole("link", { name: "src/components/thread/thinking-block.tsx" });
      expect(tsxLink).toBeInTheDocument();
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
