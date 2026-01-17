import React, {
  forwardRef,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  useEffect,
} from "react";
import { SearchInput, type SearchInputProps } from "./search-input";
import { TriggerDropdown } from "./trigger-dropdown";
import { useTriggerAutocomplete } from "@/hooks/use-trigger-autocomplete";
import type {
  TriggerContext,
  TriggerSearchInputRef,
  TriggerResult,
} from "@/lib/triggers/types";

// Trigger state passed to parent via callback
export interface TriggerStateInfo {
  isActive: boolean;
  results: TriggerResult[];
  selectedIndex: number;
  isLoading: boolean;
  error?: string | null;
}

// Note: SearchInput is a TEXTAREA, not an input - cursor tracking uses selectionStart/End
export interface TriggerSearchInputProps
  extends Omit<SearchInputProps, "onChange"> {
  triggerContext: TriggerContext;
  onChange?: (value: string) => void;
  enableTriggers?: boolean;
  disableDropdown?: boolean; // When true, don't render TriggerDropdown (parent renders results)
  onTriggerStateChange?: (state: TriggerStateInfo) => void; // Callback when trigger state changes
}

export const TriggerSearchInput = forwardRef<
  TriggerSearchInputRef,
  TriggerSearchInputProps
>(
  (
    {
      triggerContext,
      onChange,
      enableTriggers = true,
      disableDropdown = false,
      onTriggerStateChange,
      onKeyDown,
      ...props
    },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const [isComposing, setIsComposing] = useState(false);
    const cursorPositionRef = useRef<number>(0);

    const {
      state: triggerState,
      analyzeInput,
      selectResult,
      close: closeTrigger,
      setSelectedIndex,
    } = useTriggerAutocomplete({ context: triggerContext });

    // Notify parent when trigger state changes
    useEffect(() => {
      onTriggerStateChange?.({
        isActive: triggerState.isActive,
        results: triggerState.results,
        selectedIndex: triggerState.selectedIndex,
        isLoading: triggerState.isLoading,
        error: triggerState.error,
      });
    }, [
      triggerState.isActive,
      triggerState.results,
      triggerState.selectedIndex,
      triggerState.isLoading,
      triggerState.error,
      onTriggerStateChange,
    ]);

    // Update anchor rect when trigger becomes active or input scrolls
    const updateAnchorRect = useCallback(() => {
      if (textareaRef.current) {
        setAnchorRect(textareaRef.current.getBoundingClientRect());
      }
    }, []);

    const handleSelectResult = useCallback(
      (result: TriggerResult) => {
        const selectionResult = selectResult(result);
        if (selectionResult) {
          onChange?.(selectionResult.value);
        }
      },
      [selectResult, onChange]
    );

    // Expose ref methods including isTriggerActive for parent coordination
    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      blur: () => textareaRef.current?.blur(),
      getValue: () => textareaRef.current?.value ?? "",
      setValue: (value: string) => {
        if (textareaRef.current) textareaRef.current.value = value;
      },
      getCursorPosition: () => textareaRef.current?.selectionStart ?? 0,
      setCursorPosition: (pos: number) => {
        textareaRef.current?.setSelectionRange(pos, pos);
      },
      closeTrigger,
      isTriggerActive: () => triggerState.isActive,
      // Methods for parent to render trigger results in its own UI
      getTriggerResults: () => triggerState.results,
      getTriggerSelectedIndex: () => triggerState.selectedIndex,
      setTriggerSelectedIndex: setSelectedIndex,
      selectTriggerResult: handleSelectResult,
      isTriggerLoading: () => triggerState.isLoading,
    }));

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // When trigger is active and dropdown is NOT disabled, intercept navigation keys
        // If dropdown is disabled, parent handles the keyboard navigation
        if (triggerState.isActive && !disableDropdown) {
          switch (e.key) {
            case "ArrowDown":
              e.preventDefault();
              e.stopPropagation(); // Prevent parent (e.g., Spotlight) from handling
              setSelectedIndex(
                Math.min(
                  triggerState.selectedIndex + 1,
                  triggerState.results.length - 1
                )
              );
              return; // Don't call parent handler

            case "ArrowUp":
              e.preventDefault();
              e.stopPropagation();
              setSelectedIndex(Math.max(triggerState.selectedIndex - 1, 0));
              return;

            case "Enter":
              // Only intercept if not holding Shift (Shift+Enter = newline in textarea)
              if (
                !e.shiftKey &&
                triggerState.results[triggerState.selectedIndex]
              ) {
                e.preventDefault();
                e.stopPropagation();
                handleSelectResult(
                  triggerState.results[triggerState.selectedIndex]
                );
                return;
              }
              break;

            case "Tab":
              // Tab completes selection (like shell autocomplete)
              if (triggerState.results[triggerState.selectedIndex]) {
                e.preventDefault();
                e.stopPropagation();
                handleSelectResult(
                  triggerState.results[triggerState.selectedIndex]
                );
                return;
              }
              break;

            case "Escape":
              e.preventDefault();
              e.stopPropagation();
              closeTrigger();
              return;
          }
        }

        // Call parent handler for non-intercepted keys
        onKeyDown?.(e);
      },
      [
        triggerState.isActive,
        triggerState.results,
        triggerState.selectedIndex,
        setSelectedIndex,
        handleSelectResult,
        closeTrigger,
        onKeyDown,
        disableDropdown,
      ]
    );

    const handleCompositionStart = useCallback(() => {
      setIsComposing(true);
      // Don't analyze input during IME composition
    }, []);

    const handleCompositionEnd = useCallback(
      (e: React.CompositionEvent<HTMLTextAreaElement>) => {
        setIsComposing(false);
        // Analyze the final composed text
        const target = e.target as HTMLTextAreaElement;
        analyzeInput(target.value, target.selectionStart ?? 0);
      },
      [analyzeInput]
    );

    // Handle change from SearchInput (receives event, not just value)
    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        const cursorPos = e.target.selectionStart ?? 0;
        cursorPositionRef.current = cursorPos;

        onChange?.(value);

        // Skip analysis during IME composition
        if (!isComposing && enableTriggers) {
          const inputType = (e.nativeEvent as InputEvent).inputType;
          analyzeInput(value, cursorPos, inputType);
          updateAnchorRect();
        }
      },
      [onChange, isComposing, enableTriggers, analyzeInput, updateAnchorRect]
    );

    // Track cursor position changes (click, arrow keys within input)
    const handleSelect = useCallback(
      (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
        const target = e.target as HTMLTextAreaElement;
        const cursorPos = target.selectionStart ?? 0;

        if (cursorPos !== cursorPositionRef.current) {
          cursorPositionRef.current = cursorPos;
          // Re-analyze when cursor moves (might exit trigger range)
          if (enableTriggers && !isComposing) {
            analyzeInput(target.value, cursorPos);
          }
        }
      },
      [enableTriggers, isComposing, analyzeInput]
    );

    return (
      <div className="relative">
        <SearchInput
          ref={textareaRef}
          {...props}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onSelect={handleSelect}
        />
        {triggerState.isActive && anchorRect && !disableDropdown && (
          <TriggerDropdown
            isOpen={true}
            config={triggerState.handler!.config}
            results={triggerState.results}
            selectedIndex={triggerState.selectedIndex}
            isLoading={triggerState.isLoading}
            error={triggerState.error}
            onSelectIndex={setSelectedIndex}
            onActivate={handleSelectResult}
            onClose={closeTrigger}
            anchorRect={anchorRect}
          />
        )}
      </div>
    );
  }
);

TriggerSearchInput.displayName = "TriggerSearchInput";
