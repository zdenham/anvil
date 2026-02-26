import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { usePermissionStore } from "@/entities/permissions/store";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { InlinePermissionApproval } from "./inline-permission-approval";
import { useToolDiff } from "./use-tool-diff";

interface ToolPermissionWrapperProps {
  /** Tool use ID (from Claude API) */
  toolUseId: string;
  /** Tool name */
  toolName: string;
  /** Tool input */
  toolInput: Record<string, unknown>;
  /** Thread ID */
  threadId: string;
  /** The tool block to render */
  children: ReactNode;
}

/**
 * Wraps any tool block with permission awareness.
 * When a pending permission request exists for this tool use,
 * renders the approval UI below the tool block content.
 */
export function ToolPermissionWrapper({
  toolUseId,
  toolName,
  toolInput,
  threadId,
  children,
}: ToolPermissionWrapperProps) {
  const permissionRequest = usePermissionStore(
    useCallback((s) => s.getRequestByToolUseId(toolUseId), [toolUseId]),
  );
  const hasPendingPermission = permissionRequest?.status === "pending";

  // Auto-expand tool when permission arrives
  const setToolExpanded = useToolExpandStore((s) => s.setToolExpanded);
  const prevHadPermission = useRef(false);
  useEffect(() => {
    if (hasPendingPermission && !prevHadPermission.current) {
      setToolExpanded(threadId, toolUseId, true);
    }
    prevHadPermission.current = !!hasPendingPermission;
  }, [hasPendingPermission, setToolExpanded, threadId, toolUseId]);

  const diffData = useToolDiff(toolName, toolInput);

  if (!hasPendingPermission || !permissionRequest) {
    return <>{children}</>;
  }

  return (
    <div
      className="rounded-lg border border-amber-500/50 bg-amber-950/10 p-3 space-y-3"
      data-tool-status="pending_approval"
    >
      {/* Permission badge */}
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <span className="text-xs font-medium text-amber-400">
          Awaiting approval
        </span>
      </div>

      {/* Original tool block content */}
      {children}

      {/* Permission approval UI */}
      <InlinePermissionApproval
        request={permissionRequest}
        diffData={diffData}
        name={toolName}
        input={toolInput}
      />
    </div>
  );
}
