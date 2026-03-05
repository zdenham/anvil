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

import { forwardRef } from "react";
import { ThreadInput, type ThreadInputRef } from "./thread-input";
import { ThreadInputStatusBar } from "./thread-input-status-bar";
import { QuickActionsPanel } from "@/components/quick-actions/quick-actions-panel";
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
    return (
      <div className="flex-shrink-0 w-full max-w-[900px] mx-auto mt-1 pb-1">
        {/* Quick actions hidden for now - low usage
        <QuickActionsPanel contextType={contextType} />
        */}

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
