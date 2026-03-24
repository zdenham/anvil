# SkillToolBlock Implementation Plan

## Overview

The `SkillToolBlock` is a specialized component for rendering Skill tool calls in the thread view. It follows the BashToolBlock UI convention and displays skill execution results in a clean, readable format.

---

## Anthropic API Types

The Skill tool follows standard Anthropic tool use patterns. Reference these SDK types from `@anthropic-ai/sdk/resources/messages`:

```typescript
// Tool use block from assistant message (what Claude emits)
// From: Anthropic.ToolUseBlock
interface ToolUseBlock {
  id: string;           // e.g., "toolu_01D7FLrfh4GYq7yT1ULFeyMV"
  input: unknown;       // The input parameters (cast to SkillInput)
  name: string;         // "Skill"
  type: 'tool_use';
}

// Tool result block in user message (what we send back)
// From: Anthropic.ToolResultBlockParam
interface ToolResultBlockParam {
  tool_use_id: string;                              // Must match the tool_use id
  type: 'tool_result';
  content?: string | Array<TextBlockParam | ImageBlockParam>;  // Result content
  is_error?: boolean;                               // Whether execution failed
  cache_control?: CacheControlEphemeral | null;
}
```

**Important**: The `result` field in `ToolBlockProps` is the stringified version of `ToolResultBlockParam.content`. For the Skill tool, this is typically a plain text string describing the skill execution result.

---

## UI Pattern & Layout

Following the BashToolBlock pattern, the component consists of a two-line header with expandable output:

1. **First line (Description):** Chevron + Description text (shimmer animation while running) + Status/Duration
   - The chevron controls expand/collapse behavior
   - NO icon on this line (chevron takes that position)
   - Description shows skill name or summary (e.g., "commit", "pdf", "review-pr")
   - Shimmer animation applies to description text while `status === "running"`

2. **Second line (Command/Details):** Icon + Skill command/args
   - The Zap icon appears ONLY on this line
   - Shows the args if provided, or the skill name if no args
   - This line provides the "command" context, similar to how BashToolBlock shows the actual command

3. **Expanded content:** Skill output (formatted, never raw JSON)

---

## Component Structure

```tsx
// src/components/thread/tool-blocks/skill-tool-block.tsx

import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { Zap } from "lucide-react";
import type { ToolBlockProps } from "./index";
```

---

## Input Interface

The input matches the Skill tool schema (the `input` field from `Anthropic.ToolUseBlock`):

```typescript
/**
 * Input shape for the Skill tool.
 * This is cast from ToolUseBlock.input (which is typed as `unknown`).
 */
interface SkillInput {
  skill: string;           // Skill name (e.g., "commit", "pdf", "review-pr")
  args?: string;           // Optional arguments as a string
}
```

---

## Output Interface

The result is a plain text string (from `ToolResultBlockParam.content`). Skills typically return human-readable text output, not structured JSON.

```typescript
/**
 * Parse skill result from the tool_result content.
 *
 * The result string comes from ToolResultBlockParam.content.
 * For Skill tools, this is typically:
 * - Plain text describing what the skill did
 * - Status messages (e.g., "Skill 'commit' executed successfully")
 * - Error messages if is_error is true
 *
 * We do NOT parse as JSON - skills return human-readable text.
 */
function parseSkillResult(result: string | undefined): string {
  if (!result) {
    return "";
  }
  // Return as-is - skill output is already human-readable
  return result;
}
```

---

## Key Features

### First Line (Description)

The first line shows the description with shimmer animation. NO icon on this line - the chevron occupies that position.

- **`ExpandChevron`**: Animated chevron, size `md` for description headers (controls expand/collapse)
  ```tsx
  <ExpandChevron isExpanded={isExpanded} size="md" />
  ```

- **`ShimmerText`**: Wrap description text while running
  ```tsx
  <ShimmerText
    isShimmering={isRunning}
    className="text-sm text-zinc-200 truncate min-w-0"
  >
    {skillInput.skill}
  </ShimmerText>
  ```

- **`CopyButton`**: Place on first line to copy skill name
  ```tsx
  <CopyButton text={skillInput.skill} label="Copy skill name" alwaysVisible />
  ```

