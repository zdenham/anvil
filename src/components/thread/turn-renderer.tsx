import type { Turn } from "@/lib/utils/turn-grouping";
import { isToolResultOnlyTurn, isSystemInjectedTurn } from "@/lib/utils/turn-grouping";
import { UserMessage } from "./user-message";
import { AssistantMessage } from "./assistant-message";

interface TurnRendererProps {
  turn: Turn;
  /** Index of this turn in the list (for test IDs) */
  turnIndex: number;
}

/**
 * Routes a turn to the appropriate component based on type.
 */
export function TurnRenderer({
  turn,
  turnIndex,
}: TurnRendererProps) {
  // Skip rendering user turns that only contain tool_results
  // (tool results are displayed within the ToolUseBlock of the previous assistant turn)
  if (turn.type === "user" && isToolResultOnlyTurn(turn)) {
    return null;
  }

  // Skip rendering system-injected messages (e.g., permission mode changes)
  if (turn.type === "user" && isSystemInjectedTurn(turn)) {
    return null;
  }

  switch (turn.type) {
    case "user":
      return (
        <div data-testid={`user-message-${turnIndex}`}>
          <UserMessage turn={turn} />
        </div>
      );

    case "assistant":
      return (
        <div data-testid={`assistant-message-${turnIndex}`}>
          <AssistantMessage messageId={turn.messageId} />
        </div>
      );

    default:
      return null;
  }
}
