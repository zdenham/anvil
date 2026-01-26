# EditToolBlock Implementation Plan

## Overview

The `EditToolBlock` renders file edits with inline diffs. It follows the BashToolBlock UI convention with a clean header showing file path and replacement count, expandable sections for each edited file, and inline diffs showing the actual changes.

---

## Anthropic API Data Shapes

### Tool Use Block (Input)

The Edit tool input comes from `Anthropic.ToolUseBlock`:

```typescript
// From @anthropic-ai/sdk/resources/messages
interface ToolUseBlock {
  id: string;
  input: unknown;  // Tool-specific input
  name: string;    // "Edit"
  type: 'tool_use';
}
```

The `input` field for the Edit tool has this shape:

```typescript
interface EditToolInput {
  file_path: string;      // Absolute path to file being edited
  old_string: string;     // Text to find and replace
  new_string: string;     // Replacement text
  replace_all?: boolean;  // Optional: replace all occurrences (default false)
}
```

### Tool Result Block (Output)

The result comes from `Anthropic.ToolResultBlockParam`:

```typescript
// From @anthropic-ai/sdk/resources/messages
interface ToolResultBlockParam {
  tool_use_id: string;
  type: 'tool_result';
  content?: string | Array<TextBlockParam | ImageBlockParam>;
  is_error?: boolean;
}
```

For the Edit tool, the `content` field is a plain string (not JSON) containing:
- **Success**: A human-readable confirmation message like `"Successfully replaced text in /path/to/file.ts"`
- **Error**: An error message describing what went wrong

**Important**: The Edit tool result is NOT JSON - it's a plain text string. The implementation should display this message directly, not attempt to parse it as JSON.

---

## UI Structure

### Collapsed State
```
[>] Edit file                                            1 replacement
    [icon] /src/utils.ts
```

**Layout (two-line structure):**
- **First line:** `ExpandChevron` + description text ("Edit file") + summary info (replacement count)
  - The chevron controls expand/collapse and appears ONLY on this line
  - `ShimmerText` wraps the description text (animates when running)
- **Second line:** Icon (Pencil) + file path + copy button
  - The tool-specific icon appears ONLY on this line, not the first line
  - File path displayed in monospace font

**Components:**
- `ExpandChevron` - Shows expand/collapse state, placed at start of first line (from `@/components/ui/expand-chevron`)
- `ShimmerText` - Wraps description text on first line, animates while `status === "running"` (from `@/components/ui/shimmer-text`)
- Pencil icon - Shown on second line before the file path
- Summary text: replacement count derived from `replace_all` input flag (right side of first line)
- `CopyButton` - For file path on second line

### Running State
```
[>] Editing file                                         (shimmer animation)
    [icon] /src/utils.ts
```

**Layout:** Same two-line structure as collapsed state:
- **First line:** Chevron + shimmering "Editing file" text
- **Second line:** Icon + file path

### Expanded State
```
[v] Edit file                                            1 replacement
    [icon] /src/utils.ts

    [Collapsible diff view showing old_string -> new_string]
```

**Layout:** Same two-line header structure, with expandable content below:
- **First line:** Chevron (expanded state) + description text + summary info
- **Second line:** Icon + file path + copy button
- **Expanded content:** Diff view indented below

**Components:**
- `CollapsibleOutputBlock` - For the diff content when expanded (from `@/components/ui/collapsible-output-block`)
- `CopyButton` - For file path and diff strings (from `@/components/ui/copy-button`)
- Inline diff display (styled, not raw JSON)

**Note**: `CollapsibleBlock` is not used directly because we need custom header rendering with the two-line layout. Instead, we implement the same pattern manually with proper ARIA attributes.

---

## Implementation Details

### Props Interface

```typescript
import type { ToolBlockProps } from "./index";

// ToolBlockProps is already defined in tool-blocks/index.ts:
// interface ToolBlockProps {
//   id: string;
//   name: string;
//   input: Record<string, unknown>;
//   result?: string;
//   isError?: boolean;
//   status: ToolStatus;
//   durationMs?: number;
//   isFocused?: boolean;
//   threadId: string;
// }

// Type-safe input parsing
interface EditToolInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

function parseEditInput(input: Record<string, unknown>): EditToolInput | null {
  const filePath = input.file_path;
  const oldString = input.old_string;
  const newString = input.new_string;

  if (typeof filePath !== "string" || typeof oldString !== "string" || typeof newString !== "string") {
    return null;
  }

  return {
    file_path: filePath,
    old_string: oldString,
    new_string: newString,
    replace_all: input.replace_all === true,
  };
}
```

### Component Structure

