import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test/helpers";
import type { ContentBlock } from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutionState } from "@/lib/types/agent-messages";
import { AssistantMessage } from "./assistant-message";
import { ThreadProvider } from "./thread-context";
import { useThreadStore } from "@/entities/threads/store";

vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

/** Create a tool_use content block. */
function createToolUseContent(
  toolName: string,
  toolId: string,
  input: object,
): ContentBlock[] {
  return [
    {
      type: "tool_use",
      id: toolId,
      name: toolName,
      input,
    },
  ] as ContentBlock[];
}

/** Wraps children with ThreadProvider for tests. */
function TestThreadWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThreadProvider threadId={THREAD_ID} workingDirectory="">
      {children}
    </ThreadProvider>
  );
}

describe("AskUserQuestion Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThreadStore.getState().setThreadState(THREAD_ID, null);
  });

  it("renders in AssistantMessage when tool_use is AskUserQuestion", () => {
    setupThreadStore(
      [
        { role: "assistant", content: createToolUseContent("AskUserQuestion", "tool-123", {
          question: "Which approach?",
          options: ["Fast", "Thorough"],
        }) },
      ],
      { "tool-123": { status: "running" } },
    );

    render(<AssistantMessage messageId="msg-0" />, { wrapper: TestThreadWrapper });

    expect(screen.getByText("Which approach?")).toBeInTheDocument();
    expect(screen.getByText("Fast")).toBeInTheDocument();
    expect(screen.getByText("Thorough")).toBeInTheDocument();
  });

  it("shows answered state after completion", () => {
    setupThreadStore(
      [
        { role: "assistant", content: createToolUseContent("AskUserQuestion", "tool-789", {
          question: "Choose",
          options: ["X", "Y"],
        }) },
      ],
      { "tool-789": { status: "complete", result: "X" } },
    );

    render(<AssistantMessage messageId="msg-0" />, { wrapper: TestThreadWrapper });

    const block = screen.getByTestId("ask-user-question-tool-789");
    expect(block).toHaveAttribute("data-status", "answered");
  });

  it("renders regular ToolUseBlock for non-AskUserQuestion tools", () => {
    setupThreadStore(
      [
        { role: "assistant", content: createToolUseContent("Bash", "tool-999", { command: "ls -la" }) },
      ],
      { "tool-999": { status: "running" } },
    );

    render(<AssistantMessage messageId="msg-0" />, { wrapper: TestThreadWrapper });

    expect(screen.queryByTestId("ask-user-question-tool-999")).not.toBeInTheDocument();
  });

  it("renders Claude Code nested schema format", () => {
    setupThreadStore(
      [
        { role: "assistant", content: createToolUseContent("AskUserQuestion", "tool-nested", {
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
        }) },
      ],
      { "tool-nested": { status: "running" } },
    );

    render(<AssistantMessage messageId="msg-0" />, { wrapper: TestThreadWrapper });

    expect(screen.getByText("Which database?")).toBeInTheDocument();
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.getByText("Relational DB")).toBeInTheDocument();
    expect(screen.getByText("MongoDB")).toBeInTheDocument();
    expect(screen.getByText("Document DB")).toBeInTheDocument();
  });

  it("falls back to ToolUseBlock for invalid AskUserQuestion input", () => {
    setupThreadStore(
      [
        { role: "assistant", content: createToolUseContent("AskUserQuestion", "tool-invalid", {
          invalid: "data",
        }) },
      ],
      { "tool-invalid": { status: "running" } },
    );

    render(<AssistantMessage messageId="msg-0" />, { wrapper: TestThreadWrapper });

    expect(screen.queryByTestId("ask-user-question-tool-invalid")).not.toBeInTheDocument();
  });
});
