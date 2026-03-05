/**
 * Thread Integration Tests for Inline Diffs
 *
 * Tests the full flow of Edit/Write tool uses with inline diffs
 * in the context of a thread view.
 *
 * AssistantMessage now reads data from the thread store via selectors,
 * so tests populate the store instead of passing props.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test/helpers";
import type { ContentBlock } from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutionState } from "@/lib/types/agent-messages";
import { AssistantMessage } from "./assistant-message";
import { TurnRenderer } from "./turn-renderer";
import { ThreadProvider } from "./thread-context";
import { useThreadStore } from "@/entities/threads/store";
import type { Turn } from "@/lib/utils/turn-grouping";

// Mock logger
vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const THREAD_ID = "test-thread";

/** Set up thread store with messages and tool states. */
function setupThreadStore(
  messages: Array<{ role: string; content: ContentBlock[] }>,
  toolStates: Record<string, ToolExecutionState> = {},
) {
  useThreadStore.getState().setThreadState(THREAD_ID, {
    messages: messages.map((m, i) => ({ ...m, id: `msg-${i}` })),
    toolStates,
    fileChanges: [],
    workingDirectory: "",
    status: "running",
    timestamp: Date.now(),
  });
}

/** Wraps children with ThreadProvider for tests. */
function TestThreadWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThreadProvider threadId={THREAD_ID} workingDirectory="">
      {children}
    </ThreadProvider>
  );
}

