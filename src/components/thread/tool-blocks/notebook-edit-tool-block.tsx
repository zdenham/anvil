import { cn } from "@/lib/utils";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useToolState } from "@/hooks/use-tool-state";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { NotebookPen } from "lucide-react";
import type { ToolBlockProps } from "./index";

const LINE_COLLAPSE_THRESHOLD = 15;
const MAX_COLLAPSED_HEIGHT = 300;

/**
 * Parse and validate NotebookEdit input from the API.
 */
function parseNotebookInput(input: Record<string, unknown>): {
  notebookPath: string;
  newSource: string;
  cellNumber?: number;
  cellId?: string;
  cellType?: "code" | "markdown";
  editMode: "replace" | "insert" | "delete";
} {
  const notebookPath = typeof input.notebook_path === "string" ? input.notebook_path : "";
  const newSource = typeof input.new_source === "string" ? input.new_source : "";
  const cellNumber = typeof input.cell_number === "number" ? input.cell_number : undefined;
  const cellId = typeof input.cell_id === "string" ? input.cell_id : undefined;
  const cellType = input.cell_type === "code" || input.cell_type === "markdown"
    ? input.cell_type
    : undefined;
  const editMode = input.edit_mode === "insert" || input.edit_mode === "delete"
    ? input.edit_mode
    : "replace";

  return { notebookPath, newSource, cellNumber, cellId, cellType, editMode };
}

/**
 * Parse the result string to extract success/failure info.
 * Result is always a plain string, not JSON.
 */
function parseNotebookResult(result: string | undefined): {
  isSuccess: boolean;
  message: string;
} {
  if (!result) {
    return { isSuccess: true, message: "" };
  }

  const isError = result.toLowerCase().startsWith("error");
  return {
    isSuccess: !isError,
    message: result,
  };
}

/**
 * Format edit mode for display.
 */
function formatEditMode(mode: "replace" | "insert" | "delete"): string {
  const labels: Record<string, string> = {
    replace: "replaced",
    insert: "inserted",
    delete: "deleted",
  };
  return labels[mode] ?? mode;
}

/**
 * Format cell identifier for display.
 */
function formatCellIdentifier(cellNumber?: number, cellId?: string): string {
  if (cellNumber !== undefined) {
    return `cell ${cellNumber}`;
  }
  if (cellId) {
    return `cell ${cellId}`;
  }
  return "cell";
}

/**
 * Extract filename from path.
 */
function getFilename(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Check if content is long enough to warrant collapse.
 */
function isContentLong(content: string): boolean {
  return content.split("\n").length > LINE_COLLAPSE_THRESHOLD;
}

/**
 * Specialized block for rendering NotebookEdit tool calls.
 * Displays Jupyter notebook cell edits in a clear, readable format.
 */
export function NotebookEditToolBlock({
  id,
  name: _name,
  input,
  threadId,
}: ToolBlockProps) {
  const { status, result, isError } = useToolState(threadId, id);

  // Parse input and result
  const { notebookPath, newSource, cellNumber, cellId, cellType, editMode } =
    parseNotebookInput(input);
  const { message: resultMessage } = parseNotebookResult(result);

  // Expand state from store
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Output expand state for long content
  const isLongContent = isContentLong(newSource);
  const defaultOutputExpanded = !isLongContent;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  const isRunning = status === "running";
  const filename = getFilename(notebookPath);
  const cellIdentifier = formatCellIdentifier(cellNumber, cellId);
  const editModeLabel = formatEditMode(editMode);

  return (
    <div
      className="group py-0.5"
      aria-label={`Edit notebook: ${notebookPath}, status: ${status}`}
      data-testid={`notebook-edit-tool-${id}`}
      data-tool-status={status}
    >
      {/* First Line: Description Row (with chevron for expand/collapse) */}
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
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            Edit notebook
          </ShimmerText>

          {/* Error indicator */}
          {!isRunning && isError && <StatusIcon isSuccess={false} />}

          <span className="flex items-center gap-2 shrink-0 ml-auto" />
        </div>

        {/* Second Line: Command/Details Row (with icon) */}
        <div className="flex items-center gap-1 mt-0.5">
          <NotebookPen className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <code className="text-xs font-mono text-zinc-500 flex items-center gap-1 min-w-0 flex-1">
            <span className="truncate">{filename || "Unknown notebook"}</span>
            <span className="text-zinc-600">•</span>
            <span className="truncate">
              {cellIdentifier} ({editModeLabel})
            </span>
          </code>
          <CopyButton text={notebookPath} label="Copy notebook path" alwaysVisible className="ml-auto" />
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && newSource && editMode !== "delete" && (
        <div className="relative mt-2">
          {/* Cell type badge and copy button */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-zinc-500">
              {cellType === "markdown" ? "Markdown" : "Code"} Cell
              {cellNumber !== undefined && ` • Index ${cellNumber}`}
            </span>
            <CopyButton text={newSource} label="Copy cell content" />
          </div>

          <CollapsibleOutputBlock
            isExpanded={isOutputExpanded}
            onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
            isLongContent={isLongContent}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant={isError ? "error" : "default"}
          >
            <pre
              className={cn(
                "text-xs font-mono p-2",
                "whitespace-pre-wrap break-words",
                isError ? "text-red-200" : "text-zinc-300"
              )}
            >
              <code>{newSource}</code>
            </pre>
          </CollapsibleOutputBlock>

          {/* Result message (if error or notable) */}
          {isError && resultMessage && (
            <span className="text-xs text-red-400 mt-1 block">
              {resultMessage}
            </span>
          )}
        </div>
      )}

      {/* Expanded but empty new_source (not delete) */}
      {isExpanded && !newSource && editMode !== "delete" && (
        <div className="mt-2 ml-6">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Empty cell content
          </div>
        </div>
      )}

      {/* Expanded and delete operation (no content to show) */}
      {isExpanded && editMode === "delete" && (
        <div className="mt-2 ml-6">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Cell deleted
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Editing notebook"
          : isError
            ? "Notebook edit failed"
            : "Notebook edit completed successfully"}
      </span>
    </div>
  );
}
