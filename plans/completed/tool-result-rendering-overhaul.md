# Tool Result Rendering Overhaul Plan

## Overview

This plan outlines a complete overhaul of how tool calls and tool results are rendered in the thread view. The goal is to move from a generic, JSON-heavy dropdown approach to specialized, readable rendering components for each tool type.

---

## Current Architecture

### File Structure

```
src/components/thread/
├── thread-view.tsx           # Main container, manages state + message display
├── message-list.tsx          # Virtualized scrollable list (react-virtuoso)
├── turn-renderer.tsx         # Routes turns to UserMessage or AssistantMessage
├── assistant-message.tsx     # Renders mixed content: text, thinking, tool_use blocks
├── tool-use-block.tsx        # CURRENT: Generic collapsible card for ALL tool types
├── tool-status-icon.tsx      # Status icons (running, complete, error, pending)
├── inline-diff-block.tsx     # Inline diff display (used by Edit/Write)
├── inline-diff-header.tsx    # Diff header with stats
├── inline-diff-actions.tsx   # Accept/reject buttons for pending edits
├── ask-user-question-block.tsx  # Interactive question UI (already specialized!)
├── use-tool-diff.ts          # Hook to extract/generate diffs
├── text-block.tsx            # Renders markdown text
└── thinking-block.tsx        # Renders thinking blocks

src/lib/utils/
├── tool-formatters.ts        # Human-friendly formatting of tool inputs
├── tool-icons.ts             # Icon mapping for tool names
├── diff-extractor.ts         # Diff extraction/generation utilities
└── turn-grouping.ts          # Utilities for grouping messages into turns
```

### Current Rendering Flow

1. `ThreadView` passes messages + `toolStates` to `MessageList`
2. `MessageList` renders turns via `TurnRenderer`
3. `TurnRenderer` routes assistant turns to `AssistantMessage`
4. `AssistantMessage` iterates over content blocks:
   - `text` → `TextBlock`
   - `thinking` → `ThinkingBlock`
   - `tool_use` → `ToolUseBlock` (generic) or `AskUserQuestionBlock` (specialized)

### Current `ToolUseBlock` Behavior

- **Collapsible** using `<details>` element (good - keep this pattern)
- **Summary line** shows: icon, tool name, formatted primary info, duration, status
- **Expanded content** shows:
  - Raw JSON input (truncated at 500 chars)
  - Raw JSON output (truncated at 1000 chars)
  - Inline diff for Edit/Write tools only

### What Works Well

1. Collapsible pattern - keeps UI clean
2. Status indicators (running spinner, check, error icon)
3. Duration display
4. Inline diffs for Edit/Write
5. `AskUserQuestionBlock` - already a specialized component with great UX

### What Needs Improvement

1. **Raw JSON is hard to read** - Most tool results are dumped as JSON blobs
2. **All tools look the same** - No visual differentiation based on tool type
3. **Important info buried** - Key information requires expanding and reading JSON
4. **No semantic structure** - File lists, search results, errors all look identical
5. **No syntax highlighting** - Code/commands shown as plain text

---

## All Tool Types & Recommended Displays

### Core UI Convention (Based on BashToolBlock)

**All tool blocks MUST follow the BashToolBlock UI pattern:**

1. **Header row:** Chevron + Icon + Tool name + Description/summary text (shimmer while running)
2. **Second line (collapsed):** Key details (command, file path, pattern, etc.)
3. **Expandable section:** Detailed output/results

This creates visual consistency across all tools. The table below specifies what content goes in each section per tool type.

### Tool-Specific Content

