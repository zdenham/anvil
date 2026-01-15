# Diff Viewer

## Overview

Build a custom diff viewer component that takes any arbitrary git diff and renders it with syntax highlighting and collapsible unchanged sections. The viewer displays full file contents with changed sections highlighted and non-diffed sections collapsed by default.

**Key Principles** (from `system-integration.md`):

- **Disk always wins**: Load from `changes.jsonl` on mount. Stdout streaming is for low-latency display only—not persistence.
- **Stdout for display, files for persistence**: Real-time updates via stdout (purpose-built for child process output). File watching rejected (OS-level APIs coalesce rapid events).
- **Git required**: Working directories must be git repositories.
- **Full cumulative diffs**: Each `FileChangeMessage` contains the complete diff from HEAD, not a delta. No aggregation logic needed - just use the last entry per path.
- **Binary files skipped**: Binary files are not emitted as `FileChangeMessage`, similar to GitHub.

## Goals

1. Parse and render arbitrary git diff output
2. Syntax highlight diffed code for any language
3. Display full file with collapsible unchanged sections (collapsed by default)
4. Order files by importance/change precedence
5. Vertical scrolling with smooth navigation

## Non-Goals (Deferred)

- Side-by-side diff view (inline/unified only for v1)
- Inline editing of diffs
- Staging/unstaging individual hunks
- Diff generation (we consume pre-generated diffs)
- VS Code integration (open file at line)
- Word-level diff highlighting (character-level changes within lines)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Diff Viewer                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  Header: [File count] [Expand All] [Collapse All]                       │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  ▼ Vertical Scroll Container                                            │ │
│  │  ┌─────────────────────────────────────────────────────────────────────┐ │ │
│  │  │  DiffFileCard (file 1 - highest importance)                         │ │ │
│  │  │  ┌───────────────────────────────────────────────────────────────┐  │ │ │
│  │  │  │ File Header: path/to/file.ts  [+15 -3]                        │  │ │ │
│  │  │  ├───────────────────────────────────────────────────────────────┤  │ │ │
│  │  │  │ ┌─ Collapsed Region (lines 1-24) ─── [Click to expand] ─────┐ │  │ │ │
│  │  │  │ │  ... 24 unchanged lines ...                               │ │  │ │ │
│  │  │  │ └───────────────────────────────────────────────────────────┘ │  │ │ │
│  │  │  │                                                               │  │ │ │
│  │  │  │  25 │   const foo = bar;              ← context line (in diff)│  │ │ │
│  │  │  │- 26 │   const old = value;              ← RED background      │  │ │ │
│  │  │  │+ 26 │   const new = value;              ← GREEN background    │  │ │ │
│  │  │  │  27 │   return result;                ← context line (in diff)│  │ │ │
│  │  │  │                                                               │  │ │ │
│  │  │  │ ┌─ Collapsed Region (lines 28-100) ─────────────────────────┐ │  │ │ │
│  │  │  │ │  ... 73 unchanged lines ...                               │ │  │ │ │
│  │  │  │ └───────────────────────────────────────────────────────────┘ │  │ │ │
│  │  │  └───────────────────────────────────────────────────────────────┘  │ │ │
│  │  └─────────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                           │ │
│  │  ┌─────────────────────────────────────────────────────────────────────┐ │ │
│  │  │  DiffFileCard (file 2)                                              │ │ │
│  │  │  ...                                                                 │ │ │
│  │  └─────────────────────────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Raw Git Diff (string)          Full File Contents (required)
       │                              │
       ▼                              │
DiffParser (pure function)            │
       │  - Parses unified diff       │
       │  - Extracts hunks & metadata │
       ▼                              │
ParsedDiff                            │
       │                              │
       └──────────────┬───────────────┘
                      │
                      ▼
         AnnotatedFileBuilder (pure function)
                      │  - Full file is source of truth
                      │  - Diff provides highlighting annotations
                      │  - Inserts deleted lines at correct positions
                      │  - Marks additions, deletions, unchanged
                      ▼
              AnnotatedFile[]
                      │
                      ▼
         DiffPrioritizer (sort by importance)
                      │
                      ▼
         DiffViewer (React component)
                      │
                      ├── DiffHeader
                      │
                      └── DiffFileCard[] (sorted by priority)
                              │
                              ├── FileHeader (path, stats)
                              │
                              └── AnnotatedFileContent
                                      │
                                      └── LineOrRegion[] (computed at render)
                                              │
                                              ├── CollapsedRegion (N unchanged lines)
                                              │
                                              └── AnnotatedLine (context/add/delete)