- **`StatusIcon`**: Show error indicator on failure (right side of first line)
  ```tsx
  {!isRunning && isError && (
    <StatusIcon isSuccess={false} />
  )}
  ```

- **Duration:** Display execution time on right (when complete)
  ```tsx
  {durationMs !== undefined && !isRunning && (
    <span className="text-xs text-muted-foreground">
      {formatDuration(durationMs)}
    </span>
  )}
  ```

### Second Line (Command/Details)

The second line shows the command details with the icon. The icon ONLY appears on this line.

- **Icon:** `Zap` from lucide-react - this is where the icon lives (not on first line)
  ```tsx
  <Zap className="w-3 h-3 text-yellow-400/60 shrink-0" />
  ```

- **Content:** Args string in monospace, truncated if long. If no args, show the skill name as the command.
  ```tsx
  <code className="text-xs font-mono text-zinc-500 truncate">
    {skillInput.args || skillInput.skill}
  </code>
  ```

- **`CopyButton`**: Copy the command/args
  ```tsx
  <CopyButton text={skillInput.args || skillInput.skill} label="Copy command" alwaysVisible />
  ```

### Expanded Content

Use `CollapsibleOutputBlock` for the skill output:

```tsx
const LINE_COLLAPSE_THRESHOLD = 20;
const MAX_COLLAPSED_HEIGHT = 300;

const output = parseSkillResult(result);
const outputLines = output ? output.split("\n") : [];
const isLongOutput = outputLines.length > LINE_COLLAPSE_THRESHOLD;

// Use store for output expand state
const defaultOutputExpanded = !isLongOutput;
const isOutputExpanded = useToolExpandStore((state) =>
  state.isOutputExpanded(threadId, id, defaultOutputExpanded)
);
const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
const setIsOutputExpanded = (expanded: boolean) =>
  setOutputExpanded(threadId, id, expanded);

// Render output
{isExpanded && output && (
  <div className="relative mt-2">
    <div className="absolute top-1 right-1 z-10">
      <CopyButton text={output} label="Copy output" />
    </div>
    <CollapsibleOutputBlock
      isExpanded={isOutputExpanded}
      onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
      isLongContent={isLongOutput}
      maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
      variant={isError ? "error" : "default"}
    >
      <pre
        className={cn(
          "text-xs font-mono p-2",
          "whitespace-pre-wrap break-words",
          isError ? "text-red-200" : "text-zinc-300"
        )}
      >
        <code>{output}</code>
      </pre>
    </CollapsibleOutputBlock>
  </div>
)}
```

---

## Reusable Components Summary

| Component | Import Path | Purpose | Where Used |
|-----------|-------------|---------|-----------|
| **`CopyButton`** | `@/components/ui/copy-button` | Copy to clipboard with checkmark feedback | Skill name, args, output |
| **`ShimmerText`** | `@/components/ui/shimmer-text` | Loading/running state animation | Skill name while `status === "running"` |
| **`ExpandChevron`** | `@/components/ui/expand-chevron` | Animated chevron icon | Header line toggle |
| **`StatusIcon`** | `@/components/ui/status-icon` | Success/failure indicator | Header when `isError === true` |
| **`CollapsibleOutputBlock`** | `@/components/ui/collapsible-output-block` | Long content with gradient overlay | Skill output section |

---

## Props

The component receives standard `ToolBlockProps` (same interface used by BashToolBlock):

```typescript
interface ToolBlockProps {
  /** Unique tool use ID (from ToolUseBlock.id) */
  id: string;
  /** Tool name - always "Skill" for this component */
  name: string;
  /** Tool input parameters (cast to SkillInput) */
  input: Record<string, unknown>;
  /** Tool execution result (from ToolResultBlockParam.content, stringified) */
  result?: string;
  /** Whether the result was an error (from ToolResultBlockParam.is_error) */
  isError?: boolean;
  /** Current execution status */
  status: ToolStatus;  // "running" | "complete" | "error"
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Whether this block is focused for keyboard navigation */
  isFocused?: boolean;
  /** Thread ID for persisting expand state across virtualization */
  threadId: string;
}
```

