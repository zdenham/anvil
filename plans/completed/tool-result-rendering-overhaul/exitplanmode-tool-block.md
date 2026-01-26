# ExitPlanMode Tool Block Implementation Plan

## Overview

The ExitPlanMode tool block is a specialized component for rendering the result of exiting plan mode in a user-friendly way. It follows the BashToolBlock UI conventions established in the Tool Result Rendering Overhaul plan.

This block displays plan exit status and approval information in a clean, minimal interface.

---

## Anthropic API Data Structure

### Tool Use Block (from Anthropic SDK)

The tool call arrives as an `Anthropic.ToolUseBlock` from `@anthropic-ai/sdk/resources/messages`:

```typescript
// From @anthropic-ai/sdk - ContentBlock includes tool_use variant
interface ToolUseBlock {
  type: "tool_use";
  id: string;        // Unique tool call ID (e.g., "toolu_01XFDUDYJgAACzvnptvVoYEL")
  name: string;      // "ExitPlanMode"
  input: object;     // Tool input parameters (see ExitPlanModeInput below)
}
```

### Tool Result (from ToolExecutionState)

The result comes from `ToolExecutionState` defined in `@core/types/events`:

```typescript
// From core/types/events.ts
interface ToolExecutionState {
  status: "running" | "complete" | "error";
  result?: string;     // JSON-stringified result (see ExitPlanModeResult below)
  isError?: boolean;   // True if tool execution failed
  toolName?: string;   // "ExitPlanMode"
}
```

### ExitPlanModeInput

The `input` field from the tool use block:

```typescript
interface ExitPlanModeInput {
  // ExitPlanMode typically has no input parameters
  // The input object is usually empty: {}
}
```

### ExitPlanModeResult

The `result` string from ToolExecutionState, when parsed from JSON:

```typescript
interface ExitPlanModeResult {
  status: "approved" | "rejected" | "pending";
  message?: string;   // Human-readable status message
  details?: {
    planId?: string;      // ID of the plan that was exited
    timestamp?: number;   // When plan mode was exited
  };
}
```

---

## Specification

### First Line (Description Line)
- **Chevron:** `ExpandChevron` component (animated expand/collapse indicator) - controls expand/collapse
- **Text:** "Exit plan mode" wrapped in `ShimmerText` (shimmer effect while running)
- **Status indicator:** `StatusIcon` component for success/error feedback (only when not running)
- **Duration:** Display using `formatDuration` if available
- **Note:** NO icon on this line - the chevron serves as the visual anchor

### Second Line (Details Line)
- **Icon:** `MapPinCheck` from `lucide-react` (small, muted color - `text-zinc-500/60`) - icon ONLY appears here
- **Content:** Approval status text with color coding:
  - Approved: `text-green-400`
  - Rejected: `text-red-400`
  - Pending: `text-zinc-400`
- **Copy button:** Not required (no copyable content)

### Expandable Section
- **Container:** Use `CollapsibleOutputBlock` for consistent styling with gradient overlay
- **Content:** Approval details rendered as formatted text (NOT raw JSON)
- **Display format:**
  - If message exists: Show message text in a styled container
  - If no message: Show "No additional details available"
- **Copy button:** `CopyButton` on message text if present and longer than trivial

---

## Reusable UI Components

All components imported from `@/components/ui/`:

| Component | Import | Purpose | Usage |
|-----------|--------|---------|-------|
| `ExpandChevron` | `@/components/ui/expand-chevron` | Animated chevron for expand/collapse | Header row, toggles `isExpanded` state |
| `ShimmerText` | `@/components/ui/shimmer-text` | Loading animation for text | Header text while `status === "running"` |
| `StatusIcon` | `@/components/ui/status-icon` | Success/failure indicator | After header text when not running |
| `CollapsibleOutputBlock` | `@/components/ui/collapsible-output-block` | Container for expandable content with gradient | Wraps approval details section |
| `CopyButton` | `@/components/ui/copy-button` | Copy-to-clipboard button | For copying approval message (if long) |

### Component Props Reference

