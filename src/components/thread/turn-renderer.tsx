import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { Turn } from "@/lib/utils/turn-grouping";
import type { ToolExecutionState } from "@/lib/types/agent-messages";
import { isToolResultOnlyTurn } from "@/lib/utils/turn-grouping";
import { UserMessage } from "./user-message";
import { AssistantMessage } from "./assistant-message";

interface TurnRendererProps {
  turn: Turn;
  /** Index of this turn in the list (for test IDs) */
  turnIndex: number;
  /** Full messages array (needed for tool result lookup) */
  messages: MessageParam[];
  /** Whether this is the last turn (for streaming indicator) */
  isLast?: boolean;
  /** Whether the thread is streaming */
  isStreaming?: boolean;
  /** Explicit tool states from the agent */
  toolStates?: Record<string, ToolExecutionState>;
  /** Callback when user responds to a tool (e.g., AskUserQuestion) */
  onToolResponse?: (toolId: string, response: string) => void;
  /** Thread ID for persisting expand state across virtualization */
  threadId: string;
}

/**
 * Routes a turn to the appropriate component based on type.
 */
export function TurnRenderer({
  turn,
  turnIndex,
  messages,
  isLast = false,
  isStreaming = false,
  toolStates,
  onToolResponse,
  threadId,
}: TurnRendererProps) {
  // Skip rendering user turns that only contain tool_results
  // (tool results are displayed within the ToolUseBlock of the previous assistant turn)
  if (turn.type === "user" && isToolResultOnlyTurn(turn)) {
    return null;
  }

  switch (turn.type) {
    case "user":
      return (
        <div data-testid={`message-${turnIndex}`}>
          <UserMessage turn={turn} />
        </div>
      );

    case "assistant":
      return (
        <div data-testid={`message-${turnIndex}`}>
          <AssistantMessage
            messages={messages}
            messageIndex={turn.messageIndex}
            isStreaming={isLast && isStreaming}
            toolStates={toolStates}
            onToolResponse={onToolResponse}
            threadId={threadId}
          />
        </div>
      );

    default:
      return null;
  }
}
