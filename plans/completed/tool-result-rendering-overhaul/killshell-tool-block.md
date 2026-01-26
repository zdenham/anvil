# KillShell Tool Block Implementation Plan

## Overview

Implement a specialized `KillShellToolBlock` component that renders background shell termination operations. The KillShell tool is used to terminate background shell processes started with `run_in_background: true` in Bash tool calls. This block follows the BashToolBlock UI conventions established in Phase 1 of the Tool Result Rendering Overhaul and uses reusable UI components from `src/components/ui/`.

## Anthropic API Types Reference

The KillShell tool uses standard Anthropic tool call/result types from `@anthropic-ai/sdk`:

**Tool Use (Input) - `Anthropic.ToolUseBlock`:**
```typescript
// From @anthropic-ai/sdk/resources/messages
interface ToolUseBlock {
  id: string;           // Unique tool use ID (e.g., "toolu_01ABC...")
  input: unknown;       // Tool-specific input object
  name: string;         // "KillShell" for this tool
  type: 'tool_use';
}
```

**Tool Result (Output) - `Anthropic.ToolResultBlockParam`:**
```typescript
// From @anthropic-ai/sdk/resources/messages
interface ToolResultBlockParam {
  tool_use_id: string;                              // References the ToolUseBlock.id
  type: 'tool_result';
  content?: string | Array<TextBlockParam | ImageBlockParam>;  // Result content
  is_error?: boolean;                               // True if tool execution failed
  cache_control?: CacheControlEphemeral | null;
}
```

**KillShell Tool Input Shape (Claude Code specific):**
```typescript
interface KillShellInput {
  shell_id: string;  // The ID of the background shell to terminate
}
```

**KillShell Tool Result Shape:**
The `result` string in `ToolBlockProps` is a plain text message. Unlike Bash which returns structured JSON with stdout/stderr, the KillShell tool returns:
- **Success:** Plain text success message: `"Successfully terminated shell {shell_id}"`
- **Error:** Plain text error message: `"Failed to terminate shell {shell_id}: {reason}"`

The `isError` boolean in `ToolBlockProps` indicates whether the termination failed.

---

## Component Specification

### Layout Structure

Following the BashToolBlock UI pattern, the KillShellToolBlock has three main sections:

1. **First Line (Description)** - always visible, clickable for expand/collapse
   - `ExpandChevron` component (from `@/components/ui/expand-chevron`) - controls collapse/expand
   - Description text: "Kill shell" wrapped in `ShimmerText` (animates while running)
   - `StatusIcon` component (success/failure indicator, shown when not running)
   - Duration (right-aligned, shown when complete)
   - **NOTE:** No icon on this line - the chevron serves as the visual anchor

2. **Second Line (Command/Details)** - always visible
   - Icon: `XCircle` from lucide-react (red-colored to indicate termination action)
   - Content: Shell ID displayed as monospace text (NOT raw JSON)
   - `CopyButton` component for copying the Shell ID
   - **NOTE:** The icon appears here on the command line, not on the first line

3. **Expandable Result Section** (visible when expanded and has result)
   - Success message: Green-tinted box with success text
   - Error message: Red-tinted box with error text
   - Uses plain text display (no raw JSON)

### Example Layout

**Collapsed (running):**
```
> Kill shell ~~~                                         <- First line: chevron + description with shimmer
  XCircle toolu_01ABC123def456...            [copy]      <- Second line: icon + shell ID
```

**Collapsed (complete, success):**
```
> Kill shell                                 [check] [0.3s]   <- First line: chevron + description + status + duration
  XCircle toolu_01ABC123def456...            [copy]           <- Second line: icon + shell ID
```

**Expanded (complete, success):**
```
v Kill shell                                 [check] [0.3s]   <- First line: chevron + description + status + duration
  XCircle toolu_01ABC123def456...            [copy]           <- Second line: icon + shell ID

  +------------------------------------------+
  | Successfully terminated shell toolu_01... |
  +------------------------------------------+
```

**Expanded (complete, error):**
```
v Kill shell                                     [X] [0.5s]   <- First line: chevron + description + status + duration
  XCircle toolu_01ABC123def456...            [copy]           <- Second line: icon + shell ID

  +------------------------------------------+
  | Failed to terminate shell: Shell not     |
  | found or already terminated              |
  +------------------------------------------+
```

