import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { InlineDiffBlock } from "./inline-diff-block";
import type { AnnotatedLine } from "../diff-viewer/types";
import * as diffParser from "@/lib/diff-parser";

describe("InlineDiffBlock", () => {
  const sampleDiff = `diff --git a/src/foo.ts b/src/foo.ts
index abc123..def456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
 export { x };`;

  const sampleLines: AnnotatedLine[] = [
    { type: "unchanged", content: "const x = 1;", oldLineNumber: 1, newLineNumber: 1 },
    { type: "deletion", content: "const y = 2;", oldLineNumber: 2, newLineNumber: null },
    { type: "addition", content: "const y = 3;", oldLineNumber: null, newLineNumber: 2 },
    { type: "addition", content: "const z = 4;", oldLineNumber: null, newLineNumber: 3 },
    { type: "unchanged", content: "export { x };", oldLineNumber: 3, newLineNumber: 4 },
  ];

  // ============================================================================
  // Rendering Tests
  // ============================================================================

  describe("rendering", () => {
    it("renders file name in header", () => {
      render(<InlineDiffBlock filePath="/src/foo.ts" diff={sampleDiff} />);

      expect(screen.getByText("foo.ts")).toBeInTheDocument();
    });

    it("renders addition lines", () => {
      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          lines={sampleLines}
          stats={{ additions: 2, deletions: 1 }}
        />
      );

      expect(screen.getByText("const y = 3;")).toBeInTheDocument();
      expect(screen.getByText("const z = 4;")).toBeInTheDocument();
    });

    it("renders deletion lines", () => {
      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          lines={sampleLines}
          stats={{ additions: 2, deletions: 1 }}
        />
      );

      expect(screen.getByText("const y = 2;")).toBeInTheDocument();
    });

    it("renders stats badge with correct counts", () => {
      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          lines={sampleLines}
          stats={{ additions: 2, deletions: 1 }}
        />
      );

      expect(screen.getByText("+2")).toBeInTheDocument();
      expect(screen.getByText("-1")).toBeInTheDocument();
    });

    it("has correct test ID based on file path", () => {
      render(<InlineDiffBlock filePath="/src/foo.ts" diff={sampleDiff} />);

      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
    });

    it("renders unchanged lines", () => {
      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          lines={sampleLines}
          stats={{ additions: 2, deletions: 1 }}
        />
      );

      expect(screen.getByText("const x = 1;")).toBeInTheDocument();
      expect(screen.getByText("export { x };")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Expand Button Tests
  // ============================================================================

  describe("expand button", () => {
    it("renders expand button when onExpand provided", () => {
      const onExpand = vi.fn();
      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          lines={sampleLines}
          stats={{ additions: 2, deletions: 1 }}
          onExpand={onExpand}
        />
      );

      expect(screen.getByRole("button", { name: /expand/i })).toBeInTheDocument();
    });

    it("does not render expand button when onExpand not provided", () => {
      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          lines={sampleLines}
          stats={{ additions: 2, deletions: 1 }}
        />
      );

      expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();
    });

    it("calls onExpand when expand button clicked", () => {
      const onExpand = vi.fn();
      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          lines={sampleLines}
          stats={{ additions: 2, deletions: 1 }}
          onExpand={onExpand}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /expand/i }));

      expect(onExpand).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Pending Mode Tests
  // ============================================================================

  describe("pending mode", () => {
    it("renders normally when isPending is true (actions handled externally)", () => {
      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          lines={sampleLines}
          stats={{ additions: 2, deletions: 1 }}
          isPending={true}
        />
      );

      // Diff content should still render
      expect(screen.getByText("const y = 3;")).toBeInTheDocument();
      // No action buttons rendered inside InlineDiffBlock
      expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /reject/i })).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Accessibility Tests
  // ============================================================================

  describe("accessibility", () => {
    it("has region role with aria-label", () => {
      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          lines={sampleLines}
          stats={{ additions: 2, deletions: 1 }}
        />
      );

      expect(screen.getByRole("region", { name: /changes to foo.ts/i })).toBeInTheDocument();
    });

    it("has table semantics for diff content", () => {
      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          lines={sampleLines}
          stats={{ additions: 2, deletions: 1 }}
        />
      );

      expect(screen.getByRole("table", { name: /diff content/i })).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("edge cases", () => {
    it("shows placeholder for empty diff", () => {
      render(<InlineDiffBlock filePath="/src/foo.ts" diff="" />);

      expect(screen.getByText(/no changes/i)).toBeInTheDocument();
    });

    it("shows placeholder for empty lines array", () => {
      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          lines={[]}
          stats={{ additions: 0, deletions: 0 }}
        />
      );

      expect(screen.getByText(/no changes/i)).toBeInTheDocument();
    });

    it("handles diff with no context lines", () => {
      const diffNoContext = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1 +1 @@
-old
+new`;

      render(<InlineDiffBlock filePath="/foo.ts" diff={diffNoContext} />);

      expect(screen.getByText("old")).toBeInTheDocument();
      expect(screen.getByText("new")).toBeInTheDocument();
    });

    it("handles file path with special characters", () => {
      render(
        <InlineDiffBlock
          filePath="/src/components/my-component.test.tsx"
          lines={sampleLines}
          stats={{ additions: 2, deletions: 1 }}
        />
      );

      expect(
        screen.getByTestId("inline-diff--src-components-my-component-test-tsx")
      ).toBeInTheDocument();
    });

    it("uses precomputed stats when provided with lines", () => {
      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          lines={sampleLines}
          stats={{ additions: 10, deletions: 5 }}
        />
      );

      expect(screen.getByText("+10")).toBeInTheDocument();
      expect(screen.getByText("-5")).toBeInTheDocument();
    });

    it("defaults to zero stats when lines provided without stats", () => {
      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          lines={sampleLines}
        />
      );

      // Should not show stats if they're zero
      expect(screen.queryByText("+0")).not.toBeInTheDocument();
    });

    it("handles whitespace-only diff", () => {
      render(<InlineDiffBlock filePath="/src/foo.ts" diff="   \n\n  " />);

      expect(screen.getByText(/no changes/i)).toBeInTheDocument();
    });

    it("handles unicode file paths", () => {
      render(
        <InlineDiffBlock
          filePath="/src/components/日本語-component.tsx"
          lines={sampleLines}
          stats={{ additions: 2, deletions: 1 }}
        />
      );

      expect(screen.getByText("日本語-component.tsx")).toBeInTheDocument();
    });

    it("handles file paths with spaces", () => {
      render(
        <InlineDiffBlock
          filePath="/src/my component/file name.ts"
          lines={sampleLines}
          stats={{ additions: 2, deletions: 1 }}
        />
      );

      expect(screen.getByText("file name.ts")).toBeInTheDocument();
    });

    it("handles multiple hunks in diff", () => {
      const multiHunkDiff = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
 line1
-line2
+line2-modified
 line3
@@ -10,3 +10,3 @@
 line10
-line11
+line11-modified
 line12`;

      render(<InlineDiffBlock filePath="/foo.ts" diff={multiHunkDiff} />);

      expect(screen.getByText("line2")).toBeInTheDocument();
      expect(screen.getByText("line2-modified")).toBeInTheDocument();
      expect(screen.getByText("line11")).toBeInTheDocument();
      expect(screen.getByText("line11-modified")).toBeInTheDocument();
    });

    it("handles lines with special characters (tabs, unicode)", () => {
      const specialLines: AnnotatedLine[] = [
        { type: "deletion", content: "\tindented with tab", oldLineNumber: 1, newLineNumber: null },
        { type: "addition", content: "  indented with spaces", oldLineNumber: null, newLineNumber: 1 },
        { type: "unchanged", content: "Unicode: 日本語 emoji 👍", oldLineNumber: 2, newLineNumber: 2 },
      ];

      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          lines={specialLines}
          stats={{ additions: 1, deletions: 1 }}
        />
      );

      expect(screen.getByText(/indented with tab/)).toBeInTheDocument();
      expect(screen.getByText(/indented with spaces/)).toBeInTheDocument();
      expect(screen.getByText(/Unicode: 日本語 emoji/)).toBeInTheDocument();
    });

    it("handles new file (all additions)", () => {
      const newFileLines: AnnotatedLine[] = [
        { type: "addition", content: "export const foo = 1;", oldLineNumber: null, newLineNumber: 1 },
        { type: "addition", content: "export const bar = 2;", oldLineNumber: null, newLineNumber: 2 },
      ];

      render(
        <InlineDiffBlock
          filePath="/src/new.ts"
          lines={newFileLines}
          stats={{ additions: 2, deletions: 0 }}
        />
      );

      expect(screen.getByText("+2")).toBeInTheDocument();
      expect(screen.queryByText("-")).not.toBeInTheDocument();
    });

    it("handles deleted file (all deletions)", () => {
      const deletedFileLines: AnnotatedLine[] = [
        { type: "deletion", content: "export const foo = 1;", oldLineNumber: 1, newLineNumber: null },
        { type: "deletion", content: "export const bar = 2;", oldLineNumber: 2, newLineNumber: null },
      ];

      render(
        <InlineDiffBlock
          filePath="/src/deleted.ts"
          lines={deletedFileLines}
          stats={{ additions: 0, deletions: 2 }}
        />
      );

      expect(screen.getByText("-2")).toBeInTheDocument();
      expect(screen.queryByText(/\+\d/)).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Collapsed Regions Tests
  // ============================================================================

  describe("collapsed regions", () => {
    // Create a large diff with many unchanged lines
    const largeDiffLines: AnnotatedLine[] = [
      { type: "unchanged", content: "line1", oldLineNumber: 1, newLineNumber: 1 },
      { type: "unchanged", content: "line2", oldLineNumber: 2, newLineNumber: 2 },
      { type: "unchanged", content: "line3", oldLineNumber: 3, newLineNumber: 3 },
      { type: "unchanged", content: "line4", oldLineNumber: 4, newLineNumber: 4 },
      { type: "unchanged", content: "line5", oldLineNumber: 5, newLineNumber: 5 },
      { type: "unchanged", content: "line6", oldLineNumber: 6, newLineNumber: 6 },
      { type: "unchanged", content: "line7", oldLineNumber: 7, newLineNumber: 7 },
      { type: "unchanged", content: "line8", oldLineNumber: 8, newLineNumber: 8 },
      { type: "unchanged", content: "line9", oldLineNumber: 9, newLineNumber: 9 },
      { type: "unchanged", content: "line10", oldLineNumber: 10, newLineNumber: 10 },
      { type: "addition", content: "new line", oldLineNumber: null, newLineNumber: 11 },
    ];

    it("shows collapsed region placeholder for many unchanged lines", () => {
      render(
        <InlineDiffBlock
          filePath="/big.ts"
          lines={largeDiffLines}
          stats={{ additions: 1, deletions: 0 }}
        />
      );

      // Should show "N unchanged lines" placeholder
      expect(screen.getByText(/unchanged line/)).toBeInTheDocument();
    });

    it("expands collapsed region when clicked", () => {
      render(
        <InlineDiffBlock
          filePath="/big.ts"
          lines={largeDiffLines}
          stats={{ additions: 1, deletions: 0 }}
        />
      );

      const placeholder = screen.getByRole("button", { name: /unchanged line/i });
      fireEvent.click(placeholder);

      // After expanding, should show more lines
      expect(screen.getByText("line1")).toBeInTheDocument();
      expect(screen.getByText("line5")).toBeInTheDocument();
    });
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("InlineDiffBlock error handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows error state when parseDiff throws", () => {
    vi.spyOn(diffParser, "parseDiff").mockImplementation(() => {
      throw new Error("Invalid diff format");
    });

    render(<InlineDiffBlock filePath="/test.ts" diff="invalid diff content" />);

    // Should show error message
    expect(screen.getByText(/unable to parse diff/i)).toBeInTheDocument();
    expect(screen.getByText(/invalid diff format/i)).toBeInTheDocument();
  });

  it("renders with error styling when parse fails", () => {
    vi.spyOn(diffParser, "parseDiff").mockImplementation(() => {
      throw new Error("Parse error");
    });

    const { container } = render(
      <InlineDiffBlock filePath="/test.ts" diff="bad diff" />
    );

    // Should have error border
    const errorDiv = container.querySelector('[class*="border-red"]');
    expect(errorDiv).toBeInTheDocument();
  });

  it("has accessible error message with file context", () => {
    vi.spyOn(diffParser, "parseDiff").mockImplementation(() => {
      throw new Error("Parse error");
    });

    render(<InlineDiffBlock filePath="/src/component.tsx" diff="bad" />);

    // Should have aria-label with file context
    expect(
      screen.getByRole("region", { name: /error parsing changes to component.tsx/i })
    ).toBeInTheDocument();
  });

  it("preserves test ID in error state", () => {
    vi.spyOn(diffParser, "parseDiff").mockImplementation(() => {
      throw new Error("Parse error");
    });

    render(<InlineDiffBlock filePath="/src/foo.ts" diff="bad" />);

    expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
  });
});

describe("InlineDiffHeader", () => {
  it("shows full path in tooltip", () => {
    render(
      <InlineDiffBlock
        filePath="/very/long/path/to/component.tsx"
        lines={[
          { type: "addition", content: "test", oldLineNumber: null, newLineNumber: 1 },
        ]}
        stats={{ additions: 1, deletions: 0 }}
      />
    );

    // The filename should be displayed
    expect(screen.getByText("component.tsx")).toBeInTheDocument();
    // The full path should be in a title attribute
    expect(screen.getByTitle("/very/long/path/to/component.tsx")).toBeInTheDocument();
  });
});

