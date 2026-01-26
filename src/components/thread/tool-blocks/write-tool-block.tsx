import { formatDuration } from "@/lib/utils/time-format";
import { toRelativePath } from "@/lib/utils/path-display";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useWorkspaceRoot } from "@/hooks/use-workspace-root";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { InlineDiffBlock } from "../inline-diff-block";
import { useToolDiff } from "../use-tool-diff";
import { FilePlus } from "lucide-react";
import type { ToolBlockProps } from "./index";

interface WriteInput {
  file_path: string;
  content: string;
}

const LINE_COLLAPSE_THRESHOLD = 20;
const MAX_COLLAPSED_HEIGHT = 300;

/**
 * Specialized block for rendering Write tool calls.
 * Displays file path and diff showing all new content as additions.
 */
export function WriteToolBlock({
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
  // Expand state from Zustand store
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Get workspace root for relative path display
  const workspaceRoot = useWorkspaceRoot(threadId);

  // Parse input
  const writeInput = input as unknown as WriteInput;
  const filePath = writeInput.file_path || "";
  const displayPath = toRelativePath(filePath, workspaceRoot);
  const fileName = filePath.split("/").pop() || filePath;

  // Get diff data (from result or generated from input)
  const diffData = useToolDiff("Write", input, result);

  // Output expand state for long diffs
  const isLongDiff = (diffData?.lines?.length ?? 0) > LINE_COLLAPSE_THRESHOLD;
  const defaultOutputExpanded = !isLongDiff;
  const isDiffOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setDiffOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  // Extract error message if needed
  const errorMessage = isError ? extractErrorMessage(result) : null;

  const isRunning = status === "running";
  const hasDiff = diffData !== null;

  return (
    <div
      className="group py-0.5"
      aria-label={`Write file: ${filePath}, status: ${status}`}
      data-testid={`write-tool-${id}`}
      data-tool-status={status}
    >
      {/* Clickable header */}
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
        {/* First line: Chevron + description text (shimmer when running) */}
        {/* No icon on this line - the chevron controls expand/collapse */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            {isRunning ? `Writing ${fileName}` : `Write ${fileName}`}
          </ShimmerText>

          {/* Error indicator */}
          {!isRunning && isError && <StatusIcon isSuccess={false} />}

          {/* Duration - right justified */}
          <span className="ml-auto shrink-0">
            {durationMs !== undefined && !isRunning && (
              <span className="text-xs text-muted-foreground">
                {formatDuration(durationMs)}
              </span>
            )}
          </span>
        </div>

        {/* Second line: Icon + file path */}
        {/* Icon appears here (not first line) since chevron is on first line */}
        <div className="flex items-center gap-1 mt-0.5">
          <code className="text-xs font-mono text-zinc-500 flex items-center gap-1 min-w-0 flex-1">
            <FilePlus className="w-3 h-3 text-zinc-500/60 shrink-0" />
            <span className="truncate">{displayPath}</span>
          </code>
          <CopyButton text={filePath} label="Copy file path" alwaysVisible className="ml-auto" />
        </div>
      </div>

      {/* Expanded diff */}
      {isExpanded && hasDiff && (
        <div className="relative mt-2">
          <CollapsibleOutputBlock
            isExpanded={isDiffOutputExpanded}
            onToggle={() => setDiffOutputExpanded(!isDiffOutputExpanded)}
            isLongContent={isLongDiff}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
          >
            <InlineDiffBlock
              filePath={diffData.filePath}
              diff={diffData.diff}
              lines={diffData.lines}
              stats={diffData.stats}
            />
          </CollapsibleOutputBlock>
        </div>
      )}

      {/* Expanded error */}
      {isExpanded && isError && errorMessage && (
        <div className="mt-2">
          <CollapsibleOutputBlock
            isExpanded={true}
            onToggle={() => {}}
            isLongContent={false}
            variant="error"
          >
            <pre className="text-xs font-mono p-2 text-red-200 whitespace-pre-wrap break-words">
              <code>{errorMessage}</code>
            </pre>
          </CollapsibleOutputBlock>
        </div>
      )}

      {/* Running state without output */}
      {isExpanded && !hasDiff && !isError && isRunning && (
        <div className="mt-2 ml-6">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Writing file...
            <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Writing file in progress"
          : isError
            ? "Write failed"
            : "Write completed successfully"}
      </span>
    </div>
  );
}

function extractErrorMessage(result: string | undefined): string {
  if (!result) return "Unknown error";
  try {
    const parsed = JSON.parse(result);
    return parsed.error ?? parsed.message ?? result;
  } catch {
    return result;
  }
}
