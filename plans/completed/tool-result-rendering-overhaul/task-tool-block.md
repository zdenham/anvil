# TaskToolBlock Implementation Plan

## Overview

Implement a specialized `TaskToolBlock` component to render task/subagent execution results following the `BashToolBlock` UI conventions and reusable component patterns.

---

## Anthropic API Data Structures

The Task tool follows standard Anthropic tool patterns. Reference the official SDK types from `@anthropic-ai/sdk/resources/messages`:

### Tool Use Block (from assistant message)
```typescript
// Anthropic.ToolUseBlock - the tool_use content block in assistant messages
interface ToolUseBlock {
  id: string;        // Unique tool use ID (e.g., "toolu_01D7FLrfh4GYq7yT1ULFeyMV")
  input: unknown;    // Tool-specific input parameters (see TaskInput below)
  name: string;      // Tool name: "Task"
  type: 'tool_use';
}
```

### Tool Result Block (from user message response)
```typescript
// Anthropic.ToolResultBlockParam - the tool_result content block in user messages
interface ToolResultBlockParam {
  tool_use_id: string;   // References the ToolUseBlock.id
  type: 'tool_result';
  content?: string | Array<TextBlockParam | ImageBlockParam>;  // Result content
  is_error?: boolean;    // Whether execution failed
}
```

### Internal Props (from ToolBlockProps)
The component receives props via `ToolBlockProps` which normalizes the Anthropic types:
```typescript
interface ToolBlockProps {
  id: string;                         // From ToolUseBlock.id
  name: string;                       // From ToolUseBlock.name ("Task")
  input: Record<string, unknown>;     // From ToolUseBlock.input (cast from unknown)
  result?: string;                    // Stringified content from ToolResultBlockParam.content
  isError?: boolean;                  // From ToolResultBlockParam.is_error
  status: ToolStatus;                 // "running" | "complete" | "pending" | "error"
  durationMs?: number;                // Execution duration (tracked internally)
  isFocused?: boolean;                // Keyboard navigation state
  threadId: string;                   // For expand state persistence
}
```

---

## Task-Specific Types

### Task Input (from ToolUseBlock.input)
The Task tool's input object contains:
```typescript
interface TaskInput {
  description: string;  // Human-readable task description (e.g., "Search for authentication code")
  prompt?: string;      // Alternative field for task description (fallback)
  // Additional fields may be present but are not displayed
}
```

### Task Result Format
The result string may be plain text or JSON. Parse defensively:
```typescript
// Plain text result (most common)
// The result is the sub-agent's final response text

// JSON result format (if structured)
interface TaskResultJSON {
  text?: string;              // Full response text
  usage?: {                   // Usage stats (matches Anthropic.Usage structure)
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
  stopReason?: string;        // "end_turn", "max_tokens", "tool_use", etc.
}
```

---

## UI Structure

### Header (Always Visible) - Two-Line Layout

**Line 1: Description Row**
- **Expand chevron** - Left side, using `ExpandChevron` component with `size="md"` (controls collapse/expand)
- **Description** - Task description text from `input.description`
  - **While running:** Wrap in `ShimmerText` with `isShimmering={true}` for animated loading state
  - **When complete:** Show static text
- **Duration** - Right side using `formatDuration()`, only when complete
- **Status indicator** - `StatusIcon` with `isSuccess={false}` only on error

**Line 2: Command/Details Row**
- **Icon** - `GitBranch` from lucide-react (muted color, `w-3.5 h-3.5 text-zinc-500`) - icon ONLY appears on this second line, not the first line (first line has chevron instead)
- **Task identifier or prompt preview** - Secondary detail text (truncated if needed), styled with `text-xs text-zinc-500`

The two-line layout ensures visual hierarchy: the description with shimmer animation is the primary focus on line 1, while supplementary details (icon + command info) appear on line 2.

### Expanded Content (Collapsible via ExpandChevron)
Wrap the entire expanded section in `CollapsibleOutputBlock` to handle long results.

**Result Text Display:**
- Render as readable text, NOT raw JSON
- If result parses as JSON with a `text` field, extract and display that
- If result is plain text, display directly
- Use `whitespace-pre-wrap` to preserve formatting
- Apply `text-sm text-zinc-300` styling

**Usage Stats (if available):**
- Only display if result contains usage data
- Format as human-readable labels, not raw JSON
- Display in a compact horizontal layout with separators:
  ```
  Input: 342 tokens | Output: 215 tokens | Cache read: 128 tokens
  ```
- Only show non-zero cache values

---

## Reusable UI Components

Use these shared components from `@/components/ui/`:

### 1. `ShimmerText`
```typescript
import { ShimmerText } from "@/components/ui/shimmer-text";

// Props:
interface ShimmerTextProps {
  children: React.ReactNode;
  isShimmering: boolean;  // Set to status === "running"
  className?: string;
  as?: "span" | "div" | "p";  // Default: "span"
}

// Usage in header:
<ShimmerText isShimmering={isRunning} className="text-sm text-zinc-200 truncate">
  {description}
</ShimmerText>
```