```typescript
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { Pencil } from "lucide-react";
import type { ToolBlockProps } from "./index";

export function EditToolBlock({
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
  // Use Zustand store for expand state (persists across virtualization)
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Parse input
  const editInput = parseEditInput(input);
  const filePath = editInput?.file_path ?? "unknown";
  const oldString = editInput?.old_string ?? "";
  const newString = editInput?.new_string ?? "";
  const replaceAll = editInput?.replace_all ?? false;

  const isRunning = status === "running";
  const replacementCount = replaceAll ? "all" : "1";

  // Determine if diff is long enough to need expand/collapse
  const diffLineCount = Math.max(
    oldString.split("\n").length,
    newString.split("\n").length
  );
  const isLongDiff = diffLineCount > 10;

  // Use store for diff expand state
  const defaultDiffExpanded = !isLongDiff;
  const isDiffExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultDiffExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsDiffExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  return (
    <div
      className="group py-0.5"
      aria-label={`Edit file: ${filePath}`}
      data-testid={`edit-tool-${id}`}
      data-tool-status={status}
    >
      {/* Header Row - Two-line layout:
          Line 1: Chevron + description text (with shimmer) + summary
          Line 2: Icon + file path + copy button
          Note: Chevron is ONLY on line 1, Icon is ONLY on line 2 */}
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
        {/* First line: Chevron + description text + summary info */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200"
          >
            {isRunning ? "Editing file" : "Edit file"}
          </ShimmerText>

          {/* Error indicator */}
          {!isRunning && isError && <StatusIcon isSuccess={false} />}

          {/* Right-justified info */}
          <span className="flex items-center gap-2 shrink-0 ml-auto">
            {durationMs !== undefined && !isRunning && (
              <span className="text-xs text-muted-foreground">
                {formatDuration(durationMs)}
              </span>
            )}
            <span className="text-xs text-zinc-400">
              {replaceAll ? "all replacements" : "1 replacement"}
            </span>
          </span>
        </div>

        {/* Second line: Icon + file path (icon only appears here, not on first line) */}
        <div className="flex items-center gap-1.5 mt-0.5 ml-5">
          <Pencil className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <span className="text-xs font-mono text-zinc-500 truncate">
            {filePath}
          </span>
          <CopyButton text={filePath} label="Copy file path" />
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="relative mt-2 ml-5">
          {/* Diff display */}
          <CollapsibleOutputBlock
            isExpanded={isDiffExpanded}
            onToggle={() => setIsDiffExpanded(!isDiffExpanded)}
            isLongContent={isLongDiff}
            maxCollapsedHeight={200}
            variant={isError ? "error" : "default"}
          >
            <div className="p-2 space-y-2">
              {/* Old string (removed) */}
              <div className="relative">
                <div className="absolute top-1 right-1 z-10">
                  <CopyButton text={oldString} label="Copy old text" />
                </div>
                <div className="text-xs font-mono">
                  <div className="text-zinc-500 mb-1">old_string:</div>
                  <pre className="text-red-300 bg-red-950/30 p-2 rounded whitespace-pre-wrap break-words border border-red-900/30">
                    {oldString || <span className="text-zinc-600 italic">(empty)</span>}
                  </pre>
                </div>
              </div>

              {/* New string (added) */}
              <div className="relative">
                <div className="absolute top-1 right-1 z-10">
                  <CopyButton text={newString} label="Copy new text" />
                </div>
                <div className="text-xs font-mono">
                  <div className="text-zinc-500 mb-1">new_string:</div>
                  <pre className="text-green-300 bg-green-950/30 p-2 rounded whitespace-pre-wrap break-words border border-green-900/30">
                    {newString || <span className="text-zinc-600 italic">(empty)</span>}
                  </pre>
                </div>
              </div>

              {/* Result message (if available) */}
              {result && (
                <div className="text-xs font-mono">
                  <div className="text-zinc-500 mb-1">Result:</div>
                  <div className={cn(
                    "p-2 rounded border",
                    isError
                      ? "text-red-300 bg-red-950/20 border-red-900/30"
                      : "text-zinc-300 bg-zinc-900/50 border-zinc-700/50"
                  )}>
                    {result}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleOutputBlock>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Edit in progress"
          : isError
            ? "Edit failed"
            : "Edit completed successfully"}
      </span>
    </div>
  );
}
```

---

## Reusable Components Reference

| Component | Import Path | Purpose | Usage in EditToolBlock |
|-----------|-------------|---------|------------------------|
| `ExpandChevron` | `@/components/ui/expand-chevron` | Animated chevron for expand/collapse | First line only - controls expand/collapse |
| `ShimmerText` | `@/components/ui/shimmer-text` | Loading animation for running state | First line - wraps description text ("Editing file") |
| `Pencil` (lucide-react) | `lucide-react` | Tool-specific icon | Second line only - before file path |
| `CopyButton` | `@/components/ui/copy-button` | Copy-to-clipboard with feedback | Second line (file path), diff content (old_string, new_string) |
| `StatusIcon` | `@/components/ui/status-icon` | Success/error indicator | First line - error state indicator |
| `CollapsibleOutputBlock` | `@/components/ui/collapsible-output-block` | Gradient overlay for long content | Diff content container |