---

## State Management

Use `useToolExpandStore` (same pattern as BashToolBlock) for:

1. **Tool expansion state:** Track whether this skill call is expanded or collapsed
2. **Output expansion state:** Track whether long output is expanded or collapsed

```typescript
// Tool expand/collapse state
const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

// Output expand/collapse state (for long outputs)
const defaultOutputExpanded = !isLongOutput;
const isOutputExpanded = useToolExpandStore((state) =>
  state.isOutputExpanded(threadId, id, defaultOutputExpanded)
);
const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
const setIsOutputExpanded = (expanded: boolean) =>
  setOutputExpanded(threadId, id, expanded);
```

---

## Full Component Implementation

```tsx
export function SkillToolBlock({
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
  // Tool expand state
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Parse input
  const skillInput = input as unknown as SkillInput;
  const skillName = skillInput.skill || "unknown";
  const args = skillInput.args;

  // Parse result - plain text, not JSON
  const output = parseSkillResult(result);
  const outputLines = output ? output.split("\n") : [];
  const isLongOutput = outputLines.length > LINE_COLLAPSE_THRESHOLD;

  // Output expand state
  const defaultOutputExpanded = !isLongOutput;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsOutputExpanded = (expanded: boolean) =>
    setOutputExpanded(threadId, id, expanded);

  const isRunning = status === "running";
  const hasOutput = output.length > 0;

  // Determine what to show on second line (command)
  const commandText = args || skillName;

  return (
    <div
      className="group py-0.5"
      aria-label={`Skill: ${skillName}, status: ${status}`}
      data-testid={`skill-tool-${id}`}
      data-tool-status={status}
    >
      {/* Collapsed/Summary Row */}
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
        {/* First line: Description text with shimmer (NO icon - chevron is here) */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          {/* NO icon on first line - chevron occupies that position */}
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            {skillName}
          </ShimmerText>

          <CopyButton text={skillName} label="Copy skill name" alwaysVisible />

          {/* Error indicator */}
          {!isRunning && isError && (
            <StatusIcon isSuccess={false} />
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

        {/* Second line: Command/details with icon (icon ONLY appears here) */}
        <div className="flex items-center gap-1 mt-0.5 ml-5">
          <Zap className="w-3 h-3 text-yellow-400/60 shrink-0" />
          <code className="text-xs font-mono text-zinc-500 truncate min-w-0 flex-1">
            {commandText}
          </code>
          <CopyButton text={commandText} label="Copy command" alwaysVisible />
        </div>
      </div>

      {/* Expanded Output */}
      {isExpanded && hasOutput && (
        <div className="relative mt-2">
          <div className="absolute top-1 right-1 z-10">
            <CopyButton text={output} label="Copy output" />
          </div>
          <CollapsibleOutputBlock
            isExpanded={isOutputExpanded}
            onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
            isLongContent={isLongOutput}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant={isError ? "error" : "default"}
          >
            <pre
              className={cn(
                "text-xs font-mono p-2",
                "whitespace-pre-wrap break-words",
                isError ? "text-red-200" : "text-zinc-300"
              )}
            >
              <code>{output}</code>
              {isRunning && (
                <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-0.5" />
              )}
            </pre>
          </CollapsibleOutputBlock>
        </div>
      )}

      {/* Expanded but no output yet (running) */}
      {isExpanded && !hasOutput && isRunning && (
        <div className="mt-2 ml-6">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Running skill...
            <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Skill running"
          : isError
            ? "Skill failed"
            : "Skill completed successfully"}
      </span>
    </div>
  );
}
```

---

## Accessibility

Following BashToolBlock patterns:

- **ARIA labels:** `aria-label` on container, `aria-expanded` on clickable header
- **Keyboard navigation:** Enter/Space keys to toggle expand
- **Screen reader status:** Hidden span announces running/complete/error state
- **Role:** `role="button"` on header div
- **Tab index:** `tabIndex={0}` for keyboard focus

---

## Example Rendering

### Layout Structure

```
Line 1: [Chevron] [Description text with shimmer]        [Status] [Duration]
Line 2:          [Icon] [Command/args]                   [Copy]
```

