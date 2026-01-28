/**
 * Tool State UI Tests
 *
 * Tests that tool execution states are correctly rendered.
 *
 * BUG: Tools show "running" spinner even when toolStates marks them as "complete".
 * This happens when the toolStates prop is not passed to the component.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@/test/helpers";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutionState } from "@/lib/types/agent-messages";
import { AssistantMessage } from "./assistant-message";

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

describe("Tool State Rendering", () => {
  // Test data matching real state.json structure
  const toolUseId = "toolu_01WqgbRtzzhb4JgcBDP3Dsft";

  const messagesWithToolUse: MessageParam[] = [
    { role: "user", content: "can you add \"fibonacci\" to @README.md" },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I'll add \"fibonacci\" to the README.md file. Let me do that now.",
        },
      ],
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: toolUseId,
          name: "Edit",
          input: {
            file_path: "/Users/zac/Documents/README.md",
            old_string: "Hello World",
            new_string: "Hello World\n\nfibonacci",
          },
        },
      ],
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I've successfully added \"fibonacci\" to the README.md file.",
        },
      ],
    },
  ];

  const completedToolStates: Record<string, ToolExecutionState> = {
    [toolUseId]: {
      status: "complete",
      result: '{"filePath":"/Users/zac/Documents/README.md","success":true}',
      isError: false,
      toolName: "Edit",
    },
  };

  // Index 2 is the assistant message with the tool_use block
  const toolUseMessageIndex = 2;

  describe("with toolStates passed", () => {
    it("renders tool as complete when toolStates shows complete", () => {
      render(
        <AssistantMessage
          messages={messagesWithToolUse}
          messageIndex={toolUseMessageIndex}
          isStreaming={false}
          toolStates={completedToolStates}
          threadId="test-thread"
        />
      );

      // Get the tool block and check its status
      // Note: Edit tools use specialized EditToolBlock with different test ID format
      const toolBlock = screen.getByTestId(`edit-tool-${toolUseId}`);
      expect(toolBlock).toBeInTheDocument();

      // KEY ASSERTION: Status should be "complete", not "running"
      expect(toolBlock).toHaveAttribute("data-tool-status", "complete");

      // Check for visual indicator via screen reader text (EditToolBlock uses different text)
      expect(within(toolBlock).getByText("Edit completed successfully")).toBeInTheDocument();
    });

    it("renders tool as error when toolStates shows error", () => {
      const errorToolStates: Record<string, ToolExecutionState> = {
        [toolUseId]: {
          status: "error",
          result: "File not found",
          isError: true,
          toolName: "Edit",
        },
      };

      render(
        <AssistantMessage
          messages={messagesWithToolUse}
          messageIndex={toolUseMessageIndex}
          isStreaming={false}
          toolStates={errorToolStates}
          threadId="test-thread"
        />
      );

      const toolBlock = screen.getByTestId(`edit-tool-${toolUseId}`);
      expect(toolBlock).toHaveAttribute("data-tool-status", "error");
      expect(within(toolBlock).getByText("Edit failed")).toBeInTheDocument();
    });
  });

  describe("without toolStates (BUG scenario)", () => {
    /**
     * BUG TEST: This test documents the bug behavior.
     *
     * When toolStates is NOT passed, the component defaults to "running"
     * which causes an infinite spinner even for completed tools.
     *
     * This test documents the CURRENT (buggy) behavior - tool shows "running"
     * when toolStates is not passed, even though the tool has completed.
     *
     * The bug is in ControlPanelWindow which doesn't pass toolStates to ThreadView.
     */
    it("BUG: defaults to running status when toolStates is not passed", () => {
      render(
        <AssistantMessage
          messages={messagesWithToolUse}
          messageIndex={toolUseMessageIndex}
          isStreaming={false}
          threadId="test-thread"
          // NOTE: toolStates NOT passed - this is the bug scenario
        />
      );

      const toolBlock = screen.getByTestId(`edit-tool-${toolUseId}`);

      // This documents the CURRENT (buggy) behavior:
      // Tool defaults to "running" when toolStates is missing
      expect(toolBlock).toHaveAttribute("data-tool-status", "running");
      expect(within(toolBlock).getByText("Edit in progress")).toBeInTheDocument();
    });
  });

  describe("mixed tool states", () => {
    it("handles multiple tools with different states in one message", () => {
      const secondToolId = "toolu_02SecondTool";

      const messageWithMultipleTools: MessageParam[] = [
        { role: "user", content: "Edit two files" },
        {
          role: "assistant",
          content: [
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
          ],
        },
      ];

      const mixedToolStates: Record<string, ToolExecutionState> = {
        [toolUseId]: { status: "complete", isError: false, toolName: "Edit" },
        [secondToolId]: { status: "error", isError: true, result: "Permission denied", toolName: "Edit" },
      };

      render(
        <AssistantMessage
          messages={messageWithMultipleTools}
          messageIndex={1} // Index of the assistant message with tools
          isStreaming={false}
          toolStates={mixedToolStates}
          threadId="test-thread"
        />
      );

      // First tool: complete (Edit tools use edit-tool-${id} test ID format)
      const firstTool = screen.getByTestId(`edit-tool-${toolUseId}`);
      expect(firstTool).toHaveAttribute("data-tool-status", "complete");

      // Second tool: error
      const secondTool = screen.getByTestId(`edit-tool-${secondToolId}`);
      expect(secondTool).toHaveAttribute("data-tool-status", "error");
    });
  });
});
