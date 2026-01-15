# Phase 4: Testing

## Dependencies
- **Depends on:** All previous phases
  - `01-core-components.md` (components to test)
  - `02-agent-handler.md` (service functions to mock)
  - `03-ui-integration.md` (integration points to test)
- **Blocks:** None (final phase)

## Scope

Create comprehensive unit and integration tests for the AskUserQuestionBlock component and its integration with the message rendering pipeline.

## Files to Create

| File | Action | Purpose |
|------|--------|---------|
| `src/components/thread/ask-user-question-block.ui.test.tsx` | **Create new file** | Unit tests |
| `src/components/thread/ask-user-question-integration.ui.test.tsx` | **Create new file** | Integration tests |

---

## Mock Strategy for Agent Service

The tests need to mock the agent service to avoid actual Tauri invocations. Use `vi.mock` to provide a mock implementation.

### Agent Service Mock Setup

```typescript
// At the top of test files that need to mock the agent service
import { vi } from "vitest";

vi.mock("@/services/agent-service", () => ({
  submitToolResult: vi.fn().mockResolvedValue(undefined),
}));

// To access the mock in tests:
import { submitToolResult } from "@/services/agent-service";

// In your test:
it("calls submitToolResult with correct arguments", async () => {
  const mockSubmit = vi.mocked(submitToolResult);
  mockSubmit.mockResolvedValueOnce(undefined);

  // ... trigger the submission

  expect(mockSubmit).toHaveBeenCalledWith(
    "task-123",
    "thread-456",
    "tool-789",
    "Option A",
    "/working/dir"
  );
});

// To simulate an error:
it("handles submission errors gracefully", async () => {
  const mockSubmit = vi.mocked(submitToolResult);
  mockSubmit.mockRejectedValueOnce(new Error("Network error"));

  // ... trigger the submission and verify error handling
});
```

---

## Test File 1: Unit Tests

**File:** `src/components/thread/ask-user-question-block.ui.test.tsx`

**Action:** Create new file at `src/components/thread/ask-user-question-block.ui.test.tsx`

### Full Test Setup

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { AskUserQuestionBlock } from "./ask-user-question-block";

vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// Helper to create default props
const createDefaultProps = (overrides: Partial<Parameters<typeof AskUserQuestionBlock>[0]> = {}) => ({
  id: "test-id",
  question: "Choose one",
  options: ["Option A", "Option B", "Option C"],
  allowMultiple: false,
  status: "pending" as const,
  onSubmit: vi.fn(),
  ...overrides,
});

describe("AskUserQuestionBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test groups below
});
```

---

### Test Group 1: Rendering

```typescript
describe("rendering", () => {
  it("renders question text", () => {
    render(<AskUserQuestionBlock {...createDefaultProps({ question: "What would you like to do?" })} />);

    expect(screen.getByText("What would you like to do?")).toBeInTheDocument();
  });

  it("renders radio buttons for single-select mode", () => {
    render(<AskUserQuestionBlock {...createDefaultProps({ allowMultiple: false })} />);

    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("renders checkboxes for multi-select mode", () => {
    render(<AskUserQuestionBlock {...createDefaultProps({ allowMultiple: true })} />);

    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("shows single-select keyboard hint", () => {
    render(<AskUserQuestionBlock {...createDefaultProps({ options: ["A", "B"] })} />);

    expect(screen.getByText(/Press 1-2/)).toBeInTheDocument();
  });

  it("shows multi-select keyboard hints", () => {
    render(<AskUserQuestionBlock {...createDefaultProps({ allowMultiple: true, options: ["A", "B"] })} />);

    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText(/Submit \(0\)/)).toBeInTheDocument();
  });

  it("hides keyboard hints when answered", () => {
    render(
      <AskUserQuestionBlock
        {...createDefaultProps({
          status: "answered",
          result: "A",
          options: ["A", "B"],
        })}
      />
    );

    expect(screen.queryByText(/Press 1-2/)).not.toBeInTheDocument();
  });
});
```

---

### Test Group 2: Single-Select Behavior

```typescript
describe("single-select behavior", () => {
  it("selects and submits on number key", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...createDefaultProps({ onSubmit })} />);

    fireEvent.keyDown(window, { key: "2" });

    expect(onSubmit).toHaveBeenCalledWith("Option B");
  });

  it("selects and submits on click", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...createDefaultProps({ onSubmit })} />);

    fireEvent.click(screen.getByTestId("option-item-1"));

    expect(onSubmit).toHaveBeenCalledWith("Option B");
  });

  it("navigates with arrow keys and submits on Space", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...createDefaultProps({ onSubmit })} />);

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: " " });

    expect(onSubmit).toHaveBeenCalledWith("Option B");
  });

  it("navigates with vim keys (j/k)", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...createDefaultProps({ onSubmit })} />);

    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "k" });
    fireEvent.keyDown(window, { key: " " });

    expect(onSubmit).toHaveBeenCalledWith("Option B");
  });

  it("clamps navigation at bounds", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...createDefaultProps({ onSubmit })} />);

    // Try to go above first item
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: " " });

    expect(onSubmit).toHaveBeenCalledWith("Option A");
  });

  it("ignores number keys beyond option count", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...createDefaultProps({ onSubmit })} />);

    fireEvent.keyDown(window, { key: "9" });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

