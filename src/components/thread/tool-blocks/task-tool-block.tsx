import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { GitBranch } from "lucide-react";
import type { ToolBlockProps } from "./index";

const LINE_COLLAPSE_THRESHOLD = 20;
const MAX_COLLAPSED_HEIGHT = 300;

/**
 * Task result format when parsed as JSON.
 * The result may be plain text or JSON with usage stats.
 */
interface ParsedTaskResult {
  text: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
  stopReason?: string;
}

/**
 * Parse the task result which may be JSON with text/usage fields
 * or a plain string.
 */
function parseTaskResult(result: string | undefined): ParsedTaskResult {
  if (!result) {
    return { text: "" };
  }

  // Try to parse as JSON
  try {
    const parsed = JSON.parse(result);
    if (typeof parsed === "object" && parsed !== null) {
      // Check for text field
      if (typeof parsed.text === "string") {
        return {
          text: parsed.text,
          usage: parsed.usage,
          stopReason: parsed.stopReason,
        };
      }
      // If no text field, check for common result patterns
      if (typeof parsed.output === "string") {
        return { text: parsed.output, usage: parsed.usage };
      }
      if (typeof parsed.result === "string") {
        return { text: parsed.result, usage: parsed.usage };
      }
    }
  } catch {
    // Not JSON, use as plain text
  }

  // Plain text result
  return { text: result };
}

/**
 * Format usage stats as human-readable text (NOT raw JSON).
 */
function formatUsageStats(usage: ParsedTaskResult["usage"]): string[] {
  if (!usage) return [];

  const parts: string[] = [];

  if (usage.input_tokens !== undefined) {
    parts.push(`Input: ${usage.input_tokens.toLocaleString()} tokens`);
  }
  if (usage.output_tokens !== undefined) {
    parts.push(`Output: ${usage.output_tokens.toLocaleString()} tokens`);
  }
  if (usage.cache_creation_input_tokens && usage.cache_creation_input_tokens > 0) {
    parts.push(`Cache write: ${usage.cache_creation_input_tokens.toLocaleString()} tokens`);
  }
  if (usage.cache_read_input_tokens && usage.cache_read_input_tokens > 0) {
    parts.push(`Cache read: ${usage.cache_read_input_tokens.toLocaleString()} tokens`);
  }

  return parts;
}

/**
 * Specialized block for rendering Task (subagent) tool calls.
 * Displays task description, result text, and usage stats in a collapsible format.
 */
export function TaskToolBlock({
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
  // Expand state from store
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Parse input
  const taskInput = input as { description?: string; prompt?: string };
  const description = taskInput.description || taskInput.prompt || "Run task";

  // Parse result
  const parsed = parseTaskResult(result);
  const resultText = parsed.text;
  const usageStats = formatUsageStats(parsed.usage);

  // State flags
  const isRunning = status === "running";
  const hasResult = resultText.length > 0;
  const isLongOutput = resultText.split('\n').length > LINE_COLLAPSE_THRESHOLD;

  // Output expand state
  const defaultOutputExpanded = !isLongOutput;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  return (
    <div
      className="group py-0.5"
      aria-label={`Task: ${description}, status: ${status}`}
      data-testid={`task-tool-${id}`}
      data-tool-status={status}
    >
      {/* Clickable Header - Two Line Layout */}
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
        {/* Line 1: "Task agent" or "Running task agent" with chevron */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            {isRunning ? "Running task agent" : "Task agent"}
          </ShimmerText>

          {/* Right side: duration and error indicator */}
          <span className="flex items-center gap-2 shrink-0 ml-auto">
            {durationMs !== undefined && !isRunning && (
              <span className="text-xs text-muted-foreground">
                {formatDuration(durationMs)}
              </span>
            )}
            {isError && !isRunning && <StatusIcon isSuccess={false} />}
          </span>
        </div>

        {/* Line 2: Icon + description (specific task details) */}
        <div className="flex items-center gap-1 mt-0.5">
          <GitBranch className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <span className="text-xs text-zinc-500 truncate">
            {description}
          </span>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && hasResult && (
        <div className="mt-2">
          <CollapsibleOutputBlock
            isExpanded={isOutputExpanded}
            onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
            isLongContent={isLongOutput}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant={isError ? "error" : "default"}
          >
            {/* Result text - formatted, not raw JSON */}
            <div
              className={cn(
                "text-sm p-3 whitespace-pre-wrap break-words",
                isError ? "text-red-200" : "text-zinc-300"
              )}
            >
              {resultText}
              {isRunning && (
                <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-0.5" />
              )}
            </div>
          </CollapsibleOutputBlock>

          {/* Usage stats - formatted as readable text */}
          {usageStats.length > 0 && (
            <div className="mt-2 text-xs text-zinc-500">
              {usageStats.join(" | ")}
            </div>
          )}
        </div>
      )}

      {/* Running state without result */}
      {isExpanded && !hasResult && isRunning && (
        <div className="mt-2 ml-6">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Running task...
            <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning ? "Task running" : isError ? "Task failed" : "Task completed"}
      </span>
    </div>
  );
}
