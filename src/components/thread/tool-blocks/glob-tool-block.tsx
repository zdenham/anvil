import { useMemo } from "react";
import { formatDuration } from "@/lib/utils/time-format";
import { toRelativePath, toRelativePaths } from "@/lib/utils/path-display";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useWorkspaceRoot } from "@/hooks/use-workspace-root";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { FolderSearch } from "lucide-react";
import type { ToolBlockProps } from "./index";

/**
 * Input shape for the Glob tool.
 * Maps to the `input` field of Anthropic.ToolUseBlock when name === "Glob".
 */
interface GlobInput {
  pattern: string;
  path?: string;
}

const LINE_COLLAPSE_THRESHOLD = 20;
const MAX_COLLAPSED_HEIGHT = 300;

/**
 * Parse the glob result into an array of file paths.
 * Handles JSON object format, JSON array (legacy), and newline-separated (fallback) formats.
 * Never returns raw JSON - always a clean array of strings.
 */
function parseGlobResult(result: string | undefined): string[] {
  if (!result) return [];

  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed)) {
      return parsed.filter((p) => typeof p === "string");
    }
    // Handle object with filenames property
    if (parsed && Array.isArray(parsed.filenames)) {
      return parsed.filenames.filter((p: unknown) => typeof p === "string");
    }
  } catch {
    // Not JSON
  }

  return result
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Specialized block for rendering Glob tool calls.
 * Displays file search results in a formatted list, never as raw JSON.
 */
export function GlobToolBlock({
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
  // Use Zustand store for expand state to persist across virtualization remounts
  const isExpanded = useToolExpandStore((state) =>
    state.isToolExpanded(threadId, id)
  );
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) =>
    setToolExpanded(threadId, id, expanded);

  // Get workspace root for relative path display
  const workspaceRoot = useWorkspaceRoot();

  const globInput = input as unknown as GlobInput;
  const pattern = globInput.pattern || "";
  const searchPath = globInput.path || ".";
  const displaySearchPath = toRelativePath(searchPath, workspaceRoot);

  // Parse result into formatted array - never display raw JSON
  const filePaths = parseGlobResult(result);

  // Convert all paths to relative paths efficiently
  const displayPaths = useMemo(
    () => toRelativePaths(filePaths, workspaceRoot),
    [filePaths, workspaceRoot]
  );
  const matchCount = filePaths.length;
  const isRunning = status === "running";
  const hasResults = matchCount > 0;
  const isLongOutput = matchCount > LINE_COLLAPSE_THRESHOLD;

  // Use store for output expand state, with default based on output length
  const defaultOutputExpanded = !isLongOutput;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore(
    (state) => state.setOutputExpanded
  );
  const setIsOutputExpanded = (expanded: boolean) =>
    setOutputExpanded(threadId, id, expanded);

  return (
    <div
      className="group py-0.5"
      aria-label={`Glob search: ${pattern}, status: ${status}`}
      data-testid={`glob-tool-${id}`}
      data-tool-status={status}
    >
      {/* Clickable Header Row */}
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
        {/* First line: chevron + description (shimmer while running) */}
        {/* Note: Chevron only on first line, no icon here */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            Find files
          </ShimmerText>

          {/* Error indicator */}
          {!isRunning && isError && <StatusIcon isSuccess={false} />}

          {/* Duration - right aligned */}
          {durationMs !== undefined && !isRunning && (
            <span className="text-xs text-muted-foreground ml-auto shrink-0">
              {formatDuration(durationMs)}
            </span>
          )}
        </div>

        {/* Second line: icon + pattern + match count */}
        {/* Note: Icon only on second line (first line has chevron) */}
        <div className="flex items-center gap-1 mt-0.5">
          <FolderSearch className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <code className="text-xs font-mono text-zinc-500 flex items-center gap-1 min-w-0 flex-1">
            <span className="truncate">{pattern}</span>
          </code>
          {!isRunning && (
            <span className="text-xs text-zinc-500 shrink-0">
              -&gt; {matchCount} {matchCount === 1 ? "file" : "files"}
            </span>
          )}
          <CopyButton text={pattern} label="Copy pattern" alwaysVisible className="ml-auto" />
        </div>
      </div>

      {/* Expanded Content - Formatted File List */}
      {isExpanded && !isError && (
        <div className="relative mt-2">
          <CollapsibleOutputBlock
            isExpanded={isOutputExpanded}
            onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
            isLongContent={isLongOutput}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant="default"
          >
            <div className="space-y-0.5 p-2">
              {/* Search context (if non-default path) */}
              {searchPath && searchPath !== "." && (
                <div className="text-xs text-zinc-500 mb-2">
                  Search in: <span className="text-zinc-400">{displaySearchPath}</span>
                </div>
              )}

              {/* Formatted file list - never raw JSON */}
              {hasResults ? (
                displayPaths.map((displayPath, index) => (
                  <div
                    key={`${filePaths[index]}-${index}`}
                    className="flex items-center gap-2 group/item py-0.5"
                  >
                    <code className="text-xs font-mono text-zinc-300 flex-1 truncate">
                      {displayPath}
                    </code>
                    <CopyButton
                      text={filePaths[index]}
                      label="Copy path"
                      alwaysVisible={false}
                      className="opacity-0 group-hover/item:opacity-100"
                    />
                  </div>
                ))
              ) : (
                <div className="text-xs text-zinc-500">No files matched</div>
              )}
            </div>
          </CollapsibleOutputBlock>
        </div>
      )}

      {/* Error State Display */}
      {isError && isExpanded && (
        <div className="mt-2 text-xs text-red-400 bg-red-950/30 p-2 rounded border border-red-500/30">
          {result || "Pattern matching failed"}
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Finding files"
          : isError
            ? "Pattern matching failed"
            : `Found ${matchCount} ${matchCount === 1 ? "file" : "files"}`}
      </span>
    </div>
  );
}
