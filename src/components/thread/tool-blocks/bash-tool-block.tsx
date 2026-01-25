import { useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Check,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import type { ToolBlockProps } from "./index";

interface BashInput {
  command: string;
  description?: string;
  timeout?: number;
  run_in_background?: boolean;
}

const LINE_COLLAPSE_THRESHOLD = 20;
const MAX_COLLAPSED_HEIGHT = 300; // pixels

// Persist expand state across remounts using content-based keys
const expandedOutputCache = new Map<string, boolean>();
const MAX_CACHE_SIZE = 200;

function getExpandedStateKey(id: string, output: string): string {
  return `${id}:${output.length}:${output.slice(0, 50)}`;
}

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

function CopyButton({
  text,
  label = "Copy",
  alwaysVisible = false,
}: {
  text: string;
  label?: string;
  alwaysVisible?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "p-1 hover:bg-zinc-700 rounded transition-opacity shrink-0",
        !alwaysVisible && "opacity-0 group-hover:opacity-100"
      )}
      title={label}
      aria-label={label}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-400" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-zinc-400" />
      )}
    </button>
  );
}

function StatusIcon({ isSuccess }: { isSuccess: boolean }) {
  return isSuccess ? (
    <Check className="h-4 w-4 text-green-400" />
  ) : (
    <X className="h-4 w-4 text-red-400" />
  );
}

function RunningBadge() {
  return (
    <span className="text-xs font-mono px-1.5 py-0.5 rounded inline-flex items-center gap-1.5 bg-zinc-700/50 text-zinc-300">
      <Loader2 className="h-3 w-3 animate-spin" />
      Running
    </span>
  );
}

function OutputExpandCollapseOverlay({
  isOutputExpanded,
  onToggle,
}: {
  isOutputExpanded: boolean;
  onToggle: () => void;
}) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle();
  };

  return (
    <div
      className={cn(
        "absolute bottom-0 left-0 right-0 flex items-end justify-center pb-2 pointer-events-none",
        !isOutputExpanded && "h-16 bg-gradient-to-t from-zinc-950 to-transparent"
      )}
    >
      <button
        onClick={handleClick}
        className="flex items-center gap-1 px-2.5 py-1 text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors pointer-events-auto border border-zinc-700/50"
        aria-label={isOutputExpanded ? "Collapse output" : "Expand output"}
      >
        {isOutputExpanded ? (
          <>
            <ChevronUp className="h-3.5 w-3.5" />
            Collapse
          </>
        ) : (
          <>
            <ChevronDown className="h-3.5 w-3.5" />
            Expand
          </>
        )}
      </button>
    </div>
  );
}

/**
 * Specialized block for rendering Bash tool calls.
 * Displays as a terminal-style inline element with command, output, and status.
 */
export function BashToolBlock({
  id,
  name: _name,
  input,
  result,
  isError = false,
  status,
  durationMs,
  isFocused: _isFocused,
}: ToolBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

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
  const stateKey = getExpandedStateKey(id, combinedOutput);

  // Initialize output expand state from cache
  const [isOutputExpanded, setIsOutputExpanded] = useState(() => {
    const cached = expandedOutputCache.get(stateKey);
    if (cached !== undefined) return cached;
    return !isLongOutput; // Default: expanded if short, collapsed if long
  });

  // Persist output expand state changes to cache
  useEffect(() => {
    const defaultValue = !isLongOutput;
    if (isOutputExpanded !== defaultValue) {
      if (expandedOutputCache.size >= MAX_CACHE_SIZE) {
        const firstKey = expandedOutputCache.keys().next().value;
        if (firstKey) expandedOutputCache.delete(firstKey);
      }
      expandedOutputCache.set(stateKey, isOutputExpanded);
    } else {
      expandedOutputCache.delete(stateKey);
    }
  }, [isOutputExpanded, stateKey, isLongOutput]);

  return (
    <div
      className="group py-1.5"
      aria-label={`Bash command: ${command}, status: ${status}`}
      data-testid={`bash-tool-${id}`}
      data-tool-status={status}
    >
      {/* Collapsed/Summary Row */}
      <div
        className="flex items-start gap-2 cursor-pointer select-none"
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
        {/* Expand icon */}
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Primary line: description or command */}
          <div className="flex items-center gap-2">
            {description ? (
              <span
                className={cn(
                  "text-sm text-zinc-200 truncate min-w-0",
                  isRunning && "animate-shimmer"
                )}
              >
                {description}
              </span>
            ) : (
              <code className="text-sm font-mono flex items-center gap-1 min-w-0 flex-1">
                <span className="text-green-400 shrink-0">$</span>
                <span
                  className={cn(
                    "text-zinc-200 truncate",
                    isRunning && "animate-shimmer"
                  )}
                >
                  {command}
                </span>
              </code>
            )}
            <CopyButton text={command} label="Copy command" alwaysVisible />

            {/* Status area */}
            <span className="flex items-center gap-2 shrink-0">
              {durationMs !== undefined && !isRunning && (
                <span className="text-xs text-muted-foreground">
                  {formatDuration(durationMs)}
                </span>
              )}
              {isRunning ? (
                <RunningBadge />
              ) : exitCode !== null ? (
                <StatusIcon isSuccess={exitCode === 0} />
              ) : null}
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
                <span className="text-green-400/60 shrink-0">$</span>
                <span className="truncate">{command}</span>
              </code>
            </div>
          )}
        </div>
      </div>

      {/* Expanded Output */}
      {isExpanded && hasOutput && (
        <div className="relative mt-2 ml-6">
          <div className="absolute top-1 right-1 z-10">
            <CopyButton text={combinedOutput} label="Copy output" />
          </div>
          <div
            className={cn(
              "relative rounded border",
              isError || hasStderr
                ? "border-red-500/30"
                : "border-zinc-700/50",
              !isOutputExpanded && isLongOutput && "overflow-hidden"
            )}
            style={
              !isOutputExpanded && isLongOutput
                ? { maxHeight: MAX_COLLAPSED_HEIGHT }
                : undefined
            }
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

            {/* Expand/Collapse overlay for long output */}
            {isLongOutput && (
              <OutputExpandCollapseOverlay
                isOutputExpanded={isOutputExpanded}
                onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
              />
            )}
          </div>

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