```typescript
// First Line Components:

// ExpandChevron - on first line (controls expand/collapse)
<ExpandChevron isExpanded={isExpanded} size="md" />

// ShimmerText - on first line (shimmer animation while running)
<ShimmerText isShimmering={isRunning} className="text-sm text-zinc-200 truncate min-w-0">
  Exit plan mode
</ShimmerText>

// StatusIcon - on first line (only show when not running)
{!isRunning && <StatusIcon isSuccess={!isError && approvalStatus === "approved"} />}

// Second Line Components:

// MapPinCheck icon - ONLY on second line (first line has chevron)
<MapPinCheck className="w-3 h-3 text-zinc-500/60 shrink-0" />

// CollapsibleOutputBlock (for expanded content)
<CollapsibleOutputBlock
  isExpanded={isOutputExpanded}
  onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
  isLongContent={isLongMessage}
  maxCollapsedHeight={200}
  variant={isError ? "error" : "default"}
>
  {/* Formatted content here */}
</CollapsibleOutputBlock>

// CopyButton (for message if present)
<CopyButton text={message} label="Copy message" />
```

---

## Component Architecture

### File Location
`src/components/thread/tool-blocks/exitplanmode-tool-block.tsx`

### Props (ToolBlockProps)

From `src/components/thread/tool-blocks/index.ts`:

```typescript
interface ToolBlockProps {
  /** Unique tool use ID (from Anthropic.ToolUseBlock.id) */
  id: string;
  /** Tool name (from Anthropic.ToolUseBlock.name) - "ExitPlanMode" */
  name: string;
  /** Tool input parameters (from Anthropic.ToolUseBlock.input) */
  input: Record<string, unknown>;
  /** Tool execution result - JSON string (from ToolExecutionState.result) */
  result?: string;
  /** Whether the result was an error (from ToolExecutionState.isError) */
  isError?: boolean;
  /** Current execution status (from ToolExecutionState.status) */
  status: ToolStatus; // "running" | "complete" | "error"
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Whether this block is focused for keyboard navigation */
  isFocused?: boolean;
  /** Thread ID for persisting expand state across virtualization */
  threadId: string;
}
```

### Expand State Management

Use `useToolExpandStore` from `@/stores/tool-expand-store` (same pattern as BashToolBlock):

```typescript
// Persist expand state across virtualization remounts
const isExpanded = useToolExpandStore((state) =>
  state.isToolExpanded(threadId, id)
);
const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
const setIsExpanded = (expanded: boolean) =>
  setToolExpanded(threadId, id, expanded);
```

---

## Implementation

### Step 1: Parse Result (No Raw JSON Display)

Parse the JSON result into a typed structure. Never display raw JSON to users.

```typescript
import type { ToolBlockProps } from "./index";

interface ParsedExitPlanModeResult {
  status: "approved" | "rejected" | "pending";
  message?: string;
  planId?: string;
}

function parseExitPlanModeResult(result: string | undefined): ParsedExitPlanModeResult {
  if (!result) {
    return { status: "pending" };
  }

  try {
    const parsed = JSON.parse(result);
    if (typeof parsed === "object" && parsed !== null) {
      return {
        status: parsed.status ?? "pending",
        message: typeof parsed.message === "string" ? parsed.message : undefined,
        planId: typeof parsed.details?.planId === "string" ? parsed.details.planId : undefined,
      };
    }
  } catch {
    // Fallback: treat plain string as status message
    if (typeof result === "string" && result.trim()) {
      return { status: "approved", message: result.trim() };
    }
  }

  return { status: "pending" };
}
```

### Step 2: Component Implementation

