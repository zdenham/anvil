import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { AssistantMessage } from "./assistant-message";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutionState } from "@/lib/types/agent-messages";

vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));


// Helper to create tool use messages
const createToolUseMessage = (
  toolName: string,
  toolId: string,
  input: object
): MessageParam => ({
  role: "assistant",
  content: [
    {
      type: "tool_use",
      id: toolId,
      name: toolName,
      input,
    },
  ],
});

describe("AskUserQuestion Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders in AssistantMessage when tool_use is AskUserQuestion", () => {
    const messages: MessageParam[] = [
      { role: "user", content: "Help me decide" },
      createToolUseMessage("AskUserQuestion", "tool-123", {
        question: "Which approach?",
        options: ["Fast", "Thorough"],
      }),
    ];

    const toolStates: Record<string, ToolExecutionState> = {
      "tool-123": { status: "running" },
    };

    render(
      <AssistantMessage
        messages={messages}
        messageIndex={1}
        isStreaming={false}
        toolStates={toolStates}
      />
    );

    expect(screen.getByText("Which approach?")).toBeInTheDocument();
    expect(screen.getByText("Fast")).toBeInTheDocument();
    expect(screen.getByText("Thorough")).toBeInTheDocument();
  });

  it("passes onToolResponse callback through to component", () => {
    const onToolResponse = vi.fn();
    const messages: MessageParam[] = [
      { role: "user", content: "Help me" },
      createToolUseMessage("AskUserQuestion", "tool-456", {
        question: "Pick one",
        options: ["A", "B"],
      }),
    ];

    render(
      <AssistantMessage
        messages={messages}
        messageIndex={1}
        isStreaming={false}
        toolStates={{ "tool-456": { status: "running" } }}
        onToolResponse={onToolResponse}
      />
    );

    fireEvent.click(screen.getByTestId("option-item-0"));

    expect(onToolResponse).toHaveBeenCalledWith("tool-456", "A");
  });

  it("shows answered state after completion", () => {
    const messages: MessageParam[] = [
      { role: "user", content: "Help me" },
      createToolUseMessage("AskUserQuestion", "tool-789", {
        question: "Choose",
        options: ["X", "Y"],
      }),
    ];

    render(
      <AssistantMessage
        messages={messages}
        messageIndex={1}
        isStreaming={false}
        toolStates={{
          "tool-789": {
            status: "complete",
            result: "X",
          },
        }}
      />
    );

    const block = screen.getByTestId("ask-user-question-tool-789");
    expect(block).toHaveAttribute("data-status", "answered");
  });

  it("renders regular ToolUseBlock for non-AskUserQuestion tools", () => {
    const messages: MessageParam[] = [
      { role: "user", content: "List files" },
      createToolUseMessage("Bash", "tool-999", { command: "ls -la" }),
    ];

    render(
      <AssistantMessage
        messages={messages}
        messageIndex={1}
        isStreaming={false}
        toolStates={{ "tool-999": { status: "running" } }}
      />
    );

    // Should NOT render AskUserQuestionBlock
    expect(
      screen.queryByTestId("ask-user-question-tool-999")
    ).not.toBeInTheDocument();
  });

  it("handles multi-select mode correctly", () => {
    const onToolResponse = vi.fn();
    const messages: MessageParam[] = [
      { role: "user", content: "Select items" },
      createToolUseMessage("AskUserQuestion", "tool-multi", {
        question: "Select all that apply",
        options: ["Item A", "Item B", "Item C"],
        allow_multiple: true,
      }),
    ];

    render(
      <AssistantMessage
        messages={messages}
        messageIndex={1}
        isStreaming={false}
        toolStates={{ "tool-multi": { status: "running" } }}
        onToolResponse={onToolResponse}
      />
    );

    // Should render checkboxes instead of radios
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);

    // Select multiple and submit
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onToolResponse).toHaveBeenCalledWith("tool-multi", "Item A, Item C");
  });

  it("renders Claude Code nested schema format", () => {
    const messages: MessageParam[] = [
      { role: "user", content: "Help me decide" },
      createToolUseMessage("AskUserQuestion", "tool-nested", {
        questions: [
          {
            question: "Which database?",
            header: "Database",
            options: [
              { label: "PostgreSQL", description: "Relational DB" },
              { label: "MongoDB", description: "Document DB" },
            ],
            multiSelect: false,
          },
        ],
      }),
    ];

    render(
      <AssistantMessage
        messages={messages}
        messageIndex={1}
        isStreaming={false}
        toolStates={{ "tool-nested": { status: "running" } }}
      />
    );

    expect(screen.getByText("Which database?")).toBeInTheDocument();
    expect(screen.getByText("Database")).toBeInTheDocument();
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.getByText("Relational DB")).toBeInTheDocument();
    expect(screen.getByText("MongoDB")).toBeInTheDocument();
    expect(screen.getByText("Document DB")).toBeInTheDocument();
  });

  it("falls back to ToolUseBlock for invalid AskUserQuestion input", () => {
    const messages: MessageParam[] = [
      { role: "user", content: "Help me" },
      createToolUseMessage("AskUserQuestion", "tool-invalid", {
        invalid: "data",
      }),
    ];

    render(
      <AssistantMessage
        messages={messages}
        messageIndex={1}
        isStreaming={false}
        toolStates={{ "tool-invalid": { status: "running" } }}
      />
    );

    // Should NOT render AskUserQuestionBlock (it would have specific test id)
    expect(
      screen.queryByTestId("ask-user-question-tool-invalid")
    ).not.toBeInTheDocument();
  });
});
