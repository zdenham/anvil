import { useState, useCallback, useEffect, useRef } from "react";
import { HelpCircle, CheckCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NormalizedQuestion } from "@core/types/ask-user-question.js";
import { OptionItem } from "./option-item";
import { useQuestionKeyboard } from "./use-question-keyboard";

interface QuestionCarouselProps {
  id: string;
  questions: NormalizedQuestion[];
  status: "pending" | "answered";
  result?: Record<string, string>;
  onSubmitAll: (answers: Record<string, string>) => void;
}

/**
 * Carousel for 1-4 questions with dot navigation.
 * Auto-advances on answer, auto-submits when all answered.
 */
export function QuestionCarousel({
  id,
  questions,
  status,
  result,
  onSubmitAll,
}: QuestionCarouselProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isPending = status === "pending";
  const current = questions[currentIndex];

  // Auto-focus on mount when pending
  useEffect(() => {
    if (isPending) containerRef.current?.focus();
  }, [isPending, currentIndex]);

  const advanceToNextUnanswered = useCallback(
    (currentAnswers: Record<string, string>) => {
      // Check if all answered — submit
      const nowAllAnswered = questions.every(
        (q) => currentAnswers[q.question] !== undefined,
      );
      if (nowAllAnswered) {
        setIsSubmitting(true);
        onSubmitAll(currentAnswers);
        return;
      }
      // Find next unanswered
      for (let i = 1; i <= questions.length; i++) {
        const nextIdx = (currentIndex + i) % questions.length;
        if (currentAnswers[questions[nextIdx].question] === undefined) {
          setCurrentIndex(nextIdx);
          return;
        }
      }
    },
    [currentIndex, questions, onSubmitAll],
  );

  const handleOptionSelect = useCallback(
    (optionLabel: string) => {
      if (!isPending || isSubmitting) return;
      const newAnswers = { ...answers, [current.question]: optionLabel };
      setAnswers(newAnswers);

      if (!current.multiSelect) {
        advanceToNextUnanswered(newAnswers);
      }
    },
    [isPending, isSubmitting, answers, current, advanceToNextUnanswered],
  );

  // Carousel keyboard navigation (left/right arrows)
  useEffect(() => {
    if (!isPending) return;
    const el = containerRef.current;
    if (!el) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrentIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setCurrentIndex((i) => Math.min(questions.length - 1, i + 1));
      }
    };
    el.addEventListener("keydown", handleKey);
    return () => el.removeEventListener("keydown", handleKey);
  }, [isPending, questions.length]);

  // Per-question multi-select state
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Reset selection state when changing questions
  useEffect(() => {
    setSelectedIndices(new Set());
    setFocusedIndex(0);
  }, [currentIndex]);

  const toggleOption = useCallback(
    (index: number) => {
      if (current.multiSelect) {
        setSelectedIndices((prev) => {
          const next = new Set(prev);
          next.has(index) ? next.delete(index) : next.add(index);
          return next;
        });
      } else {
        setSelectedIndices(new Set([index]));
        handleOptionSelect(current.options[index].label);
      }
    },
    [current, handleOptionSelect],
  );

  const handleSubmit = useCallback(
    (indexOrOption?: number | string) => {
      if (current.multiSelect) {
        // Confirm multi-select
        if (selectedIndices.size > 0) {
          const labels = Array.from(selectedIndices)
            .sort((a, b) => a - b)
            .map((i) => current.options[i].label)
            .join(", ");
          const newAnswers = { ...answers, [current.question]: labels };
          setAnswers(newAnswers);
          advanceToNextUnanswered(newAnswers);
        }
      } else if (indexOrOption !== undefined) {
        const label =
          typeof indexOrOption === "number"
            ? current.options[indexOrOption].label
            : indexOrOption;
        handleOptionSelect(label);
      }
    },
    [current, selectedIndices, answers, advanceToNextUnanswered, handleOptionSelect],
  );

  useQuestionKeyboard({
    optionCount: current.options.length,
    focusedIndex,
    setFocusedIndex,
    allowMultiple: current.multiSelect,
    toggleOption,
    selectAll: () => setSelectedIndices(new Set(current.options.map((_, i) => i))),
    deselectAll: () => setSelectedIndices(new Set()),
    submit: handleSubmit,
    enabled: isPending,
  });

  const variant = current.multiSelect ? "checkbox" : "radio";
  const isAnswered = answers[current.question] !== undefined;

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={`Question ${currentIndex + 1} of ${questions.length}`}
      tabIndex={isPending ? 0 : -1}
      className={cn(
        "rounded-lg border p-4",
        isPending
          ? "border-accent-500/50 bg-accent-950/20"
          : "border-zinc-700 bg-zinc-900/50",
      )}
      data-testid={`question-carousel-${id}`}
    >
      {/* Question header */}
      <div className="flex items-start gap-3 mb-4">
        <HelpCircle className="h-5 w-5 text-accent-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          {current.header && (
            <span className="inline-block px-2 py-0.5 mb-2 text-xs font-medium bg-accent-500/20 text-accent-400 rounded">
              {current.header}
            </span>
          )}
          <p className="text-sm text-surface-200 font-medium">{current.question}</p>
        </div>
      </div>

      {/* Options */}
      <div className="space-y-2 ml-8" role="listbox" aria-label="Options">
        {current.options.map((option, index) => (
          <OptionItem
            key={`${currentIndex}-${index}`}
            index={index}
            label={option.label}
            description={option.description}
            isSelected={
              isAnswered
                ? answers[current.question]
                    .split(", ")
                    .includes(option.label)
                : selectedIndices.has(index)
            }
            isFocused={focusedIndex === index}
            variant={variant}
            disabled={!isPending}
            onActivate={() => toggleOption(index)}
          />
        ))}
      </div>

      {/* Dot navigation */}
      <div className="flex items-center justify-center gap-2 mt-3 pt-3 border-t border-surface-700 ml-8">
        <button
          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          disabled={currentIndex === 0}
          className="p-0.5 text-surface-400 hover:text-surface-200 disabled:opacity-30"
          aria-label="Previous question"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        {questions.map((q, i) => {
          const answered = answers[q.question] !== undefined;
          return (
            <button
              key={i}
              onClick={() => setCurrentIndex(i)}
              className={cn(
                "h-2 w-2 rounded-full transition-colors",
                i === currentIndex
                  ? "bg-accent-400"
                  : answered
                    ? "bg-green-400"
                    : "bg-surface-600",
              )}
              aria-label={`Question ${i + 1}${answered ? " (answered)" : ""}`}
            />
          );
        })}

        <button
          onClick={() =>
            setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))
          }
          disabled={currentIndex === questions.length - 1}
          className="p-0.5 text-surface-400 hover:text-surface-200 disabled:opacity-30"
          aria-label="Next question"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Keyboard hints */}
      {isPending && (
        <div className="flex items-center justify-between text-xs text-surface-400 mt-2 ml-8">
          <span>
            <kbd className="px-1 bg-surface-700 rounded">&larr;</kbd>{" "}
            <kbd className="px-1 bg-surface-700 rounded">&rarr;</kbd> Navigate
          </span>
          {current.multiSelect ? (
            <span>
              Submit ({selectedIndices.size}){" "}
              <kbd className="px-1 bg-surface-700 rounded">Enter</kbd>
            </span>
          ) : (
            <span>
              Press 1-{Math.min(current.options.length, 9)} or{" "}
              <kbd className="px-1 bg-surface-700 rounded">Enter</kbd>
            </span>
          )}
        </div>
      )}

      {/* Answered summary */}
      {status === "answered" && result && (
        <div className="mt-3 pt-3 border-t border-surface-700 ml-8 space-y-1">
          {Object.entries(result).map(([q, a]) => (
            <div key={q} className="flex items-center gap-2">
              <CheckCircle className="h-3.5 w-3.5 text-green-400 shrink-0" />
              <span className="text-xs text-surface-400 truncate">{q}:</span>
              <span className="text-xs text-green-300">{a}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
