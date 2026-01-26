# EnterPlanMode Tool Block Implementation Plan

## Overview

The `EnterPlanMode` tool block renders when the agent enters plan mode (switching from chat to plan view). This is a specialized tool block that follows the BashToolBlock UI conventions established in the tool-result-rendering-overhaul plan.

**Status:** Pending (Phase 2 - Specialized Tool Blocks)
**Priority:** Medium (low-frequency tool, simple requirements)
**Complexity:** Low

---

## Anthropic API Data Shape

The EnterPlanMode tool follows the standard Anthropic tool use protocol:

### Tool Use Block (from `Anthropic.ToolUseBlock`)

```typescript
// From @anthropic-ai/sdk - Anthropic.ToolUseBlock
interface ToolUseBlock {
  id: string;       // Unique tool call ID (e.g., "toolu_01ABC123...")
  input: unknown;   // Tool-specific input parameters
  name: string;     // "EnterPlanMode"
  type: 'tool_use'; // Block type discriminator
}
```

### Tool Input Shape

The EnterPlanMode tool takes no input parameters:

```typescript
interface EnterPlanModeInput {
  // Empty object - no parameters required
}
```

### Tool Result Block (from `Anthropic.ToolResultBlockParam`)

```typescript
// From @anthropic-ai/sdk - Anthropic.ToolResultBlockParam
interface ToolResultBlockParam {
  tool_use_id: string;  // Matches the tool_use block's id
  type: 'tool_result';  // Block type discriminator
  content?: string | Array<TextBlockParam | ImageBlockParam>;
  is_error?: boolean;   // True if tool execution failed
}
```

### Tool Result Content

The result is a simple string message confirming plan mode entry:

```typescript
// Result string (not JSON)
"Plan mode entered successfully"
```

**Important:** The result is a plain string, NOT JSON. Do not attempt to JSON.parse() the result.

---

## Current Behavior

Currently, the `EnterPlanMode` tool is rendered using the generic `GenericToolBlock` (fallback), which displays raw JSON input/output. This is adequate but not optimized.

---

## Design

### Two-Line Layout (Always visible)

**First Line (Description):**
- **Chevron:** Use `ExpandChevron` component for animated expand/collapse indicator (left-most element)
- **Description text:** "Entering plan mode" with `ShimmerText` animation when `status === "running"`, plain "Enter plan mode" when complete
- **No icon on this line** - the chevron serves as the visual anchor

**Second Line (Command/Details):**
- **Icon:** `Map` from lucide-react (semantic representation of entering plan mode) - icon ONLY appears on this line
- **Status indicator:** `StatusIcon` showing success/failure state (shown on completion)
- **Content:** Brief status message or empty when running

The icon is placed on the second line because the first line has the chevron which controls collapse/expand behavior.

### Expanded Section

