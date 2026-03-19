/**
 * SubAgentReferenceBlock
 *
 * Displays a compact reference to a child sub-agent thread within the parent thread.
 * Shows running status, tool call count, and allows navigation to the child thread.
 * Styled to match other tool blocks with shimmer effect and two-line layout.
 */

import { ArrowRight, GitBranch } from "lucide-react";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { useContextAwareNavigation } from "@/hooks/use-context-aware-navigation";
import { useToolDuration } from "@/hooks/use-tool-duration";
import type { ThreadStatus } from "@/entities/threads/types";

interface SubAgentReferenceBlockProps {
  toolUseId: string;
  childThreadId: string;
  name: string;
  status: ThreadStatus;
  toolCallCount: number;
  /** Parent thread ID where the tool_use lives — needed for duration timer. */
  threadId?: string;
}

/**
 * Compact reference block for sub-agent threads.
 * Replaces the full TaskToolBlock when a child thread exists.
 */
export function SubAgentReferenceBlock({
  toolUseId,
  childThreadId,
  name,
  status,
  toolCallCount,
  threadId,
}: SubAgentReferenceBlockProps) {
  const { navigateToThread } = useContextAwareNavigation();
  const duration = useToolDuration(threadId ?? "", toolUseId);
  const isRunning = status === "running";

  const handleClick = async () => {
    await navigateToThread(childThreadId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      className="group py-0.5"
      aria-label={`Sub-agent: ${name}, ${isRunning ? "running" : "completed"}${toolCallCount > 0 ? `, ${toolCallCount} tool calls` : ""}`}
      data-testid={`sub-agent-reference-${childThreadId}`}
    >
      {/* Clickable area */}
      <div
        className="cursor-pointer select-none"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
      >
        {/* Line 1: "Sub-agent" or "Running sub-agent" with open button */}
        <div className="flex items-center gap-2">
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            {isRunning ? "Running sub-agent" : "Sub-agent"}
          </ShimmerText>

          {/* Right side: duration, tool count, and open button */}
          <span className="flex items-center gap-2 shrink-0 ml-auto">
            {duration && (
              <span className="text-xs text-zinc-500 font-mono tabular-nums">
                {duration}
              </span>
            )}
            {toolCallCount > 0 && (
              <span className="text-xs text-zinc-500">
                {toolCallCount} tool {toolCallCount === 1 ? "call" : "calls"}
              </span>
            )}
            <span className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
              Open
              <ArrowRight className="w-3 h-3" />
            </span>
          </span>
        </div>

        {/* Line 2: Icon + task name/description */}
        <div className="flex items-center gap-1 mt-0.5">
          <GitBranch className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <span className="text-xs text-zinc-500 truncate">
            {name || "Sub-agent"}
          </span>
        </div>
      </div>

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning ? "Sub-agent running" : "Sub-agent completed"}
      </span>
    </div>
  );
}
