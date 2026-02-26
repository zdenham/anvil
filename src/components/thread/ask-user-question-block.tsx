import { useState, useCallback, useEffect, useRef } from "react";
import { CheckCircle } from "lucide-react";
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
      className="py-1"
      data-testid={`ask-user-question-${id}`}
      data-status={status}
    >
      {/* Question text */}
      <p className={cn(
        "font-mono text-sm mb-1",
        isPending ? "text-accent-400" : "text-surface-400"
      )}>
        {question}
      </p>

      {/* Options list */}
      {isPending && (
        <div className="space-y-0" role="listbox" aria-label="Options">
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
      )}

      {/* Keyboard hints */}
      {isPending && allowMultiple && (
        <div className="flex items-center gap-3 text-xs text-surface-500 mt-1 ml-6 font-mono">
          <span>
            <kbd className="text-surface-400">a</kbd> all{" "}
            <kbd className="text-surface-400">n</kbd> none{" "}
            <kbd className="text-surface-400">enter</kbd> submit ({selectedIndices.size})
          </span>
        </div>
      )}

      {/* Answered state */}
      {status === "answered" && result && (
        <div className="flex items-center gap-1.5 font-mono text-sm">
          <CheckCircle className="h-3.5 w-3.5 text-green-400 shrink-0" />
          <span className="text-green-400">{result}</span>
        </div>
      )}
    </div>
  );
}