---

### Test Group 3: Multi-Select Behavior

```typescript
describe("multi-select behavior", () => {
  const multiSelectProps = createDefaultProps({
    options: ["Option A", "Option B", "Option C", "Option D"],
    allowMultiple: true,
  });

  it("toggles selection without submitting on number key", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...multiSelectProps} onSubmit={onSubmit} />);

    fireEvent.keyDown(window, { key: "1" });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("option-item-0")).toHaveAttribute("aria-checked", "true");
  });

  it("toggles selection off on second press", () => {
    render(<AskUserQuestionBlock {...multiSelectProps} />);

    fireEvent.keyDown(window, { key: "1" });
    expect(screen.getByTestId("option-item-0")).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(window, { key: "1" });
    expect(screen.getByTestId("option-item-0")).toHaveAttribute("aria-checked", "false");
  });

  it("allows multiple selections", () => {
    render(<AskUserQuestionBlock {...multiSelectProps} />);

    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "3" });

    expect(screen.getByTestId("option-item-0")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("option-item-1")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("option-item-2")).toHaveAttribute("aria-checked", "true");
  });

  it("updates selection count in hint", () => {
    render(<AskUserQuestionBlock {...multiSelectProps} />);

    expect(screen.getByText(/Submit \(0\)/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "1" });
    expect(screen.getByText(/Submit \(1\)/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "2" });
    expect(screen.getByText(/Submit \(2\)/)).toBeInTheDocument();
  });

  it("selects all with 'a' key", () => {
    render(<AskUserQuestionBlock {...multiSelectProps} />);

    fireEvent.keyDown(window, { key: "a" });

    expect(screen.getByTestId("option-item-0")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("option-item-1")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("option-item-2")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("option-item-3")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Submit \(4\)/)).toBeInTheDocument();
  });

  it("deselects all with 'n' key", () => {
    render(<AskUserQuestionBlock {...multiSelectProps} />);

    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.keyDown(window, { key: "n" });

    expect(screen.getByTestId("option-item-0")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("option-item-1")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Submit \(0\)/)).toBeInTheDocument();
  });

  it("submits comma-separated values on Enter", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...multiSelectProps} onSubmit={onSubmit} />);

    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith("Option A, Option C");
  });

  it("maintains index order regardless of selection order", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...multiSelectProps} onSubmit={onSubmit} />);

    fireEvent.keyDown(window, { key: "4" });
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith("Option A, Option B, Option D");
  });

  it("does not submit when nothing selected", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...multiSelectProps} onSubmit={onSubmit} />);

    fireEvent.keyDown(window, { key: "Enter" });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("'a' and 'n' keys are ignored in single-select mode", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...createDefaultProps({ onSubmit })} />);

    fireEvent.keyDown(window, { key: "a" });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("option-item-0")).toHaveAttribute("aria-checked", "false");
  });
});
```

---

### Test Group 4: Answered State