**Note**: `CollapsibleBlock` is not used directly because we need custom two-line header rendering. The first line has the chevron for expand/collapse control, while the second line has the tool icon. We implement this pattern manually with proper ARIA attributes.

---

## Styling Patterns (Consistent with BashToolBlock)

### Color Scheme
- **Icon:** `text-zinc-500` (muted)
- **Header text:** `text-zinc-200` (primary)
- **Secondary text:** `text-zinc-500` or `text-zinc-400` (muted)
- **File path:** `font-mono text-zinc-500`
- **Diff removed:** `text-red-300 bg-red-950/30 border-red-900/30`
- **Diff added:** `text-green-300 bg-green-950/30 border-green-900/30`
- **Result (success):** `text-zinc-300 bg-zinc-900/50 border-zinc-700/50`
- **Result (error):** `text-red-300 bg-red-950/20 border-red-900/30`

### Spacing & Layout
- Container: `py-0.5` (matches BashToolBlock)
- Icon size: `w-3.5 h-3.5` (on second line)
- First line gap: `gap-2`
- Second line: `ml-5` indent (aligns with text after chevron), `gap-1.5`
- Expanded content margin: `mt-2 ml-5`
- Text size: `text-sm` (first line description), `text-xs` (second line file path, diff content)

### Two-Line Header Layout
- **First line:** `[Chevron] [Description text with shimmer] ... [Summary info]`
  - Chevron is the expand/collapse control
  - No icon on this line
- **Second line:** `[Icon] [File path] [Copy button]`
  - Icon appears here (not on first line)
  - Indented to align with text content from first line (`ml-5`)

---

## Expand State Management

Follow BashToolBlock pattern using Zustand store for both block expansion and diff expansion:

```typescript
// Block-level expand (header click)
const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

// Diff expand (for long diffs, inside CollapsibleOutputBlock)
const isDiffExpanded = useToolExpandStore((state) =>
  state.isOutputExpanded(threadId, id, defaultDiffExpanded)
);
const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
const setIsDiffExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);
```

---

## Error Handling

1. **Missing input fields**: Show "unknown" for file path, display whatever data is available
2. **Invalid input types**: `parseEditInput` returns `null`, component falls back to safe defaults
3. **No result yet**: Don't show result section when `result` is undefined
4. **Error result**: Display result message with error styling (red background/border)
5. **Empty old_string/new_string**: Show "(empty)" in italic to indicate intentional empty value

---

## Keyboard Navigation & ARIA

Following BashToolBlock pattern:
- Header row: `role="button"`, `tabIndex={0}`, `aria-expanded={isExpanded}`
- Enter/Space toggle expansion
- `aria-label` on container describes the tool and file
- Screen reader only status text for completion state

---

## Integration

### 1. Imports

```typescript
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { Pencil } from "lucide-react";
import type { ToolBlockProps } from "./index";
```

### 2. Registry

Add to `tool-blocks/index.ts`:

```typescript
import { EditToolBlock } from "./edit-tool-block";

const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
  edit: EditToolBlock,
};

export { BashToolBlock, EditToolBlock };
```

---

## Success Criteria

**Two-Line Header Layout:**
- [ ] First line: Chevron + description text (with shimmer animation when running) + summary info
- [ ] Second line: Icon (Pencil) + file path + copy button
- [ ] Chevron appears ONLY on first line (controls expand/collapse)
- [ ] Icon appears ONLY on second line (not on first line with chevron)
- [ ] ShimmerText wraps description on first line, animates when `status === "running"`

**Components:**
- [ ] Uses `ExpandChevron` for expand/collapse indicator (first line only)
- [ ] Uses `ShimmerText` for running state animation (first line description)
- [ ] Uses `CopyButton` for file path (second line), old_string, and new_string (diff content)
- [ ] Uses `StatusIcon` for error indicator (first line)
- [ ] Uses `CollapsibleOutputBlock` for diff content with gradient overlay

**Behavior:**
- [ ] Header shows "Edit file" / "Editing file" based on status
- [ ] Expanded section shows properly styled diff (NOT raw JSON)
- [ ] Diff uses red/green color coding for removed/added text
- [ ] Result message displayed as plain text (not JSON)
- [ ] Expand states persist across virtualization (Zustand store)
- [ ] Error states display with appropriate styling
- [ ] Keyboard navigation works (Enter/Space to toggle)
- [ ] Matches BashToolBlock visual style and spacing

---

## Related Files

- Main plan: `/Users/zac/Documents/juice/mort/mortician/plans/tool-result-rendering-overhaul.md`
- BashToolBlock (reference): `/Users/zac/Documents/juice/mort/mortician/src/components/thread/tool-blocks/bash-tool-block.tsx`
- Reusable components: `/Users/zac/Documents/juice/mort/mortician/src/components/ui/`
- Tool blocks index: `/Users/zac/Documents/juice/mort/mortician/src/components/thread/tool-blocks/index.ts`
- Tool expand store: `/Users/zac/Documents/juice/mort/mortician/src/stores/tool-expand-store.ts`
