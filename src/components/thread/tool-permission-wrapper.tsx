import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { usePermissionStore } from "@/entities/permissions/store";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { InlinePermissionApproval } from "./inline-permission-approval";
import { useToolDiff } from "./use-tool-diff";
import { ToolPermissionProvider } from "./tool-permission-context";

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
    <div data-tool-status="pending_approval">
      <ToolPermissionProvider value={{ isPending: true, diffData }}>
        {children}
      </ToolPermissionProvider>

      <InlinePermissionApproval
        request={permissionRequest}
        name={toolName}
      />
    </div>
  );
}