| Tool | Header Summary | Second Line Icon | Second Line (Collapsed) | Expandable Content |
|------|----------------|------------------|-------------------------|-------------------|
| **Bash** ✅ | Description or "Running command" | `$` (green text) | `$ command` | Terminal output, exit code badge |
| **Read** | "Read file" / "Reading file" | `FileText` | File path | File path only (no content needed) |
| **Write** | "Write file" / "Writing file" | `FilePlus` | File path | List of files written; each file expandable to show diff (all additions) |
| **Edit** | "Edit file" / "Editing file" | `Pencil` | File path + replacement count | List of files edited; each file expandable to show inline diff |
| **Glob** | "Find files" / "Finding files" | `FolderSearch` | Pattern + match count (e.g., `**/*.tsx → 23 files`) | List of matching file paths |
| **Grep** | "Search" / "Searching" | `Search` | Pattern + match summary (e.g., `"useState" → 15 matches in 8 files`) | Grouped results by file with highlighted matches |
| **WebSearch** | "Web search" / "Searching web" | `Globe` | Query text | Search result cards with links and snippets |
| **WebFetch** | "Fetch URL" / "Fetching URL" | `Link` | URL (truncated) | AI response as markdown |
| **Task** | Agent description | `GitBranch` | Subagent type badge | Full result text, duration, usage stats |
| **TaskOutput** | "Task output" | `ArrowDownToLine` | Task ID + status | Output content |
| **TodoWrite** | "Update todos" | `ListTodo` | Item count + status summary | Todo checklist preview |
| **AskUserQuestion** | — | — | — | **Already specialized** - no changes needed |
| **LSP** | Operation name | `Code` | `file:line` | Results by operation type |
| **NotebookEdit** | "Edit notebook" | `NotebookPen` | Notebook path + cell info | Cell preview |
| **KillShell** | "Kill shell" | `XCircle` | Shell ID | Success/failure message |
| **EnterPlanMode** | "Enter plan mode" | `Map` | — | Status message |
| **ExitPlanMode** | "Exit plan mode" | `MapPinCheck` | — | Approval status |
| **Skill** | Skill name | `Zap` | Args if any | Skill output |

### Second Line Icon Reference

All icons use `lucide-react`. The icon appears at the start of the second line (like `$` does for Bash):

```tsx
import { FileText, FilePlus, Pencil, FolderSearch, Search, Globe, Link,
         GitBranch, ArrowDownToLine, ListTodo, Code, NotebookPen,
         XCircle, Map, MapPinCheck, Zap } from "lucide-react";

// Icon styling: small, muted color, consistent with Bash's $ symbol
<FileText className="w-3 h-3 text-zinc-500 shrink-0" />
```

**Bash is special:** Uses the `$` character (styled as green text) rather than a Lucide icon, matching terminal conventions.

### GenericToolBlock (Fallback)

**IMPORTANT:** The `GenericToolBlock` must also follow the BashToolBlock conventions:
- Same header layout (chevron + icon + name + shimmer text)
- Second line showing key input parameters
- Expandable section for JSON output (formatted, not raw)

This ensures that even unknown/MCP tools have a consistent, polished appearance.

---

## Reusable UI Components (from `src/components/ui/`)

The `BashToolBlock` pilot established several reusable components that should be used across all tool blocks. See `plans/extract-reusable-tool-block-components.md` for full details.

### Available Components

| Component | Purpose | Use In |
|-----------|---------|--------|
| **`CopyButton`** | Copy-to-clipboard with checkmark feedback | All tools with copyable content (commands, paths, output) |
| **`ShimmerText`** | Loading/running state animation | All tool headers during `running` status |
| **`CollapsibleOutputBlock`** | Long content with gradient overlay + expand/collapse | Read, Bash, Grep, Task output sections |
| **`ExpandChevron`** | Animated chevron for expand/collapse state | All collapsible headers |
| **`StatusIcon`** | Success/failure indicator (check/X) | All tools showing completion status |
| **`CollapsibleBlock`** | Wrapper with click handler, keyboard nav, ARIA | Base pattern for all tool blocks |

### Component Usage by Tool Block

```
ReadToolBlock:
  - CopyButton (file path)
  - ShimmerText (header while running)
  - CollapsibleOutputBlock (file contents)
  - ExpandChevron (header)

BashToolBlock: ✅ Already uses all components
  - CopyButton (command, output)
  - ShimmerText (description while running)
  - CollapsibleOutputBlock (stdout/stderr)
  - ExpandChevron (header, output section)
  - StatusIcon (exit code indicator)

GlobToolBlock:
  - CopyButton (pattern, individual paths)
  - ShimmerText (header while running)
  - CollapsibleOutputBlock (if many results)
  - ExpandChevron (header)

GrepToolBlock:
  - CopyButton (pattern, file paths)
  - ShimmerText (header while running)
  - CollapsibleOutputBlock (per-file results)
  - ExpandChevron (header, per-file sections)

WebSearchToolBlock:
  - ShimmerText (header while running)
  - ExpandChevron (header)

WebFetchToolBlock:
  - CopyButton (URL)
  - ShimmerText (header while running)
  - CollapsibleOutputBlock (response content)
  - ExpandChevron (header)

TaskToolBlock:
  - ShimmerText (header while running)
  - CollapsibleOutputBlock (full result)
  - ExpandChevron (header)

TodoWriteToolBlock:
  - ShimmerText (header while running)
  - ExpandChevron (header)
  - StatusIcon (per-item status - adapt for pending/in-progress/completed)

LSPToolBlock:
  - CopyButton (file:line references)
  - ShimmerText (header while running)
  - ExpandChevron (header)

NotebookEditToolBlock:
  - CopyButton (cell content)
  - ShimmerText (header while running)
  - CollapsibleOutputBlock (cell preview)
  - ExpandChevron (header)

GenericToolBlock:
  - ShimmerText (header while running)
  - CollapsibleOutputBlock (JSON output)
  - ExpandChevron (header)
```

