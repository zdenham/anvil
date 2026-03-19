import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { Square } from "lucide-react";
import { TriggerSearchInput, type TriggerStateInfo } from "./trigger-search-input";
import type { TriggerSearchInputRef } from "@/lib/triggers/types";
import { CursorBoundary } from "@/lib/cursor-boundary";
import { usePromptHistory } from "@/hooks/use-prompt-history";
import { useInputStore } from "@/stores/input-store";
import { writeImageToTempFile, MAX_IMAGE_SIZE_BYTES } from "@/lib/image-paste";
import { usePaneGroupMaybe } from "@/components/split-layout/pane-group-context";
import { paneLayoutService } from "@/stores/pane-layout";
import { logger } from "@/lib/logger-client";
import { cn } from "@/lib/utils";

interface ThreadInputProps {
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
  workingDirectory?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  /** Context type — controls contextual UI like the implement button for plans */
  contextType?: "empty" | "thread" | "plan";
  /** Called when Shift+Tab is pressed to cycle permission mode */
  onCycleMode?: () => void;
  /** Called when cancel button is clicked (shown when agent is running) */
  onCancel?: () => void;
  /** @deprecated Up/down arrows now cycle prompt history instead of navigating to quick actions */
  onNavigateToQuickActions?: () => void;
}

export interface ThreadInputRef {
  focus: () => void;
}

