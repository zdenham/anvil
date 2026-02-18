/**
 * ThreadInputSection
 *
 * Composable component that provides the shared layout for quick actions
 * panel, permission request block, thread input, and status bar.
 *
 * This component handles layout and styling only - submit logic is
 * controlled by the consumer through the onSubmit prop.
 *
 * Used by:
 * - ThreadContent: For viewing/interacting with existing threads
 * - EmptyPaneContent: For creating new threads from the empty state
 */

import { forwardRef, useCallback } from "react";
import { ThreadInput, type ThreadInputRef } from "./thread-input";
import { ThreadInputStatusBar } from "./thread-input-status-bar";
import { QuickActionsPanel } from "@/components/quick-actions/quick-actions-panel";
import { PermissionRequestBlock } from "@/components/permission/permission-request-block";
import { usePermissionStore } from "@/entities/permissions/store";
import { permissionService } from "@/entities/permissions/service";
import type { PermissionModeId } from "@core/types/permissions.js";

export interface ThreadInputSectionProps {
  onSubmit: (prompt: string) => void | Promise<void>;
  workingDirectory: string | null;
  contextType: "empty" | "thread" | "plan";
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Thread ID - enables permission block and status bar */
  threadId?: string;
  /** Current permission mode for this thread */
  permissionMode?: PermissionModeId;
  /** Called when mode should cycle (Shift+Tab or click) */
  onCycleMode?: () => void;
}

export const ThreadInputSection = forwardRef<ThreadInputRef, ThreadInputSectionProps>(
  function ThreadInputSection(
    {
      onSubmit,
      workingDirectory,
      contextType,
      disabled = false,
      placeholder,
      autoFocus,
      threadId,
      permissionMode,
      onCycleMode,
    },
    ref
  ) {
    // Get pending permission request for this thread
    const pendingRequest = usePermissionStore(
      useCallback(
        (s) => (threadId ? s.getNextRequestForThread(threadId) : undefined),
        [threadId],
      ),
    );

    const handlePermissionRespond = useCallback(
      (_requestId: string, decision: "approve" | "deny") => {
        if (!pendingRequest) return;
        permissionService.respond(pendingRequest, decision);
      },
      [pendingRequest],
    );

    return (
      <div className="flex-shrink-0 w-full max-w-[900px] mx-auto mt-1 pb-1">
        {/* Permission request block - pinned above everything when pending */}
        {pendingRequest && pendingRequest.status === "pending" && (
          <PermissionRequestBlock
            request={pendingRequest}
            onRespond={handlePermissionRespond}
          />
        )}

        <QuickActionsPanel contextType={contextType} />

        <ThreadInput
          ref={ref}
          onSubmit={onSubmit}
          disabled={disabled}
          workingDirectory={workingDirectory ?? undefined}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onCycleMode={onCycleMode}
        />

        {/* Status bar - below input when permission mode is provided */}
        {permissionMode && onCycleMode && (
          <ThreadInputStatusBar
            threadId={threadId}
            permissionMode={permissionMode}
            onCycleMode={onCycleMode}
          />
        )}
      </div>
    );
  }
);