---

## Proposed Architecture

### New Directory Structure

```
src/components/thread/
├── tool-blocks/
│   ├── index.ts                      # Barrel export + tool type registry
│   ├── base-tool-block.tsx           # Shared collapsible wrapper
│   ├── tool-block-header.tsx         # Shared header: icon, name, summary, status
│   ├── tool-block-utils.ts           # Shared utilities
│   │
│   ├── read-tool-block.tsx           # File read display
│   ├── write-tool-block.tsx          # File write/create display
│   ├── edit-tool-block.tsx           # File edit with diff
│   ├── bash-tool-block.tsx           # Terminal output display
│   ├── glob-tool-block.tsx           # File list display
│   ├── grep-tool-block.tsx           # Search results display
│   ├── web-search-tool-block.tsx     # Web search results
│   ├── web-fetch-tool-block.tsx      # Web fetch results
│   └── generic-tool-block.tsx        # Fallback for all other tools (follows BashToolBlock conventions)
│
├── ask-user-question-block.tsx       # Keep existing (already good)
└── ... (other existing files)
```

### Component Registry Pattern

```typescript
// tool-blocks/index.ts
// Phase 2 tools get specialized blocks; others use GenericToolBlock
const TOOL_BLOCK_REGISTRY: Record<string, React.ComponentType<ToolBlockProps>> = {
  // Phase 1 - Completed
  Bash: BashToolBlock,

  // Phase 2 - High-impact specialized tools
  Read: ReadToolBlock,
  Write: WriteToolBlock,
  Edit: EditToolBlock,
  Glob: GlobToolBlock,
  Grep: GrepToolBlock,
  WebSearch: WebSearchToolBlock,
  WebFetch: WebFetchToolBlock,

  // All other tools use GenericToolBlock (which follows BashToolBlock conventions)
  // Task, TaskOutput, TodoWrite, LSP, NotebookEdit, KillShell,
  // EnterPlanMode, ExitPlanMode, Skill, and MCP tools
};

export function getToolBlockComponent(toolName: string): React.ComponentType<ToolBlockProps> {
  return TOOL_BLOCK_REGISTRY[toolName] ?? GenericToolBlock;
}
```

### Shared Base Component

**NOTE:** The `BaseToolBlock` should be built on top of the reusable UI components:

```typescript
// tool-blocks/base-tool-block.tsx
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { ShimmerText } from "@/components/ui/shimmer-text";

interface BaseToolBlockProps {
  id: string;
  name: string;
  status: ToolStatus;
  durationMs?: number;
  isError?: boolean;
  // Render props for customization
  renderSummary: () => React.ReactNode;
  renderContent: () => React.ReactNode;
  // Optional overrides
  defaultExpanded?: boolean;
  headerClassName?: string;
}

export function BaseToolBlock({ ... }: BaseToolBlockProps) {
  // Uses CollapsibleBlock for expand/collapse with keyboard nav + ARIA
  // Uses ExpandChevron in header
  // Uses ShimmerText for running state
  // Handles: collapse/expand, status icon, duration, animations
  // Delegates summary + content rendering to children
}
```

### Shared Props Interface

```typescript
// All tool blocks receive these standard props
interface ToolBlockProps {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  status: ToolStatus;
  durationMs?: number;
  // Optional callbacks
  onOpenDiff?: (filePath: string) => void;
  onAccept?: () => void;
  onReject?: () => void;
  isFocused?: boolean;
}
```

---

## Implementation Details by Tool Type

### ReadToolBlock

**Follows BashToolBlock convention:**
- **Header:** Chevron + Icon + "Read file" (shimmer: "Reading file")
- **Second line:** File path (e.g., `src/components/App.tsx`)
- **Expanded:** File path only (no file content displayed)

