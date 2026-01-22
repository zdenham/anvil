/**
 * Thread Integration Tests for Inline Diffs
 *
 * Tests the full flow of Edit/Write tool uses with inline diffs
 * in the context of a thread view.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test/helpers";
import type { MessageParam, ContentBlock } from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutionState } from "@/lib/types/agent-messages";
import { AssistantMessage } from "./assistant-message";
import { TurnRenderer } from "./turn-renderer";
import type { Turn } from "@/lib/utils/turn-grouping";

// Mock logger
vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe("Thread with Inline Diffs", () => {
  // ============================================================================
  // Thread with Edit Tools
  // ============================================================================

  describe("thread with Edit tools", () => {
    it("renders inline diffs for Edit tool uses in assistant messages", () => {
      const messages: MessageParam[] = [
        {
          role: "assistant",
          content: [
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
          ] as ContentBlock[],
        },
      ];

      const toolStates: Record<string, ToolExecutionState> = {
        "edit-1": { status: "complete", result: JSON.stringify({ filePath: "/src/foo.ts", diff: "..." }) },
      };

      render(
        <AssistantMessage
          messages={messages}
          messageIndex={0}
          toolStates={toolStates}
        />
      );

      // Should render the text
      expect(screen.getByText("I'll fix that bug for you.")).toBeInTheDocument();

      // Should render the inline diff
      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
    });

    it("renders multiple Edit tools in same message separately", () => {
      const messages: MessageParam[] = [
        {
          role: "assistant",
          content: [
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
          ] as ContentBlock[],
        },
      ];

      const toolStates: Record<string, ToolExecutionState> = {
        "edit-1": { status: "complete" },
        "edit-2": { status: "complete" },
      };

      render(
        <AssistantMessage
          messages={messages}
          messageIndex={0}
          toolStates={toolStates}
        />
      );

      // Should render both inline diffs
      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
      expect(screen.getByTestId("inline-diff--src-bar-ts")).toBeInTheDocument();
    });

    it("tool state updates reflect in diff display", () => {
      const messages: MessageParam[] = [
        {
          role: "assistant",
          content: [
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
          ] as ContentBlock[],
        },
      ];

      // First render with running status
      const { rerender } = render(
        <AssistantMessage
          messages={messages}
          messageIndex={0}
          toolStates={{ "edit-1": { status: "running" } }}
        />
      );

      // Should show the diff (generated from input)
      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
      expect(screen.getByTestId("tool-use-edit-1")).toHaveAttribute("data-tool-status", "running");

      // Rerender with pending status
      // Note: Using type assertion because ToolExecutionState doesn't include "pending"
      // but the UI component supports it for approval workflows
      rerender(
        <AssistantMessage
          messages={messages}
          messageIndex={0}
          toolStates={{ "edit-1": { status: "pending" } } as unknown as Record<string, ToolExecutionState>}
        />
      );

      // Should now show pending status and accept/reject buttons
      expect(screen.getByTestId("tool-use-edit-1")).toHaveAttribute("data-tool-status", "pending");
    });
  });

  // ============================================================================
  // Mixed Content Tests
  // ============================================================================

  describe("mixed content", () => {
    it("renders text, Edit, and other tools in correct order", () => {
      const messages: MessageParam[] = [
        {
          role: "assistant",
          content: [
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
          ] as ContentBlock[],
        },
      ];

      const toolStates: Record<string, ToolExecutionState> = {
        "read-1": { status: "complete", result: "const x = 1;" },
        "edit-1": { status: "complete" },
      };

      render(
        <AssistantMessage
          messages={messages}
          messageIndex={0}
          toolStates={toolStates}
        />
      );

      // All content should be rendered
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
      const messages: MessageParam[] = [
        {
          role: "assistant",
          content: [
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
          ] as ContentBlock[],
        },
      ];

      // Note: Using type assertion because ToolExecutionState doesn't include "pending"
      // but the UI component supports it for approval workflows
      render(
        <AssistantMessage
          messages={messages}
          messageIndex={0}
          toolStates={{ "edit-1": { status: "pending" } } as unknown as Record<string, ToolExecutionState>}
        />
      );

      // Pending status should be shown
      expect(screen.getByTestId("tool-use-edit-1")).toHaveAttribute("data-tool-status", "pending");
      // The inline diff should still be rendered
      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Turn Renderer Tests
  // ============================================================================

  describe("TurnRenderer with Edit tools", () => {
    it("renders assistant turn with Edit tool correctly", () => {
      const messages: MessageParam[] = [
        {
          role: "assistant",
          content: [
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
          ] as ContentBlock[],
        },
      ];

      const turn: Turn = {
        type: "assistant",
        message: messages[0],
        messageIndex: 0,
      };

      const toolStates: Record<string, ToolExecutionState> = {
        "edit-1": { status: "running" },
      };

      render(
        <TurnRenderer
          turn={turn}
          turnIndex={0}
          messages={messages}
          toolStates={toolStates}
        />
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
      const messages: MessageParam[] = [
        {
          role: "assistant",
          content: [
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
          ] as ContentBlock[],
        },
      ];

      const toolStates: Record<string, ToolExecutionState> = {
        "write-1": { status: "complete" },
      };

      render(
        <AssistantMessage
          messages={messages}
          messageIndex={0}
          toolStates={toolStates}
        />
      );

      expect(screen.getByText("Creating a new file...")).toBeInTheDocument();
      expect(screen.getByTestId("inline-diff--src-new-file-ts")).toBeInTheDocument();
      // Write tool generates all lines as additions
      expect(screen.getByText("export const greeting = 'Hello';")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Streaming State
  // ============================================================================

  describe("streaming state", () => {
    it("shows running diff while streaming", () => {
      const messages: MessageParam[] = [
        {
          role: "assistant",
          content: [
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
          ] as ContentBlock[],
        },
      ];

      render(
        <AssistantMessage
          messages={messages}
          messageIndex={0}
          isStreaming={true}
          toolStates={{ "edit-1": { status: "running" } }}
        />
      );

      // Diff should still be visible during streaming
      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
      expect(screen.getByTestId("tool-use-edit-1")).toHaveAttribute("data-tool-status", "running");
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("edge cases", () => {
    it("handles missing toolStates gracefully (backwards compatibility)", () => {
      const messages: MessageParam[] = [
        {
          role: "assistant",
          content: [
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
          ] as ContentBlock[],
        },
      ];

      // No toolStates provided - should default to running
      render(
        <AssistantMessage
          messages={messages}
          messageIndex={0}
        />
      );

      // Should still render without crashing
      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
      expect(screen.getByTestId("tool-use-edit-1")).toHaveAttribute("data-tool-status", "running");
    });

    it("handles empty content array", () => {
      const messages: MessageParam[] = [
        {
          role: "assistant",
          content: [] as ContentBlock[],
        },
      ];

      const { container } = render(
        <AssistantMessage
          messages={messages}
          messageIndex={0}
          toolStates={{}}
        />
      );

      // Should render the article wrapper but with no content blocks
      expect(container.querySelector("article")).toBeInTheDocument();
    });

    it("handles error state in Edit tool", () => {
      const messages: MessageParam[] = [
        {
          role: "assistant",
          content: [
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
          ] as ContentBlock[],
        },
      ];

      render(
        <AssistantMessage
          messages={messages}
          messageIndex={0}
          toolStates={{
            "edit-1": {
              status: "error",
              isError: true,
              result: "File not found",
            },
          }}
        />
      );

      expect(screen.getByTestId("tool-use-edit-1")).toHaveAttribute("data-tool-status", "error");
    });
  });
});