### 2. `ExpandChevron`
```typescript
import { ExpandChevron } from "@/components/ui/expand-chevron";

// Props:
interface ExpandChevronProps {
  isExpanded: boolean;
  size?: "sm" | "md";  // Use "md" for main header
  className?: string;
}

// Usage:
<ExpandChevron isExpanded={isExpanded} size="md" />
```

### 3. `CollapsibleOutputBlock`
```typescript
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";

// Props:
interface CollapsibleOutputBlockProps {
  children: React.ReactNode;
  isExpanded: boolean;           // Output expand state (separate from tool expand)
  onToggle: () => void;
  isLongContent: boolean;        // Controls gradient overlay visibility
  maxCollapsedHeight?: number;   // Default: 300px
  variant?: "default" | "error"; // Use "error" when isError is true
  className?: string;
}

// Usage:
<CollapsibleOutputBlock
  isExpanded={isOutputExpanded}
  onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
  isLongContent={isLongOutput}
  variant={isError ? "error" : "default"}
>
  {/* Result content here */}
</CollapsibleOutputBlock>
```

### 4. `StatusIcon`
```typescript
import { StatusIcon } from "@/components/ui/status-icon";

// Props:
interface StatusIconProps {
  isSuccess: boolean;
  size?: "sm" | "md" | "lg";  // Default: "md"
  className?: string;
}

// Usage - only show on error:
{isError && !isRunning && <StatusIcon isSuccess={false} />}
```

### 5. `CopyButton`
```typescript
import { CopyButton } from "@/components/ui/copy-button";

// Props:
interface CopyButtonProps {
  text: string;           // Text to copy
  label?: string;         // Tooltip label (default: "Copy")
  alwaysVisible?: boolean; // false = show on hover only
  className?: string;
}

// Usage:
<CopyButton text={resultText} label="Copy result" />
```

---

## State Management

### Tool Expand State
Use Zustand store to persist expand state across virtualization remounts:
```typescript
import { useToolExpandStore } from "@/stores/tool-expand-store";

// Get expand state
const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);
```

### Output Expand State (for long results)
Use separate output expand state for the CollapsibleOutputBlock:
```typescript
const LINE_COLLAPSE_THRESHOLD = 20;

// Calculate if output is long
const isLongOutput = resultText.split('\n').length > LINE_COLLAPSE_THRESHOLD;

// Default to expanded if short, collapsed if long
const defaultOutputExpanded = !isLongOutput;

const isOutputExpanded = useToolExpandStore((state) =>
  state.isOutputExpanded(threadId, id, defaultOutputExpanded)
);
const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);
```

---

## Component Implementation

### File Location
`src/components/thread/tool-blocks/task-tool-block.tsx`

### Result Parsing
Parse the result string defensively to extract display content:
```typescript
interface ParsedTaskResult {
  text: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
  stopReason?: string;
}

function parseTaskResult(result: string | undefined): ParsedTaskResult {
  if (!result) {
    return { text: "" };
  }

  // Try to parse as JSON
  try {
    const parsed = JSON.parse(result);
    if (typeof parsed === "object" && parsed !== null) {
      // Check for text field
      if (typeof parsed.text === "string") {
        return {
          text: parsed.text,
          usage: parsed.usage,
          stopReason: parsed.stopReason,
        };
      }
      // If no text field, check for common result patterns
      if (typeof parsed.output === "string") {
        return { text: parsed.output, usage: parsed.usage };
      }
      if (typeof parsed.result === "string") {
        return { text: parsed.result, usage: parsed.usage };
      }
    }
  } catch {
    // Not JSON, use as plain text
  }

  // Plain text result
  return { text: result };
}
```

### Usage Stats Formatter
Format usage stats as human-readable text (NOT raw JSON):
```typescript
function formatUsageStats(usage: ParsedTaskResult["usage"]): string[] {
  if (!usage) return [];

  const parts: string[] = [];

  if (usage.input_tokens !== undefined) {
    parts.push(`Input: ${usage.input_tokens.toLocaleString()} tokens`);
  }
  if (usage.output_tokens !== undefined) {
    parts.push(`Output: ${usage.output_tokens.toLocaleString()} tokens`);
  }
  if (usage.cache_creation_input_tokens && usage.cache_creation_input_tokens > 0) {
    parts.push(`Cache write: ${usage.cache_creation_input_tokens.toLocaleString()} tokens`);
  }
  if (usage.cache_read_input_tokens && usage.cache_read_input_tokens > 0) {
    parts.push(`Cache read: ${usage.cache_read_input_tokens.toLocaleString()} tokens`);
  }

  return parts;
}
```