**Reusable components:**
- `ShimmerText` - Header text while file is being read
- `CopyButton` - Copy file path
- `ExpandChevron` - Header expand/collapse indicator

**Note:** We intentionally do NOT display file contents. The file path is sufficient context for the user to understand what was read.

### WriteToolBlock

**Follows BashToolBlock convention:**
- **Header:** Chevron + Icon + "Write file" (shimmer: "Writing file")
- **Second line:** File path (e.g., `src/components/NewComponent.tsx`)
- **Expanded:** List of files written; each file expandable to show diff (all additions in green)

**Reusable components:**
- `ShimmerText` - Header text while writing
- `CopyButton` - Copy file path
- `ExpandChevron` - Header expand/collapse indicator
- `CollapsibleBlock` - Per-file expandable sections for diffs

**Expanded content:**
- List of file paths (usually just one)
- Each file path is expandable to reveal inline diff showing all new content as additions

### EditToolBlock

**Follows BashToolBlock convention:**
- **Header:** Chevron + Icon + "Edit file" (shimmer: "Editing file")
- **Second line:** File path + replacement count (e.g., `src/utils.ts` `2 replacements`)
- **Expanded:** List of files edited; each file expandable to show inline diff

**Reusable components:**
- `ShimmerText` - Header text while editing
- `CopyButton` - Copy file path
- `ExpandChevron` - Header expand/collapse indicator
- `CollapsibleBlock` - Per-file expandable sections for diffs

**Expanded content:**
- List of edited files with replacement counts
- Each file is expandable to reveal the inline diff (existing component)
- Highlight old_string → new_string changes

### BashToolBlock ✅ COMPLETED (Pilot)

**Summary line:** `Bash` `npm test` (from description or command)

**Reusable components:** (all extracted from this pilot)
- `ShimmerText` - Description/command while running
- `CopyButton` - Copy command and output
- `CollapsibleOutputBlock` - stdout/stderr with gradient overlay
- `ExpandChevron` - Header and output section toggles
- `StatusIcon` - Exit code success/failure indicator

**Expanded content:**
- Terminal-style dark background with monospace font
- Prompt line: `$ npm test`
- Output with ANSI color support (or at minimum, stderr in red)
- Exit code badge: green "Exit 0" or red "Exit 1"
- Copy output button
- For background tasks: show "Running..." with shell ID

### GlobToolBlock

**Follows BashToolBlock convention:**
- **Header:** Chevron + Icon + "Find files" (shimmer: "Finding files")
- **Second line:** Pattern + match count (e.g., `**/*.tsx → 23 files`)
- **Expanded:** List of matching file paths

**Reusable components:**
- `ShimmerText` - Header text while searching
- `CopyButton` - Copy pattern, individual file paths
- `CollapsibleOutputBlock` - File list (if many results)
- `ExpandChevron` - Header expand/collapse

**Expanded content:**
- Simple list of matching file paths
- Copy button for individual paths
- Show pattern used + search path at top

### GrepToolBlock

**Follows BashToolBlock convention:**
- **Header:** Chevron + Icon + "Search" (shimmer: "Searching")
- **Second line:** Pattern + match summary (e.g., `"useState" → 15 matches in 8 files`)
- **Expanded:** Grouped results by file with highlighted matches

**Reusable components:**
- `ShimmerText` - Header text while searching
- `CopyButton` - Copy pattern, file paths
- `CollapsibleOutputBlock` - Per-file result sections
- `ExpandChevron` - Header and per-file section toggles
- `CollapsibleBlock` - Nested collapsible sections for each file

**Expanded content:**
- Search results grouped by file
- Each match shows: line number, context lines (before/after)
- Pattern highlighted in yellow/orange
- File names as collapsible headers (use `CollapsibleBlock` with `ExpandChevron`)
- Match count per file

### WebSearchToolBlock

**Follows BashToolBlock convention:**
- **Header:** Chevron + Icon + "Web search" (shimmer: "Searching web")
- **Second line:** Query text
- **Expanded:** Search result cards with links and snippets

**Reusable components:**
- `ShimmerText` - Header text while searching
- `ExpandChevron` - Header expand/collapse
- `CopyButton` - Copy individual URLs

**Expanded content:**
- Search result cards:
  - Title (clickable link)
  - URL (subdued)
  - Snippet with query terms highlighted