```typescript
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { CopyButton } from "@/components/ui/copy-button";
import { MapPinCheck } from "lucide-react";
import type { ToolBlockProps } from "./index";

const MESSAGE_LENGTH_THRESHOLD = 100; // Characters before showing copy button

export function ExitPlanModeToolBlock({
  id,
  name: _name,
  input: _input,
  result,
  isError = false,
  status,
  durationMs,
  isFocused: _isFocused,
  threadId,
}: ToolBlockProps) {
  // Parse result - never display raw JSON
  const { status: approvalStatus, message, planId } = parseExitPlanModeResult(result);

  // Manage expand state via Zustand store (persists across virtualization)
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  const isRunning = status === "running";
  const hasMessage = !!message && message.length > 0;
  const isLongMessage = hasMessage && message.length > MESSAGE_LENGTH_THRESHOLD;

  return (
    <div
      className="group py-0.5"
      aria-label={`Exit plan mode, status: ${approvalStatus}`}
      data-testid={`exitplanmode-tool-${id}`}
      data-tool-status={status}
    >
      {/* Header Row - Always Visible */}
      <div
        className="cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        {/* First Line - Description with shimmer animation */}
        {/* Chevron controls expand/collapse - NO icon on this line */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            Exit plan mode
          </ShimmerText>

          {/* Status indicator - only show when not running */}
          {!isRunning && (
            <StatusIcon isSuccess={!isError && approvalStatus === "approved"} />
          )}

          {/* Duration - right justified */}
          {durationMs !== undefined && !isRunning && (
            <span className="text-xs text-muted-foreground ml-auto">
              {formatDuration(durationMs)}
            </span>
          )}
        </div>

        {/* Second Line - Details with icon */}
        {/* Icon ONLY appears on this line (chevron is on first line) */}
        <div className="flex items-center gap-1 mt-0.5 ml-5">
          <MapPinCheck className="w-3 h-3 text-zinc-500/60 shrink-0" />
          <span
            className={cn(
              "text-xs truncate",
              approvalStatus === "approved" && "text-green-400",
              approvalStatus === "rejected" && "text-red-400",
              approvalStatus === "pending" && "text-zinc-400"
            )}
          >
            {getApprovalStatusLabel(approvalStatus)}
          </span>
        </div>
      </div>

      {/* Expanded Content - Formatted Display (No Raw JSON) */}
      {isExpanded && (
        <div className="mt-2 ml-6">
          <div className="relative">
            {/* Copy button for long messages */}
            {hasMessage && isLongMessage && (
              <div className="absolute top-1 right-1 z-10">
                <CopyButton text={message} label="Copy message" />
              </div>
            )}

            <div className="rounded border border-zinc-700/50 bg-zinc-900/30 p-3">
              {/* Formatted approval details - NOT raw JSON */}
              <div className="space-y-2">
                {/* Status badge */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">Status:</span>
                  <span
                    className={cn(
                      "text-xs font-medium px-1.5 py-0.5 rounded",
                      approvalStatus === "approved" && "bg-green-500/20 text-green-400",
                      approvalStatus === "rejected" && "bg-red-500/20 text-red-400",
                      approvalStatus === "pending" && "bg-zinc-500/20 text-zinc-400"
                    )}
                  >
                    {approvalStatus.charAt(0).toUpperCase() + approvalStatus.slice(1)}
                  </span>
                </div>

                {/* Plan ID if available */}
                {planId && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">Plan:</span>
                    <span className="text-xs font-mono text-zinc-300">{planId}</span>
                  </div>
                )}

                {/* Message if available */}
                {hasMessage ? (
                  <div className="mt-2">
                    <span className="text-xs text-zinc-500 block mb-1">Details:</span>
                    <p className="text-xs text-zinc-300 whitespace-pre-wrap break-words">
                      {message}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 italic">
                    No additional details available
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        Exit plan mode, approval status: {approvalStatus}
        {isRunning && ", currently running"}
        {isError && ", operation failed"}
      </span>
    </div>
  );
}

/** Format approval status for display */
function getApprovalStatusLabel(status: string): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "pending":
      return "Pending approval";
    default:
      return "Unknown status";
  }
}
```

---

## UI Layout

### Collapsed View
```
[>] Exit plan mode                  [check/x] [1.2s]   <- First line: chevron + description (shimmer when running)
    [MapPinCheck] Approved                             <- Second line: icon + details
```

### Expanded View
```
[v] Exit plan mode                  [check/x] [1.2s]   <- First line: chevron + description
    [MapPinCheck] Approved                             <- Second line: icon + details

    ┌─────────────────────────────────────────┐
    │ Status: [Approved]                      │
    │ Plan: plan_abc123                       │
    │                                         │
    │ Details:                                │
    │ Plan execution completed successfully.  │
    └─────────────────────────────────────────┘
```

---

## Styling Guidelines

### Colors (Match BashToolBlock)
- Icon colors: `text-zinc-500` (primary), `text-zinc-500/60` (secondary)
- Text: `text-zinc-200` (primary), `text-zinc-300` (secondary)
- Status indicators:
  - Approved: `text-green-400`, `bg-green-500/20`
  - Rejected: `text-red-400`, `bg-red-500/20`
  - Pending: `text-zinc-400`, `bg-zinc-500/20`
- Duration/metadata: `text-muted-foreground`

### Spacing
- Vertical padding: `py-0.5` (container)
- Gap between elements: `gap-2` (first line), `gap-1` (second line)
- Second line margin: `mt-0.5 ml-5` (aligns with description text on first line, after chevron)
- Expanded section margin: `mt-2 ml-6`