**Key Layout Principles:**
- First line has the chevron (for collapse/expand control) and description text with shimmer animation when running
- Second line has the icon (XCircle) and the command details (shell ID)
- The icon ONLY appears on the second line, never on the first line

---

## Reusable UI Components

The KillShellToolBlock uses these components from `src/components/ui/`:

| Component | Import Path | Usage |
|-----------|-------------|-------|
| `ExpandChevron` | `@/components/ui/expand-chevron` | Header expand/collapse chevron indicator |
| `ShimmerText` | `@/components/ui/shimmer-text` | "Kill shell" text animation while running |
| `StatusIcon` | `@/components/ui/status-icon` | Success (green check) or failure (red X) indicator |
| `CopyButton` | `@/components/ui/copy-button` | Copy Shell ID to clipboard |

**Not Used (not applicable for this tool):**
- `CollapsibleOutputBlock` - Not needed; result messages are short and don't need the gradient collapse overlay
- `CollapsibleBlock` - Not used as wrapper; we implement click handlers directly (same pattern as BashToolBlock)

---

## Component Implementation

### File Location

```
src/components/thread/tool-blocks/killshell-tool-block.tsx
```

### Imports

```tsx
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { XCircle } from "lucide-react";
import type { ToolBlockProps } from "./index";
```

### Type Definitions

```tsx
/**
 * Claude Code's KillShell tool input shape.
 * Matches the input parameter passed to the KillShell tool.
 */
interface KillShellInput {
  shell_id: string;
}
```

### Component Props

The component receives `ToolBlockProps` from `./index`:

```typescript
interface ToolBlockProps {
  id: string;                    // Unique tool use ID (from Anthropic.ToolUseBlock.id)
  name: string;                  // "KillShell"
  input: Record<string, unknown>; // Cast to KillShellInput: { shell_id: string }
  result?: string;               // Plain text success/failure message
  isError?: boolean;             // True if shell termination failed
  status: ToolStatus;            // "pending" | "running" | "complete"
  durationMs?: number;           // Execution duration in milliseconds
  isFocused?: boolean;           // Keyboard navigation focus (unused for this tool)
  threadId: string;              // For expand state persistence across virtualization
}
```

### State Management

Use `useToolExpandStore` for expand/collapse state persistence across virtualization remounts:

```tsx
const isExpanded = useToolExpandStore(
  (state) => state.isToolExpanded(threadId, id)
);
const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);
```

### Input Extraction

Extract the shell ID from input, handling missing values gracefully:

```tsx
const killShellInput = input as unknown as KillShellInput;
const shellId = killShellInput.shell_id || "(unknown)";
const isRunning = status === "running";
```

### First Line Implementation (Description)

The first line uses `ExpandChevron`, `ShimmerText`, and `StatusIcon`. Note: NO icon on this line - the chevron serves as the visual anchor for collapse/expand:

```tsx
{/* First line: Description with shimmer animation (no icon - chevron is the visual anchor) */}
<div className="flex items-center gap-2">
  <ExpandChevron isExpanded={isExpanded} size="md" />
  <ShimmerText
    isShimmering={isRunning}
    className="text-sm text-zinc-200"
  >
    Kill shell
  </ShimmerText>

  {/* Status indicator - only show when not running */}
  {!isRunning && status === "complete" && (
    <StatusIcon isSuccess={!isError} />
  )}

  {/* Duration - right justified */}
  <span className="flex items-center gap-2 shrink-0 ml-auto">
    {durationMs !== undefined && !isRunning && (
      <span className="text-xs text-muted-foreground">
        {formatDuration(durationMs)}
      </span>
    )}
  </span>
</div>
```

### Second Line Implementation (Command/Details with Icon)

The second line displays the Shell ID with the icon. This line is always visible (not conditional on expand state) and contains the tool-specific icon:

```tsx
{/* Second line: Icon + Shell ID (always visible) */}
<div className="flex items-center gap-1 mt-0.5 pl-5">
  <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
  <code className="text-xs font-mono text-zinc-500 min-w-0 flex-1 truncate">
    {shellId}
  </code>
  <CopyButton text={shellId} label="Copy shell ID" alwaysVisible />
</div>
```