```typescript
describe("answered state", () => {
  it("shows result text", () => {
    render(
      <AskUserQuestionBlock
        {...createDefaultProps({
          status: "answered",
          result: "A",
          options: ["A", "B"],
        })}
      />
    );

    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("disables keyboard interaction", () => {
    const onSubmit = vi.fn();
    render(
      <AskUserQuestionBlock
        {...createDefaultProps({
          status: "answered",
          result: "A",
          options: ["A", "B"],
          onSubmit,
        })}
      />
    );

    fireEvent.keyDown(window, { key: "2" });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sets tabIndex to -1", () => {
    render(
      <AskUserQuestionBlock
        {...createDefaultProps({
          status: "answered",
          result: "A",
          options: ["A", "B"],
        })}
      />
    );

    const block = screen.getByTestId("ask-user-question-test-id");
    expect(block).toHaveAttribute("tabindex", "-1");
  });
});
```

---

### Test Group 5: Accessibility

```typescript
describe("accessibility", () => {
  it("has proper ARIA group label", () => {
    render(<AskUserQuestionBlock {...createDefaultProps({ question: "What do you want?" })} />);

    expect(screen.getByRole("group", { name: /What do you want/i })).toBeInTheDocument();
  });

  it("has proper listbox role", () => {
    render(<AskUserQuestionBlock {...createDefaultProps()} />);

    expect(screen.getByRole("listbox", { name: /Options/i })).toBeInTheDocument();
  });

  it("updates aria-checked when selection changes", () => {
    render(<AskUserQuestionBlock {...createDefaultProps({ allowMultiple: true })} />);

    const checkbox = screen.getByTestId("option-item-0");
    expect(checkbox).toHaveAttribute("aria-checked", "false");

    fireEvent.keyDown(window, { key: "1" });
    expect(checkbox).toHaveAttribute("aria-checked", "true");
  });

  it("focused item has tabindex 0, others have -1", () => {
    render(<AskUserQuestionBlock {...createDefaultProps()} />);

    expect(screen.getByTestId("option-item-0")).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("option-item-1")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByTestId("option-item-2")).toHaveAttribute("tabindex", "-1");
  });
});
```

---

### Test Group 6: Edge Cases

```typescript
describe("edge cases", () => {
  it("handles empty options array", () => {
    render(<AskUserQuestionBlock {...createDefaultProps({ question: "No options?", options: [] })} />);

    expect(screen.getByText("No options?")).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("handles single option", () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionBlock {...createDefaultProps({ question: "Confirm?", options: ["Yes"], onSubmit })} />);

    fireEvent.keyDown(window, { key: "1" });
    expect(onSubmit).toHaveBeenCalledWith("Yes");
  });

  it("handles 9 options (max number key support)", () => {
    const options = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
    const onSubmit = vi.fn();

    render(<AskUserQuestionBlock {...createDefaultProps({ options, onSubmit })} />);

    fireEvent.keyDown(window, { key: "9" });
    expect(onSubmit).toHaveBeenCalledWith("I");
  });

  it("handles 10+ options (arrow navigation for 10th+)", () => {
    const options = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

    render(<AskUserQuestionBlock {...createDefaultProps({ options, allowMultiple: true })} />);

    // Navigate to 10th option
    for (let i = 0; i < 9; i++) {
      fireEvent.keyDown(window, { key: "ArrowDown" });
    }
    fireEvent.keyDown(window, { key: " " });

    expect(screen.getByTestId("option-item-9")).toHaveAttribute("aria-checked", "true");
  });

  it("handles very long option text", () => {
    const longOption = "This is a very long option that should be displayed correctly";

    render(<AskUserQuestionBlock {...createDefaultProps({ options: [longOption] })} />);

    expect(screen.getByText(longOption)).toBeInTheDocument();
  });
});
```

---

## Test File 2: Integration Tests

**File:** `src/components/thread/ask-user-question-integration.ui.test.tsx`

**Action:** Create new file at `src/components/thread/ask-user-question-integration.ui.test.tsx`

### Full Test Setup and Implementation

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { AssistantMessage } from "./assistant-message";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutionState } from "@/types/agent";

vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/services/agent-service", () => ({
  submitToolResult: vi.fn().mockResolvedValue(undefined),
}));

