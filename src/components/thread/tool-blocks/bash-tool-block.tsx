import { cn } from "@/lib/utils";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useToolState } from "@/hooks/use-tool-state";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { DollarSign } from "lucide-react";
import type { ToolBlockProps } from "./index";

interface BashInput {
  command: string;
  description?: string;
  timeout?: number;
  run_in_background?: boolean;
}

const LINE_COLLAPSE_THRESHOLD = 20;
const MAX_COLLAPSED_HEIGHT = 300; // pixels

/**
 * Claude Code's bash tool result format.
 * Not exported from @anthropic-ai/sdk - this is Claude Code's internal representation.
 * The result string from tool_result blocks is JSON-stringified with this shape.
 */
interface BashToolResult {
  stdout?: string;
  stderr?: string;
  /** Whether the command was interrupted (e.g., via Ctrl+C or timeout) */
  interrupted?: boolean;
  /** Whether the output contains an image (for screenshot commands, etc.) */
  isImage?: boolean;
}

/**
 * Parse the bash result which may be JSON with stdout/stderr fields
 * or a plain string (legacy format).
 */
function parseBashResult(result: string | undefined): {
  stdout: string;
  stderr: string;
  interrupted: boolean;
  isImage: boolean;
} {
  if (!result) {
    return { stdout: "", stderr: "", interrupted: false, isImage: false };
  }

  // Try to parse as JSON (Claude Code format)
  try {
    const parsed = JSON.parse(result) as BashToolResult;
    // Validate it looks like a bash result (has at least one expected field)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      ("stdout" in parsed || "stderr" in parsed || "interrupted" in parsed)
    ) {
      return {
        stdout: parsed.stdout ?? "",
        stderr: parsed.stderr ?? "",
        interrupted: parsed.interrupted ?? false,
        isImage: parsed.isImage ?? false,
      };
    }
  } catch {
    // Not JSON, treat as plain stdout (legacy/fallback format)
  }

  return { stdout: result, stderr: "", interrupted: false, isImage: false };
}

/**
 * Specialized block for rendering Bash tool calls.
 * Displays as a terminal-style inline element with command, output, and status.
 */
export function BashToolBlock({
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

  const bashInput = input as unknown as BashInput;
  const command = bashInput.command || "";
  const description = bashInput.description;
  const isBackground = bashInput.run_in_background;

  // Parse the result JSON
  // Note: isImage is parsed but not yet rendered (future: inline image display)
  const { stdout, stderr, interrupted, isImage: _isImage } =
    parseBashResult(result);
  const combinedOutput = stderr
    ? `${stdout}${stdout && stderr ? "\n" : ""}${stderr}`
    : stdout;

  // Parse exit code from status
  const exitCode = isError ? 1 : status === "complete" ? 0 : null;

  // Process output
  const outputLines = combinedOutput ? combinedOutput.split("\n") : [];

  const isRunning = status === "running";
  const hasOutput = combinedOutput.length > 0;
  const hasStderr = stderr.length > 0;

  // Determine if output is long enough to need expand/collapse
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
      aria-label={`Bash command: ${command}, status: ${status}`}
      data-testid={`bash-tool-${id}`}
      data-tool-status={status}
    >
      {/* Collapsed/Summary Row */}
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
        {/* Primary line: description or command */}
        <div className="flex items-center gap-2">
          {description ? (
            <>
              <ExpandChevron isExpanded={isExpanded} size="md" />
              <ShimmerText
                isShimmering={isRunning}
                className="text-sm text-zinc-200 truncate min-w-0"
              >
                {description}
              </ShimmerText>
            </>
          ) : (
            <code className="text-sm font-mono flex items-center gap-1 min-w-0 flex-1">
              <ExpandChevron isExpanded={isExpanded} size="sm" />
              <DollarSign className="w-3.5 h-3.5 text-green-400 shrink-0" />
              <ShimmerText
                isShimmering={isRunning}
                className="text-zinc-200 truncate"
              >
                {command}
              </ShimmerText>
            </code>
          )}
          {/* Copy button on first line only when no description */}
          {!description && (
            <CopyButton text={command} label="Copy command" alwaysVisible />
          )}

          {/* Error indicator - only show on failure */}
          {!isRunning && exitCode !== null && exitCode !== 0 && (
            <StatusIcon isSuccess={false} />
          )}

          {/* Background info - right justified */}
          <span className="flex items-center gap-2 shrink-0 ml-auto">
            {isBackground && (
              <span className="text-xs text-zinc-500 font-mono">
                (bg: {id.slice(0, 8)})
              </span>
            )}
          </span>
        </div>

        {/* Secondary line: command when description exists */}
        {description && (
          <div className="flex items-center gap-1 mt-0.5">
            <code className="text-xs font-mono text-zinc-500 flex items-center gap-1 min-w-0 flex-1">
              <DollarSign className="w-3 h-3 text-green-400/60 shrink-0" />
              <span className="truncate">{command}</span>
            </code>
            <CopyButton text={command} label="Copy command" alwaysVisible className="ml-auto" />
          </div>
        )}
      </div>

      {/* Expanded Output */}
      {isExpanded && hasOutput && (
        <div data-testid={`bash-output-${id}`} className="relative mt-2">
          <div className="absolute top-1 right-1 z-10">
            <CopyButton text={combinedOutput} label="Copy output" />
          </div>
          <CollapsibleOutputBlock
            isExpanded={isOutputExpanded}
            onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
            isLongContent={isLongOutput}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant={isError || hasStderr ? "error" : "default"}
          >
            <pre
              className={cn(
                "text-xs font-mono p-2",
                "whitespace-pre-wrap break-words",
                isError || hasStderr ? "text-red-200" : "text-zinc-300"
              )}
            >
              <code>{combinedOutput}</code>
              {isRunning && (
                <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-0.5" />
              )}
            </pre>
          </CollapsibleOutputBlock>

          {interrupted && (
            <span className="text-xs text-yellow-500 mt-1 block">
              Command was interrupted
            </span>
          )}
        </div>
      )}

      {/* Expanded but no output yet (running) */}
      {isExpanded && !hasOutput && isRunning && (
        <div className="mt-2 ml-6">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Waiting for output...
            <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Command running"
          : isError
            ? "Command failed"
            : "Command completed successfully"}
      </span>
    </div>
  );
}
