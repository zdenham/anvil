import { useCallback, useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import type { PermissionRequest, PermissionStatus } from "@core/types/permissions.js";
import { isDangerousTool } from "@core/types/permissions.js";
import { permissionService } from "@/entities/permissions/service";
import { InlineDiffBlock } from "./inline-diff-block";
import { PermissionInputDisplay } from "@/components/permission/permission-input-display";
import type { useToolDiff } from "./use-tool-diff";

interface InlinePermissionApprovalProps {
  request: PermissionRequest & { status: PermissionStatus };
  diffData: ReturnType<typeof useToolDiff>;
  name: string;
  input: Record<string, unknown>;
  onOpenDiff?: (filePath: string) => void;
}

/**
 * Inline permission approval UI rendered inside the tool-use block.
 * Shows diff preview for Write/Edit, fallback input display for others.
 */
export function InlinePermissionApproval({
  request,
  diffData,
  name,
  input,
  onOpenDiff,
}: InlinePermissionApprovalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDangerous = isDangerousTool(name);

  const handleApprove = useCallback(() => {
    permissionService.respond(request, "approve");
  }, [request]);

  const handleDeny = useCallback(() => {
    permissionService.respond(request, "deny");
  }, [request]);

  // Keyboard handling
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        handleApprove();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        handleDeny();
      }
    },
    [handleApprove, handleDeny],
  );

  // Auto-focus and scroll into view
  useEffect(() => {
    containerRef.current?.focus();
    containerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [request.requestId]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="outline-none"
      role="alertdialog"
      aria-label={`Permission request: Allow ${name}?`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        {isDangerous && (
          <AlertTriangle className="text-amber-500 flex-shrink-0" size={16} />
        )}
        <span className="text-sm font-medium text-surface-100">
          Allow {name}?
        </span>
      </div>

      {/* Diff preview for Write/Edit tools */}
      {diffData ? (
        <InlineDiffBlock
          filePath={diffData.filePath}
          diff={diffData.diff}
          lines={diffData.lines}
          stats={diffData.stats}
          isPending
          onAccept={handleApprove}
          onReject={handleDeny}
          onExpand={() => onOpenDiff?.(diffData.filePath)}
        />
      ) : (
        <PermissionInputDisplay toolName={name} toolInput={input} />
      )}

      {/* Approve/Deny controls (only if no diff — diff block has its own actions) */}
      {!diffData && (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={handleApprove}
            className="px-3 py-1.5 text-xs font-medium rounded bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors border border-green-600/30"
          >
            Approve <kbd className="ml-1 text-[10px] opacity-60">y</kbd>
          </button>
          <button
            onClick={handleDeny}
            className="px-3 py-1.5 text-xs font-medium rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors border border-red-600/30"
          >
            Deny <kbd className="ml-1 text-[10px] opacity-60">n</kbd>
          </button>
        </div>
      )}
    </div>
  );
}
