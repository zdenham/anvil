import { cn } from "@/lib/utils";
import type { Turn } from "@/lib/utils/turn-grouping";
import { getUserTurnPrompt } from "@/lib/utils/turn-grouping";

interface UserMessageProps {
  /** The user turn containing the message */
  turn: Turn;
}

/**
 * Right-aligned user message bubble.
 */
export function UserMessage({ turn }: UserMessageProps) {
  // getUserTurnPrompt handles both string content and array content
  // (with text blocks and tool_result blocks) - returns just the text portion
  const content = getUserTurnPrompt(turn);

  // Don't render empty user messages (e.g., tool-result-only turns)
  if (!content) {
    return null;
  }

  return (
    <article
      role="article"
      aria-label="Your message"
      className="flex justify-end my-3"
    >
      <div
        className={cn(
          "max-w-[80%] px-4 py-3 rounded-2xl",
          "bg-accent-600 text-accent-900",
          "shadow-sm"
        )}
      >
        <p className="whitespace-pre-wrap break-words">{content}</p>
      </div>
    </article>
  );
}