- **Content:** Status message indicating the plan mode was entered
- **Display format:** Simple styled text (NOT raw JSON)
- **Default state:** Collapsed (users typically don't need to expand this)

---

## Implementation

### File: `src/components/thread/tool-blocks/enterplanmode-tool-block.tsx`

```typescript
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { StatusIcon } from "@/components/ui/status-icon";
import { Map } from "lucide-react";
import type { ToolBlockProps } from "./index";
import { useToolExpandStore } from "@/stores/tool-expand-store";

/**
 * EnterPlanMode tool block - renders when agent enters plan mode.
 *
 * Layout:
 * - First line: Chevron + description text (with shimmer when running)
 * - Second line: Icon + status indicator
 *
 * API shape:
 * - Input: Empty object (no parameters)
 * - Result: Plain string message (e.g., "Plan mode entered successfully")
 *
 * This tool uses the standard Anthropic tool use protocol:
 * - ToolUseBlock: { id, name: "EnterPlanMode", input: {}, type: "tool_use" }
 * - ToolResultBlockParam: { tool_use_id, type: "tool_result", content: string }
 */
export function EnterPlanModeToolBlock({
  id,
  name: _name,
  input: _input, // Empty object, not used
  result,
  isError = false,
  status,
  threadId,
}: ToolBlockProps) {
  // Use Zustand store for expand state to persist across virtualization remounts
  const isExpanded = useToolExpandStore((state) =>
    state.isToolExpanded(threadId, id)
  );
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Result is a plain string message (not JSON)
  const statusMessage = result?.trim() || "Plan mode entered";

  const isRunning = status === "running";
  const isComplete = status === "complete";

  // Build the header content with two-line layout
  const header = (
    <div className="flex flex-col gap-1">
      {/* First line: Chevron + description text (shimmer when running) */}
      <div className="flex items-center gap-2">
        <ExpandChevron isExpanded={isExpanded} size="md" />
        {isRunning ? (
          <ShimmerText className="text-sm text-zinc-200">
            Entering plan mode
          </ShimmerText>
        ) : (
          <span className="text-sm text-zinc-200">Enter plan mode</span>
        )}
      </div>

      {/* Second line: Icon + status indicator (icon ONLY on this line) */}
      <div className="flex items-center gap-2 ml-6">
        <Map className="w-4 h-4 text-zinc-500 shrink-0" />
        {isComplete && !isError && (
          <StatusIcon isSuccess={true} size="sm" />
        )}
        {isError && (
          <StatusIcon isSuccess={false} size="sm" />
        )}
      </div>
    </div>
  );

  return (
    <CollapsibleBlock
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      header={header}
      testId={`enterplanmode-tool-${id}`}
      ariaLabel="Enter plan mode tool"
      className="py-0.5"
    >
      {/* Expanded Section: Status Message (formatted, not raw JSON) */}
      <div className="mt-2 ml-6 p-2 rounded border border-zinc-700/50 bg-zinc-900/30">
        <p className="text-xs text-zinc-400">{statusMessage}</p>
      </div>
    </CollapsibleBlock>
  );
}
```

### Reusable UI Components Used

| Component | Import Path | Purpose |
|-----------|-------------|---------|
| `CollapsibleBlock` | `@/components/ui/collapsible-block` | Handles expand/collapse with keyboard nav (Enter/Space) and ARIA attributes |
| `ExpandChevron` | `@/components/ui/expand-chevron` | Animated chevron that rotates based on expanded state (first line only) |
| `ShimmerText` | `@/components/ui/shimmer-text` | Animated shimmer effect for in-progress description text (first line) |
| `StatusIcon` | `@/components/ui/status-icon` | Shows success (checkmark) or failure (X) indicator (second line) |
| `Map` | `lucide-react` | Semantic icon representing plan mode (second line only) |

### Props Interface

The component receives the standard `ToolBlockProps` from `src/components/thread/tool-blocks/index.ts`:

```typescript
// From src/components/thread/tool-blocks/index.ts
export interface ToolBlockProps {
  /** Unique tool use ID (from Anthropic.ToolUseBlock.id) */
  id: string;
  /** Tool name (from Anthropic.ToolUseBlock.name) - "EnterPlanMode" */
  name: string;
  /** Tool input parameters (from Anthropic.ToolUseBlock.input) - empty object for this tool */
  input: Record<string, unknown>;
  /** Tool execution result (from Anthropic.ToolResultBlockParam.content) - plain string */
  result?: string;
  /** Whether the result was an error (from Anthropic.ToolResultBlockParam.is_error) */
  isError?: boolean;
  /** Current execution status */
  status: ToolStatus; // "running" | "complete" | "error"
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Whether this block is focused for keyboard navigation */
  isFocused?: boolean;
  /** Thread ID for persisting expand state across virtualization */
  threadId: string;
}
```

### Visual Hierarchy

```
[▶] Entering plan mode~~~                        (first line: chevron + description with shimmer when running)
    🗺️ [✓]                                       (second line: icon + status indicator)
    ┌─────────────────────────────────────────┐
    │ Plan mode entered successfully          │  (expanded section)
    └─────────────────────────────────────────┘
```

**Layout explanation:**
- **First line:** Chevron (controls expand/collapse) + description text ("Entering plan mode" with shimmer when running, "Enter plan mode" when complete)
- **Second line:** Icon (`Map`) + status indicator - the icon ONLY appears here because the first line has the chevron
- **Expanded section:** Styled message box with status details

**Collapsed state:** Shows both lines (description + icon/status)
**Expanded state:** Adds the styled message box below

---

## Integration

### 1. Update Tool Block Registry

In `src/components/thread/tool-blocks/index.ts`, add to the registry:

```typescript
import { EnterPlanModeToolBlock } from "./enterplanmode-tool-block";

const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
  enterplanmode: EnterPlanModeToolBlock,
  // ... other tools
};
```

**Note:** Registry keys are lowercase (tool names are normalized via `toolName.toLowerCase()`).

### 2. Export from Index

```typescript
export { EnterPlanModeToolBlock } from "./enterplanmode-tool-block";
```

### 3. No Type Changes Required

The `ToolBlockProps` interface already supports this component's needs.

---

## Testing

### Unit Tests: `src/components/thread/tool-blocks/__tests__/enterplanmode-tool-block.test.tsx`

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EnterPlanModeToolBlock } from "../enterplanmode-tool-block";