describe("Thread with Inline Diffs", () => {
  beforeEach(() => {
    useThreadStore.getState().setThreadState(THREAD_ID, null);
  });

  // ============================================================================
  // Thread with Edit Tools
  // ============================================================================

  describe("thread with Edit tools", () => {
    it("renders inline diffs for Edit tool uses in assistant messages", () => {
      const content: ContentBlock[] = [
        { type: "text", text: "I'll fix that bug for you." },
        {
          type: "tool_use",
          id: "edit-1",
          name: "Edit",
          input: {
            file_path: "/src/foo.ts",
            old_string: "const x = 1;",
            new_string: "const x = 2;",
          },
        },
      ] as ContentBlock[];

      setupThreadStore(
        [{ role: "assistant", content }],
        { "edit-1": { status: "complete", result: JSON.stringify({ filePath: "/src/foo.ts", diff: "..." }) } },
      );

      render(<AssistantMessage messageId="msg-0" />, { wrapper: TestThreadWrapper });

      expect(screen.getByText("I'll fix that bug for you.")).toBeInTheDocument();
      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
    });

    it("renders multiple Edit tools in same message separately", () => {
      const content: ContentBlock[] = [
        { type: "text", text: "Making multiple changes..." },
        {
          type: "tool_use",
          id: "edit-1",
          name: "Edit",
          input: {
            file_path: "/src/foo.ts",
            old_string: "const x = 1;",
            new_string: "const x = 2;",
          },
        },
        {
          type: "tool_use",
          id: "edit-2",
          name: "Edit",
          input: {
            file_path: "/src/bar.ts",
            old_string: "const y = 1;",
            new_string: "const y = 2;",
          },
        },
      ] as ContentBlock[];

      setupThreadStore(
        [{ role: "assistant", content }],
        { "edit-1": { status: "complete" }, "edit-2": { status: "complete" } },
      );

      render(<AssistantMessage messageId="msg-0" />, { wrapper: TestThreadWrapper });

      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
      expect(screen.getByTestId("inline-diff--src-bar-ts")).toBeInTheDocument();
    });

    it("tool state updates reflect in diff display", () => {
      const content: ContentBlock[] = [
        {
          type: "tool_use",
          id: "edit-1",
          name: "Edit",
          input: {
            file_path: "/src/foo.ts",
            old_string: "const x = 1;",
            new_string: "const x = 2;",
          },
        },
      ] as ContentBlock[];

      // First render with running status
      setupThreadStore(
        [{ role: "assistant", content }],
        { "edit-1": { status: "running" } },
      );

      render(<AssistantMessage messageId="msg-0" />, { wrapper: TestThreadWrapper });

      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
      expect(screen.getByTestId("tool-use-edit-1")).toHaveAttribute("data-tool-status", "running");
    });
  });

  // ============================================================================
  // Mixed Content Tests
  // ============================================================================

  describe("mixed content", () => {
    it("renders text, Edit, and other tools in correct order", () => {
      const content: ContentBlock[] = [
        { type: "text", text: "First, let me read the file." },
        {
          type: "tool_use",
          id: "read-1",
          name: "Read",
          input: { file_path: "/src/foo.ts" },
        },
        { type: "text", text: "Now I'll make the change." },
        {
          type: "tool_use",
          id: "edit-1",
          name: "Edit",
          input: {
            file_path: "/src/foo.ts",
            old_string: "const x = 1;",
            new_string: "const x = 2;",
          },
        },
      ] as ContentBlock[];

      setupThreadStore(
        [{ role: "assistant", content }],
        {
          "read-1": { status: "complete", result: "const x = 1;" },
          "edit-1": { status: "complete" },
        },
      );

      render(<AssistantMessage messageId="msg-0" />, { wrapper: TestThreadWrapper });

      expect(screen.getByText("First, let me read the file.")).toBeInTheDocument();
      expect(screen.getByText("Now I'll make the change.")).toBeInTheDocument();
      expect(screen.getByTestId("tool-use-read-1")).toBeInTheDocument();
      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Pending Edit Flow Tests
  // ============================================================================

  describe("pending edit flow", () => {
    it("shows pending status for pending Edit tool", () => {
      const content: ContentBlock[] = [
        {
          type: "tool_use",
          id: "edit-1",
          name: "Edit",
          input: {
            file_path: "/src/foo.ts",
            old_string: "const x = 1;",
            new_string: "const x = 2;",
          },
        },
      ] as ContentBlock[];

      // Note: Using type assertion because ToolExecutionState doesn't include "pending"
      // but the UI component supports it for approval workflows
      setupThreadStore(
        [{ role: "assistant", content }],
        { "edit-1": { status: "pending" } } as unknown as Record<string, ToolExecutionState>,
      );

      render(<AssistantMessage messageId="msg-0" />, { wrapper: TestThreadWrapper });

      expect(screen.getByTestId("tool-use-edit-1")).toHaveAttribute("data-tool-status", "pending");
      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Turn Renderer Tests
  // ============================================================================

  describe("TurnRenderer with Edit tools", () => {
    it("renders assistant turn with Edit tool correctly", () => {
      const content: ContentBlock[] = [
        { type: "text", text: "Editing the file..." },
        {
          type: "tool_use",
          id: "edit-1",
          name: "Edit",
          input: {
            file_path: "/src/app.ts",
            old_string: "old",
            new_string: "new",
          },
        },
      ] as ContentBlock[];

      setupThreadStore(
        [{ role: "assistant", content }],
        { "edit-1": { status: "running" } },
      );

      const turn: Turn = {
        type: "assistant",
        message: { role: "assistant", content },
        messageId: "msg-0",
      };

      render(
        <TurnRenderer turn={turn} turnIndex={0} />,
        { wrapper: TestThreadWrapper },
      );

      expect(screen.getByText("Editing the file...")).toBeInTheDocument();
      expect(screen.getByTestId("inline-diff--src-app-ts")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Write Tool in Thread
  // ============================================================================

  describe("Write tool in thread", () => {
    it("renders Write tool with inline diff showing new file", () => {
      const content: ContentBlock[] = [
        { type: "text", text: "Creating a new file..." },
        {
          type: "tool_use",
          id: "write-1",
          name: "Write",
          input: {
            file_path: "/src/new-file.ts",
            content: "export const greeting = 'Hello';",
          },
        },
      ] as ContentBlock[];

      setupThreadStore(
        [{ role: "assistant", content }],
        { "write-1": { status: "complete" } },
      );

      render(<AssistantMessage messageId="msg-0" />, { wrapper: TestThreadWrapper });

      expect(screen.getByText("Creating a new file...")).toBeInTheDocument();
      expect(screen.getByTestId("inline-diff--src-new-file-ts")).toBeInTheDocument();
      expect(screen.getByText("export const greeting = 'Hello';")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Streaming State
  // ============================================================================

  describe("streaming state", () => {
    it("shows running diff while tool is running", () => {
      const content: ContentBlock[] = [
        {
          type: "tool_use",
          id: "edit-1",
          name: "Edit",
          input: {
            file_path: "/src/foo.ts",
            old_string: "const x = 1;",
            new_string: "const x = 2;",
          },
        },
      ] as ContentBlock[];

      setupThreadStore(
        [{ role: "assistant", content }],
        { "edit-1": { status: "running" } },
      );

      render(<AssistantMessage messageId="msg-0" />, { wrapper: TestThreadWrapper });

      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
      expect(screen.getByTestId("tool-use-edit-1")).toHaveAttribute("data-tool-status", "running");
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("edge cases", () => {
    it("handles missing toolStates gracefully (defaults to running)", () => {
      const content: ContentBlock[] = [
        {
          type: "tool_use",
          id: "edit-1",
          name: "Edit",
          input: {
            file_path: "/src/foo.ts",
            old_string: "const x = 1;",
            new_string: "const x = 2;",
          },
        },
      ] as ContentBlock[];

      // No tool states — useToolState defaults to { status: "running" }
      setupThreadStore(
        [{ role: "assistant", content }],
        {},
      );

      render(<AssistantMessage messageId="msg-0" />, { wrapper: TestThreadWrapper });

      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
      expect(screen.getByTestId("tool-use-edit-1")).toHaveAttribute("data-tool-status", "running");
    });

    it("handles empty content array", () => {
      setupThreadStore(
        [{ role: "assistant", content: [] as ContentBlock[] }],
        {},
      );

      const { container } = render(
        <AssistantMessage messageId="msg-0" />,
        { wrapper: TestThreadWrapper },
      );

      // Should render the article wrapper but with no content blocks
      expect(container.querySelector("article")).toBeInTheDocument();
    });

    it("handles error state in Edit tool", () => {
      const content: ContentBlock[] = [
        {
          type: "tool_use",
          id: "edit-1",
          name: "Edit",
          input: {
            file_path: "/src/foo.ts",
            old_string: "const x = 1;",
            new_string: "const x = 2;",
          },
        },
      ] as ContentBlock[];

      setupThreadStore(
        [{ role: "assistant", content }],
        { "edit-1": { status: "error", isError: true, result: "File not found" } },
      );

      render(<AssistantMessage messageId="msg-0" />, { wrapper: TestThreadWrapper });

      expect(screen.getByTestId("tool-use-edit-1")).toHaveAttribute("data-tool-status", "error");
    });
  });
});
