import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { StopCircle } from "lucide-react";
import type { ToolBlockProps } from "./index";

interface TaskStopInput {
  task_id?: string;
  shell_id?: string;
}

/**
 * Specialized block for rendering TaskStop tool calls.
 * Displays task termination status with shimmer UI.
 *
 * Layout:
 * - First line: Chevron + "Stop task" description (with shimmer when running) + status + duration
 * - Second line: StopCircle icon + task ID + copy button
 * - Result section: Success/error message (visible when expanded)
 */
export function TaskStopToolBlock({
  id,
  name: _name,
  input,
  result,
  isError = false,
  status,
  durationMs,
  isFocused: _isFocused,
  threadId,
}: ToolBlockProps) {
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  const taskStopInput = input as unknown as TaskStopInput;
  const taskId = taskStopInput.task_id || taskStopInput.shell_id || "(unknown)";
  const isRunning = status === "running";

  return (
    <div
      className="group py-0.5"
      aria-label={`Stop task: ${taskId}, status: ${status}`}
      data-testid={`taskstop-tool-${id}`}
      data-tool-status={status}
    >
      {/* Clickable Header */}
      <div
        className="cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        {/* First line: Description with shimmer */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200"
          >
            {isRunning ? "Stopping task" : "Stop task"}
          </ShimmerText>

          {!isRunning && status === "complete" && (
            <StatusIcon isSuccess={!isError} />
          )}

          <span className="flex items-center gap-2 shrink-0 ml-auto">
            {durationMs !== undefined && !isRunning && (
              <span className="text-xs text-muted-foreground">
                {formatDuration(durationMs)}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Second line: Icon + Task ID */}
      <div className="flex items-center gap-1 mt-0.5">
        <StopCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
        <code className="text-xs font-mono text-zinc-500 min-w-0 flex-1 truncate">
          {taskId}
        </code>
        <CopyButton text={taskId} label="Copy task ID" alwaysVisible className="ml-auto" />
      </div>

      {/* Expanded Result Section */}
      {isExpanded && result && (
        <div className="mt-2">
          <div className={cn(
            "text-xs font-mono p-2 rounded border break-words whitespace-normal",
            isError
              ? "bg-red-950/20 border-red-700/50 text-red-200"
              : "bg-green-950/20 border-green-700/50 text-green-200"
          )}>
            {result}
          </div>
        </div>
      )}

      {/* Running state - no result yet */}
      {isExpanded && !result && isRunning && (
        <div className="mt-2">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Stopping task...
            <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? `Stopping task ${taskId}`
          : isError
            ? `Failed to stop task ${taskId}`
            : `Successfully stopped task ${taskId}`}
      </span>
    </div>
  );
}
