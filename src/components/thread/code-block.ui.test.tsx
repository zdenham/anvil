import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@/test/helpers";
import { CodeBlock, clearExpandedStateCache } from "./code-block";

// Mock the useCodeHighlight hook
vi.mock("@/hooks/use-code-highlight", () => ({
  useCodeHighlight: vi.fn(),
}));

import { useCodeHighlight } from "@/hooks/use-code-highlight";
const mockUseCodeHighlight = vi.mocked(useCodeHighlight);

// Mock navigator.clipboard using vi.stubGlobal
const mockWriteText = vi.fn();

describe("CodeBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clearExpandedStateCache(); // Reset expand state between tests
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        writeText: mockWriteText,
      },
    });
    mockUseCodeHighlight.mockReturnValue({
      tokens: [[{ content: "const x = 1;", color: "#e1e4e8", offset: 0 }]],
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ============================================================================
  // Rendering Tests
  // ============================================================================

  describe("Rendering", () => {
    it("renders code content", () => {
      render(<CodeBlock code="const x = 1;" language="typescript" />);

      expect(screen.getByText("const x = 1;")).toBeInTheDocument();
    });

    it("displays language label", () => {
      render(<CodeBlock code="print('hello')" language="python" />);

      expect(screen.getByText("python")).toBeInTheDocument();
    });

    it("shows unstyled code while loading", () => {
      mockUseCodeHighlight.mockReturnValue({
        tokens: null,
        isLoading: true,
      });

      render(<CodeBlock code="const x = 1;" language="typescript" />);

      // Should show the raw code text while loading
      expect(screen.getByText("const x = 1;")).toBeInTheDocument();
    });

    it("defaults to plaintext when no language provided", () => {
      render(<CodeBlock code="some text" />);

      expect(screen.getByText("plaintext")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Copy Functionality Tests
  // ============================================================================

  describe("Copy Functionality", () => {
    it("copies code to clipboard on button click", async () => {
      mockWriteText.mockResolvedValue(undefined);

      render(<CodeBlock code="const x = 1;" language="typescript" />);

      const copyButton = screen.getByRole("button", { name: /copy code/i });
      await act(async () => {
        fireEvent.click(copyButton);
      });

      expect(mockWriteText).toHaveBeenCalledWith("const x = 1;");
    });

    it("shows copied feedback after copying", async () => {
      mockWriteText.mockResolvedValue(undefined);

      render(<CodeBlock code="const x = 1;" language="typescript" />);

      const copyButton = screen.getByRole("button", { name: /copy code/i });
      await act(async () => {
        fireEvent.click(copyButton);
      });

      expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();
    });

    it("resets copied state after 2 seconds", async () => {
      mockWriteText.mockResolvedValue(undefined);

      render(<CodeBlock code="const x = 1;" language="typescript" />);

      const copyButton = screen.getByRole("button", { name: /copy code/i });
      await act(async () => {
        fireEvent.click(copyButton);
      });

      expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();

      // Advance time by 2 seconds
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      expect(screen.getByRole("button", { name: /copy code/i })).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Collapsing Tests
  // ============================================================================

  describe("Collapsing", () => {
    const shortCode = "line 1\nline 2\nline 3";
    const longCode = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n");

    beforeEach(() => {
      mockUseCodeHighlight.mockReturnValue({
        tokens: [[{ content: "line", color: "#e1e4e8", offset: 0 }]],
        isLoading: false,
      });
    });

    it("collapses long code blocks by default (>20 lines)", () => {
      render(<CodeBlock code={longCode} language="typescript" />);

      // Should show expand button when collapsed
      expect(screen.getByRole("button", { name: /expand/i })).toBeInTheDocument();
    });

    it("expands when clicking expand button", async () => {
      render(<CodeBlock code={longCode} language="typescript" />);

      const expandButton = screen.getByRole("button", { name: /expand/i });
      fireEvent.click(expandButton);

      // Button should now show "Collapse" after expanding
      expect(screen.getByRole("button", { name: /collapse/i })).toBeInTheDocument();
    });

    it("does not show expand/collapse for short code blocks", () => {
      render(<CodeBlock code={shortCode} language="typescript" />);

      // Should not show expand or collapse buttons for short code
      expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /collapse/i })).not.toBeInTheDocument();
    });

    it("shows collapse button at bottom when expanded", async () => {
      render(<CodeBlock code={longCode} language="typescript" />);

      // Initially shows expand
      expect(screen.getByRole("button", { name: /expand/i })).toBeInTheDocument();

      // Expand the code
      const expandButton = screen.getByRole("button", { name: /expand/i });
      fireEvent.click(expandButton);

      // Now collapse button should be visible at the same position
      expect(screen.getByRole("button", { name: /collapse/i })).toBeInTheDocument();
    });

    it("collapse button re-collapses the code block", async () => {
      render(<CodeBlock code={longCode} language="typescript" />);

      // Expand first
      const expandButton = screen.getByRole("button", { name: /expand/i });
      fireEvent.click(expandButton);

      // Then collapse
      const collapseButton = screen.getByRole("button", { name: /collapse/i });
      fireEvent.click(collapseButton);

      // Should show expand button again
      expect(screen.getByRole("button", { name: /expand/i })).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Accessibility Tests
  // ============================================================================

  describe("Accessibility", () => {
    it("has accessible copy button with aria-label", () => {
      render(<CodeBlock code="const x = 1;" language="typescript" />);

      const copyButton = screen.getByRole("button", { name: /copy code to clipboard/i });
      expect(copyButton).toBeInTheDocument();
    });

    it("uses semantic code element", () => {
      render(<CodeBlock code="const x = 1;" language="typescript" />);

      const codeElement = screen.getByRole("code", { hidden: true });
      expect(codeElement).toBeInTheDocument();
    });
  });
});
