import { cn } from "@/lib/utils";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useToolState } from "@/hooks/use-tool-state";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { ArrowDownToLine } from "lucide-react";
import type { ToolBlockProps } from "./index";

/**
 * TaskOutput tool input from Claude Agent SDK.
 * This matches the shape of input.* fields passed to the component.
 */
interface TaskOutputInput {
  /** The task ID to get output from */
  task_id: string;
  /** Whether to wait for completion */
  block?: boolean;
  /** Max wait time in ms */
  timeout?: number;
}

/**
 * Claude Code's TaskOutput tool result format.
 * The result string from tool_result blocks is JSON-stringified with this shape.
 */
interface TaskOutputResult {
  /** Output from the background task */
  output?: string;
  /** Whether the task is still running */
  is_running?: boolean;
  /** Error message if the task failed */
  error?: string;
  /** Exit code for Bash tasks */
  exit_code?: number;
}

const LINE_COLLAPSE_THRESHOLD = 20; // Lines of output
const MAX_COLLAPSED_HEIGHT = 300;   // Pixels

/**
 * Parse the TaskOutput result which is JSON with output/status fields.
 * Falls back to treating result as plain text if JSON parsing fails.
 */
function parseTaskOutputResult(result: string | undefined): TaskOutputResult {
  if (!result) {
    return { output: "" };
  }

  try {
    const parsed = JSON.parse(result) as TaskOutputResult;
    // Validate it looks like a TaskOutput result
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      ("output" in parsed || "is_running" in parsed || "error" in parsed)
    ) {
      return {
        output: parsed.output ?? "",
        is_running: parsed.is_running ?? false,
        error: parsed.error,
        exit_code: parsed.exit_code,
      };
    }
  } catch {
    // Not JSON, treat as plain text output
  }

  // Fallback: treat entire result as output string
  return { output: result };
}

/**
 * Specialized block for rendering TaskOutput tool calls.
 * Displays background task output and status in a readable format.
 */
export function TaskOutputToolBlock({
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

  // Parse input and result
  const taskInput = input as unknown as TaskOutputInput;
  const taskId = taskInput.task_id || "";
  const isBlocking = taskInput.block ?? false;
  const { output, is_running, error, exit_code } = parseTaskOutputResult(result);

  // Derive display state
  const isRunning = status === "running" || is_running === true;
  const hasOutput = output && output.length > 0;
  const hasError = isError || !!error;

  // Process output for line counting
  const outputLines = output ? output.split("\n") : [];
  const isLongOutput = outputLines.length > LINE_COLLAPSE_THRESHOLD;

  // Use store for output expand state, with default based on output length
  const defaultOutputExpanded = !isLongOutput;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  return (
    <div
      className="group py-0.5"
      aria-label={`Task output: ${taskId}, status: ${status}`}
      data-testid={`taskoutput-tool-${id}`}
      data-tool-status={status}
    >
      {/* Collapsed/Summary Row - clickable header */}
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
        {/* First Line (Header Row): Chevron + Description + Duration */}
        <div className="flex items-center gap-2">
          {/* Chevron on the left - controls expand/collapse */}
          <ExpandChevron isExpanded={isExpanded} size="md" />

          {/* Description text - shimmer animates while running */}
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            Task output
          </ShimmerText>

          <span className="flex items-center gap-2 shrink-0 ml-auto" />
        </div>

        {/* Second Line (Details Row): Icon + Task ID + Status */}
        <div className="flex items-center gap-1 mt-0.5">
          {/* Icon appears on the second line, not the first */}
          <ArrowDownToLine className="w-3 h-3 text-zinc-500 shrink-0" />
          <code className="text-xs font-mono text-zinc-500 truncate flex-1">
            {taskId.length > 20 ? `${taskId.slice(0, 20)}...` : taskId}
          </code>
          {isBlocking && (
            <span className="text-xs text-zinc-600">(blocking)</span>
          )}
          {/* Status icon only shows after completion */}
          {!isRunning && <StatusIcon isSuccess={!hasError} size="sm" />}
          <CopyButton text={taskId} label="Copy task ID" alwaysVisible className="ml-auto" />
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && hasOutput && (
        <div className="relative mt-2">
          <div className="absolute top-1 right-1 z-10">
            <CopyButton text={output} label="Copy output" />
          </div>
          <CollapsibleOutputBlock
            isExpanded={isOutputExpanded}
            onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
            isLongContent={isLongOutput}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant={hasError ? "error" : "default"}
          >
            <pre
              className={cn(
                "text-xs font-mono p-2",
                "whitespace-pre-wrap break-words",
                hasError ? "text-red-200" : "text-zinc-300"
              )}
            >
              <code>{output}</code>
              {isRunning && (
                <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-0.5" />
              )}
            </pre>
          </CollapsibleOutputBlock>

          {/* Show error message if present */}
          {error && (
            <span className="text-xs text-red-400 mt-1 block">
              Error: {error}
            </span>
          )}

          {/* Show exit code for Bash tasks */}
          {exit_code !== undefined && exit_code !== 0 && (
            <span className="text-xs text-yellow-500 mt-1 block">
              Exit code: {exit_code}
            </span>
          )}
        </div>
      )}

      {/* Expanded but no output yet (running) */}
      {isExpanded && !hasOutput && isRunning && (
        <div className="mt-2">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Waiting for output...
            <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Task running"
          : hasError
            ? "Task failed"
            : "Task completed"}
      </span>
    </div>
  );
}