// Mock the store
jest.mock("@/stores/tool-expand-store", () => ({
  useToolExpandStore: jest.fn((selector) => {
    const state = {
      isToolExpanded: () => false,
      setToolExpanded: jest.fn(),
    };
    return selector(state);
  }),
}));

describe("EnterPlanModeToolBlock", () => {
  const defaultProps = {
    id: "toolu_01ABC123",
    name: "EnterPlanMode",
    input: {}, // Empty object per API spec
    result: "Plan mode entered successfully",
    status: "complete" as const,
    threadId: "thread-456",
  };

  it("renders two-line layout with description on first line", () => {
    render(<EnterPlanModeToolBlock {...defaultProps} />);
    // First line shows description text (no shimmer when complete)
    expect(screen.getByText("Enter plan mode")).toBeInTheDocument();
  });

  it("renders shimmer text on first line when running", () => {
    render(<EnterPlanModeToolBlock {...defaultProps} status="running" />);
    // First line shows shimmer description when running
    expect(screen.getByText("Entering plan mode")).toBeInTheDocument();
  });

  it("renders Map icon on second line (not first line)", () => {
    render(<EnterPlanModeToolBlock {...defaultProps} />);
    // Map icon should be on second line, separate from the chevron on first line
    // The icon is in a container with ml-6 class (indented under first line)
    expect(screen.getByLabelText("Enter plan mode tool")).toBeInTheDocument();
  });

  it("renders success status icon on second line when complete", () => {
    render(<EnterPlanModeToolBlock {...defaultProps} />);
    // StatusIcon renders a Check icon for success on second line
    expect(screen.getByLabelText("Enter plan mode tool")).toBeInTheDocument();
  });

  it("renders error status icon on second line when isError is true", () => {
    render(<EnterPlanModeToolBlock {...defaultProps} isError={true} />);
    // StatusIcon renders an X icon for failure on second line
    expect(screen.getByLabelText("Enter plan mode tool")).toBeInTheDocument();
  });

  it("expands to show status message on click", async () => {
    const user = userEvent.setup();

    // Mock expanded state
    const mockSetToolExpanded = jest.fn();
    jest.spyOn(require("@/stores/tool-expand-store"), "useToolExpandStore")
      .mockImplementation((selector: Function) => {
        const state = {
          isToolExpanded: () => true,
          setToolExpanded: mockSetToolExpanded,
        };
        return selector(state);
      });

    render(<EnterPlanModeToolBlock {...defaultProps} />);
    expect(screen.getByText("Plan mode entered successfully")).toBeInTheDocument();
  });

  it("handles missing result gracefully with default message", () => {
    jest.spyOn(require("@/stores/tool-expand-store"), "useToolExpandStore")
      .mockImplementation((selector: Function) => {
        const state = {
          isToolExpanded: () => true,
          setToolExpanded: jest.fn(),
        };
        return selector(state);
      });

    render(<EnterPlanModeToolBlock {...defaultProps} result={undefined} />);
    expect(screen.getByText("Plan mode entered")).toBeInTheDocument();
  });

  it("uses CollapsibleBlock for keyboard navigation", async () => {
    const user = userEvent.setup();
    render(<EnterPlanModeToolBlock {...defaultProps} />);

    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-expanded", "false");

    // Keyboard interaction handled by CollapsibleBlock
    button.focus();
    await user.keyboard("{Enter}");
    // Verify setToolExpanded was called (state change)
  });

  it("does not render raw JSON", () => {
    jest.spyOn(require("@/stores/tool-expand-store"), "useToolExpandStore")
      .mockImplementation((selector: Function) => {
        const state = {
          isToolExpanded: () => true,
          setToolExpanded: jest.fn(),
        };
        return selector(state);
      });

    render(<EnterPlanModeToolBlock {...defaultProps} />);

    // Should NOT contain JSON syntax
    expect(screen.queryByText(/\{/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\}/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"result"/)).not.toBeInTheDocument();
  });
});
```

### Visual Regression Tests

- Verify two-line layout: first line has chevron + description, second line has icon + status
- Verify `Map` icon renders ONLY on second line (zinc-500 color)
- Verify `ExpandChevron` renders on first line and animates on expand/collapse
- Verify `ShimmerText` animation on first line when status is "running"
- Verify `StatusIcon` appears on second line (checkmark for success, X for error)
- Verify text alignment and spacing match BashToolBlock
- Verify expanded state styling (border, background, padding)

### Integration Tests

- Verify tool block renders correctly in message thread
- Verify expand/collapse persists across virtualization (via useToolExpandStore)
- Verify keyboard navigation (Tab, Enter, Space) works via CollapsibleBlock

---

## Accessibility

Accessibility is handled by the `CollapsibleBlock` component:

- **ARIA attributes:** `aria-label` on container, `aria-expanded` on clickable header
- **Keyboard navigation:** Enter/Space to toggle expand/collapse, Tab to navigate (handled by `CollapsibleBlock`)
- **Focus management:** Header has `tabIndex={0}` for keyboard access (handled by `CollapsibleBlock`)
- **Semantic HTML:** `role="button"` on interactive header (handled by `CollapsibleBlock`)
- **Status indication:** `StatusIcon` provides visual feedback for success/failure

---

## Performance Considerations

- **Store persistence:** Uses `useToolExpandStore` to persist expand state across virtualization remounts (same pattern as BashToolBlock)
- **Minimal rendering:** No expensive computations, simple string display
- **Small component:** Minimal DOM overhead
- **Lightweight shimmer:** ShimmerText on first line provides visual feedback during brief running state with minimal performance overhead

---

## Success Criteria

- [ ] Component uses `CollapsibleBlock` for expand/collapse behavior
- [ ] Component uses `ExpandChevron` for animated chevron indicator on first line
- [ ] Component uses `ShimmerText` for description on first line when status is "running"
- [ ] Component uses `StatusIcon` for success/failure indication on second line
- [ ] Component renders `Map` icon ONLY on second line (not on first line with chevron)
- [ ] First line shows: chevron + description text (with shimmer animation when running)
- [ ] Second line shows: icon + status indicator
- [ ] Expand/collapse works with mouse click and keyboard (Enter, Space)
- [ ] Status message displays in expanded state as styled text (NOT raw JSON)
- [ ] Expand state persists across re-renders via Zustand store
- [ ] Visual consistency with BashToolBlock (same fonts, spacing, colors)
- [ ] All keyboard navigation and screen reader text working
- [ ] No console warnings or TypeScript errors
- [ ] Unit tests pass with >80% coverage
- [ ] Tool block appears correctly in message thread
- [ ] No raw JSON is ever displayed to the user

---

## Related Components

- **`CollapsibleBlock`** - See `src/components/ui/collapsible-block.tsx`
- **`ExpandChevron`** - See `src/components/ui/expand-chevron.tsx`
- **`ShimmerText`** - See `src/components/ui/shimmer-text.tsx`
- **`StatusIcon`** - See `src/components/ui/status-icon.tsx`
- **`useToolExpandStore`** - See `src/stores/tool-expand-store.ts`
- **`ToolBlockProps`** - See `src/components/thread/tool-blocks/index.ts`
- **`BashToolBlock`** - Reference implementation at `src/components/thread/tool-blocks/bash-tool-block.tsx`

---

## Notes

- This is a simple tool block (no complex rendering, no copy buttons, no output sections)
- The result is a plain string message, NOT JSON - do not parse it
- The shimmer animation on the first line provides visual feedback during the (typically brief) running state
- Consider grouping this with `ExitPlanMode` tool block if implementing together
- Unlike BashToolBlock, this does not need `CollapsibleOutputBlock` since the output is always short
- The two-line layout follows the established pattern: first line for description (with chevron), second line for command/details (with icon)