### Full Component Structure
```tsx
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { GitBranch } from "lucide-react";
import type { ToolBlockProps } from "./index";

const LINE_COLLAPSE_THRESHOLD = 20;
const MAX_COLLAPSED_HEIGHT = 300;

export function TaskToolBlock({
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
  // Expand state from store
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Parse input
  const taskInput = input as { description?: string; prompt?: string };
  const description = taskInput.description || taskInput.prompt || "Run task";

  // Parse result
  const parsed = parseTaskResult(result);
  const resultText = parsed.text;
  const usageStats = formatUsageStats(parsed.usage);

  // State flags
  const isRunning = status === "running";
  const hasResult = resultText.length > 0;
  const isLongOutput = resultText.split('\n').length > LINE_COLLAPSE_THRESHOLD;

  // Output expand state
  const defaultOutputExpanded = !isLongOutput;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  return (
    <div
      className="group py-0.5"
      aria-label={`Task: ${description}, status: ${status}`}
      data-testid={`task-tool-${id}`}
      data-tool-status={status}
    >
      {/* Clickable Header - Two Line Layout */}
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
        {/* Line 1: Description with chevron (has shimmer animation when running) */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            {description}
          </ShimmerText>

          {/* Right side: duration and error indicator */}
          <span className="flex items-center gap-2 shrink-0 ml-auto">
            {durationMs !== undefined && !isRunning && (
              <span className="text-xs text-muted-foreground">
                {formatDuration(durationMs)}
              </span>
            )}
            {isError && !isRunning && <StatusIcon isSuccess={false} />}
          </span>
        </div>

        {/* Line 2: Icon + command/details (icon only appears here, not on line 1) */}
        <div className="flex items-center gap-2 mt-1 ml-5">
          <GitBranch className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <span className="text-xs text-zinc-500 truncate">
            {taskInput.prompt ? taskInput.prompt.slice(0, 80) + (taskInput.prompt.length > 80 ? "..." : "") : "Subagent task"}
          </span>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && hasResult && (
        <div className="relative mt-2">
          {/* Copy button */}
          <div className="absolute top-1 right-1 z-10">
            <CopyButton text={resultText} label="Copy result" />
          </div>

          <CollapsibleOutputBlock
            isExpanded={isOutputExpanded}
            onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
            isLongContent={isLongOutput}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant={isError ? "error" : "default"}
          >
            {/* Result text - formatted, not raw JSON */}
            <div
              className={cn(
                "text-sm p-3 whitespace-pre-wrap break-words",
                isError ? "text-red-200" : "text-zinc-300"
              )}
            >
              {resultText}
              {isRunning && (
                <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-0.5" />
              )}
            </div>
          </CollapsibleOutputBlock>

          {/* Usage stats - formatted as readable text */}
          {usageStats.length > 0 && (
            <div className="mt-2 text-xs text-zinc-500">
              {usageStats.join(" | ")}
            </div>
          )}
        </div>
      )}

      {/* Running state without result */}
      {isExpanded && !hasResult && isRunning && (
        <div className="mt-2 ml-6">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Running task...
            <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning ? "Task running" : isError ? "Task failed" : "Task completed"}
      </span>
    </div>
  );
}
```

---

## Registry Integration

Add to `src/components/thread/tool-blocks/index.ts`:
```typescript
import { TaskToolBlock } from "./task-tool-block";

const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
  task: TaskToolBlock,  // Add this line
};

export { BashToolBlock, TaskToolBlock };
```

---

## Error Handling

1. **Missing description** - Fall back to `"Run task"`
2. **Unparseable result** - Display raw text (already handled by parser)
3. **Missing result** - Show "No output" placeholder when expanded
4. **Error state** - Apply "error" variant to CollapsibleOutputBlock, use red text styling

---

## Keyboard Navigation

Following BashToolBlock pattern:
- Entire header row is clickable with `role="button"` and `tabIndex={0}`
- `Enter` and `Space` keys toggle expand/collapse
- `onKeyDown` prevents default and toggles state

---

## Integration Checklist

- [ ] Create `src/components/thread/tool-blocks/task-tool-block.tsx`
- [ ] Implement `parseTaskResult()` function
- [ ] Implement `formatUsageStats()` function
- [ ] Import all reusable components (`ShimmerText`, `ExpandChevron`, `StatusIcon`, `CopyButton`, `CollapsibleOutputBlock`)
- [ ] Add `task: TaskToolBlock` to registry in `tool-blocks/index.ts`
- [ ] Export `TaskToolBlock` from `tool-blocks/index.ts`
- [ ] Test with various result sizes (empty, normal, very long)
- [ ] Test error states
- [ ] Verify expand state persists across virtualization
- [ ] Verify no raw JSON is displayed to users

---

## Related Files

- **Main plan:** `/Users/zac/Documents/juice/mort/mortician/plans/tool-result-rendering-overhaul.md`
- **Pilot implementation:** `/Users/zac/Documents/juice/mort/mortician/src/components/thread/tool-blocks/bash-tool-block.tsx`
- **Registry:** `/Users/zac/Documents/juice/mort/mortician/src/components/thread/tool-blocks/index.ts`
- **UI Components:** `src/components/ui/` (CopyButton, ShimmerText, ExpandChevron, StatusIcon, CollapsibleOutputBlock)
- **Store:** `src/stores/tool-expand-store.ts`
- **Anthropic types reference:** `@anthropic-ai/sdk/resources/messages` (ToolUseBlock, ToolResultBlockParam, Usage)
