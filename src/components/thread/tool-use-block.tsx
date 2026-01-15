import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Pencil,
  Terminal,
  Search,
  Globe,
  GitBranch,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getToolDisplayName } from "@/lib/utils/tool-icons";
import { formatDuration } from "@/lib/utils/time-format";
import { formatToolInput } from "@/lib/utils/tool-formatters";
import { InlineDiffBlock } from "./inline-diff-block";
import { useToolDiff } from "./use-tool-diff";
import { ToolStatusIcon } from "./tool-status-icon";
import type { ToolStatus } from "./tool-status-icon";

interface ToolUseBlockProps {
  /** Unique tool use ID */
  id: string;
  /** Tool name */
  name: string;
  /** Tool input parameters */
  input: Record<string, unknown>;
  /** Tool execution result (if completed) */
  result?: string;
  /** Whether the result was an error */
  isError?: boolean;
  /** Current execution status */
  status: ToolStatus;
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Callback when user wants to expand diff to full viewer */
  onOpenDiff?: (filePath: string) => void;
  /** Callback when user accepts pending edit */
  onAccept?: () => void;
  /** Callback when user rejects pending edit */
  onReject?: () => void;
  /** Whether this block is focused for keyboard navigation */
  isFocused?: boolean;
}

// Tool name to icon mapping
const TOOL_ICONS: Record<string, typeof Wrench> = {
  read: FileText,
  write: Pencil,
  edit: Pencil,
  bash: Terminal,
  grep: Search,
  glob: Search,
  webfetch: Globe,
  websearch: Globe,
  task: GitBranch,
};

function getToolIconComponent(toolName: string) {
  const normalized = toolName.toLowerCase();
  for (const [pattern, Icon] of Object.entries(TOOL_ICONS)) {
    if (normalized.includes(pattern)) {
      return Icon;
    }
  }
  return Wrench;
}

/**
 * Collapsible card displaying tool execution details.
 * Renders inline diffs for Edit/Write tools when applicable.
 */
export function ToolUseBlock({
  id: _id,
  name,
  input,
  result,
  isError = false,
  status,
  durationMs,
  onOpenDiff,
  onAccept,
  onReject,
  isFocused,
}: ToolUseBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const Icon = getToolIconComponent(name);
  const displayName = getToolDisplayName(name);
  const formatted = formatToolInput(name, input);
  const diffData = useToolDiff(name, input, result);

  const inputStr = JSON.stringify(input, null, 2);
  const showInputTruncated = inputStr.length > 500;
  const truncatedInput = showInputTruncated
    ? inputStr.slice(0, 500) + "\n..."
    : inputStr;

  const showResultTruncated = result && result.length > 1000;
  const truncatedResult = showResultTruncated
    ? result.slice(0, 1000) + "\n..."
    : result;

  return (
    <details
      open={isExpanded}
      onToggle={(e) => setIsExpanded(e.currentTarget.open)}
      className={cn(
        "group rounded-lg border",
        status === "error" || isError
          ? "border-red-500/30 bg-red-950/20"
          : "border-zinc-700 bg-zinc-900/50"
      )}
      aria-label={`Tool: ${displayName}, status: ${status}`}
      data-testid={`tool-use-${_id}`}
      data-tool-status={status}
    >
      <summary
        className={cn(
          "flex items-center gap-2 p-3 cursor-pointer select-none",
          "list-none [&::-webkit-details-marker]:hidden",
          "hover:bg-zinc-800/50 rounded-lg transition-colors"
        )}
      >
        {/* Expand icon */}
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}

        {/* Tool icon */}
        <Icon className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />

        {/* Tool name and summary */}
        <span className="font-medium text-sm text-surface-200">{displayName}</span>
        <span className="text-sm text-zinc-400 truncate min-w-0 flex-1">
          <code className="font-mono">{formatted.primary}</code>
          {formatted.secondary && (
            <span className="text-zinc-500 ml-2">{formatted.secondary}</span>
          )}
        </span>

        {/* Status indicator */}
        <span className="ml-auto flex items-center gap-2">
          {durationMs !== undefined && status !== "running" && (
            <span className="text-xs text-muted-foreground">
              {formatDuration(durationMs)}
            </span>
          )}
          <ToolStatusIcon status={status} isError={isError} />
        </span>

        {/* Screen reader status */}
        <span className="sr-only">
          {status === "running"
            ? "In progress"
            : status === "pending"
              ? "Pending approval"
              : isError
                ? "Failed"
                : "Completed"}
        </span>
      </summary>

      <div className="px-3 pb-3 space-y-3">
        {/* Inline diff display for Edit/Write tools */}
        {diffData && (
          <InlineDiffBlock
            filePath={diffData.filePath}
            diff={diffData.diff}
            lines={diffData.lines}
            stats={diffData.stats}
            isPending={status === "pending"}
            onAccept={onAccept}
            onReject={onReject}
            isFocused={isFocused}
            onExpand={() => onOpenDiff?.(diffData.filePath)}
          />
        )}

        {/* Input section - only show if no diff or when expanded */}
        {(!diffData || isExpanded) && (
          <div role="region" aria-label="Tool input">
            <h4 className="text-xs font-medium text-muted-foreground mb-1">
              Input
            </h4>
            <pre className="text-xs bg-zinc-950 text-zinc-300 p-2 rounded overflow-x-auto">
              <code>{isExpanded ? inputStr : truncatedInput}</code>
            </pre>
            {showInputTruncated && !isExpanded && (
              <button
                className="text-xs text-accent-400 hover:underline mt-1"
                onClick={(e) => {
                  e.preventDefault();
                  setIsExpanded(true);
                }}
              >
                Show more
              </button>
            )}
          </div>
        )}

        {/* Output section - only show if no diff or when expanded, and has result */}
        {result !== undefined && (!diffData || isExpanded) && (
          <div role="region" aria-label="Tool output">
            <h4 className="text-xs font-medium text-muted-foreground mb-1">
              Output
            </h4>
            <pre
              className={cn(
                "text-xs p-2 rounded overflow-x-auto max-h-64 overflow-y-auto",
                isError ? "bg-red-950/50 text-red-300" : "bg-zinc-950 text-zinc-300"
              )}
            >
              <code>{isExpanded ? result : truncatedResult}</code>
            </pre>
            {showResultTruncated && !isExpanded && (
              <button
                className="text-xs text-accent-400 hover:underline mt-1"
                onClick={(e) => {
                  e.preventDefault();
                  setIsExpanded(true);
                }}
              >
                Show more
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
