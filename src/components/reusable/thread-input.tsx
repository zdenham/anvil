import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { TriggerSearchInput, type TriggerStateInfo } from "./trigger-search-input";
import type { TriggerSearchInputRef } from "@/lib/triggers/types";
import { CursorBoundary } from "@/lib/cursor-boundary";
import { usePromptHistory } from "@/hooks/use-prompt-history";

interface ThreadInputProps {
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
  workingDirectory?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Called when Shift+Tab is pressed to cycle permission mode */
  onCycleMode?: () => void;
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
  onCycleMode,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onNavigateToQuickActions: _deprecated,
}: ThreadInputProps, ref) {
  const [value, setValue] = useState("");
  const [triggerState, setTriggerState] = useState<TriggerStateInfo | null>(null);
  const inputRef = useRef<TriggerSearchInputRef>(null);

  const { handleHistoryNavigation, resetHistory, isInHistoryMode } = usePromptHistory({
    onQueryChange: (query: string) => {
      setValue(query);
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

  const handleSubmit = useCallback(() => {
    if (value.trim() && !disabled) {
      onSubmit(value.trim());
      setValue("");
      resetHistory();
    }
  }, [value, disabled, onSubmit, resetHistory]);


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
      if (e.key === "Enter" && !e.shiftKey && !triggerState?.isActive && value.trim()) {
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

        const isEmpty = value.trim() === "";
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
    [handleSubmit, triggerState?.isActive, value, isInHistoryMode, handleHistoryNavigation, onCycleMode]
  );

  const handleTriggerStateChange = useCallback((state: TriggerStateInfo) => {
    setTriggerState(state);
  }, []);

  // Handle value changes - reset history mode when user types
  // Note: This only fires on actual user input, not when we call setValue from history navigation
  const handleChange = useCallback((newValue: string) => {
    resetHistory();
    setValue(newValue);
  }, [resetHistory]);

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
    <div className="flex gap-2 pb-3 bg-surface-900" data-thread-input>
      <div className="flex-1 min-w-0">
        <TriggerSearchInput
          ref={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onTriggerStateChange={handleTriggerStateChange}
          disabled={disabled}
          placeholder={getPlaceholder()}
          triggerContext={{ rootPath: workingDirectory ?? null }}
          enableTriggers={enableTriggers}
          variant="compact"
          autoFocus={autoFocus}
          // disableDropdown defaults to false, so dropdown renders for @ tags
          className="min-h-[40px] max-h-[120px] flex-1 border-surface-600 focus:border-secondary-500 disabled:opacity-60 disabled:cursor-not-allowed placeholder:text-surface-500"
          aria-label="Message input"
          aria-expanded={triggerState?.isActive}
          aria-autocomplete="list"
        />
      </div>
    </div>
  );
});
