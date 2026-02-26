import { useState, useCallback, useEffect, useRef } from "react";
import { CheckCircle, ChevronLeft, ChevronRight } from "lucide-react";
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
      const nowAllAnswered = questions.every(
        (q) => currentAnswers[q.question] !== undefined,
      );
      if (nowAllAnswered) {
        setIsSubmitting(true);
        onSubmitAll(currentAnswers);
        return;
      }
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
      className="py-1"
      data-testid={`question-carousel-${id}`}
    >
      {/* Question text with dot navigation */}
      <div className="flex items-center gap-2 mb-1">
        <p className={cn(
          "font-mono text-sm",
          isPending ? "text-accent-400" : "text-surface-400"
        )}>
          {current.question}
        </p>
        {questions.length > 1 && (
          <div className="flex items-center gap-1 ml-auto shrink-0">
            <button
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              disabled={currentIndex === 0}
              className="p-0.5 text-surface-500 hover:text-surface-200 disabled:opacity-30"
              aria-label="Previous question"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            {questions.map((q, i) => {
              const answered = answers[q.question] !== undefined;
              return (
                <button
                  key={i}
                  onClick={() => setCurrentIndex(i)}
                  className={cn(
                    "h-1.5 w-1.5 rounded-full transition-colors",
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
              className="p-0.5 text-surface-500 hover:text-surface-200 disabled:opacity-30"
              aria-label="Next question"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Options */}
      {isPending && (
        <div className="space-y-0" role="listbox" aria-label="Options">
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
      )}

      {/* Keyboard hints for multi-select */}
      {isPending && current.multiSelect && (
        <div className="flex items-center gap-3 text-xs text-surface-500 mt-1 ml-6 font-mono">
          <span>
            <kbd className="text-surface-400">a</kbd> all{" "}
            <kbd className="text-surface-400">n</kbd> none{" "}
            <kbd className="text-surface-400">enter</kbd> submit ({selectedIndices.size})
          </span>
        </div>
      )}

      {/* Answered summary */}
      {status === "answered" && result && (
        <div className="space-y-0.5">
          {Object.entries(result).map(([q, a]) => (
            <div key={q} className="flex items-center gap-1.5 font-mono text-sm">
              <CheckCircle className="h-3.5 w-3.5 text-green-400 shrink-0" />
              <span className="text-surface-500 truncate">{q}:</span>
              <span className="text-green-400">{a}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
