/**
 * Tool State UI Tests
 *
 * Tests that tool execution states are correctly rendered.
 *
 * AssistantMessage now reads data from the thread store via selectors,
 * so tests populate the store instead of passing props.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@/test/helpers";
import type { ContentBlock } from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutionState } from "@/lib/types/agent-messages";
import { AssistantMessage } from "./assistant-message";
import { ThreadProvider } from "./thread-context";
import { useThreadStore } from "@/entities/threads/store";

// Suppress logger output during tests
vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

/** Set up thread store with messages and tool states for a given thread. */
function setupThreadStore(
  threadId: string,
  messages: Array<{ role: string; content: ContentBlock[] }>,
  toolStates: Record<string, ToolExecutionState> = {},
) {
  useThreadStore.getState().setThreadState(threadId, {
    messages: messages.map((m, i) => ({ ...m, id: `msg-${i}` })),
    toolStates,
    fileChanges: [],
    workingDirectory: "",
    status: "running",
    timestamp: Date.now(),
  });
}

describe("Tool State Rendering", () => {
  const threadId = "test-thread";
  const toolUseId = "toolu_01WqgbRtzzhb4JgcBDP3Dsft";

  const toolUseContent: ContentBlock[] = [
    {
      type: "tool_use",
      id: toolUseId,
      name: "Edit",
      input: {
        file_path: "/Users/test/Documents/README.md",
        old_string: "Hello World",
        new_string: "Hello World\n\nfibonacci",
      },
    },
  ];

  beforeEach(() => {
    // Reset store between tests
    useThreadStore.getState().setThreadState(threadId, null);
  });

  describe("with toolStates in store", () => {
    it("renders tool as complete when toolStates shows complete", () => {
      setupThreadStore(
        threadId,
        [{ role: "assistant", content: toolUseContent }],
        {
          [toolUseId]: {
            status: "complete",
            result: '{"filePath":"/Users/test/Documents/README.md","success":true}',
            isError: false,
            toolName: "Edit",
          },
        },
      );

      render(
        <ThreadProvider threadId={threadId} workingDirectory="">
          <AssistantMessage messageId="msg-0" />
        </ThreadProvider>,
      );

      const toolBlock = screen.getByTestId(`edit-tool-${toolUseId}`);
      expect(toolBlock).toBeInTheDocument();
      expect(toolBlock).toHaveAttribute("data-tool-status", "complete");
      expect(within(toolBlock).getByText("Edit completed successfully")).toBeInTheDocument();
    });

    it("renders tool as error when toolStates shows error", () => {
      setupThreadStore(
        threadId,
        [{ role: "assistant", content: toolUseContent }],
        {
          [toolUseId]: {
            status: "error",
            result: "File not found",
            isError: true,
            toolName: "Edit",
          },
        },
      );

      render(
        <ThreadProvider threadId={threadId} workingDirectory="">
          <AssistantMessage messageId="msg-0" />
        </ThreadProvider>,
      );

      const toolBlock = screen.getByTestId(`edit-tool-${toolUseId}`);
      expect(toolBlock).toHaveAttribute("data-tool-status", "error");
      expect(within(toolBlock).getByText("Edit failed")).toBeInTheDocument();
    });
  });

  describe("without toolStates (default running)", () => {
    it("defaults to running status when no toolState exists for the tool", () => {
      setupThreadStore(
        threadId,
        [{ role: "assistant", content: toolUseContent }],
        {}, // No tool states
      );

      render(
        <ThreadProvider threadId={threadId} workingDirectory="">
          <AssistantMessage messageId="msg-0" />
        </ThreadProvider>,
      );

      const toolBlock = screen.getByTestId(`edit-tool-${toolUseId}`);
      expect(toolBlock).toHaveAttribute("data-tool-status", "running");
      expect(within(toolBlock).getByText("Edit in progress")).toBeInTheDocument();
    });
  });

  describe("mixed tool states", () => {
    it("handles multiple tools with different states in one message", () => {
      const secondToolId = "toolu_02SecondTool";

      const multiToolContent: ContentBlock[] = [
        {
          type: "tool_use",
          id: toolUseId,
          name: "Edit",
          input: { file_path: "/file1.txt", old_string: "a", new_string: "b" },
        },
        {
          type: "tool_use",
          id: secondToolId,
          name: "Edit",
          input: { file_path: "/file2.txt", old_string: "c", new_string: "d" },
        },
      ];

      setupThreadStore(
        threadId,
        [{ role: "assistant", content: multiToolContent }],
        {
          [toolUseId]: { status: "complete", isError: false, toolName: "Edit" },
          [secondToolId]: { status: "error", isError: true, result: "Permission denied", toolName: "Edit" },
        },
      );

      render(
        <ThreadProvider threadId={threadId} workingDirectory="">
          <AssistantMessage messageId="msg-0" />
        </ThreadProvider>,
      );

      const firstTool = screen.getByTestId(`edit-tool-${toolUseId}`);
      expect(firstTool).toHaveAttribute("data-tool-status", "complete");

      const secondTool = screen.getByTestId(`edit-tool-${secondToolId}`);
      expect(secondTool).toHaveAttribute("data-tool-status", "error");
    });
  });
});