```

### Key Architecture Decision: Full File as Source of Truth

**The full file content is required, not optional.** The diff provides annotations on top of the full file:

1. **Full file**: The complete new file content (array of lines)
2. **Diff annotations**: Which lines are additions, and where deletions occurred
3. **Merged view**: Full file + deleted lines inserted at their positions

**Line types:**

- **Addition** (`+`): Line exists in new file, not in old. Green highlight.
- **Deletion** (`-`): Line existed in old file, removed. Red highlight. Inserted as "ghost line" at correct position.
- **Unchanged**: Line exists in both. No highlight. Collapsible when in contiguous groups.

**Collapsed regions** are computed at render time by grouping contiguous unchanged lines. Any group of N+ unchanged lines (configurable, default 8) becomes collapsible.

---

## Data Models

See individual phase files for detailed type definitions:
- [01-diff-parser.md](./01-diff-parser.md) - `ParsedDiff`, `ParsedDiffFile`, `DiffHunk`, `DiffLine`
- [02-priority-annotated-builder.md](./02-priority-annotated-builder.md) - `AnnotatedFile`, `AnnotatedLine`
- [04-core-components.md](./04-core-components.md) - `DiffViewerState`, `DiffViewerProps`
- [05-collapsed-regions.md](./05-collapsed-regions.md) - `CollapsedRegion`

---

## File Structure

### New Files

| Path                                                          | Description                                             |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| `src/lib/diff-parser.ts`                                      | Git diff parsing logic                                  |
| `src/lib/diff-parser.test.ts`                                 | Parser unit tests                                       |
| `src/lib/diff-prioritizer.ts`                                 | File priority scoring                                   |
| `src/lib/annotated-file-builder.ts`                           | Merges full file content with diff annotations          |
| `src/lib/annotated-file-builder.test.ts`                      | Annotated file builder unit tests                       |
| `src/lib/language-detector.ts`                                | File extension → language mapping                       |
| `src/lib/syntax-highlighter.ts`                               | Shiki wrapper service                                   |
| `src/hooks/use-file-contents.ts`                              | Hook for loading file contents upfront                  |
| `src/components/diff-viewer/types.ts`                         | TypeScript interfaces                                   |
| `src/components/diff-viewer/diff-viewer.tsx`                  | Main container component                                |
| `src/components/diff-viewer/diff-header.tsx`                  | Top header with stats                                   |
| `src/components/diff-viewer/diff-file-card.tsx`               | Single file card with collapse logic                    |
| `src/components/diff-viewer/virtualized-file-content.tsx`     | Virtualized renderer for large files (>1000 lines)      |
| `src/components/diff-viewer/file-header.tsx`                  | File header with path & actions                         |
| `src/components/diff-viewer/collapsed-region-placeholder.tsx` | Collapsed region placeholder                            |
| `src/components/diff-viewer/annotated-line-row.tsx`           | Single annotated line display                           |
| `src/components/diff-viewer/binary-file-placeholder.tsx`      | Binary file display                                     |
| `src/components/diff-viewer/file-card-error-boundary.tsx`     | Error boundary per file                                 |
| `src/components/diff-viewer/use-diff-navigation.ts`           | Navigation hook                                         |
| `src/components/diff-viewer/use-collapsed-regions.ts`         | Collapse region computation hook                        |
| `src/components/diff-viewer/file-jump-dropdown.tsx`           | Quick file navigation                                   |
| `src/components/diff-viewer/index.ts`                         | Public exports                                          |

### Modified Files

| Path           | Change                                    |
| -------------- | ----------------------------------------- |
| `package.json` | Add `shiki`, `@tanstack/react-virtual`    |

---

## Component API

### Integration Usage (from ConversationWindow)

The primary use case - receiving file changes from `useConversation`:

```tsx
import { DiffViewer } from "./components/diff-viewer";

function ConversationWindow({ conversationId }: Props) {
  const { fileChanges, workingDirectory } = useConversation(conversationId);

  // Load all file contents upfront
  const { data: fullFileContents, isLoading } = useFileContents(
    fileChanges,
    workingDirectory
  );

  if (isLoading) return <DiffViewerSkeleton />;

  return (
    <DiffViewer
      fileChanges={fileChanges}
      fullFileContents={fullFileContents}
      workingDirectory={workingDirectory}
    />
  );
}
```

### Custom Priority

```tsx
<DiffViewer
  fileChanges={fileChanges}
  fullFileContents={fullFileContents}
  workingDirectory={workingDirectory}
  priorityFn={(file) => {
    // Prioritize test files
    if (file.path?.includes(".test.")) return 100;
    return file.stats?.additions ?? 0;
  }}
/>
```

---

## Styling Reference

### Color Palette (Diff-Specific)

```css
/* Additions */
--diff-add-bg: rgba(16, 185, 129, 0.1); /* emerald-500/10 */
--diff-add-border: #10b981; /* emerald-500 */
--diff-add-text: #6ee7b7; /* emerald-300 */

/* Deletions */
--diff-del-bg: rgba(239, 68, 68, 0.1); /* red-500/10 */
--diff-del-border: #ef4444; /* red-500 */
--diff-del-text: #fca5a5; /* red-300 */

