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

Based on the Claude Agent SDK documentation and analysis of actual usage:

| Tool | Input Summary | Output Summary | Recommended Display |
|------|---------------|----------------|---------------------|
| **Read** | `file_path`, `offset?`, `limit?` | File contents with line numbers | Code block with syntax highlighting, line numbers, collapsible for long files. Show file path prominently. |
| **Write** | `file_path`, `content` | Success message, bytes written | Diff view showing new file content (all additions). File path header. Success indicator. |
| **Edit** | `file_path`, `old_string`, `new_string`, `replace_all?` | Success message, replacement count | **Already good:** inline diff. Enhance: show replacement count, highlight matched regions. |
| **Bash** | `command`, `timeout?`, `description?`, `run_in_background?` | stdout/stderr, exit code, shellId? | Terminal-style output with colored prompt/output. Exit code badge (green=0, red=non-zero). Copy button. |
| **Glob** | `pattern`, `path?` | Array of matching file paths, count | File tree or list view with icons by file type. Show pattern and match count prominently. |
| **Grep** | `pattern`, `path?`, `glob?`, output_mode, context flags | Matches with line numbers/context | Search results with highlighted matches, file grouping, line numbers. Like VS Code search results. |
| **WebSearch** | `query`, domain filters | Search results with title, URL, snippet | Search result cards with clickable links, snippets, source icons. |
| **WebFetch** | `url`, `prompt` | AI's response to prompt about content | URL as header, AI response as markdown. Show final URL if redirected. |
| **Task** | `description`, `prompt`, `subagent_type` | Result string, usage stats, cost | Subagent summary card: description, duration, token usage, cost badge. Expandable for full result. |
| **TaskOutput** | `task_id`, `block?`, `timeout?` | Output, status (running/completed/failed) | Status badge + output. Progress indicator if still running. |
| **TodoWrite** | `todos` array with content/status/activeForm | Success message, stats | Todo checklist preview with status icons. Compact pill showing "3 items, 1 in progress". |
| **AskUserQuestion** | `questions` array | `answers` mapping | **Already specialized** - interactive radio/checkbox UI. No changes needed. |
| **LSP** | `operation`, `filePath`, `line`, `character` | Definition/references/hover info | Code references with clickable file:line links. Symbol info card for hover. |
| **NotebookEdit** | `notebook_path`, `cell_id?`, `new_source`, etc. | Success, edit_type, cell count | Notebook cell preview showing the edited cell. Syntax highlighting. |
| **KillShell** | `shell_id` | Success message | Simple status message - minimal display needed. |
| **EnterPlanMode** | (empty) | (awaits user) | Status indicator showing "Entered plan mode". |
| **ExitPlanMode** | (empty) | Approval status | Plan summary preview if available. Approval badge. |
| **Skill** | `skill`, `args?` | Skill output | Skill name badge + output formatted based on skill type. |

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
│   ├── task-tool-block.tsx           # Subagent task display
│   ├── task-output-tool-block.tsx    # Background task output
│   ├── todo-write-tool-block.tsx     # Todo list display
│   ├── lsp-tool-block.tsx            # LSP results display
│   ├── notebook-edit-tool-block.tsx  # Jupyter edit display
│   ├── generic-tool-block.tsx        # Fallback for unknown tools
│   └── mcp-tool-block.tsx            # MCP tool display (fallback)
│
├── ask-user-question-block.tsx       # Keep existing (already good)
└── ... (other existing files)
```

### Component Registry Pattern

```typescript
// tool-blocks/index.ts
const TOOL_BLOCK_REGISTRY: Record<string, React.ComponentType<ToolBlockProps>> = {
  Read: ReadToolBlock,
  Write: WriteToolBlock,
  Edit: EditToolBlock,
  Bash: BashToolBlock,
  Glob: GlobToolBlock,
  Grep: GrepToolBlock,
  WebSearch: WebSearchToolBlock,
  WebFetch: WebFetchToolBlock,
  Task: TaskToolBlock,
  TaskOutput: TaskOutputToolBlock,
  TodoWrite: TodoWriteToolBlock,
  LSP: LSPToolBlock,
  NotebookEdit: NotebookEditToolBlock,
  KillShell: GenericToolBlock, // Simple enough for generic
  EnterPlanMode: GenericToolBlock,
  ExitPlanMode: GenericToolBlock,
  Skill: GenericToolBlock,
};

export function getToolBlockComponent(toolName: string): React.ComponentType<ToolBlockProps> {
  return TOOL_BLOCK_REGISTRY[toolName] ?? GenericToolBlock;
}
```

### Shared Base Component

```typescript
// tool-blocks/base-tool-block.tsx
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