// Helper to create tool use messages
const createToolUseMessage = (
  toolName: string,
  toolId: string,
  input: object
): MessageParam => ({
  role: "assistant",
  content: [
    {
      type: "tool_use",
      id: toolId,
      name: toolName,
      input,
    },
  ],
});

describe("AskUserQuestion Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders in AssistantMessage when tool_use is AskUserQuestion", () => {
    const messages: MessageParam[] = [
      { role: "user", content: "Help me decide" },
      createToolUseMessage("AskUserQuestion", "tool-123", {
        question: "Which approach?",
        options: ["Fast", "Thorough"],
      }),
    ];

    const toolStates: Record<string, ToolExecutionState> = {
      "tool-123": { status: "running" },
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
      createToolUseMessage("AskUserQuestion", "tool-456", {
        question: "Pick one",
        options: ["A", "B"],
      }),
    ];

    render(
      <AssistantMessage
        messages={messages}
        messageIndex={1}
        isStreaming={false}
        toolStates={{ "tool-456": { status: "running" } }}
        onToolResponse={onToolResponse}
      />
    );

    fireEvent.click(screen.getByTestId("option-item-0"));

    expect(onToolResponse).toHaveBeenCalledWith("tool-456", "A");
  });

  it("shows answered state after completion", () => {
    const messages: MessageParam[] = [
      { role: "user", content: "Help me" },
      createToolUseMessage("AskUserQuestion", "tool-789", {
        question: "Choose",
        options: ["X", "Y"],
      }),
    ];

    render(
      <AssistantMessage
        messages={messages}
        messageIndex={1}
        isStreaming={false}
        toolStates={{
          "tool-789": {
            status: "complete",
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
      createToolUseMessage("Bash", "tool-999", { command: "ls -la" }),
    ];

    render(
      <AssistantMessage
        messages={messages}
        messageIndex={1}
        isStreaming={false}
        toolStates={{ "tool-999": { status: "running" } }}
      />
    );

    // Should NOT render AskUserQuestionBlock
    expect(screen.queryByTestId("ask-user-question-tool-999")).not.toBeInTheDocument();
  });

  it("handles multi-select mode correctly", () => {
    const onToolResponse = vi.fn();
    const messages: MessageParam[] = [
      { role: "user", content: "Select items" },
      createToolUseMessage("AskUserQuestion", "tool-multi", {
        question: "Select all that apply",
        options: ["Item A", "Item B", "Item C"],
        allow_multiple: true,
      }),
    ];

    render(
      <AssistantMessage
        messages={messages}
        messageIndex={1}
        isStreaming={false}
        toolStates={{ "tool-multi": { status: "running" } }}
        onToolResponse={onToolResponse}
      />
    );

    // Should render checkboxes instead of radios
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);

    // Select multiple and submit
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onToolResponse).toHaveBeenCalledWith("tool-multi", "Item A, Item C");
  });
});
```

---

## Test Commands

```bash
# Verify test directory exists
ls -la src/components/thread/

# Run all UI tests
pnpm test:ui

# Run specific test file
pnpm test:ui src/components/thread/ask-user-question-block.ui.test.tsx

# Run integration tests
pnpm test:ui src/components/thread/ask-user-question-integration.ui.test.tsx

# Run with coverage
pnpm test:ui --coverage

# Watch mode during development
pnpm test:ui --watch
```

---

## Coverage Requirements

- All public component props tested
- Both single-select and multi-select modes covered
- All keyboard shortcuts tested
- Accessibility attributes verified
- Edge cases handled
- Agent service mocked correctly

---

## Verification

```bash
# Verify test files will be created in correct location
ls -la src/components/thread/

# Run all tests
pnpm test:ui

# Ensure no test failures
pnpm test:ui --reporter=verbose

# Check coverage
pnpm test:ui --coverage
```

---

## Exit Criteria

- [ ] `ask-user-question-block.ui.test.tsx` created at `src/components/thread/ask-user-question-block.ui.test.tsx` with all test groups
- [ ] `ask-user-question-integration.ui.test.tsx` created at `src/components/thread/ask-user-question-integration.ui.test.tsx`
- [ ] Agent service properly mocked with `vi.mock`
- [ ] All tests pass (`pnpm test:ui`)
- [ ] No skipped or pending tests
- [ ] Coverage meets project standards
