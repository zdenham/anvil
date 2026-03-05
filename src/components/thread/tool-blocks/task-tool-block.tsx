import { cn } from "@/lib/utils";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useToolState } from "@/hooks/use-tool-state";
import { useThreadStore } from "@/entities/threads/store";
import { useChildThreadToolCount } from "@/hooks/use-child-thread-tool-count";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { SubAgentReferenceBlock } from "./sub-agent-reference-block";
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
 *
 * If a child thread exists for this Task tool use, renders a compact
 * SubAgentReferenceBlock instead of the full tool block.
 */
export function TaskToolBlock({
  id,
  name: _name,
  input,
  threadId,
}: ToolBlockProps) {
  const { status, result, isError } = useToolState(threadId, id);

  // Check if this Task created a sub-agent thread
  const childThread = useThreadStore((state) =>
    state.getChildThreadByParentToolUseId(id)
  );

  // Get tool call count for child thread (only used if child exists)
  const toolCallCount = useChildThreadToolCount(childThread?.id ?? "");

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

  // Expand state from store - must be called unconditionally (before any returns)
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Output expand state - must be called unconditionally (before any returns)
  const defaultOutputExpanded = !isLongOutput;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  // If a child thread exists, render the reference block instead
  if (childThread) {
    return (
      <SubAgentReferenceBlock
        toolUseId={id}
        childThreadId={childThread.id}
        name={childThread.name ?? "Sub-agent"}
        status={childThread.status}
        toolCallCount={toolCallCount}
      />
    );
  }

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
        {/* Line 1: "Sub-agent" or "Running sub-agent" with chevron */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            {isRunning ? "Running sub-agent" : "Sub-agent"}
          </ShimmerText>

          {/* Right side: error indicator */}
          <span className="flex items-center gap-2 shrink-0 ml-auto">
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
            Running sub-agent...
            <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning ? "Sub-agent running" : isError ? "Sub-agent failed" : "Sub-agent completed"}
      </span>
    </div>
  );
}
