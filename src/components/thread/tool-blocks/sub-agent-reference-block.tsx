/**
 * SubAgentReferenceBlock
 *
 * Displays a compact reference to a child sub-agent thread within the parent thread.
 * Shows running status, tool call count, and allows navigation to the child thread.
 */

import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/ui/status-dot";
import { useContextAwareNavigation } from "@/hooks/use-context-aware-navigation";
import type { ThreadStatus } from "@/entities/threads/types";

interface SubAgentReferenceBlockProps {
  toolUseId: string;
  childThreadId: string;
  name: string;
  status: ThreadStatus;
  toolCallCount: number;
}

/**
 * Compact reference block for sub-agent threads.
 * Replaces the full TaskToolBlock when a child thread exists.
 */
export function SubAgentReferenceBlock({
  childThreadId,
  name,
  status,
  toolCallCount,
}: SubAgentReferenceBlockProps) {
  const { navigateToThread } = useContextAwareNavigation();
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
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-md border",
        "bg-zinc-800/30 hover:bg-zinc-800/50 cursor-pointer transition-colors",
        "border-zinc-700/50"
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Sub-agent: ${name}, ${isRunning ? "running" : "completed"}${toolCallCount > 0 ? `, ${toolCallCount} tool calls` : ""}`}
      data-testid={`sub-agent-reference-${childThreadId}`}
    >
      {/* Flashing indicator while running */}
      <StatusDot
        variant={isRunning ? "running" : "read"}
        data-testid="sub-agent-status-dot"
      />

      {/* Thread name */}
      <span className="flex-1 truncate text-sm text-zinc-200">
        {name || "Sub-agent"}
      </span>

      {/* Tool call count (only show if > 0) */}
      {toolCallCount > 0 && (
        <span className="text-xs text-zinc-500 shrink-0">
          {toolCallCount} tool {toolCallCount === 1 ? "call" : "calls"}
        </span>
      )}

      {/* Open button */}
      <span className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 shrink-0">
        Open
        <ArrowRight className="w-3 h-3" />
      </span>
    </div>
  );
}