**Summary line:** `Read` `src/components/App.tsx` `lines 1-50`

**Expanded content:**
- Syntax-highlighted code block (detect language from extension)
- Line numbers in gutter
- File path header with copy button
- "Show more" for truncated files (offset/limit info)
- For images/PDFs: render inline preview

### BashToolBlock

**Summary line:** `Bash` `npm test` (from description or command)

**Expanded content:**
- Terminal-style dark background with monospace font
- Prompt line: `$ npm test`
- Output with ANSI color support (or at minimum, stderr in red)
- Exit code badge: green "Exit 0" or red "Exit 1"
- Copy output button
- For background tasks: show "Running..." with shell ID

### GlobToolBlock

**Summary line:** `Glob` `**/*.tsx` `→ 23 files`

**Expanded content:**
- File list with appropriate icons (folder, file type icons)
- Grouped by directory (collapsible tree view)
- Clickable file paths (could integrate with editor opening)
- Show pattern used + search path

### GrepToolBlock

**Summary line:** `Grep` `"useState"` `→ 15 matches in 8 files`

**Expanded content:**
- Search results grouped by file
- Each match shows: line number, context lines (before/after)
- Pattern highlighted in yellow/orange
- File names as collapsible headers
- Match count per file

### WebSearchToolBlock

**Summary line:** `WebSearch` `"React hooks best practices 2025"`

**Expanded content:**
- Search result cards:
  - Title (clickable link)
  - URL (subdued)
  - Snippet with query terms highlighted
- Source favicon/icon if available
- "Powered by web search" footer

### WebFetchToolBlock

**Summary line:** `WebFetch` `docs.anthropic.com/...`

**Expanded content:**
- URL header (truncated with full on hover)
- Final URL if different (redirects)
- AI response rendered as markdown
- "Fetched and analyzed" footer

### TaskToolBlock

**Summary line:** `Task` `Exploring codebase` (`Explore` agent)

**Expanded content:**
- Subagent type badge
- Description/prompt preview
- Duration and token usage stats
- Cost (if available): `$0.02`
- Full result text (markdown rendered)
- Expandable "View full transcript" if needed

### TodoWriteToolBlock

**Summary line:** `TodoWrite` `4 items` (2 pending, 1 in progress, 1 completed)

**Expanded content:**
- Mini todo list with status icons:
  - ⏳ Pending
  - 🔄 In progress
  - ✅ Completed
- Each item shows content + activeForm
- Compact, scannable format

### LSPToolBlock

**Summary line:** `LSP` `goToDefinition` `→ src/utils.ts:42`

**Expanded content:**
- Operation type badge
- Results formatted by operation:
  - goToDefinition: clickable file:line link
  - findReferences: list of locations
  - hover: documentation/type info card
  - documentSymbol: symbol tree

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

### Phase 1: Bash Pilot (Full Polish)

**Goal:** Fully polished BashToolBlock that establishes conventions for all other tools.

1. Create `tool-blocks/` directory structure
2. Build `BashToolBlock` with:
   - Terminal-style rendering
   - Exit code badge (green/red)
   - Command display with `$` prompt
   - Output with proper truncation
   - Copy button
   - Error state styling
   - Background task handling (shell ID, "running" state)
3. Iterate on design with real usage
4. Extract shared patterns:
   - `BaseToolBlock` wrapper
   - `ToolBlockProps` interface
   - `tool-block-utils.ts` utilities
   - Component registry pattern
5. Create `GenericToolBlock` (current behavior as fallback)
6. Document conventions

### Phase 2: High-Impact Tools
1. `GrepToolBlock` - Search results are currently very hard to read
2. `GlobToolBlock` - File lists need better display
3. `ReadToolBlock` - Syntax highlighting is huge win

### Phase 3: Remaining Tools
1. `WebSearchToolBlock`
2. `WebFetchToolBlock`
3. `TaskToolBlock`
4. `TodoWriteToolBlock`
5. `LSPToolBlock`
6. `NotebookEditToolBlock`

### Phase 4: Polish
1. Add copy buttons where useful
2. Add keyboard navigation
3. Performance optimization (virtualize long lists)
4. Add animations for expand/collapse

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
2. **How to handle MCP tools?** Use generic or create dynamic renderer?
3. **Should we support themes?** Light mode? Different syntax themes?
4. **Performance with many tool calls?** May need virtualization within tool results.
5. **Copy functionality?** What exactly should copy buttons copy?

---

## Success Criteria

1. Each tool type has visually distinct, readable output
2. Key information visible without expanding (good summaries)
3. Expanded content is well-formatted, not raw JSON
4. Maintains current collapsible behavior
5. No regression in performance
6. Backwards compatible with existing state.json files
