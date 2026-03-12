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
  // HTML Comment Stripping Tests
  // ============================================================================

  describe("HTML Comment Stripping", () => {
    it("strips single-line HTML comments", () => {
      const content = `## Summary\n\nSome text here.\n\n<!-- CURSOR_SUMMARY -->`;
      render(<MarkdownRenderer content={content} />);

      expect(screen.getByText("Some text here.")).toBeInTheDocument();
      expect(screen.queryByText(/CURSOR_SUMMARY/)).not.toBeInTheDocument();
    });

    it("strips multi-line HTML comments", () => {
      const content = `Before\n\n<!-- LOCATIONS START\nfile.ts#L158-L163\nLOCATIONS END -->\n\nAfter`;
      render(<MarkdownRenderer content={content} />);

      expect(screen.getByText("Before")).toBeInTheDocument();
      expect(screen.getByText("After")).toBeInTheDocument();
      expect(screen.queryByText(/LOCATIONS/)).not.toBeInTheDocument();
      expect(screen.queryByText(/file\.ts/)).not.toBeInTheDocument();
    });

    it("preserves content between separate comments", () => {
      const content = `<!-- DESCRIPTION START -->\nVisible description.\n<!-- DESCRIPTION END -->`;
      render(<MarkdownRenderer content={content} />);

      expect(screen.getByText("Visible description.")).toBeInTheDocument();
      expect(screen.queryByText(/DESCRIPTION START/)).not.toBeInTheDocument();
      expect(screen.queryByText(/DESCRIPTION END/)).not.toBeInTheDocument();
    });

    it("handles full Bugbot review comment format", () => {
      const content = [
        "### Bug Title",
        "",
        "**Medium Severity**",
        "",
        "<!-- DESCRIPTION START -->",
        "The function may produce incorrect results.",
        "<!-- DESCRIPTION END -->",
        "",
        "<!-- BUGBOT_BUG_ID: 550e8400-e29b-41d4-a716-446655440000 -->",
        "",
        "<!-- LOCATIONS START",
        "file.ts#L158-L163",
        "LOCATIONS END -->",
      ].join("\n");

      render(<MarkdownRenderer content={content} />);

      expect(screen.getByText("Bug Title")).toBeInTheDocument();
      expect(screen.getByText(/Medium Severity/)).toBeInTheDocument();
      expect(screen.getByText(/incorrect results/)).toBeInTheDocument();
      expect(screen.queryByText(/BUGBOT_BUG_ID/)).not.toBeInTheDocument();
      expect(screen.queryByText(/LOCATIONS/)).not.toBeInTheDocument();
      expect(screen.queryByText(/DESCRIPTION START/)).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // GitHub Admonition Tests
  // ============================================================================

  describe("GitHub Admonitions", () => {
    it("renders NOTE admonition without literal [!NOTE] text", () => {
      const content = `> [!NOTE]\n> This is an important note.`;
      const { container } = render(<MarkdownRenderer content={content} />);

      expect(screen.queryByText("[!NOTE]")).not.toBeInTheDocument();
      expect(screen.getByText(/important note/)).toBeInTheDocument();
      expect(container.querySelector(".markdown-alert-note")).toBeInTheDocument();
    });

    it("renders WARNING admonition", () => {
      const content = `> [!WARNING]\n> Be careful with this change.`;
      const { container } = render(<MarkdownRenderer content={content} />);

      expect(screen.queryByText("[!WARNING]")).not.toBeInTheDocument();
      expect(screen.getByText(/Be careful/)).toBeInTheDocument();
      expect(container.querySelector(".markdown-alert-warning")).toBeInTheDocument();
    });

    it("renders full Bugbot PR body format", () => {
      const content = [
        "## Summary",
        "",
        "Fixed the payment calculation.",
        "",
        "<!-- CURSOR_SUMMARY -->",
        "---",
        "> [!NOTE]",
        "> **Medium Risk**",
        "> Changes expected-credit computation.",
        "<!-- /CURSOR_SUMMARY -->",
      ].join("\n");

      const { container } = render(<MarkdownRenderer content={content} />);

      expect(screen.getByText("Summary")).toBeInTheDocument();
      expect(screen.getByText(/Fixed the payment/)).toBeInTheDocument();
      expect(screen.queryByText(/CURSOR_SUMMARY/)).not.toBeInTheDocument();
      expect(screen.getByText(/Medium Risk/)).toBeInTheDocument();
      expect(container.querySelector(".markdown-alert-note")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Raw HTML Rendering Tests
  // ============================================================================

  describe("Raw HTML Rendering", () => {
    it("renders <sup> tags as superscript", () => {
      const content = `Written by Cursor<sup>beta</sup>`;
      const { container } = render(<MarkdownRenderer content={content} />);

      const sup = container.querySelector("sup");
      expect(sup).toBeInTheDocument();
      expect(sup?.textContent).toBe("beta");
    });

    it("sanitizes script tags", () => {
      const content = `Hello<script>alert('xss')</script>World`;
      render(<MarkdownRenderer content={content} />);

      expect(screen.getByText(/Hello/)).toBeInTheDocument();
      expect(screen.getByText(/World/)).toBeInTheDocument();
      // Script content should not be in the document at all
      expect(screen.queryByText(/alert/)).not.toBeInTheDocument();
    });

    it("sanitizes onclick attributes", () => {
      const content = `<button onclick="alert('xss')">Click me</button>`;
      const { container } = render(<MarkdownRenderer content={content} />);

      // The onclick attribute should be stripped by rehype-sanitize
      const button = container.querySelector("button");
      if (button) {
        expect(button.getAttribute("onclick")).toBeNull();
      }
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
