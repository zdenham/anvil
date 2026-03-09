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

import { forwardRef, useCallback, useRef } from "react";
import { ThreadInput, type ThreadInputRef } from "./thread-input";
import { ThreadInputStatusBar } from "./thread-input-status-bar";
import { AttachmentPreviewStrip } from "./attachment-preview-strip";
import { useFileDrop } from "@/hooks/use-file-drop";
import { useInputStore } from "@/stores/input-store";
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
  /** Called when cancel button is clicked (shown when provided) */
  onCancel?: () => void;
}

export const ThreadInputSection = forwardRef<ThreadInputRef, ThreadInputSectionProps>(
  function ThreadInputSection(
    {
      onSubmit,
      workingDirectory,
      contextType: _contextType,
      disabled = false,
      placeholder,
      autoFocus,
      threadId,
      permissionMode,
      onCycleMode,
      onCancel,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const content = useInputStore((s) => s.content);
    const appendContent = useInputStore((s) => s.appendContent);

    const handleFileDrop = useCallback(
      (paths: string[]) => {
        if (paths.length === 0) return;
        const currentContent = content;
        const prefix = currentContent && !currentContent.endsWith("\n") ? "\n" : "";
        appendContent(prefix + paths.join("\n"));
      },
      [content, appendContent],
    );

    const isDragging = useFileDrop(containerRef, handleFileDrop);

    return (
      <div
        ref={containerRef}
        className="flex-shrink-0 w-full max-w-[900px] mx-auto mt-1 pb-1"
      >
        <AttachmentPreviewStrip content={content} />

        <ThreadInput
          ref={ref}
          onSubmit={onSubmit}
          disabled={disabled}
          workingDirectory={workingDirectory ?? undefined}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={isDragging ? "ring-2 ring-accent-500" : undefined}
          onCycleMode={onCycleMode}
          onCancel={onCancel}
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