### Result Display Implementation

Show success/error message with appropriate styling (no raw JSON):

```tsx
{/* Expanded Result Section */}
{isExpanded && result && (
  <div className="mt-2">
    <div className={cn(
      "text-xs font-mono p-2 rounded border break-words whitespace-normal",
      isError
        ? "bg-red-950/20 border-red-700/50 text-red-200"
        : "bg-green-950/20 border-green-700/50 text-green-200"
    )}>
      {result}
    </div>
  </div>
)}

{/* Running state - no result yet */}
{isExpanded && !result && isRunning && (
  <div className="mt-2">
    <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
      Terminating shell...
      <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
    </div>
  </div>
)}
```

### Click Handler Implementation

The header is clickable to toggle expand/collapse with keyboard accessibility:

```tsx
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
  {/* Header content here */}
</div>
```

---

## Complete Component Code

```tsx
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { XCircle } from "lucide-react";
import type { ToolBlockProps } from "./index";

interface KillShellInput {
  shell_id: string;
}

/**
 * Specialized block for rendering KillShell tool calls.
 * Displays shell termination status with success/failure indication.
 *
 * Layout:
 * - First line: Chevron + "Kill shell" description (with shimmer when running) + status + duration
 * - Second line: XCircle icon + shell ID + copy button (always visible)
 * - Result section: Success/error message (visible when expanded)
 */
export function KillShellToolBlock({
  id,
  name: _name,
  input,
  result,
  isError = false,
  status,
  durationMs,
  isFocused: _isFocused,
  threadId,
}: ToolBlockProps) {
  // Use Zustand store for expand state to persist across virtualization remounts
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  const killShellInput = input as unknown as KillShellInput;
  const shellId = killShellInput.shell_id || "(unknown)";
  const isRunning = status === "running";

  return (
    <div
      className="group py-0.5"
      aria-label={`Kill shell: ${shellId}, status: ${status}`}
      data-testid={`killshell-tool-${id}`}
      data-tool-status={status}
    >
      {/* Clickable Header (controls expand/collapse) */}
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
        {/* First line: Description with shimmer (NO icon - chevron is the visual anchor) */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200"
          >
            Kill shell
          </ShimmerText>

          {/* Status indicator - only show when complete */}
          {!isRunning && status === "complete" && (
            <StatusIcon isSuccess={!isError} />
          )}

          {/* Duration - right justified */}
          <span className="flex items-center gap-2 shrink-0 ml-auto">
            {durationMs !== undefined && !isRunning && (
              <span className="text-xs text-muted-foreground">
                {formatDuration(durationMs)}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Second line: Icon + Shell ID (always visible - icon ONLY appears here) */}
      <div className="flex items-center gap-1 mt-0.5 pl-5">
        <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
        <code className="text-xs font-mono text-zinc-500 min-w-0 flex-1 truncate">
          {shellId}
        </code>
        <CopyButton text={shellId} label="Copy shell ID" alwaysVisible />
      </div>

      {/* Expanded Result Section */}
      {isExpanded && result && (
        <div className="mt-2 pl-5">
          <div className={cn(
            "text-xs font-mono p-2 rounded border break-words whitespace-normal",
            isError
              ? "bg-red-950/20 border-red-700/50 text-red-200"
              : "bg-green-950/20 border-green-700/50 text-green-200"
          )}>
            {result}
          </div>
        </div>
      )}

      {/* Running state - no result yet */}
      {isExpanded && !result && isRunning && (
        <div className="mt-2 pl-5">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Terminating shell...
            <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? `Terminating shell ${shellId}`
          : isError
            ? `Failed to terminate shell ${shellId}`
            : `Successfully terminated shell ${shellId}`}
      </span>
    </div>
  );
}
```

---

## Registry Integration

Export from the barrel file and register in the tool block registry:

```typescript
// src/components/thread/tool-blocks/index.ts

// Add import
import { KillShellToolBlock } from "./killshell-tool-block";

// Add export
export { KillShellToolBlock };

// Add to registry (tool name is case-insensitive in lookup)
const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
  killshell: KillShellToolBlock,
  // ... other tools
};
```

---

## Styling Reference

### Colors