- Source favicon/icon if available
- "Powered by web search" footer

### WebFetchToolBlock

**Follows BashToolBlock convention:**
- **Header:** Chevron + Icon + "Fetch URL" (shimmer: "Fetching URL")
- **Second line:** URL (truncated)
- **Expanded:** AI response as markdown

**Reusable components:**
- `ShimmerText` - Header text while fetching
- `CopyButton` - Copy URL
- `CollapsibleOutputBlock` - Response content (can be long)
- `ExpandChevron` - Header expand/collapse

**Expanded content:**
- URL header (truncated with full on hover)
- Final URL if different (redirects)
- AI response rendered as markdown

### TaskToolBlock, TodoWriteToolBlock, LSPToolBlock, etc.

**These tools use the GenericToolBlock (fallback) for now.**

The GenericToolBlock follows BashToolBlock conventions with:
- **Header:** Chevron + Icon + Tool name (shimmer while running)
- **Second line:** Key input parameters formatted nicely
- **Expanded:** Formatted JSON output (not raw)

Future iterations may add specialized blocks for these tools if needed.

---

## Shared Utilities

### `tool-block-utils.ts`

```typescript
// Parse tool result JSON safely
export function parseToolResult<T>(result: string | undefined): T | null;

// Format file size for display
export function formatFileSize(bytes: number): string;

// Detect language from file path
export function detectLanguage(filePath: string): string;

// Truncate with "show more" support
export function useTruncatedContent(content: string, maxLength: number);

// ANSI to React elements (for terminal output)
export function ansiToReact(text: string): React.ReactNode;
```

### Syntax Highlighting

Consider using:
- `react-syntax-highlighter` with a dark theme
- Or `shiki` for more accurate highlighting
- Or keep simple with just monospace + basic coloring

---

## Migration Strategy

### Pilot Tool: `Bash`

Before implementing all tools, we'll fully iterate on **BashToolBlock** as our pilot. This tool was chosen because:

1. **Highest frequency** - Almost every agent session uses Bash multiple times, giving us lots of real-world test cases
2. **Rich output patterns** - Covers many UI patterns we'll reuse:
   - Success/error states (exit codes)
   - Output truncation for long results
   - Copy functionality
   - Status badges
   - Potentially ANSI color parsing
3. **Clear success criteria** - Easy to judge if it "looks right" (should feel like a terminal)
4. **Medium complexity** - Complex enough to establish patterns, not so complex we get bogged down
5. **Highly transferable** - The conventions we develop will directly inform:
   - Header layout and iconography
   - Expand/collapse behavior and animations
   - Copy button placement and behavior
   - Status badge styling
   - Output formatting and truncation
   - Error state display

**Pilot Process:**
1. Build `BashToolBlock` end-to-end
2. Iterate on design until we're happy
3. Extract patterns into `BaseToolBlock` and shared utilities
4. Document conventions in a style guide
5. Apply conventions to remaining tools

**Alternatives Considered:**
- `Grep` - Tempting because it's currently the hardest to read, but too complex for a pilot (grouping, highlighting, context lines). Better to nail fundamentals first.
- `Read` - Good candidate but syntax highlighting adds complexity; Bash lets us focus on layout/interaction patterns first.
- `Task` - Complex nested content; save for later.

---

### Phase 1: Bash Pilot (Full Polish) ✅ COMPLETED

**Goal:** Fully polished BashToolBlock that establishes conventions for all other tools.

1. ✅ Create `tool-blocks/` directory structure
2. ✅ Build `BashToolBlock` with:
   - Terminal-style rendering
   - Exit code badge (green/red)
   - Command display with `$` prompt
   - Output with proper truncation
   - Copy button
   - Error state styling
   - Background task handling (shell ID, "running" state)
3. ✅ Iterate on design with real usage
4. ✅ Extract shared patterns:
   - `BaseToolBlock` wrapper
   - `ToolBlockProps` interface
   - `tool-block-utils.ts` utilities
   - Component registry pattern
5. ✅ Create `GenericToolBlock` (current behavior as fallback)
6. Document conventions

### Phase 1.5: Extract Reusable UI Components ✅ COMPLETED

**Goal:** Extract patterns from BashToolBlock into `src/components/ui/` for use across all tool blocks.

See `plans/extract-reusable-tool-block-components.md` for full implementation details.

