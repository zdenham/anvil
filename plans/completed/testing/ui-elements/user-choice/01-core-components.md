# Phase 1: Core Components

## Dependencies
- **Depends on:** None
- **Blocks:** `02-agent-handler.md`, `03-ui-integration.md`

## Scope

Create the foundational components that will be used by both the UI integration and testing phases.

## Files to Create

| File | Action | Purpose |
|------|--------|---------|
| `src/components/thread/option-item.tsx` | **Create new file** | Reusable option row (radio/checkbox) |
| `src/components/thread/use-question-keyboard.ts` | **Create new file** | Shared keyboard handling hook |
| `src/components/thread/ask-user-question-block.tsx` | **Create new file** | Main unified component |

---

## Step 1.1: Create OptionItem Component

**File:** `src/components/thread/option-item.tsx`

**Action:** Create new file at `src/components/thread/option-item.tsx`

A reusable option row that renders as either radio or checkbox based on the `variant` prop.

### Full Implementation

```typescript
import { Circle, Square, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface OptionItemProps {
  /** 0-based index */
  index: number;
  /** Display label */
  label: string;
  /** Whether this option is selected */
  isSelected: boolean;
  /** Whether this option has keyboard focus */
  isFocused: boolean;
  /** Radio for single-select, checkbox for multi-select */
  variant: "radio" | "checkbox";
  /** Whether interaction is disabled */
  disabled?: boolean;
  /** Called when option is clicked or activated */
  onActivate: () => void;
}

export function OptionItem({
  index,
  label,
  isSelected,
  isFocused,
  variant,
  disabled,
  onActivate,
}: OptionItemProps) {
  const displayNumber = index + 1;

  return (
    <div
      role={variant === "radio" ? "radio" : "checkbox"}
      aria-checked={isSelected}
      tabIndex={isFocused ? 0 : -1}
      data-testid={`option-item-${index}`}
      onClick={disabled ? undefined : onActivate}
      className={cn(
        "flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors rounded-md",
        isFocused && "ring-2 ring-accent-500/50 bg-surface-800",
        isSelected && !isFocused && "bg-accent-500/10",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <SelectionIcon variant={variant} isSelected={isSelected} />
      <span className="flex-1 text-sm text-surface-200">{label}</span>
      <kbd className="px-1.5 py-0.5 text-xs font-mono bg-surface-700 rounded text-surface-400">
        {displayNumber}
      </kbd>
    </div>
  );
}

function SelectionIcon({
  variant,
  isSelected,
}: {
  variant: "radio" | "checkbox";
  isSelected: boolean;
}) {
  if (variant === "radio") {
    return isSelected ? (
      <div className="w-4 h-4 rounded-full bg-accent-500 flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-white" />
      </div>
    ) : (
      <Circle className="w-4 h-4 text-surface-500" />
    );
  }

  return isSelected ? (
    <CheckSquare className="w-4 h-4 text-accent-500" />
  ) : (
    <Square className="w-4 h-4 text-surface-500" />
  );
}
```

---

## Step 1.2: Create useQuestionKeyboard Hook

**File:** `src/components/thread/use-question-keyboard.ts`

**Action:** Create new file at `src/components/thread/use-question-keyboard.ts`

Shared keyboard handling for both single-select and multi-select modes.

### Key Bindings

| Key | Action | Mode |
|-----|--------|------|
| `ArrowDown` / `j` | Move focus down | Both |
| `ArrowUp` / `k` | Move focus up | Both |
| `Space` | Toggle selection (auto-submit in single-select) | Both |
| `Enter` | Submit selection | Both |
| `Escape` | Deselect all | Both |
| `1-9` | Select/toggle option N | Both |
| `a` | Select all | Multi-select only |
| `n` | Deselect all | Multi-select only |

### Full Implementation

