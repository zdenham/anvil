import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { TriggerSearchInput, type TriggerStateInfo } from "./trigger-search-input";
import type { TriggerSearchInputRef } from "@/lib/triggers/types";

interface ThreadInputProps {
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
  workingDirectory?: string;
  placeholder?: string;
  onNavigateToQuickActions?: () => void; // Callback for safe focus transfer to quick actions
}

export interface ThreadInputRef {
  focus: () => void;
}

export const ThreadInput = forwardRef<ThreadInputRef, ThreadInputProps>(function ThreadInput({
  onSubmit,
  disabled,
  workingDirectory,
  placeholder,
  onNavigateToQuickActions,
}: ThreadInputProps, ref) {
  const [value, setValue] = useState("");
  const [triggerState, setTriggerState] = useState<TriggerStateInfo | null>(null);
  const inputRef = useRef<TriggerSearchInputRef>(null);

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
    }
  }), []);

  const handleSubmit = useCallback(() => {
    if (value.trim() && !disabled) {
      onSubmit(value.trim());
      setValue("");
    }
  }, [value, disabled, onSubmit]);

  // Helper to check if cursor is on the first line of the textarea
  const isCursorOnFirstLine = useCallback((textarea: HTMLTextAreaElement): boolean => {
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = textarea.value.substring(0, cursorPos);
    return !textBeforeCursor.includes('\n');
  }, []);

  // Helper to check if cursor is on the last line of the textarea
  const isCursorOnLastLine = useCallback((textarea: HTMLTextAreaElement): boolean => {
    const cursorPos = textarea.selectionStart;
    const textAfterCursor = textarea.value.substring(cursorPos);
    return !textAfterCursor.includes('\n');
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter submits (unless Shift is held for newline, or trigger dropdown is active)
      // Only consume Enter if there's content to submit - otherwise let it propagate to quick actions
      if (e.key === "Enter" && !e.shiftKey && !triggerState?.isActive && value.trim()) {
        e.preventDefault();
        e.stopPropagation();
        handleSubmit();
        return;
      }

      // Handle arrow keys for quick action navigation
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !triggerState?.isActive) {
        const isEmpty = value.trim() === "";
        const textarea = e.target as HTMLTextAreaElement;

        // Allow propagation to quick actions only when:
        // - Input is empty, OR
        // - ArrowUp on first line (navigate to quick actions above)
        // - ArrowDown on last line (navigate to quick actions below)
        // Otherwise, stop propagation so arrow keys work normally in textarea
        if (isEmpty) {
          // Transfer focus to quick actions panel safely
          // If callback provided, use it; otherwise fall back to blur
          if (onNavigateToQuickActions) {
            e.preventDefault();
            e.stopPropagation();
            onNavigateToQuickActions();
          } else {
            textarea.blur();
          }
          return;
        }

        const onFirstLine = isCursorOnFirstLine(textarea);
        const onLastLine = isCursorOnLastLine(textarea);

        if (e.key === "ArrowUp" && onFirstLine) {
          // Transfer focus to quick actions panel safely
          if (onNavigateToQuickActions) {
            e.preventDefault();
            e.stopPropagation();
            onNavigateToQuickActions();
          } else {
            textarea.blur();
          }
          return;
        }

        if (e.key === "ArrowDown" && onLastLine) {
          // Let the quick actions panel handle it (it will re-focus us if needed)
          return;
        }

        // Input has content and cursor is in the middle of the text
        // Stop propagation so ControlPanelWindow doesn't intercept
        e.stopPropagation();
        return;
      }

      // Note: Arrow keys, Tab, plain Enter are handled by TriggerSearchInput
      // when trigger is active and dropdown is enabled
    },
    [handleSubmit, triggerState?.isActive, value, isCursorOnFirstLine, isCursorOnLastLine, onNavigateToQuickActions]
  );

  const handleTriggerStateChange = useCallback((state: TriggerStateInfo) => {
    setTriggerState(state);
  }, []);

  // Determine if triggers should be enabled
  // Disable if no working directory (file search won't work)
  const enableTriggers = Boolean(workingDirectory);

  // Build placeholder text
  const getPlaceholder = () => {
    if (placeholder) return placeholder;
    if (disabled) return "Agent is running...";
    if (!workingDirectory) return "Type a message...";
    return "Type a message, @ to mention files...";
  };

  return (
    <div className="flex gap-2 px-4 py-3 bg-surface-800 border-t border-surface-700" data-thread-input>
      <div className="flex-1 min-w-0">
        <TriggerSearchInput
          ref={inputRef}
          value={value}
          onChange={setValue}
          onKeyDown={handleKeyDown}
          onTriggerStateChange={handleTriggerStateChange}
          disabled={disabled}
          placeholder={getPlaceholder()}
          triggerContext={{ rootPath: workingDirectory ?? null }}
          enableTriggers={enableTriggers}
          variant="compact"
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