**Components extracted:**
1. ✅ `CopyButton` - Copy-to-clipboard with checkmark feedback
2. ✅ `ShimmerText` - Loading/running state text animation
3. ✅ `ExpandChevron` - Animated chevron for expand/collapse
4. ✅ `StatusIcon` - Binary success/failure indicator
5. ✅ `CollapsibleOutputBlock` - Long content with gradient overlay
6. ✅ `CollapsibleBlock` - Wrapper with keyboard nav + ARIA

**After extraction:**
- ✅ Refactor `BashToolBlock` to import from `@/components/ui/`
- ✅ Verify no visual regression
- All subsequent tool blocks use these components from the start

### Phase 2: Update GenericToolBlock

**CRITICAL:** Before implementing specialized tool blocks, update `GenericToolBlock` to follow BashToolBlock conventions. This ensures ALL tools (including MCP tools and any we haven't specialized) have a consistent, polished appearance.

**GenericToolBlock must have:**
- **Header:** Chevron + Icon + Tool name (shimmer while running)
- **Second line:** Key input parameters formatted nicely (not raw JSON)
- **Expanded:** Formatted output (not raw JSON blob)

This is the foundation for visual consistency across the entire tool system.

### Phase 3: Specialized Tool Blocks

**Prerequisite:** Phase 2 (GenericToolBlock update) must be complete.

Each tool block imports reusable components from `@/components/ui/`:

1. `ReadToolBlock` - File path display (no content)
   - Uses: `ShimmerText`, `CopyButton`, `ExpandChevron`
2. `WriteToolBlock` - File list with expandable diffs
   - Uses: `ShimmerText`, `CopyButton`, `ExpandChevron`, `CollapsibleBlock`
3. `EditToolBlock` - File list with expandable diffs
   - Uses: `ShimmerText`, `CopyButton`, `ExpandChevron`, `CollapsibleBlock`
4. `GlobToolBlock` - File list display
   - Uses: `ShimmerText`, `CopyButton`, `CollapsibleOutputBlock`, `ExpandChevron`
5. `GrepToolBlock` - Grouped search results
   - Uses: `ShimmerText`, `CopyButton`, `CollapsibleOutputBlock`, `ExpandChevron`, `CollapsibleBlock`
6. `WebSearchToolBlock` - Search result cards
   - Uses: `ShimmerText`, `ExpandChevron`, `CopyButton`
7. `WebFetchToolBlock` - URL + markdown response
   - Uses: `ShimmerText`, `CopyButton`, `CollapsibleOutputBlock`, `ExpandChevron`

### Phase 4: Polish
1. ~~Add copy buttons where useful~~ (handled by `CopyButton` component in each block)
2. ~~Add keyboard navigation~~ (handled by `CollapsibleBlock` component)
3. Performance optimization (virtualize long lists)
4. ~~Add animations for expand/collapse~~ (handled by `ExpandChevron` component)
5. Review component API consistency across all tool blocks

---

## Testing Strategy

1. **Unit tests** for each tool block component
2. **Visual regression tests** using existing `*.ui.test.tsx` pattern
3. **Integration tests** with real state.json data
4. Test with various result sizes (empty, normal, huge)
5. Test error states for each tool type

---

## Open Questions

1. **Should expanded state persist?** Currently resets on re-render.
2. ~~**How to handle MCP tools?** Use generic or create dynamic renderer?~~ → Use GenericToolBlock (follows BashToolBlock conventions)
3. **Should we support themes?** Light mode? Different syntax themes?
4. **Performance with many tool calls?** May need virtualization within tool results.
5. **Copy functionality?** What exactly should copy buttons copy?

---

## Success Criteria

1. **GenericToolBlock follows BashToolBlock conventions** - This is the foundation; ensures ALL tools look consistent
2. Each specialized tool type has readable, well-formatted output
3. Key information visible without expanding (good summaries in header + second line)
4. Expanded content is well-formatted, not raw JSON
5. Maintains current collapsible behavior (chevron, expand/collapse)
6. No regression in performance
7. Backwards compatible with existing state.json files
8. **All tool blocks consistently use reusable UI components** (`CopyButton`, `ShimmerText`, `CollapsibleOutputBlock`, `ExpandChevron`, `StatusIcon`, `CollapsibleBlock`)

---

## Related Plans

- **`plans/extract-reusable-tool-block-components.md`** - Details the extraction of reusable UI components from the BashToolBlock pilot. This plan should be completed as Phase 1.5 before implementing Phase 2+ tool blocks.