export const ThreadInput = forwardRef<ThreadInputRef, ThreadInputProps>(function ThreadInput({
  onSubmit,
  disabled,
  workingDirectory,
  placeholder,
  autoFocus,
  className: extraClassName,
  contextType,
  onCycleMode,
  onCancel,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onNavigateToQuickActions: _deprecated,
}: ThreadInputProps, ref) {
  const paneGroup = usePaneGroupMaybe();
  const content = useInputStore((s) => s.content);
  const setStoreContent = useInputStore((s) => s.setContent);
  const appendContent = useInputStore((s) => s.appendContent);
  const [triggerState, setTriggerState] = useState<TriggerStateInfo | null>(null);
  const [isPasting, setIsPasting] = useState(false);
  const inputRef = useRef<TriggerSearchInputRef>(null);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const types = Array.from(items).map((i) => i.type);
    logger.log("[image-paste] paste event", { itemCount: items.length, types });

    for (const item of items) {
      if (!item.type.startsWith("image/")) continue;
      e.preventDefault();

      const blob = item.getAsFile();
      if (!blob) continue;

      logger.log("[image-paste] image item", { type: blob.type, size: blob.size });

      if (blob.size > MAX_IMAGE_SIZE_BYTES) {
        logger.warn("[image-paste] image too large", { size: blob.size });
        continue;
      }

      setIsPasting(true);
      writeImageToTempFile(blob)
        .then((path) => {
          logger.log("[image-paste] saved", { path });
          const prefix = content.trim() ? "\n" : "";
          appendContent(prefix + path);
        })
        .catch((err) => logger.error("[image-paste] save failed", { error: String(err) }))
        .finally(() => setIsPasting(false));
      break;
    }
  }, [content, appendContent]);

  const { handleHistoryNavigation, resetHistory, isInHistoryMode } = usePromptHistory({
    onQueryChange: (query: string) => {
      setStoreContent(query);
      // Move cursor to end after history selection
      requestAnimationFrame(() => {
        const textarea = inputRef.current?.getElement();
        if (textarea) {
          CursorBoundary.moveToEnd(textarea);
        }
      });
    },
  });

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
    }
  }), []);

  const handleFocus = useCallback(() => {
    paneGroup?.activate();
    paneLayoutService.pinActiveTabIfEphemeral();
  }, [paneGroup]);

  const handleSubmit = useCallback(() => {
    const text = content.trim();
    if (text && !disabled) {
      onSubmit(text);
      setStoreContent("");
      resetHistory();
    }
  }, [content, disabled, onSubmit, resetHistory, setStoreContent]);

  const handleImplementPlan = useCallback(() => {
    if (!disabled) {
      onSubmit("implement this plan");
    }
  }, [disabled, onSubmit]);


  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Shift+Tab cycles permission mode
      if (e.shiftKey && e.key === "Tab") {
        e.preventDefault();
        onCycleMode?.();
        return;
      }

      // Enter submits (unless Shift is held for newline, or trigger dropdown is active)
      // Only consume Enter if there's content to submit - otherwise let it propagate to quick actions
      if (e.key === "Enter" && !e.shiftKey && !triggerState?.isActive && content.trim()) {
        e.preventDefault();
        e.stopPropagation();
        handleSubmit();
        return;
      }

      // Handle arrow keys for history navigation
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !triggerState?.isActive) {
        // Skip history navigation if Command key is pressed (let default cursor behavior happen)
        if (e.metaKey) {
          return;
        }

        const isEmpty = content.trim() === "";
        const textarea = e.target as HTMLTextAreaElement;

        // === HISTORY NAVIGATION LOGIC (follows spotlight pattern) ===

        if (e.key === "ArrowUp") {
          // Condition: empty input OR already in history mode OR on top row
          const onTopRow = CursorBoundary.isOnTopRow(textarea);

          if (isEmpty || isInHistoryMode || onTopRow) {
            const handled = await handleHistoryNavigation("up");
            if (handled) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
          }
        }

        if (e.key === "ArrowDown") {
          // Only cycle down if already in history mode
          if (isInHistoryMode) {
            const handled = await handleHistoryNavigation("down");
            if (handled) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
          }

          // If not in history mode, let default behavior handle cursor movement
        }

        // Input has content and cursor is in the middle of the text
        // Stop propagation so ControlPanelWindow doesn't intercept
        e.stopPropagation();
        return;
      }

      // Note: Arrow keys, Tab, plain Enter are handled by TriggerSearchInput
      // when trigger is active and dropdown is enabled
    },
    [handleSubmit, triggerState?.isActive, content, isInHistoryMode, handleHistoryNavigation, onCycleMode]
  );

  const handleTriggerStateChange = useCallback((state: TriggerStateInfo) => {
    setTriggerState(state);
  }, []);

  // Handle value changes - reset history mode when user types
  // Note: This only fires on actual user input, not when we call setStoreContent from history navigation
  const handleChange = useCallback((newValue: string) => {
    resetHistory();
    setStoreContent(newValue);
  }, [resetHistory, setStoreContent]);

  // Determine if triggers should be enabled
  // Disable if no working directory (file search won't work)
  const enableTriggers = Boolean(workingDirectory);

  // Build placeholder text
  const getPlaceholder = () => {
    if (placeholder) return placeholder;
    if (disabled) return "Agent is running...";
    if (!workingDirectory) return "Type a message...";
    return "Type a message, @ to mention files, / for skills...";
  };

  return (
    <div className="flex gap-2 pb-3 bg-surface-900" data-thread-input data-testid="thread-input">
      <div className="relative flex-1 min-w-0">
        <TriggerSearchInput
          ref={inputRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={handleFocus}
          onTriggerStateChange={handleTriggerStateChange}
          disabled={disabled}
          placeholder={getPlaceholder()}
          triggerContext={{ rootPath: workingDirectory ?? null }}
          enableTriggers={enableTriggers}
          variant="compact"
          autoFocus={autoFocus}
          // disableDropdown defaults to false, so dropdown renders for @ tags
          className={cn("min-h-[40px] max-h-[120px] flex-1 border-surface-600 focus:border-secondary-500 disabled:opacity-60 disabled:cursor-not-allowed placeholder:text-surface-500", extraClassName)}
          aria-label="Message input"
          aria-expanded={triggerState?.isActive}
          aria-autocomplete="list"
        />
        {isPasting && (
          <div className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-surface-400">Pasting image...</div>
        )}
        {onCancel && (
          <button
            onClick={onCancel}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border border-accent-400/50 flex items-center justify-center hover:bg-accent-400/20 text-accent-400 cancel-pulse transition-colors"
            aria-label="Cancel agent"
            title="Cancel agent"
          >
            <Square size={8} className="fill-current" />
          </button>
        )}
        {!onCancel && contextType === "plan" && !content.trim() && (
          <button
            onClick={handleImplementPlan}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-surface-400 hover:text-surface-200 transition-colors px-2 py-0.5 rounded border border-surface-600 hover:border-surface-500"
            aria-label="Implement this plan"
          >
            implement
          </button>
        )}
      </div>
    </div>
  );
});