### Typography
- Primary text: `text-sm`
- Secondary text: `text-xs`
- Monospace for IDs: `font-mono`

---

## Integration

### Tool Block Registry

Update `src/components/thread/tool-blocks/index.ts`:

```typescript
import { BashToolBlock } from "./bash-tool-block";
import { ExitPlanModeToolBlock } from "./exitplanmode-tool-block";

const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
  exitplanmode: ExitPlanModeToolBlock,  // Note: lowercase key for matching
};

export { BashToolBlock, ExitPlanModeToolBlock };
```

---

## Testing Checklist

### Component Rendering
- [ ] Collapsed view renders header with icon, text, status, duration
- [ ] Secondary line shows approval status with correct color
- [ ] Expanded view shows formatted details (not raw JSON)
- [ ] All reusable UI components render correctly

### Interactions
- [ ] Click to expand/collapse works
- [ ] Keyboard navigation (Enter/Space) works
- [ ] Expand state persists across virtualization remounts
- [ ] Copy button works for long messages

### States
- [ ] Running state shows shimmer effect on header text
- [ ] Error state shows red X via StatusIcon
- [ ] Success state shows green check via StatusIcon
- [ ] Approval status colors are correct

### Edge Cases
- [ ] Result is undefined (shows "Pending approval")
- [ ] Result is invalid JSON (falls back gracefully)
- [ ] Result is plain string (treats as message)
- [ ] Message is very long (shows copy button)
- [ ] No message field (shows "No additional details")

### Accessibility
- [ ] Screen reader announces tool name and status
- [ ] Keyboard navigation works (Tab, Enter, Space)
- [ ] ARIA labels are correct (`aria-expanded`, `aria-label`)
- [ ] Focus states are visible

---

## Related Files

- **Main plan:** `/Users/zac/Documents/juice/mort/mortician/plans/tool-result-rendering-overhaul.md`
- **BashToolBlock reference:** `/Users/zac/Documents/juice/mort/mortician/src/components/thread/tool-blocks/bash-tool-block.tsx`
- **Reusable UI components:** `/Users/zac/Documents/juice/mort/mortician/src/components/ui/`
  - `shimmer-text.tsx` - Loading animation
  - `expand-chevron.tsx` - Animated expand/collapse chevron
  - `status-icon.tsx` - Success/failure indicator
  - `collapsible-output-block.tsx` - Container for long content
  - `copy-button.tsx` - Copy-to-clipboard
- **Expand store:** `/Users/zac/Documents/juice/mort/mortician/src/stores/tool-expand-store.ts`
- **Type definitions:**
  - `ToolBlockProps` - `/Users/zac/Documents/juice/mort/mortician/src/components/thread/tool-blocks/index.ts`
  - `ToolExecutionState` - `/Users/zac/Documents/juice/mort/mortician/core/types/events.ts`
  - Anthropic types - `@anthropic-ai/sdk/resources/messages` (ContentBlock, ToolUseBlock)

---

## Notes

1. **Two-Line Layout:** The first line displays the description text ("Exit plan mode") with shimmer animation during in-progress state, while the second line shows the command/details with the icon. The chevron on the first line controls expand/collapse, so no icon is needed there.

2. **Icon Placement:** The `MapPinCheck` icon appears ONLY on the second line. The first line uses the `ExpandChevron` as its visual anchor, which also serves as the expand/collapse control.

3. **No Raw JSON Display:** The expanded section displays formatted, human-readable content. Raw JSON is parsed and displayed with proper labels and styling.

4. **Reusable Components:** Uses `ExpandChevron`, `ShimmerText`, `StatusIcon`, `CollapsibleOutputBlock`, and `CopyButton` from `@/components/ui/` for consistency with BashToolBlock.

5. **Anthropic API Alignment:** Props match the data flow from `Anthropic.ToolUseBlock` (input) through `ToolExecutionState` (result), ensuring type safety.

6. **Minimal UI:** ExitPlanMode is intentionally simple - it's a status confirmation, not a complex tool result. The expanded section provides context without overwhelming detail.

7. **Copy Button:** Only shown for messages longer than 100 characters. Short status messages don't need copying.

8. **Accessibility:** Full keyboard navigation and screen reader support following BashToolBlock patterns.