/* Line numbers */
--line-number: #64748b; /* slate-500 */
--line-number-highlight: #94a3b8; /* slate-400 */

/* Collapsed sections */
--collapsed-bg: rgba(51, 65, 85, 0.3); /* slate-700/30 */
--collapsed-border: #475569; /* slate-600 */
```

### Layout Constants

```css
--line-height: 1.5rem; /* 24px per line */
--line-number-width: 4rem; /* 64px for dual line numbers */
--file-header-height: 3rem; /* 48px sticky header */
--gutter-width: 0.5rem; /* 8px between elements */
```

### Long Line Handling

Long lines use horizontal scrolling within each file card:

- `overflow-x: auto` on the code container
- Line numbers remain fixed (sticky left)
- Scrollbar appears only when content overflows

---

## Testing Strategy

### Unit Tests

1. **diff-parser.test.ts**
   - Parse simple unified diff
   - Parse multi-file diff
   - Handle new/deleted/renamed files
   - Handle binary files
   - Parse hunk headers correctly
   - Handle edge cases (no newline at EOF)

2. **diff-prioritizer.test.ts**
   - Score source files higher than config
   - Score by additions/deletions
   - Sort files correctly

3. **language-detector.test.ts**
   - Map common extensions
   - Handle unknown extensions
   - Case insensitivity

### Component Tests

1. **DiffViewer**
   - Renders files in priority order
   - Expand/collapse all works
   - Loading state shown while parsing

2. **CollapsibleSection**
   - Collapsed by default
   - Expands on click
   - Shows correct line count

3. **DiffHunk**
   - Renders additions in green
   - Renders deletions in red
   - Line numbers are correct

### Integration Tests

1. Real git diff output parsing
2. Full file content expansion

---

## Integration with Other Systems

This plan is part of a larger system. See `plans/system-integration.md` for how this connects to:

- **Agent Execution System** (`agent-execution-system.md`): Produces incremental `FileChangeMessage` events
- **Conversation Chat UI** (`conversation-chat-ui.md`): Displayed alongside chat in conversation window

### Contracts This System Must Fulfill

1. **Input Format**: Accept `Map<path, FileChangeMessage>` (already aggregated by path)
2. **Component API**: Export `DiffViewer` component for embedding in conversation window
3. **No aggregation needed**: Parent component provides Map where each path has its latest diff

### Input Format

The diff viewer receives:
1. `Map<string, FileChangeMessage>` - file changes keyed by path (from `useConversation`)
2. `Record<string, string[]>` - full file contents loaded upfront (from `useFileContents`)

No aggregation logic needed inside the diff viewer—the parent handles aggregation and content loading.

- Each `FileChangeMessage` contains a **full cumulative diff from HEAD** (not a delta)
- Last entry per path wins
- Binary files are never in the map (skipped at emission time)

### Data Source (Disk Always Wins)

The parent `useConversation` hook loads from files on mount:

- **Source of truth**: `changes.jsonl` (JSONL of FileChangeMessage, one per line)
- **Real-time overlay**: stdout streaming during active runs (display only)

```
.mort/conversations/{id}/
└── changes.jsonl         # JSONL of FileChangeMessage (one per line, append-only)
```

---

## Implementation Order

1. [Phase 0: Dependencies & Setup](./00-dependencies-setup.md)
2. [Phase 1: Diff Parser](./01-diff-parser.md)
3. [Phase 2: Priority Scoring & Annotated File Builder](./02-priority-annotated-builder.md)
4. [Phase 3: Syntax Highlighting](./03-syntax-highlighting.md)
5. [Phase 4: Core Components](./04-core-components.md)
6. [Phase 5: Collapsed Region Behavior](./05-collapsed-regions.md)
7. [Phase 6: Scroll & Navigation](./06-scroll-navigation.md)
8. [Phase 7: Polish & Accessibility](./07-polish-accessibility.md)

---

## Resolved Questions

These were originally open questions, now resolved with decisions:

1. **Shiki bundle size**: Start with full shiki, optimize if bundle becomes issue
2. **Lazy loading languages**: Preload top 10 languages (ts, js, rust, py, json, yaml, md, css, html, go), lazy-load others
3. **File content loading**: Load all file contents upfront (not lazy). This enables virtualization and eliminates loading states when expanding regions.
4. **Large file handling**: Virtualize files with >1000 lines using `@tanstack/react-virtual`. All data is loaded, but only visible lines are rendered.
5. **Theme customization**: Use single dark theme for v1, defer customization to v2
6. **Language detection**: Write a simple extension→language map. Shiki doesn't auto-detect from extensions.
7. **Deleted file content**: Load from git using `git show HEAD:path`. Handle errors gracefully with fallback to raw diff hunks.
8. **New file collapsed regions**: Collapse interior of very large new files (>100 lines) to avoid overwhelming the viewer.
