import { formatDuration } from "@/lib/utils/time-format";
import { toRelativePath } from "@/lib/utils/path-display";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useWorkspaceRoot } from "@/hooks/use-workspace-root";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { FileDiff } from "lucide-react";
import { InlineDiffBlock } from "../inline-diff-block";
import { useToolPermission } from "../tool-permission-context";
import type { ToolBlockProps } from "./index";

interface EditToolInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

function parseEditInput(input: Record<string, unknown>): EditToolInput | null {
  const filePath = input.file_path;
  const oldString = input.old_string;
  const newString = input.new_string;

  if (typeof filePath !== "string" || typeof oldString !== "string" || typeof newString !== "string") {
    return null;
  }

  return {
    file_path: filePath,
    old_string: oldString,
    new_string: newString,
    replace_all: input.replace_all === true,
  };
}

/**
 * Specialized block for rendering Edit tool calls.
 * Displays file edits with inline diffs showing old_string -> new_string.
 */
export function EditToolBlock({
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
  // Use Zustand store for expand state (persists across virtualization)
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Get workspace root for relative path display
  const workspaceRoot = useWorkspaceRoot();

  // Parse input
  const editInput = parseEditInput(input);
  const filePath = editInput?.file_path ?? "unknown";
  const displayPath = toRelativePath(filePath, workspaceRoot);
  const fileName = filePath.split("/").pop() || filePath;
  const oldString = editInput?.old_string ?? "";
  const newString = editInput?.new_string ?? "";
  const replaceAll = editInput?.replace_all ?? false;

  const isRunning = status === "running";
  const permissionCtx = useToolPermission();
  const isPendingPermission = permissionCtx?.isPending && permissionCtx?.diffData;

  // Determine if diff is long enough to need expand/collapse
  const diffLineCount = Math.max(
    oldString.split("\n").length,
    newString.split("\n").length
  );
  const isLongDiff = diffLineCount > 10;

  // Use store for diff expand state
  const defaultDiffExpanded = !isLongDiff;
  const isDiffExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultDiffExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsDiffExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  return (
    <div
      className="group py-0.5"
      aria-label={`Edit file: ${filePath}`}
      data-testid={`edit-tool-${id}`}
      data-tool-status={status}
    >
      {/* Header Row - Two-line layout:
          Line 1: Chevron + description text (with shimmer) + summary
          Line 2: Icon + file path + copy button
          Note: Chevron is ONLY on line 1, Icon is ONLY on line 2 */}
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
        {/* First line: Chevron + description text + summary info */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200"
          >
            {isRunning ? `Editing ${fileName}` : `Edit ${fileName}`}
          </ShimmerText>

          {/* Error indicator */}
          {!isRunning && isError && <StatusIcon isSuccess={false} />}

          {/* Right-justified info */}
          <span className="flex items-center gap-2 shrink-0 ml-auto">
            {durationMs !== undefined && !isRunning && (
              <span className="text-xs text-muted-foreground">
                {formatDuration(durationMs)}
              </span>
            )}
            <span className="text-xs text-zinc-400">
              {replaceAll ? "all replacements" : "1 replacement"}
            </span>
          </span>
        </div>

        {/* Second line: Icon + file path (icon only appears here, not on first line) */}
        <div className="flex items-center gap-1 mt-0.5">
          <FileDiff className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <span className="text-xs font-mono text-zinc-500 truncate flex-1">
            {displayPath}
          </span>
          <CopyButton text={filePath} label="Copy file path" className="ml-auto" />
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="relative mt-2 ml-5">
          {isPendingPermission ? (
            <InlineDiffBlock
              filePath={permissionCtx.diffData!.filePath}
              diff={permissionCtx.diffData!.diff}
              lines={permissionCtx.diffData!.lines}
              stats={permissionCtx.diffData!.stats}
              isPending
            />
          ) : (
            <CollapsibleOutputBlock
              isExpanded={isDiffExpanded}
              onToggle={() => setIsDiffExpanded(!isDiffExpanded)}
              isLongContent={isLongDiff}
              maxCollapsedHeight={200}
              variant={isError ? "error" : "default"}
            >
              <div className="p-2 space-y-2">
                {/* Old string (removed) */}
                <div className="relative">
                  <div className="absolute top-1 right-1 z-10">
                    <CopyButton text={oldString} label="Copy old text" />
                  </div>
                  <div className="text-xs font-mono">
                    <div className="text-zinc-500 mb-1">old_string:</div>
                    <pre className="text-red-300 bg-red-950/30 p-2 rounded whitespace-pre-wrap break-words border border-red-900/30">
                      {oldString || <span className="text-zinc-600 italic">(empty)</span>}
                    </pre>
                  </div>
                </div>

                {/* New string (added) */}
                <div className="relative">
                  <div className="absolute top-1 right-1 z-10">
                    <CopyButton text={newString} label="Copy new text" />
                  </div>
                  <div className="text-xs font-mono">
                    <div className="text-zinc-500 mb-1">new_string:</div>
                    <pre className="text-green-300 bg-green-950/30 p-2 rounded whitespace-pre-wrap break-words border border-green-900/30">
                      {newString || <span className="text-zinc-600 italic">(empty)</span>}
                    </pre>
                  </div>
                </div>

                {/* Error message (only shown on errors) */}
                {isError && result && (
                  <div className="text-xs font-mono">
                    <div className="text-zinc-500 mb-1">Error:</div>
                    <div className="p-2 rounded border text-red-300 bg-red-950/20 border-red-900/30">
                      {result}
                    </div>
                  </div>
                )}
              </div>
            </CollapsibleOutputBlock>
          )}
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Edit in progress"
          : isError
            ? "Edit failed"
            : "Edit completed successfully"}
      </span>
    </div>
  );
}
