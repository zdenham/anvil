/**
 * ThreadInputSection
 *
 * Composable component that provides the shared layout for quick actions
 * panel, queued messages banner, and thread input.
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
import { QuickActionsPanel } from "@/components/quick-actions/quick-actions-panel";
import { QueuedMessagesBanner } from "@/components/content-pane/queued-messages-banner";
import { cn } from "@/lib/utils";
import type { QueuedMessage } from "@/stores/queued-messages-store";

export interface ThreadInputSectionProps {
  onSubmit: (prompt: string) => void | Promise<void>;
  workingDirectory: string | null;
  contextType: "empty" | "thread";
  disabled?: boolean;
  placeholder?: string;
  queuedMessages?: QueuedMessage[];
  canQueue?: boolean;
  autoFocus?: boolean;
}

export const ThreadInputSection = forwardRef<ThreadInputRef, ThreadInputSectionProps>(
  function ThreadInputSection(
    {
      onSubmit,
      workingDirectory,
      contextType,
      disabled = false,
      placeholder,
      queuedMessages = [],
      canQueue = false,
      autoFocus,
    },
    ref
  ) {
    return (
      <div className="flex-shrink-0 w-full max-w-[900px] mx-auto mt-4">
        <QuickActionsPanel contextType={contextType} />
        <QueuedMessagesBanner messages={queuedMessages} />
        <div
          className={cn(
            "relative",
            canQueue && "ring-1 ring-amber-500/30 ring-inset"
          )}
        >
          <ThreadInput
            ref={ref}
            onSubmit={onSubmit}
            disabled={disabled}
            workingDirectory={workingDirectory ?? undefined}
            placeholder={placeholder}
            autoFocus={autoFocus}
          />
        </div>
      </div>
    );
  }
);