```typescript
import { useEffect } from "react";

interface UseQuestionKeyboardOptions {
  /** Number of options available */
  optionCount: number;
  /** Current focused index */
  focusedIndex: number;
  /** Move focus to a new index */
  setFocusedIndex: (index: number) => void;
  /** Whether multiple selection is enabled */
  allowMultiple: boolean;
  /** Toggle selection at index */
  toggleOption: (index: number) => void;
  /** Select all options (multi-select only) */
  selectAll: () => void;
  /** Deselect all options (multi-select only) */
  deselectAll: () => void;
  /** Submit current selection(s) */
  submit: () => void;
  /** Whether keyboard handling is enabled */
  enabled?: boolean;
}

export function useQuestionKeyboard({
  optionCount,
  focusedIndex,
  setFocusedIndex,
  allowMultiple,
  toggleOption,
  selectAll,
  deselectAll,
  submit,
  enabled = true,
}: UseQuestionKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowDown":
        case "j":
          e.preventDefault();
          setFocusedIndex(Math.min(focusedIndex + 1, optionCount - 1));
          return;

        case "ArrowUp":
        case "k":
          e.preventDefault();
          setFocusedIndex(Math.max(focusedIndex - 1, 0));
          return;

        case " ":
          e.preventDefault();
          toggleOption(focusedIndex);
          if (!allowMultiple) submit();
          return;

        case "Enter":
          e.preventDefault();
          submit();
          return;

        case "Escape":
          e.preventDefault();
          deselectAll();
          return;
      }

      // Number keys 1-9
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9 && num <= optionCount) {
        e.preventDefault();
        const index = num - 1;
        toggleOption(index);
        if (!allowMultiple) submit();
        return;
      }

      // Multi-select shortcuts
      if (allowMultiple) {
        if (e.key === "a") {
          e.preventDefault();
          selectAll();
        } else if (e.key === "n") {
          e.preventDefault();
          deselectAll();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    focusedIndex,
    optionCount,
    allowMultiple,
    toggleOption,
    selectAll,
    deselectAll,
    submit,
    setFocusedIndex,
  ]);
}
```

---

## Step 1.3: Create AskUserQuestionBlock Component

**File:** `src/components/thread/ask-user-question-block.tsx`

**Action:** Create new file at `src/components/thread/ask-user-question-block.tsx`

The main component that uses OptionItem and useQuestionKeyboard.

### Key Behaviors

1. **Auto-focus** when status is "pending"
2. **Single-select mode:** Click or number key immediately submits
3. **Multi-select mode:** Toggle selections, submit with Enter
4. **Response format:**
   - Single-select: Just the selected option text
   - Multi-select: Comma-separated list, sorted by index order

### Visual States

| State | Border | Background |
|-------|--------|------------|
| Pending | `border-accent-500/50` | `bg-accent-950/20` |
| Answered | `border-zinc-700` | `bg-zinc-900/50` |

### Full Implementation

```typescript
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
  /** List of options (1-9 supported for keyboard shortcuts) */
  options: string[];
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

  const handleSubmit = useCallback(() => {
    if (isSubmitting || status === "answered" || selectedIndices.size === 0) return;

    setIsSubmitting(true);
    const selectedOptions = Array.from(selectedIndices)
      .sort((a, b) => a - b)
      .map((i) => options[i]);

    const response = allowMultiple
      ? selectedOptions.join(", ")
      : selectedOptions[0];

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
        <p className="text-sm text-surface-200 font-medium">{question}</p>
      </div>

      {/* Options list */}
      <div className="space-y-2 ml-8" role="listbox" aria-label="Options">
        {options.map((option, index) => (
          <OptionItem
            key={index}
            index={index}
            label={option}
            isSelected={selectedIndices.has(index)}
            isFocused={focusedIndex === index}
            variant={variant}
            disabled={!isPending}
            onActivate={() => {
              toggleOption(index);
              if (!allowMultiple) handleSubmit();
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
```

---

## Dependencies

- `lucide-react`: Circle, Square, CheckSquare, HelpCircle, CheckCircle icons
- `@/lib/utils`: cn utility for className merging

---

## Verification

```bash
# Verify parent directory exists
ls -la src/components/thread/

# Type check
pnpm tsc --noEmit

# Ensure files are created
ls -la src/components/thread/option-item.tsx
ls -la src/components/thread/use-question-keyboard.ts
ls -la src/components/thread/ask-user-question-block.tsx
```

---

## Exit Criteria

- [ ] `option-item.tsx` created at `src/components/thread/option-item.tsx` with radio/checkbox variants
- [ ] `use-question-keyboard.ts` created at `src/components/thread/use-question-keyboard.ts` with all key bindings
- [ ] `ask-user-question-block.tsx` created at `src/components/thread/ask-user-question-block.tsx` with single/multi-select support
- [ ] All files pass type checking
- [ ] Files follow kebab-case naming
- [ ] Each file under 250 lines
