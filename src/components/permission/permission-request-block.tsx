/**
 * PermissionRequestBlock
 *
 * Pinned permission request block rendered above the chat input.
 * Shows tool name, file path (if applicable), and selectable approve/deny options.
 * Keyboard: Arrow Up/Down to select, Enter to confirm.
 * Auto-focuses when mounted to capture keyboard input.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { isDangerousTool } from "@core/types/permissions.js";
import type { PermissionRequest, PermissionStatus } from "@core/types/permissions.js";
import { useToolDiff } from "@/components/thread/use-tool-diff";
import { InlineDiffBlock } from "@/components/thread/inline-diff-block";
import { PermissionInputDisplay } from "./permission-input-display";

interface PermissionRequestBlockProps {
  request: PermissionRequest & { status: PermissionStatus };
  onRespond: (requestId: string, decision: "approve" | "deny") => void;
}

/**
 * Extract a human-readable label from a tool name.
 * E.g. "Write" -> "Write", "NotebookEdit" -> "NotebookEdit"
 */
function getToolLabel(toolName: string): string {
  return toolName;
}

/**
 * Extract the primary file path from tool input, if applicable.
 */
function getFilePath(toolInput: Record<string, unknown>): string | undefined {
  if (typeof toolInput.file_path === "string") return toolInput.file_path;
  if (typeof toolInput.path === "string") return toolInput.path;
  return undefined;
}

export function PermissionRequestBlock({ request, onRespond }: PermissionRequestBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0); // 0 = Approve, 1 = Deny
  const isDangerous = isDangerousTool(request.toolName);
  const filePath = getFilePath(request.toolInput);
  const diffData = useToolDiff(request.toolName, request.toolInput);

  // Auto-focus container on mount
  useEffect(() => {
    containerRef.current?.focus();
  }, [request.requestId]);

  const handleApprove = useCallback(() => {
    onRespond(request.requestId, "approve");
  }, [onRespond, request.requestId]);

  const handleDeny = useCallback(() => {
    onRespond(request.requestId, "deny");
  }, [onRespond, request.requestId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelected((prev) => (prev === 0 ? 1 : 0));
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (selected === 0) {
          handleApprove();
        } else {
          handleDeny();
        }
      }
    },
    [selected, handleApprove, handleDeny],
  );

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="mb-2 rounded-lg border border-surface-600 p-3 outline-none bg-surface-800"
      role="alertdialog"
      aria-label={`Permission request: Allow ${request.toolName}?`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        {isDangerous && (
          <AlertTriangle className="text-amber-500 flex-shrink-0" size={16} />
        )}
        <span className="text-sm font-medium text-surface-100">
          Allow {getToolLabel(request.toolName)}?
        </span>
      </div>

      {/* Diff preview for Write/Edit tools, fallback to generic input display */}
      {diffData ? (
        <InlineDiffBlock
          filePath={diffData.filePath}
          diff={diffData.diff}
          lines={diffData.lines}
          stats={diffData.stats}
          isPending
        />
      ) : (
        <>
          {filePath && (
            <div className="text-xs text-surface-400 font-mono truncate mb-1">
              {filePath}
            </div>
          )}
          <PermissionInputDisplay
            toolName={request.toolName}
            toolInput={request.toolInput}
          />
        </>
      )}

      {/* Selectable options */}
      <div className="mt-3 flex flex-col gap-0.5 font-mono">
        <button
          onClick={handleApprove}
          className={`px-2 py-1 text-xs rounded flex items-center gap-1.5 transition-colors ${
            selected === 0
              ? "text-surface-100"
              : "text-surface-500 hover:text-surface-300"
          }`}
        >
          <ChevronRight size={12} className={selected === 0 ? "opacity-100" : "opacity-0"} />
          Approve
        </button>
        <button
          onClick={handleDeny}
          className={`px-2 py-1 text-xs rounded flex items-center gap-1.5 transition-colors ${
            selected === 1
              ? "text-surface-100"
              : "text-surface-500 hover:text-surface-300"
          }`}
        >
          <ChevronRight size={12} className={selected === 1 ? "opacity-100" : "opacity-0"} />
          Deny
        </button>
      </div>

      {/* Keyboard hint */}
      <div className="mt-2 text-[10px] text-surface-500 flex items-center gap-2">
        <span>&#8593;&#8595; select</span>
        <span>&#8629; confirm</span>
      </div>
    </div>
  );
}
