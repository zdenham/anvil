# AskUserQuestionBlock Implementation Plan

## Consolidated From

This plan consolidates the following plans into a single DRY implementation:
- `plans/ui-elements/ask-user-question.md` - Top-level unified plan with single/multi-select support
- `plans/ui-elements/ask-user-question/README.md` - Decomposition strategy overview
- `plans/ui-elements/ask-user-question/01-core-component.md` - Core component creation
- `plans/ui-elements/ask-user-question/02-ui-integration.md` - UI integration
- `plans/ui-elements/ask-user-question/03-agent-handler.md` - Agent-side handler

The key insight: a single `AskUserQuestionBlock` component with an `allowMultiple` prop handles both radio (single-select) and checkbox (multi-select) modes, sharing keyboard navigation, option rendering, and submission flows.

---

## Overview

Render multiple choice questions from the agent's AskUserQuestion tool with keyboard-friendly selection. Supports both single-select (radio) and multi-select (checkbox) modes via a single unified component.

---

## Tool Input Structure

```typescript
interface AskUserQuestionInput {
  question: string;
  options: string[];
  allow_multiple?: boolean; // Enables multi-select mode
}
```

---

## Visual Design

### Single-Select Mode (Radio)
```
+--------------------------------------------------+
| [?] What would you like to do?                   |
|                                                  |
|  O  First option                            [1]  |
|  *  Second option (selected)                [2]  |
|  O  Third option                            [3]  |
|                                                  |
|  Press 1-3 to select, or arrow keys + Enter      |
+--------------------------------------------------+
```

### Multi-Select Mode (Checkbox)
```
+--------------------------------------------------+
| [?] Select all that apply:                       |
|                                                  |
|  [ ]  Option A                              [1]  |
|  [x]  Option B (selected)                   [2]  |
|  [x]  Option C (selected/focused)           [3]  |
|  [ ]  Option D                              [4]  |
|                                                  |
|  [a] All  [n] None              Submit (2) [->]  |
+--------------------------------------------------+
```

States:
- **Pending:** Blue/accent border, options are interactive
- **Answered:** Green highlight on selected option(s), disabled state

---

## File Structure

```
src/components/thread/
  ask-user-question-block.tsx       # Main component
  option-item.tsx                   # Reusable option row (radio/checkbox)
  use-question-keyboard.ts          # Shared keyboard handling hook
  ask-user-question-block.ui.test.tsx  # Component tests
  ask-user-question-integration.ui.test.tsx  # Integration tests
```

---

## Execution Strategy

```
                    +-------------------+
                    |  Phase 1: Core    |
                    |  Components       |
                    +--------+----------+
                             |
         +-------------------+-------------------+
         |                                       |
         v                                       v
+-------------------+                 +-------------------+
| Phase 2: Agent    |  (parallel)     | Phase 3: UI       |
| Handler           |                 | Integration       |
+--------+----------+                 +--------+----------+
         |                                     |
         +------------------+------------------+
                            |
                            v
                  +---------+---------+
                  | Phase 4: Testing  |
                  | & Verification    |
                  +-------------------+
```

---

## Phase 1: Core Components

### Step 1.1: Create OptionItem Component

**File:** `src/components/thread/option-item.tsx`

A reusable option row that renders as either radio or checkbox based on the `variant` prop.

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

### Step 1.2: Create useQuestionKeyboard Hook

**File:** `src/components/thread/use-question-keyboard.ts`

Shared keyboard handling for both single-select and multi-select modes.

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

### Step 1.3: Create AskUserQuestionBlock Component

**File:** `src/components/thread/ask-user-question-block.tsx`

The main component that uses OptionItem and useQuestionKeyboard to provide a unified experience.

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

## Phase 2: Agent-Side Handler

### Step 2.1: Add submitToolResult to Agent Service

**File:** `src/services/agent-service.ts`