| Element | Class | Purpose |
|---------|-------|---------|
| Second line icon | `text-red-400` | Red XCircle indicates termination/destructive action |
| Success box | `bg-green-950/20 border-green-700/50 text-green-200` | Green for successful termination |
| Error box | `bg-red-950/20 border-red-700/50 text-red-200` | Red for failed termination |
| Shell ID | `text-zinc-500` | Muted monospace for technical ID |

### Typography

| Element | Classes | Notes |
|---------|---------|-------|
| First line (description) | `text-sm text-zinc-200` | Standard header size |
| Second line (shell ID) | `text-xs font-mono text-zinc-500` | Smaller monospace for technical content |
| Result message | `text-xs font-mono` | Monospace for consistency |
| Duration | `text-xs text-muted-foreground` | Subdued timing info |

### Spacing

| Element | Spacing | Notes |
|---------|---------|-------|
| First line elements | `gap-2` | Standard gap between chevron and description |
| Second line elements | `gap-1` | Tighter gap for icon + shell ID |
| Second line indent | `pl-5` | Indent to align with first line content (past chevron) |
| Second line margin | `mt-0.5` | Small margin from first line |
| Result section margin | `mt-2` | Standard spacing before result |
| Result section indent | `pl-5` | Indent to align with content |
| Result padding | `p-2` | Standard padding inside result box |

---

## Accessibility

### ARIA Attributes

- Container: `aria-label={`Kill shell: ${shellId}, status: ${status}`}`
- Header: `role="button"`, `aria-expanded={isExpanded}`, `tabIndex={0}`
- Copy button: Uses built-in `aria-label` from `CopyButton` component

### Screen Reader Support

Hidden text provides context for screen readers:

```tsx
<span className="sr-only">
  {isRunning
    ? `Terminating shell ${shellId}`
    : isError
      ? `Failed to terminate shell ${shellId}`
      : `Successfully terminated shell ${shellId}`}
</span>
```

### Keyboard Navigation

- `Tab`: Navigate to header and copy button
- `Enter` or `Space`: Toggle expand/collapse on header
- Copy button handles its own keyboard interaction

---

## Testing Checklist

### Visual Tests

- [ ] First line renders with `ExpandChevron` and "Kill shell" description text (NO icon on first line)
- [ ] First line `ShimmerText` animates while `status === "running"`
- [ ] Second line shows red `XCircle` icon + Shell ID with monospace font (always visible)
- [ ] `CopyButton` on second line works and shows checkmark feedback
- [ ] `ExpandChevron` animates between collapsed/expanded states
- [ ] `StatusIcon` shows green check on success, red X on error (on first line)
- [ ] Duration displays in muted text when available and not running (on first line)
- [ ] Success result displays with green styling (when expanded)
- [ ] Error result displays with red styling (when expanded)
- [ ] Second line is properly indented to align with first line content (past chevron)

### Functional Tests

- [ ] Clicking first line (header) toggles expand/collapse state
- [ ] Keyboard navigation (Enter/Space) toggles expand/collapse
- [ ] Copy button copies Shell ID correctly
- [ ] Expand state persists across component remounts (virtualization)
- [ ] Missing shell_id shows "(unknown)" gracefully

### Edge Cases

- [ ] Empty shell_id displays "(unknown)"
- [ ] Very long shell_id truncates on second line
- [ ] Long result message wraps correctly in expanded section
- [ ] No result while running shows "Terminating shell..." with pulse animation
- [ ] Component handles undefined result gracefully when complete

---

## Status

- **Phase:** Phase 2 (Specialized Tool Blocks)
- **Prerequisite:** Phase 1.5 (Extract Reusable UI Components) - COMPLETED
- **Priority:** Low (background shell termination is less frequent than core tools)
- **Complexity:** Low (simple input/output, straightforward UI)

---

## Related Files

- `src/components/thread/tool-blocks/bash-tool-block.tsx` - Reference implementation for UI patterns
- `src/components/thread/tool-blocks/index.ts` - Tool block registry
- `src/components/ui/expand-chevron.tsx` - Expand/collapse indicator
- `src/components/ui/shimmer-text.tsx` - Loading/running animation
- `src/components/ui/status-icon.tsx` - Success/failure indicator
- `src/components/ui/copy-button.tsx` - Copy-to-clipboard functionality
- `src/stores/tool-expand-store.ts` - Expand state persistence
