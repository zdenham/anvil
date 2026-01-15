import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { ToolUseBlock } from "./tool-use-block";

// Mock logger
vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

describe("ToolUseBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // Edit Tool Tests
  // ============================================================================

  describe("Edit tool", () => {
    it("renders inline diff when Edit result contains diff", () => {
      const result = JSON.stringify({
        filePath: "/src/foo.ts",
        success: true,
        diff: `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,1 @@
-const x = 1;
+const x = 2;`,
      });

      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/foo.ts", old_string: "const x = 1;", new_string: "const x = 2;" }}
          result={result}
          status="complete"
        />
      );

      // Should show the inline diff
      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
    });

    it("generates preview diff from input when running", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/foo.ts", old_string: "const x = 1;", new_string: "const x = 2;" }}
          status="running"
        />
      );

      // Should generate diff from input
      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
      // Should show the lines being changed
      expect(screen.getByText("const x = 1;")).toBeInTheDocument();
      expect(screen.getByText("const x = 2;")).toBeInTheDocument();
    });

    it("renders accept/reject buttons for pending Edit", () => {
      const onAccept = vi.fn();
      const onReject = vi.fn();

      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/foo.ts", old_string: "const x = 1;", new_string: "const x = 2;" }}
          status="pending"
          onAccept={onAccept}
          onReject={onReject}
        />
      );

      // Should show accept/reject buttons
      expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
    });

    it("calls onAccept when accept clicked", () => {
      const onAccept = vi.fn();

      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/foo.ts", old_string: "const x = 1;", new_string: "const x = 2;" }}
          status="pending"
          onAccept={onAccept}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /accept/i }));
      expect(onAccept).toHaveBeenCalledTimes(1);
    });

    it("calls onReject when reject clicked", () => {
      const onReject = vi.fn();

      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/foo.ts", old_string: "const x = 1;", new_string: "const x = 2;" }}
          status="pending"
          onReject={onReject}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /reject/i }));
      expect(onReject).toHaveBeenCalledTimes(1);
    });

    it("does not render inline diff when Edit input is invalid", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/foo.ts" }} // missing old_string and new_string
          status="running"
        />
      );

      // Should not show inline diff
      expect(screen.queryByTestId("inline-diff--src-foo-ts")).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Write Tool Tests
  // ============================================================================

  describe("Write tool", () => {
    it("renders inline diff for Write results", () => {
      const result = JSON.stringify({
        filePath: "/src/new.ts",
        success: true,
        diff: `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+const foo = 1;
+export { foo };`,
      });

      render(
        <ToolUseBlock
          id="tool-1"
          name="Write"
          input={{ file_path: "/src/new.ts", content: "const foo = 1;\nexport { foo };" }}
          result={result}
          status="complete"
        />
      );

      expect(screen.getByTestId("inline-diff--src-new-ts")).toBeInTheDocument();
    });

    it("handles new file creation (all additions)", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Write"
          input={{ file_path: "/src/new.ts", content: "const foo = 1;\nexport { foo };" }}
          status="running"
        />
      );

      // Should generate diff showing all lines as additions
      expect(screen.getByTestId("inline-diff--src-new-ts")).toBeInTheDocument();
      expect(screen.getByText("const foo = 1;")).toBeInTheDocument();
      expect(screen.getByText("export { foo };")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Non-Edit/Write Tools Tests
  // ============================================================================

  describe("Non-Edit/Write tools", () => {
    it("does not render inline diff for Read tool", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Read"
          input={{ file_path: "/src/foo.ts" }}
          result="file contents here"
          status="complete"
        />
      );

      expect(screen.queryByTestId(/inline-diff/)).not.toBeInTheDocument();
    });

    it("does not render inline diff for Bash tool", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Bash"
          input={{ command: "ls -la" }}
          result="file1.txt\nfile2.txt"
          status="complete"
        />
      );

      expect(screen.queryByTestId(/inline-diff/)).not.toBeInTheDocument();
    });

    it("does not render inline diff for Glob tool", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Glob"
          input={{ pattern: "**/*.ts" }}
          result="/src/foo.ts\n/src/bar.ts"
          status="complete"
        />
      );

      expect(screen.queryByTestId(/inline-diff/)).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Status Handling Tests
  // ============================================================================

  describe("status handling", () => {
    it("shows data-tool-status=running for running status", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Read"
          input={{ file_path: "/src/foo.ts" }}
          status="running"
        />
      );

      expect(screen.getByTestId("tool-use-tool-1")).toHaveAttribute("data-tool-status", "running");
    });

    it("shows data-tool-status=complete for complete status", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Read"
          input={{ file_path: "/src/foo.ts" }}
          result="contents"
          status="complete"
        />
      );

      expect(screen.getByTestId("tool-use-tool-1")).toHaveAttribute("data-tool-status", "complete");
    });

    it("shows data-tool-status=pending for pending status", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/foo.ts", old_string: "a", new_string: "b" }}
          status="pending"
        />
      );

      expect(screen.getByTestId("tool-use-tool-1")).toHaveAttribute("data-tool-status", "pending");
    });

    it("shows data-tool-status=error for error status", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Read"
          input={{ file_path: "/src/foo.ts" }}
          status="error"
          isError={true}
        />
      );

      expect(screen.getByTestId("tool-use-tool-1")).toHaveAttribute("data-tool-status", "error");
    });

    it("shows error styling for error status", () => {
      const { container } = render(
        <ToolUseBlock
          id="tool-1"
          name="Read"
          input={{ file_path: "/src/foo.ts" }}
          status="error"
          isError={true}
        />
      );

      // Check for error border class
      const details = container.querySelector("details");
      expect(details?.className).toContain("border-red");
    });

    it("shows read-only diff for complete status (no accept/reject)", () => {
      const result = JSON.stringify({
        filePath: "/src/foo.ts",
        success: true,
        diff: "diff content",
      });

      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/foo.ts", old_string: "a", new_string: "b" }}
          result={result}
          status="complete"
        />
      );

      // Should not show accept/reject buttons for completed edits
      expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /reject/i })).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Expand/Collapse Tests
  // ============================================================================

  describe("expand/collapse", () => {
    it("is collapsed by default", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Read"
          input={{ file_path: "/src/foo.ts" }}
          result="file contents"
          status="complete"
        />
      );

      const details = screen.getByTestId("tool-use-tool-1");
      expect(details).not.toHaveAttribute("open");
    });

    it("expands when clicked", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Read"
          input={{ file_path: "/src/foo.ts" }}
          result="file contents"
          status="complete"
        />
      );

      const summary = screen.getByRole("group").querySelector("summary");
      if (summary) {
        fireEvent.click(summary);
      }

      // After clicking, details should be open
      const details = screen.getByTestId("tool-use-tool-1");
      expect(details).toHaveAttribute("open");
    });
  });

  // ============================================================================
  // Tool Display Name Tests
  // ============================================================================

  describe("tool display", () => {
    it("displays formatted file path for Edit tool", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/foo.ts", old_string: "a", new_string: "b" }}
          status="running"
        />
      );

      expect(screen.getByText("Edit")).toBeInTheDocument();
    });

    it("displays formatted command for Bash tool", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Bash"
          input={{ command: "npm test" }}
          status="running"
        />
      );

      expect(screen.getByText("Bash")).toBeInTheDocument();
    });

    it("shows duration for completed tools", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Read"
          input={{ file_path: "/src/foo.ts" }}
          result="contents"
          status="complete"
          durationMs={1500}
        />
      );

      expect(screen.getByText("1.5s")).toBeInTheDocument();
    });

    it("does not show duration while running", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Read"
          input={{ file_path: "/src/foo.ts" }}
          status="running"
          durationMs={1500}
        />
      );

      expect(screen.queryByText("1.5s")).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Accessibility Tests
  // ============================================================================

  describe("accessibility", () => {
    it("has aria-label with tool name and status", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/foo.ts", old_string: "a", new_string: "b" }}
          status="running"
        />
      );

      expect(screen.getByLabelText(/tool: edit, status: running/i)).toBeInTheDocument();
    });

    it("has screen reader status announcement", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Read"
          input={{ file_path: "/src/foo.ts" }}
          status="running"
        />
      );

      expect(screen.getByText("In progress")).toBeInTheDocument();
    });

    it("announces pending approval for pending status", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/foo.ts", old_string: "a", new_string: "b" }}
          status="pending"
        />
      );

      expect(screen.getByText("Pending approval")).toBeInTheDocument();
    });

    it("announces completed for complete status", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Read"
          input={{ file_path: "/src/foo.ts" }}
          result="contents"
          status="complete"
        />
      );

      expect(screen.getByText("Completed")).toBeInTheDocument();
    });

    it("announces failed for error status", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Read"
          input={{ file_path: "/src/foo.ts" }}
          status="error"
          isError={true}
        />
      );

      expect(screen.getByText("Failed")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("edge cases", () => {
    it("handles empty old_string (new code insertion)", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/foo.ts", old_string: "", new_string: "new line" }}
          status="running"
        />
      );

      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
      expect(screen.getByText("new line")).toBeInTheDocument();
    });

    it("handles empty new_string (deletion)", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/foo.ts", old_string: "old line", new_string: "" }}
          status="running"
        />
      );

      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
      expect(screen.getByText("old line")).toBeInTheDocument();
    });

    it("handles identical strings (no changes)", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/foo.ts", old_string: "same", new_string: "same" }}
          status="running"
        />
      );

      // Should show no changes placeholder
      expect(screen.getByText(/no changes/i)).toBeInTheDocument();
    });

    it("calls onOpenDiff when expand button clicked", () => {
      const onOpenDiff = vi.fn();

      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/foo.ts", old_string: "a", new_string: "b" }}
          status="running"
          onOpenDiff={onOpenDiff}
        />
      );

      // Find the expand button within the diff block
      const expandButton = screen.getByRole("button", { name: /expand to full diff/i });
      fireEvent.click(expandButton);

      expect(onOpenDiff).toHaveBeenCalledWith("/src/foo.ts");
    });

    it("handles file path with special characters", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/my-component.test.tsx", old_string: "a", new_string: "b" }}
          status="running"
        />
      );

      expect(
        screen.getByTestId("inline-diff--src-my-component-test-tsx")
      ).toBeInTheDocument();
    });
  });
});
