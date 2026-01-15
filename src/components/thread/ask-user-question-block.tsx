import { useState, useCallback, useEffect, useRef } from "react";
import { HelpCircle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { OptionItem } from "./option-item";
import { useQuestionKeyboard } from "./use-question-keyboard";

interface AskUserQuestionBlockProps {
  /** Unique tool use ID for submitting response */
  id: string;
  /** The question text to display */
  question: string;
  /** Short header/chip label shown above the question */
  header?: string;
  /** List of options with label and optional description (1-9 supported for keyboard shortcuts) */
  options: Array<{ label: string; description?: string }>;
  /** Enable multi-select mode */
  allowMultiple?: boolean;
  /** Current status: pending (awaiting input) or answered */
  status: "pending" | "answered";
  /** The selected response (set after user answers) */
  result?: string;
  /** Callback when user submits their selection */
  onSubmit: (response: string) => void;
}

export function AskUserQuestionBlock({
  id,
  question,
  header,
  options,
  allowMultiple = false,
  status,
  result,
  onSubmit,
}: AskUserQuestionBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-focus when pending
  useEffect(() => {
    if (status === "pending") {
      containerRef.current?.focus();
    }
  }, [status]);

  const toggleOption = useCallback((index: number) => {
    if (allowMultiple) {
      setSelectedIndices((prev) => {
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        return next;
      });
    } else {
      setSelectedIndices(new Set([index]));
    }
  }, [allowMultiple]);

  const selectAll = useCallback(() => {
    setSelectedIndices(new Set(options.map((_, i) => i)));
  }, [options]);

  const deselectAll = useCallback(() => {
    setSelectedIndices(new Set());
  }, []);

  const handleSubmit = useCallback((indexOrOption?: number | string) => {
    if (isSubmitting || status === "answered") return;

    // For single-select, use the directly passed index/option to avoid async state issues
    if (indexOrOption !== undefined) {
      setIsSubmitting(true);
      // If it's a number, look up the option label; if string, use directly
      const response = typeof indexOrOption === "number"
        ? options[indexOrOption].label
        : indexOrOption;
      onSubmit(response);
      return;
    }

    // For multi-select, use selectedIndices
    if (selectedIndices.size === 0) return;

    setIsSubmitting(true);
    const selectedLabels = Array.from(selectedIndices)
      .sort((a, b) => a - b)
      .map((i) => options[i].label);

    const response = allowMultiple
      ? selectedLabels.join(", ")
      : selectedLabels[0];

    onSubmit(response);
  }, [isSubmitting, status, selectedIndices, options, allowMultiple, onSubmit]);

  useQuestionKeyboard({
    optionCount: options.length,
    focusedIndex,
    setFocusedIndex,
    allowMultiple,
    toggleOption,
    selectAll,
    deselectAll,
    submit: handleSubmit,
    enabled: status === "pending",
  });

  const variant = allowMultiple ? "checkbox" : "radio";
  const isPending = status === "pending";

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={`Question: ${question}`}
      tabIndex={isPending ? 0 : -1}
      className={cn(
        "rounded-lg border p-4",
        isPending
          ? "border-accent-500/50 bg-accent-950/20"
          : "border-zinc-700 bg-zinc-900/50"
      )}
      data-testid={`ask-user-question-${id}`}
      data-status={status}
    >
      {/* Question header */}
      <div className="flex items-start gap-3 mb-4">
        <HelpCircle className="h-5 w-5 text-accent-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          {header && (
            <span className="inline-block px-2 py-0.5 mb-2 text-xs font-medium bg-accent-500/20 text-accent-400 rounded">
              {header}
            </span>
          )}
          <p className="text-sm text-surface-200 font-medium">{question}</p>
        </div>
      </div>

      {/* Options list */}
      <div className="space-y-2 ml-8" role="listbox" aria-label="Options">
        {options.map((option, index) => (
          <OptionItem
            key={index}
            index={index}
            label={option.label}
            description={option.description}
            isSelected={selectedIndices.has(index)}
            isFocused={focusedIndex === index}
            variant={variant}
            disabled={!isPending}
            onActivate={() => {
              toggleOption(index);
              if (!allowMultiple) handleSubmit(option.label);
            }}
          />
        ))}
      </div>

      {/* Keyboard hints */}
      {isPending && (
        <div className="flex items-center justify-between text-xs text-surface-400 mt-3 pt-3 border-t border-surface-700 ml-8">
          {allowMultiple ? (
            <>
              <span>
                <kbd className="px-1 bg-surface-700 rounded">a</kbd> All{" "}
                <kbd className="px-1 bg-surface-700 rounded">n</kbd> None
              </span>
              <span>
                Submit ({selectedIndices.size}){" "}
                <kbd className="px-1 bg-surface-700 rounded">Enter</kbd>
              </span>
            </>
          ) : (
            <span className="ml-auto">
              Press 1-{Math.min(options.length, 9)} or{" "}
              <kbd className="px-1 bg-surface-700 rounded">Enter</kbd>
            </span>
          )}
        </div>
      )}

      {/* Answered state */}
      {status === "answered" && result && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-surface-700 ml-8">
          <CheckCircle className="h-4 w-4 text-green-400" />
          <span className="text-sm text-green-300">{result}</span>
        </div>
      )}
    </div>
  );
}
