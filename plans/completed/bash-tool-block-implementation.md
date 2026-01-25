# Bash Tool Block Implementation Plan

## Overview

This plan details the implementation of `BashToolBlock`, a specialized component for rendering Bash tool calls in the thread view. The component will replace the generic JSON-based rendering with a terminal-style display that clearly communicates command execution, output, and status.

---

## Behavior Specification

### Visual Design

The Bash tool block renders as a subtle, inline element that blends with the chat background:
- **No distinct card or heavy borders** - uses minimal visual separation
- Monospace font for command and output
- Subtle left border accent (like a blockquote) to indicate it's a tool block
- Colored prompt indicator (`$`) for commands
- Background matches chat area (transparent or very subtle tint)
- Feels like natural part of the conversation flow, not a separate widget

### States

#### 1. **Running State** (Collapsed)
```
│ ▶ Install package dependencies                     ⏳ Running
│   $ npm install
```
Or without description:
```
│ ▶ $ npm test                                       ⏳ Running
```
- Subtle left border accent
- Chevron indicates expandable (▶)
- Description as primary line (if provided), command below it
- If no description, command with `$` prompt is shown as primary line
- Spinning loader with "Running" text
- No duration shown yet

#### 2. **Running State** (Expanded)
```
│ ▼ Run test suite                                   ⏳ Running
│   $ npm test
│
│   > mortician@0.1.0 test
│   > vitest run
│
│   Running tests...
│   █
```
- Left border continues through output
- Description as header, command always visible below it
- Output streams in with subtle indentation
- Blinking cursor or streaming indicator while running

#### 3. **Success State** (Collapsed)
```
│ ▶ Run test suite                               1.2s  ✓ Exit 0
│   $ npm test
```
Or without description:
```
│ ▶ $ npm test                                   1.2s  ✓ Exit 0
```
- Green checkmark and exit badge
- Duration shown
- Description as primary line with command below (or just command if no description)

#### 4. **Success State** (Expanded)
```
│ ▼ Run test suite                           1.2s  ✓ Exit 0  📋
│   $ npm test
│
│   > mortician@0.1.0 test
│   > vitest run
│
│    ✓ src/utils.test.ts (3 tests) 120ms
│    ✓ src/hooks.test.ts (5 tests) 89ms
│
│   Test Files  2 passed (2)
│   Tests       8 passed (8)
│   Duration    1.24s
```
- Description as header, command always visible below
- Copy button appears on hover (or always visible, inline)
- Full output displayed with consistent indentation
- Truncation with "Show more" for very long output

#### 5. **Error State** (Collapsed)
```
│ ▶ Run test suite                               0.8s  ✗ Exit 1
│   $ npm test
```
Or without description:
```
│ ▶ $ npm test                                   0.8s  ✗ Exit 1
```
- Left border tinted red for errors
- Red X icon and exit badge
- Description with command below (or just command if no description)

#### 6. **Error State** (Expanded)
```
│ ▼ Run test suite                           0.8s  ✗ Exit 1  📋
│   $ npm test
│
│   > mortician@0.1.0 test
│   > vitest run
│
│   FAIL  src/utils.test.ts
│   ✗ should format duration correctly
│     Expected: "1.2s"
│     Received: "1.20s"
│
│   Test Files  1 failed (1)
│   Duration    0.82s
```
- Description as header, command always visible below
- Red left border accent
- stderr could use slightly different text color if distinguishable

#### 7. **Background Task State** (Running)
```
│ ▶ Start development server             ⏳ Running  (bg: shell_abc)
│   $ npm run dev
```
Or without description:
```
│ ▶ $ npm run dev                    ⏳ Running  (bg: shell_abc)
```
- Compact shell ID indicator
- Same minimal styling
- Description with command below (or just command if no description)

#### 8. **Background Task State** (Expanded, with partial output)
```
│ ▼ Start development server             ⏳ Running  (bg: shell_abc)
│   $ npm run dev
│
│   > mortician@0.1.0 dev
│   > vite
│
│   VITE v5.0.0  ready in 234ms
│   ➜  Local:   http://localhost:5173/
│   █
```

---

## Component Props

```typescript
interface BashToolBlockProps {
  /** Unique tool use ID */
  id: string;
  /** Tool name (always "Bash") */
  name: string;
  /** Tool input parameters */
  input: {
    command: string;
    description?: string;
    timeout?: number;
    run_in_background?: boolean;
  };
  /** Tool execution result (stdout/stderr combined, or structured) */
  result?: string;
  /** Whether the result was an error */
  isError?: boolean;
  /** Current execution status */
  status: ToolStatus; // "running" | "complete" | "error" | "pending"
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Whether this block is focused for keyboard navigation */
  isFocused?: boolean;
}
```

---

## Implementation Details

### File Location
```
src/components/thread/tool-blocks/bash-tool-block.tsx
```

### Dependencies
- `lucide-react`: Terminal, Copy, Check, X, Loader2 icons
- `@/lib/utils`: `cn` utility for class merging
- `@/lib/utils/time-format`: `formatDuration` utility

### Key Implementation Points

#### 1. Command Display
```typescript
// Inline command with $ prefix, no card wrapper
<div className="font-mono text-sm border-l-2 border-zinc-600 pl-3">
  <span className="text-green-400">$</span>{" "}
  <span className="text-zinc-200">{input.command}</span>
</div>
```

#### 2. Exit Code Parsing
The result string may contain exit code information. Parse it:
```typescript
function parseExitCode(result: string | undefined, isError: boolean): number | null {
  // Try to extract from result if present
  // Default to 0 for success, 1 for error
  if (isError) return 1;
  return 0;
}
```

