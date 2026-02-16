/**
 * PermissionRequestBlock
 *
 * Pinned permission request block rendered above the chat input.
 * Shows tool name, file path (if applicable), and approve/deny buttons.
 * Keyboard: Enter -> approve, Esc -> deny.
 * Auto-focuses when mounted to capture keyboard input.
 */

import { useCallback, useEffect, useRef } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { isDangerousTool } from "@core/types/permissions.js";
import type { PermissionRequest, PermissionStatus } from "@core/types/permissions.js";
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
  const isDangerous = isDangerousTool(request.toolName);
  const filePath = getFilePath(request.toolInput);

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
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        handleApprove();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleDeny();
      }
    },
    [handleApprove, handleDeny],
  );

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={`mb-2 rounded-lg border p-3 outline-none focus:ring-1 ${
        isDangerous
          ? "border-amber-500/50 focus:ring-amber-500/30"
          : "border-blue-500/50 focus:ring-blue-500/30"
      } bg-surface-800`}
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

      {/* File path */}
      {filePath && (
        <div className="text-xs text-surface-400 font-mono truncate mb-1">
          {filePath}
        </div>
      )}

      {/* Tool input preview */}
      <PermissionInputDisplay
        toolName={request.toolName}
        toolInput={request.toolInput}
      />

      {/* Action buttons */}
      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={handleDeny}
          className="px-3 py-1 text-xs text-surface-300 hover:text-surface-100
                     border border-surface-600 rounded hover:border-surface-500
                     flex items-center gap-1.5 transition-colors"
        >
          <X size={12} />
          Deny
          <kbd className="ml-0.5 px-1 py-0.5 bg-surface-700 rounded text-[10px]">Esc</kbd>
        </button>
        <button
          onClick={handleApprove}
          className="px-3 py-1 text-xs bg-green-600 hover:bg-green-500
                     text-white rounded flex items-center gap-1.5 transition-colors"
        >
          <Check size={12} />
          Approve
          <kbd className="ml-0.5 px-1 py-0.5 bg-green-800 rounded text-[10px]">&#9166;</kbd>
        </button>
      </div>
    </div>
  );
}