```typescript
import { invoke } from "@tauri-apps/api/core";

/**
 * Submit a tool result to resume agent execution.
 * Used for interactive tools like AskUserQuestion.
 */
export async function submitToolResult(
  taskId: string,
  threadId: string,
  toolId: string,
  response: string,
  workingDirectory: string
): Promise<void> {
  return invoke("submit_tool_result", {
    taskId,
    threadId,
    toolId,
    response,
    workingDirectory,
  });
}
```

### Step 2.2: Agent Runner Tool Result Handling

The agent runner should:
1. Detect AskUserQuestion tool_use blocks
2. Pause execution (wait for user input)
3. Accept tool results via `submitToolResult`
4. Construct proper `tool_result` message per Anthropic API spec
5. Resume agent loop

```typescript
// In agent runner
interface ToolResultMessage {
  role: "user";
  content: [{
    type: "tool_result";
    tool_use_id: string;
    content: string;
  }];
}

/**
 * Construct a proper tool_result message for the Anthropic API.
 */
function createToolResultMessage(toolId: string, response: string): ToolResultMessage {
  return {
    role: "user",
    content: [{
      type: "tool_result",
      tool_use_id: toolId,
      content: response,
    }],
  };
}

/**
 * Called when user responds to an interactive tool like AskUserQuestion.
 */
async submitToolResult(threadId: string, toolId: string, response: string): Promise<void> {
  const toolResultMessage = createToolResultMessage(toolId, response);

  // Append to conversation history
  this.messages.push(toolResultMessage);

  // Update tool state to complete
  this.updateToolState(toolId, {
    status: "complete",
    result: response,
  });

  // Emit state change for UI
  this.emit("toolStateChange", { toolId, status: "complete", result: response });

  // Resume the agent loop
  await this.runAgentLoop();
}
```

---

## Phase 3: UI Integration

### Step 3.1: Update AssistantMessage Component

**File:** `src/components/thread/assistant-message.tsx`

```typescript
import { AskUserQuestionBlock } from "./ask-user-question-block";

// In the switch statement for block.type === "tool_use":
case "tool_use": {
  if (block.name === "AskUserQuestion") {
    const input = block.input as {
      question: string;
      options: string[];
      allow_multiple?: boolean;
    };
    const state = toolStates?.[block.id] ?? { status: "running" as const };

    return (
      <AskUserQuestionBlock
        key={block.id}
        id={block.id}
        question={input.question}
        options={input.options}
        allowMultiple={input.allow_multiple}
        status={state.status === "complete" ? "answered" : "pending"}
        result={state.result}
        onSubmit={(response) => onToolResponse?.(block.id, response)}
      />
    );
  }

  // Default tool rendering...
}
```

### Step 3.2: Add onToolResponse Prop to AssistantMessage

```typescript
interface AssistantMessageProps {
  messages: MessageParam[];
  messageIndex: number;
  isStreaming?: boolean;
  toolStates?: Record<string, ToolExecutionState>;
  /** Callback when user responds to a tool (e.g., AskUserQuestion) */
  onToolResponse?: (toolId: string, response: string) => void;
}
```

### Step 3.3: Thread Response Flow Through ThreadView

**File:** `src/components/thread/thread-view.tsx`

```typescript
interface ThreadViewProps {
  // ... existing props
  onToolResponse?: (toolId: string, response: string) => void;
}

// In ThreadView render, pass to AssistantMessage:
<AssistantMessage
  // ...existing props
  onToolResponse={onToolResponse}
/>
```

### Step 3.4: SimpleTaskWindow Integration

**File:** `src/components/simple-task/simple-task-window.tsx`

```typescript
import { submitToolResult } from "@/services/agent-service";
import { logger } from "@/lib/logger-client";

const handleToolResponse = useCallback(async (toolId: string, response: string) => {
  if (!workingDirectory) {
    logger.error("[SimpleTaskWindow] Cannot respond: no working directory");
    return;
  }

  try {
    await submitToolResult(taskId, threadId, toolId, response, workingDirectory);
  } catch (error) {
    logger.error("[SimpleTaskWindow] Failed to submit tool response", { error, toolId });
    throw error;
  }
}, [taskId, threadId, workingDirectory]);

// Pass to ThreadView:
<ThreadView
  // ...existing props
  onToolResponse={handleToolResponse}
/>
```