#### 3. Exit Code Badge Component
```typescript
function ExitCodeBadge({ code }: { code: number }) {
  const isSuccess = code === 0;
  return (
    <span className={cn(
      "text-xs font-mono px-1.5 py-0.5 rounded",
      isSuccess
        ? "bg-green-500/20 text-green-400"
        : "bg-red-500/20 text-red-400"
    )}>
      Exit {code}
    </span>
  );
}
```

#### 4. Output Truncation
- Default max lines: 50 (configurable)
- Show "Show all X lines" button when truncated
- Max height with scroll for very long output

```typescript
const MAX_LINES = 50;
const lines = output.split('\n');
const isTruncated = lines.length > MAX_LINES;
const displayedLines = isTruncated ? lines.slice(0, MAX_LINES) : lines;
```

#### 5. Copy Button
```typescript
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 hover:bg-zinc-700 rounded"
      title="Copy output"
    >
      {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}
```

#### 6. Summary Line Content
When a description is provided, display both the description (as primary) and the command below it.
When no description is provided, show only the command.

```typescript
interface SummaryContent {
  primary: string;      // Description or command (shown on main line)
  command?: string;     // Command (shown below, only when description exists)
}

function getSummaryContent(input: BashInput): SummaryContent {
  if (input.description) {
    return {
      primary: input.description,
      command: truncate(input.command, 80),
    };
  }
  return {
    primary: truncate(input.command, 60),
  };
}
```

Rendering logic:
```tsx
const summary = getSummaryContent(input);

return (
  <div className="flex flex-col gap-0.5">
    <div className="flex items-center gap-2">
      <ChevronIcon />
      <span className="text-zinc-200">{summary.primary}</span>
      <StatusBadge />
    </div>
    {summary.command && (
      <div className="pl-6 text-zinc-500 font-mono text-sm">
        $ {summary.command}
      </div>
    )}
  </div>
);
```

### Styling

#### Color Palette
- Background: transparent (inherits from chat)
- Left border (default): `border-l-2 border-zinc-600` (subtle accent)
- Left border (error): `border-l-2 border-red-500/50`
- Left border (success): `border-l-2 border-green-500/30` (optional, could stay neutral)
- Prompt `$`: `text-green-400`
- Command text: `text-zinc-200`
- Output text: `text-zinc-400` (slightly muted)
- Exit 0: `text-green-400`
- Exit non-zero: `text-red-400`
- Running spinner: `text-zinc-400`

#### Font
- All terminal content: `font-mono text-sm`
- Consistent with existing code blocks

#### Spacing
- Minimal padding, relies on left border for visual grouping
- Output indented slightly from command line
- Comfortable line-height for readability

### Accessibility

1. **ARIA Labels**
   - Container: `aria-label="Bash command: {command}, status: {status}"`
   - Expand/collapse: proper `aria-expanded` state

2. **Screen Reader**
   - Announce status changes
   - Exit code read as "Exit code 0" not just "Exit 0"

3. **Keyboard Navigation**
   - Enter/Space to toggle expand
   - Copy button focusable

---

## Integration

### Registry Entry
```typescript
// tool-blocks/index.ts
import { BashToolBlock } from './bash-tool-block';

const TOOL_BLOCK_REGISTRY = {
  Bash: BashToolBlock,
  // ... other tools fall back to GenericToolBlock
};
```

### Assistant Message Integration
```typescript
// In assistant-message.tsx
import { getToolBlockComponent } from './tool-blocks';

// When rendering tool_use blocks:
const ToolBlock = getToolBlockComponent(toolUse.name);
return <ToolBlock {...props} />;
```

---

## Testing Plan

### Unit Tests (`bash-tool-block.test.tsx`)
1. Renders collapsed state correctly
2. Expands on click
3. Shows running state with spinner
4. Shows success state with green exit badge
5. Shows error state with red styling and exit badge
6. Truncates long output
7. "Show more" expands truncated output
8. Copy button copies output to clipboard
9. Background task shows shell ID
10. Handles missing/undefined result gracefully

### Visual Tests (`bash-tool-block.ui.test.tsx`)
1. Running state appearance
2. Success state appearance
3. Error state appearance
4. Long output truncation
5. Background task display
6. Responsive behavior

### Integration Tests
1. Renders correctly within thread view
2. Status transitions (running → complete)
3. Streaming output updates

---

## Edge Cases

1. **Empty output**: Show command only, no output section
2. **Very long command**: Truncate in summary, show full in expanded
3. **Binary output / non-UTF8**: Show "[Binary output]" or hex preview
4. **No exit code available**: Don't show badge, just checkmark/X
5. **Timeout**: Show timeout message, treat as error
6. **Killed process**: Show "Killed" or "Terminated" status

---

## Future Enhancements (Out of Scope)

1. ANSI color code parsing
2. Clickable URLs in output
3. Syntax highlighting for known output formats (JSON, etc.)
4. Diff highlighting for git commands
5. Collapsible output sections (stdout vs stderr)

---

## Implementation Checklist

- [ ] Create `src/components/thread/tool-blocks/` directory
- [ ] Create `bash-tool-block.tsx` component
- [ ] Create `tool-blocks/index.ts` with registry
- [ ] Implement collapsed summary view
- [ ] Implement expanded output view
- [ ] Add exit code badge component
- [ ] Add copy button functionality
- [ ] Handle running state with spinner
- [ ] Handle error state with red styling
- [ ] Handle background task state
- [ ] Add output truncation with "Show more"
- [ ] Update `assistant-message.tsx` to use registry
- [ ] Write unit tests
- [ ] Write visual regression tests
- [ ] Test with real Bash tool calls in thread
