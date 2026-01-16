import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { TriggerSearchInput, type TriggerStateInfo } from "./trigger-search-input";
import type { TriggerSearchInputRef } from "@/lib/triggers/types";
import { useModeKeyboard } from "@/components/simple-task/use-mode-keyboard";

interface ThreadInputProps {
  threadId: string;
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
  workingDirectory?: string;
  placeholder?: string;
}

export interface ThreadInputRef {
  focus: () => void;
}

export const ThreadInput = forwardRef<ThreadInputRef, ThreadInputProps>(({
  threadId,
  onSubmit,
  disabled,
  workingDirectory,
  placeholder,
}: ThreadInputProps, ref) => {
  const [value, setValue] = useState("");
  const [triggerState, setTriggerState] = useState<TriggerStateInfo | null>(null);
  const inputRef = useRef<TriggerSearchInputRef>(null);

  const { handleKeyDown: handleModeKeyDown } = useModeKeyboard({
    threadId,
    enabled: !disabled,
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
    }
  }, [value, disabled, onSubmit]);

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

      // Allow arrow keys to propagate to quick actions panel when input is empty
      // This will be handled by the quick actions panel's global listener
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && value.trim() === "" && !triggerState?.isActive) {
        // Don't prevent default - let the quick actions panel handle it
        return;
      }

      // Skip mode switching if trigger dropdown is open (Shift+Tab navigates dropdown)
      if (triggerState?.isActive && e.shiftKey && e.key === "Tab") {
        return; // Let dropdown handle it
      }

      // Check for mode switching (Shift+Tab)
      handleModeKeyDown(e);
      if (e.defaultPrevented) return;

      // Note: Arrow keys, Tab, plain Enter are handled by TriggerSearchInput
      // when trigger is active and dropdown is enabled
    },
    [handleSubmit, triggerState?.isActive, handleModeKeyDown, value]
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
    <div className="flex gap-2 px-4 py-3 bg-surface-800 border-t border-surface-700">
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
      {/* <div className="flex items-center gap-2 self-end">
        <ModeIndicatorWithShortcut mode={currentMode} />
      </div> */}
    </div>
  );
});