---

## Phase 4: Testing

### Test File: `src/components/thread/ask-user-question-block.ui.test.tsx`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { AskUserQuestionBlock } from "./ask-user-question-block";

vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

describe("AskUserQuestionBlock", () => {
  // Tests organized below
});
```

### Test Group 1: Rendering

```typescript
describe("rendering", () => {
  it("renders question text", () => {
    render(
      <AskUserQuestionBlock
        id="test-id"
        question="What would you like to do?"
        options={["Option A", "Option B"]}
        status="pending"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText("What would you like to do?")).toBeInTheDocument();
  });

  it("renders radio buttons for single-select mode", () => {
    render(
      <AskUserQuestionBlock
        id="test-id"
        question="Choose one"
        options={["A", "B", "C"]}
        allowMultiple={false}
        status="pending"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("renders checkboxes for multi-select mode", () => {
    render(
      <AskUserQuestionBlock
        id="test-id"
        question="Choose many"
        options={["A", "B", "C"]}
        allowMultiple={true}
        status="pending"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("shows single-select keyboard hint", () => {
    render(
      <AskUserQuestionBlock
        id="test-id"
        question="Choose"
        options={["A", "B"]}
        allowMultiple={false}
        status="pending"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText(/Press 1-2/)).toBeInTheDocument();
  });

  it("shows multi-select keyboard hints", () => {
    render(
      <AskUserQuestionBlock
        id="test-id"
        question="Choose"
        options={["A", "B"]}
        allowMultiple={true}
        status="pending"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText(/Submit \(0\)/)).toBeInTheDocument();
  });

  it("hides keyboard hints when answered", () => {
    render(
      <AskUserQuestionBlock
        id="test-id"
        question="Choose"
        options={["A", "B"]}
        status="answered"
        result="A"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.queryByText(/Press 1-2/)).not.toBeInTheDocument();
  });
});
```

### Test Group 2: Single-Select Behavior

```typescript
describe("single-select behavior", () => {
  const defaultProps = {
    id: "test-id",
    question: "Choose one",
    options: ["Option A", "Option B", "Option C"],
    allowMultiple: false,
    status: "pending" as const,
    onSubmit: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects and submits on number key", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.keyDown(window, { key: "2" });

    expect(onSubmit).toHaveBeenCalledWith("Option B");
  });

  it("selects and submits on click", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTestId("option-item-1"));

    expect(onSubmit).toHaveBeenCalledWith("Option B");
  });

  it("navigates with arrow keys and submits on Enter", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: " " });

    expect(onSubmit).toHaveBeenCalledWith("Option A");
  });

  it("navigates with vim keys (j/k)", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "k" });
    fireEvent.keyDown(window, { key: " " });

    expect(onSubmit).toHaveBeenCalledWith("Option B");
  });

  it("clamps navigation at bounds", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...defaultProps} onSubmit={onSubmit} />);

    // Try to go above first item
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: " " });

    expect(onSubmit).toHaveBeenCalledWith("Option A");
  });

  it("ignores number keys beyond option count", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.keyDown(window, { key: "9" });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

### Test Group 3: Multi-Select Behavior

```typescript
describe("multi-select behavior", () => {
  const defaultProps = {
    id: "test-id",
    question: "Select all that apply",
    options: ["Option A", "Option B", "Option C", "Option D"],
    allowMultiple: true,
    status: "pending" as const,
    onSubmit: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toggles selection without submitting on number key", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.keyDown(window, { key: "1" });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("option-item-0")).toHaveAttribute("aria-checked", "true");
  });

  it("toggles selection off on second press", () => {
    render(<AskUserQuestionBlock {...defaultProps} />);

    fireEvent.keyDown(window, { key: "1" });
    expect(screen.getByTestId("option-item-0")).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(window, { key: "1" });
    expect(screen.getByTestId("option-item-0")).toHaveAttribute("aria-checked", "false");
  });

  it("allows multiple selections", () => {
    render(<AskUserQuestionBlock {...defaultProps} />);

    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "3" });

    expect(screen.getByTestId("option-item-0")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("option-item-1")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("option-item-2")).toHaveAttribute("aria-checked", "true");
  });

  it("updates selection count in hint", () => {
    render(<AskUserQuestionBlock {...defaultProps} />);

    expect(screen.getByText(/Submit \(0\)/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "1" });
    expect(screen.getByText(/Submit \(1\)/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "2" });
    expect(screen.getByText(/Submit \(2\)/)).toBeInTheDocument();
  });

  it("selects all with 'a' key", () => {
    render(<AskUserQuestionBlock {...defaultProps} />);

    fireEvent.keyDown(window, { key: "a" });

    expect(screen.getByTestId("option-item-0")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("option-item-1")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("option-item-2")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("option-item-3")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Submit \(4\)/)).toBeInTheDocument();
  });

  it("deselects all with 'n' key", () => {
    render(<AskUserQuestionBlock {...defaultProps} />);

    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.keyDown(window, { key: "n" });

    expect(screen.getByTestId("option-item-0")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("option-item-1")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Submit \(0\)/)).toBeInTheDocument();
  });

  it("submits comma-separated values on Enter", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith("Option A, Option C");
  });

  it("maintains index order regardless of selection order", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.keyDown(window, { key: "4" });
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith("Option A, Option B, Option D");
  });

  it("does not submit when nothing selected", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.keyDown(window, { key: "Enter" });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("'a' and 'n' keys are ignored in single-select mode", () => {
    const onSubmit = vi.fn();
    render(
      <AskUserQuestionBlock
        {...defaultProps}
        allowMultiple={false}
        onSubmit={onSubmit}
      />
    );

    fireEvent.keyDown(window, { key: "a" });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("option-item-0")).toHaveAttribute("aria-checked", "false");
  });
});
```

### Test Group 4: Answered State

```typescript
describe("answered state", () => {
  it("shows result text", () => {
    render(
      <AskUserQuestionBlock
        id="test-id"
        question="Choose"
        options={["A", "B"]}
        status="answered"
        result="A"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("disables keyboard interaction", () => {
    const onSubmit = vi.fn();
    render(
      <AskUserQuestionBlock
        id="test-id"
        question="Choose"
        options={["A", "B"]}
        status="answered"
        result="A"
        onSubmit={onSubmit}
      />
    );

    fireEvent.keyDown(window, { key: "2" });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sets tabIndex to -1", () => {
    render(
      <AskUserQuestionBlock
        id="test-id"
        question="Choose"
        options={["A", "B"]}
        status="answered"
        result="A"
        onSubmit={vi.fn()}
      />
    );

    const block = screen.getByTestId("ask-user-question-test-id");
    expect(block).toHaveAttribute("tabindex", "-1");
  });
});
```

### Test Group 5: Accessibility

```typescript
describe("accessibility", () => {
  it("has proper ARIA group label", () => {
    render(
      <AskUserQuestionBlock
        id="test-id"
        question="What do you want?"
        options={["A", "B"]}
        status="pending"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("group", { name: /What do you want/i })).toBeInTheDocument();
  });

  it("has proper listbox role", () => {
    render(
      <AskUserQuestionBlock
        id="test-id"
        question="Choose"
        options={["A", "B"]}
        status="pending"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("listbox", { name: /Options/i })).toBeInTheDocument();
  });

  it("updates aria-checked when selection changes", () => {
    render(
      <AskUserQuestionBlock
        id="test-id"
        question="Pick"
        options={["A", "B"]}
        allowMultiple={true}
        status="pending"
        onSubmit={vi.fn()}
      />
    );

    const checkbox = screen.getByTestId("option-item-0");
    expect(checkbox).toHaveAttribute("aria-checked", "false");

    fireEvent.keyDown(window, { key: "1" });
    expect(checkbox).toHaveAttribute("aria-checked", "true");
  });

  it("focused item has tabindex 0, others have -1", () => {
    render(
      <AskUserQuestionBlock
        id="test-id"
        question="Pick"
        options={["A", "B", "C"]}
        status="pending"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByTestId("option-item-0")).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("option-item-1")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByTestId("option-item-2")).toHaveAttribute("tabindex", "-1");
  });
});
```

### Test Group 6: Edge Cases

```typescript
describe("edge cases", () => {
  it("handles empty options array", () => {
    render(
      <AskUserQuestionBlock
        id="empty"
        question="No options?"
        options={[]}
        status="pending"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText("No options?")).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("handles single option", () => {
    const onSubmit = vi.fn();
    render(
      <AskUserQuestionBlock
        id="single"
        question="Confirm?"
        options={["Yes"]}
        status="pending"
        onSubmit={onSubmit}
      />
    );

    fireEvent.keyDown(window, { key: "1" });
    expect(onSubmit).toHaveBeenCalledWith("Yes");
  });

  it("handles 9 options (max number key support)", () => {
    const options = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
    const onSubmit = vi.fn();

    render(
      <AskUserQuestionBlock
        id="nine"
        question="Pick one"
        options={options}
        status="pending"
        onSubmit={onSubmit}
      />
    );

    fireEvent.keyDown(window, { key: "9" });
    expect(onSubmit).toHaveBeenCalledWith("I");
  });

  it("handles 10+ options (arrow navigation for 10th+)", () => {
    const options = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

    render(
      <AskUserQuestionBlock
        id="ten"
        question="Pick"
        options={options}
        allowMultiple={true}
        status="pending"
        onSubmit={vi.fn()}
      />
    );

    // Navigate to 10th option
    for (let i = 0; i < 9; i++) {
      fireEvent.keyDown(window, { key: "ArrowDown" });
    }
    fireEvent.keyDown(window, { key: " " });

    expect(screen.getByTestId("option-item-9")).toHaveAttribute("aria-checked", "true");
  });

  it("handles very long option text", () => {
    const longOption = "This is a very long option that should be displayed correctly";

    render(
      <AskUserQuestionBlock
        id="long"
        question="Pick"
        options={[longOption]}
        status="pending"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText(longOption)).toBeInTheDocument();
  });
});
```

### Integration Tests

**File:** `src/components/thread/ask-user-question-integration.ui.test.tsx`

```typescript
describe("AskUserQuestion Integration", () => {
  it("renders in AssistantMessage when tool_use is AskUserQuestion", () => {
    const messages: MessageParam[] = [
      { role: "user", content: "Help me decide" },
      {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "tool-123",
          name: "AskUserQuestion",
          input: {
            question: "Which approach?",
            options: ["Fast", "Thorough"],
          },
        }],
      },
    ];

    const toolStates = {
      "tool-123": { status: "running" as const },
    };

    render(
      <AssistantMessage
        messages={messages}
        messageIndex={1}
        isStreaming={false}
        toolStates={toolStates}
      />
    );

    expect(screen.getByText("Which approach?")).toBeInTheDocument();
    expect(screen.getByText("Fast")).toBeInTheDocument();
    expect(screen.getByText("Thorough")).toBeInTheDocument();
  });

  it("passes onToolResponse callback through to component", () => {
    const onToolResponse = vi.fn();
    const messages: MessageParam[] = [
      { role: "user", content: "Help me" },
      {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "tool-456",
          name: "AskUserQuestion",
          input: {
            question: "Pick one",
            options: ["A", "B"],
          },
        }],
      },
    ];

    render(
      <AssistantMessage
        messages={messages}
        messageIndex={1}
        isStreaming={false}
        toolStates={{ "tool-456": { status: "running" as const } }}
        onToolResponse={onToolResponse}
      />
    );

    fireEvent.click(screen.getByTestId("option-item-0"));

    expect(onToolResponse).toHaveBeenCalledWith("tool-456", "A");
  });

  it("shows answered state after completion", () => {
    const messages: MessageParam[] = [
      { role: "user", content: "Help me" },
      {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "tool-789",
          name: "AskUserQuestion",
          input: {
            question: "Choose",
            options: ["X", "Y"],
          },
        }],
      },
    ];

    render(
      <AssistantMessage
        messages={messages}
        messageIndex={1}
        isStreaming={false}
        toolStates={{
          "tool-789": {
            status: "complete" as const,
            result: "X",
          },
        }}
      />
    );

    const block = screen.getByTestId("ask-user-question-tool-789");
    expect(block).toHaveAttribute("data-status", "answered");
  });

  it("renders regular ToolUseBlock for non-AskUserQuestion tools", () => {
    const messages: MessageParam[] = [
      { role: "user", content: "List files" },
      {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "tool-999",
          name: "Bash",
          input: { command: "ls -la" },
        }],
      },
    ];

    render(
      <AssistantMessage
        messages={messages}
        messageIndex={1}
        isStreaming={false}
        toolStates={{ "tool-999": { status: "running" as const } }}
      />
    );

    // Should NOT render AskUserQuestionBlock
    expect(screen.queryByTestId("ask-user-question-tool-999")).not.toBeInTheDocument();
  });
});
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/components/thread/option-item.tsx` | Create | Reusable option row component (radio/checkbox) |
| `src/components/thread/use-question-keyboard.ts` | Create | Shared keyboard handling hook |
| `src/components/thread/ask-user-question-block.tsx` | Create | Main unified component |
| `src/components/thread/ask-user-question-block.ui.test.tsx` | Create | Unit tests |
| `src/components/thread/ask-user-question-integration.ui.test.tsx` | Create | Integration tests |
| `src/components/thread/assistant-message.tsx` | Modify | Add case for AskUserQuestion tool |
| `src/components/thread/thread-view.tsx` | Modify | Pass onToolResponse prop |
| `src/components/simple-task/simple-task-window.tsx` | Modify | Implement response handler |
| `src/services/agent-service.ts` | Modify | Add submitToolResult function |

---

## Implementation Checklist

- [ ] Create `option-item.tsx` with radio/checkbox variants
- [ ] Create `use-question-keyboard.ts` shared hook
- [ ] Create `ask-user-question-block.tsx` with single/multi-select support
- [ ] Add test IDs and data attributes for testing
- [ ] Create comprehensive unit tests covering both modes
- [ ] Create integration tests
- [ ] Integrate into AssistantMessage
- [ ] Add onToolResponse prop flow through ThreadView
- [ ] Implement response handler in SimpleTaskWindow
- [ ] Add submitToolResult to agent-service
- [ ] Add accessibility attributes (ARIA labels, roles)
- [ ] Verify all tests pass (`pnpm test:ui`)
- [ ] Type check passes (`pnpm tsc --noEmit`)

---

## Dependencies

- lucide-react (HelpCircle, CheckCircle, Circle, Square, CheckSquare icons)
- @/lib/utils (cn utility)

---

## Pattern Compliance

| Pattern | Status | Notes |
|---------|--------|-------|
| **File Size** | OK | Each file under 250 lines |
| **Function Size** | OK | All functions under 50 lines |
| **Single Responsibility** | OK | Separated into hook + sub-component + main |
| **DRY** | OK | Single component handles both modes via `allowMultiple` prop |
| **Testing** | OK | Comprehensive UI tests for both modes |
| **Logging** | OK | Uses logger, not console.log |
| **Kebab-case Files** | OK | All files follow convention |
| **TypeScript** | OK | No `any` types, proper interfaces |

---

## Test Commands

```bash
# Run all UI tests
pnpm test:ui

# Run specific test file
pnpm test:ui src/components/thread/ask-user-question-block.ui.test.tsx

# Run with coverage
pnpm test:ui --coverage

# Watch mode
pnpm test:ui --watch
```