Note: Icon ONLY appears on line 2. Line 1 has the chevron which controls expand/collapse.

### Collapsed State (with args)

```
> commit                                     [Copy]
  ⚡ -m "Fix bug"                            [Copy]
```

### Collapsed State (no args)

```
> commit                                     [Copy]
  ⚡ commit                                  [Copy]
```

### Expanded State

```
v commit                                     [Copy]     1.2s
  ⚡ -m "Fix bug"                            [Copy]

  +--------------------------------------------------+
  | Created commit abc1234                    [Copy] |
  | "Fix authentication bug in login flow"          |
  +--------------------------------------------------+
```

### Running State

```
> commit... (shimmer animation on "commit")
  ⚡ -m "Fix bug"

  +--------------------------------------------------+
  | Running skill...                                |
  +--------------------------------------------------+
```

### Error State

```
v commit                               [X]   [Copy]     0.8s
  ⚡ -m "Fix bug"                            [Copy]

  +--------------------------------------------------+  (red border)
  | Error: No changes to commit               [Copy] |
  +--------------------------------------------------+
```

---

## Testing Checklist

- [ ] Renders with skill name and Zap icon
- [ ] Chevron expands/collapses on click
- [ ] Second line shows args when provided
- [ ] Shimmer text animates while running
- [ ] Output displays as plain text (never raw JSON)
- [ ] Long output uses `CollapsibleOutputBlock` with gradient
- [ ] Copy buttons work for skill name, args, and output
- [ ] Duration displays correctly after completion
- [ ] Keyboard navigation works (Enter/Space to toggle)
- [ ] Screen reader announces status correctly
- [ ] Error states display with red styling and StatusIcon
- [ ] State persists across virtualization remounts
- [ ] Uses all reusable UI components correctly

---

## Integration Points

### Registration in `tool-blocks/index.ts`

```typescript
import { SkillToolBlock } from "./skill-tool-block";

const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  // ... other tools
  bash: BashToolBlock,
  skill: SkillToolBlock,  // lowercase for registry lookup
  // ...
};
```

### Tool Name Normalization

The registry uses lowercase tool names. Ensure the lookup normalizes:

```typescript
export function getSpecializedToolBlock(
  toolName: string
): ToolBlockComponent | null {
  const normalized = toolName.toLowerCase();
  return TOOL_BLOCK_REGISTRY[normalized] ?? null;
}
```

---

## Design Rationale

1. **Two-line layout with clear separation:**
   - First line: Description with shimmer animation (chevron here, NO icon)
   - Second line: Command/args with icon (icon ONLY here)
   - This matches the BashToolBlock pattern where description and command are visually separated
2. **Chevron on first line:** Controls expand/collapse, positioned at the start of the description line
3. **Icon on second line only:** The Zap icon appears with the command/args, not competing with the chevron
4. **Zap icon:** Represents instant execution and power, fitting for skill invocation
5. **Yellow color (#facc15 / text-yellow-400):** Differentiates skills from other tools (green for Bash, etc.)
6. **Shimmer on description:** The first line description text shimmers while running, providing clear visual feedback
7. **Plain text output (no JSON):** Skills return human-readable text, not structured data
8. **CollapsibleOutputBlock reuse:** Handles potentially large skill outputs efficiently
9. **All reusable UI components:** `CopyButton`, `ShimmerText`, `ExpandChevron`, `StatusIcon`, `CollapsibleOutputBlock` ensure consistency with BashToolBlock

---

## Related Files

- Main plan: `/Users/zac/Documents/juice/anvil/anvil/plans/tool-result-rendering-overhaul.md`
- BashToolBlock reference: `/Users/zac/Documents/juice/anvil/anvil/src/components/thread/tool-blocks/bash-tool-block.tsx`
- UI components: `/Users/zac/Documents/juice/anvil/anvil/src/components/ui/`
- Tool block registry: `/Users/zac/Documents/juice/anvil/anvil/src/components/thread/tool-blocks/index.ts`
- Anthropic SDK types: `@anthropic-ai/sdk/resources/messages` (ToolUseBlock, ToolResultBlockParam)
