import { cn } from "@/lib/utils";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useToolState } from "@/hooks/use-tool-state";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { XCircle } from "lucide-react";
import type { ToolBlockProps } from "./index";

interface KillShellInput {
  shell_id: string;
}

/**
 * Specialized block for rendering KillShell tool calls.
 * Displays shell termination status with success/failure indication.
 *
 * Layout:
 * - First line: Chevron + "Kill shell" description (with shimmer when running) + status + duration
 * - Second line: XCircle icon + shell ID + copy button (always visible)
 * - Result section: Success/error message (visible when expanded)
 */
export function KillShellToolBlock({
  id,
  name: _name,
  input,
  threadId,
}: ToolBlockProps) {
  const { status, result, isError } = useToolState(threadId, id);

  // Use Zustand store for expand state to persist across virtualization remounts
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  const killShellInput = input as unknown as KillShellInput;
  const shellId = killShellInput.shell_id || "(unknown)";
  const isRunning = status === "running";

  return (
    <div
      className="group py-0.5"
      aria-label={`Kill shell: ${shellId}, status: ${status}`}
      data-testid={`killshell-tool-${id}`}
      data-tool-status={status}
    >
      {/* Clickable Header (controls expand/collapse) */}
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
        {/* First line: Description with shimmer (NO icon - chevron is the visual anchor) */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200"
          >
            Kill shell
          </ShimmerText>

          {/* Status indicator - only show when complete */}
          {!isRunning && status === "complete" && (
            <StatusIcon isSuccess={!isError} />
          )}

          <span className="flex items-center gap-2 shrink-0 ml-auto" />
        </div>
      </div>

      {/* Second line: Icon + Shell ID (always visible - icon ONLY appears here) */}
      <div className="flex items-center gap-1 mt-0.5">
        <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
        <code className="text-xs font-mono text-zinc-500 min-w-0 flex-1 truncate">
          {shellId}
        </code>
        <CopyButton text={shellId} label="Copy shell ID" alwaysVisible className="ml-auto" />
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
            Terminating shell...
            <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? `Terminating shell ${shellId}`
          : isError
            ? `Failed to terminate shell ${shellId}`
            : `Successfully terminated shell ${shellId}`}
      </span>
    </div>
  );
}
