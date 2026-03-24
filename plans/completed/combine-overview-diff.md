# Plan: Combine Overview and Diff Sections

## Goal

Merge the "Overview" and "Changes" tabs into a single unified view where:
1. Task content markdown (`content.md`) is rendered at the top
2. Diff views appear below in a vertical scroll

## Current State

### Tab Structure (`left-menu.tsx:6`)
- Three tabs: `"overview" | "changes" | "git"`
- Each renders independently in `main-content-pane.tsx`

### Overview Tab (`task-overview.tsx`)
- Loads markdown from `taskService.getContent(taskId)`
- Renders with `ReactMarkdown` component
- Displays tags at top, then markdown content
- Has loading skeleton and empty states

### Changes Tab (`main-content-pane.tsx:57-72`)
- Shows `DiffViewer` component
- Has loading skeleton and empty states
- Receives `fileChanges` and `fullFileContents` props

## Proposed Implementation

### Option A: Merge into Overview Tab (Recommended)

Combine both views into the existing "overview" tab and remove the "changes" tab.

**Pros:**
- Reduces tab count for simpler navigation
- Content and changes are naturally related
- Single scrollable view for task context

**Cons:**
- Longer scroll for large diffs
- May need visual separator between sections

### Option B: Keep Both Tabs, Add Combined View

Add a new "Summary" tab that shows both, keep original tabs.

**Pros:**
- Preserves existing behavior for users who prefer it
- More flexibility

**Cons:**
- More tabs to manage
- Duplicated UI

---

## Implementation Steps (Option A)

### Step 1: Update WorkspaceTab Type
**File:** `src/components/workspace/left-menu.tsx`

Remove "changes" from the type or repurpose "overview" to include changes:
```typescript
export type WorkspaceTab = "overview" | "git";
```

### Step 2: Update Left Menu
**File:** `src/components/workspace/left-menu.tsx`

- Remove the "Changes" tab button
- Optionally rename "Overview" to "Summary" or keep as "Overview"
- Move the file change count badge to the Overview tab

### Step 3: Create Combined Overview Component
**File:** `src/components/workspace/task-overview.tsx` (modify existing)

Update `TaskOverview` to accept additional props and render both sections:

```typescript
interface TaskOverviewProps {
  taskId: string;
  // New props for diff viewer
  fileChanges: Map<string, FileChange>;
  fullFileContents: Record<string, string[]>;
  workingDirectory: string;
  filesLoading?: boolean;
}
```

New structure:
```tsx
<div className="overflow-auto h-full">
  {/* Section 1: Markdown Content */}
  <section className="p-6 border-b border-slate-700/50">
    {/* Tags */}
    {/* ReactMarkdown content */}
  </section>

  {/* Section 2: File Changes */}
  <section className="p-4">
    <h3 className="text-sm font-medium text-slate-400 mb-4">Changes</h3>
    {filesLoading ? (
      <DiffViewerSkeleton />
    ) : fileChanges.size === 0 ? (
      <DiffEmptyState />
    ) : (
      <DiffViewer
        fileChanges={fileChanges}
        fullFileContents={fullFileContents}
        workingDirectory={workingDirectory}
      />
    )}
  </section>
</div>
```

### Step 4: Update MainContentPane
**File:** `src/components/workspace/main-content-pane.tsx`

- Remove the "changes" case from the switch statement
- Pass all necessary props to `TaskOverview`

```typescript
case "overview":
  return (
    <div className={contentClass}>
      <TaskOverview
        taskId={taskId}
        fileChanges={fileChanges}
        fullFileContents={validFileContents}
        workingDirectory={workingDirectory}
        filesLoading={filesLoading}
      />
    </div>
  );
```

### Step 5: Update Default Tab (if needed)
**File:** `src/components/workspace/task-workspace.tsx`

Ensure the default active tab is still valid after removing "changes".

### Step 6: Update Loading States

The combined view needs to handle:
1. Content loading (markdown)
2. Files loading (diff data)

Show skeleton for markdown section while content loads, and skeleton for diff section while files load. These can load independently.

---

## Visual Design

```
┌──────────────────────────────────────────────────────┐
│  [Tags: feature, ui]                                 │
│                                                      │
│  # Task Title (from content.md)                      │
│                                                      │
│  Task description and notes rendered as markdown...  │
│  - Item 1                                            │
│  - Item 2                                            │
│                                                      │
├──────────────────────────────────────────────────────┤
│  Changes (3 files)                                   │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ src/components/foo.tsx  +12 -5                 │  │
│  │ [collapsed diff content]                       │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ src/lib/utils.ts  +3 -1                        │  │
│  │ [collapsed diff content]                       │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## Content Refresh During Agent Execution

### The Problem

The agent writes to `content.md` as it runs (research findings, implementation plans), but the UI won't see these updates because:

1. **Content is cached**: `taskService.getContent()` stores content in `taskStore.taskContent[id]` and returns the cached value on subsequent calls without re-fetching
2. **No file watching**: There's no mechanism to detect when `content.md` changes on disk
3. **Agent uses Write tool directly**: The agent writes to `~/.anvil/tasks/{slug}/content.md` via the Write tool

### Solution: React to Write Tool Calls

Detect completed Write tool calls targeting `content.md` files in the streaming messages and refresh content when they occur.

#### Tool Use Block Structure

From the Anthropic SDK, tool_use blocks have:
```typescript
{
  type: "tool_use",
  id: string,
  name: string,           // e.g., "Write"
  input: {
    file_path: string,    // e.g., "~/.anvil/tasks/{slug}/content.md"
    content: string
  }
}
```

Tool results appear in the subsequent user message with `type: "tool_result"` and matching `tool_use_id`.

#### Implementation

##### Step 1: Create utility to detect content.md writes

**File:** `src/lib/utils/content-write-detector.ts` (new)

```typescript
import type { MessageParam, ContentBlock } from "@anthropic-ai/sdk/resources/messages";

/**
 * Check if a file path is a task content.md file.
 */
function isContentMdPath(filePath: string): boolean {
  // Match paths like:
  // ~/.anvil/tasks/{slug}/content.md
  // /Users/.../Documents/.anvil/tasks/{slug}/content.md
  return filePath.includes(".anvil/tasks/") && filePath.endsWith("/content.md");
}

/**
 * Extract completed Write tool calls to content.md from messages.
 * Returns the file paths that were written to.
 */
export function getCompletedContentWrites(messages: MessageParam[]): string[] {
  const writtenPaths: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;

    // Find Write tool_use blocks targeting content.md
    const toolUses = (msg.content as ContentBlock[]).filter(
      (block): block is ContentBlock & { type: "tool_use"; name: string; input: { file_path?: string } } =>
        block.type === "tool_use" &&
        block.name === "Write" &&
        typeof (block as any).input?.file_path === "string" &&
        isContentMdPath((block as any).input.file_path)
    );

    if (toolUses.length === 0) continue;

    // Check if there's a subsequent user message with tool_results
    const nextMsg = messages[i + 1];
    if (!nextMsg || nextMsg.role !== "user" || !Array.isArray(nextMsg.content)) continue;

    // Find successful tool_results for our Write calls
    for (const tu of toolUses) {
      const hasResult = nextMsg.content.some(
        (block) =>
          block.type === "tool_result" &&
          block.tool_use_id === tu.id &&
          !block.is_error
      );

      if (hasResult) {
        writtenPaths.push((tu as any).input.file_path);
      }
    }
  }

  return writtenPaths;
}

/**
 * Get count of completed content.md writes.
 * Useful for triggering effects when count changes.
 */
export function countCompletedContentWrites(messages: MessageParam[]): number {
  return getCompletedContentWrites(messages).length;
}
```

##### Step 2: Add refreshContent to task service

**File:** `src/entities/tasks/service.ts`

```typescript
/**
 * Refreshes content from disk, bypassing cache.
 * Use when agent may have written to content.md.
 */
async refreshContent(id: string): Promise<string> {
  const task = useTaskStore.getState().tasks[id];
  if (!task) return "";

  const content = (await persistence.readText(`${TASKS_DIR}/${task.slug}/content.md`)) ?? "";
  useTaskStore.getState()._applyContentLoaded(id, content);
  return content;
}
```

##### Step 3: Update TaskOverview to react to writes

**File:** `src/components/workspace/task-overview.tsx`

```typescript
import { countCompletedContentWrites } from "@/lib/utils/content-write-detector";

interface TaskOverviewProps {
  taskId: string;
  fileChanges: Map<string, FileChange>;
  fullFileContents: Record<string, string[]>;
  workingDirectory: string;
  filesLoading?: boolean;
  messages?: MessageParam[];  // NEW: streaming messages to detect writes
}

export function TaskOverview({ taskId, messages = [], ...props }: TaskOverviewProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Track number of completed content.md writes
  const writeCount = useMemo(
    () => countCompletedContentWrites(messages),
    [messages]
  );

  // Initial load + refresh when write count changes
  useEffect(() => {
    setLoading(true);
    // Use refreshContent to bypass cache when writeCount > 0
    const loadFn = writeCount > 0
      ? taskService.refreshContent(taskId)
      : taskService.getContent(taskId);

    loadFn.then(setContent).finally(() => setLoading(false));
  }, [taskId, writeCount]);

  // ... rest of component
}
```

##### Step 4: Pass messages through the component tree

**File:** `src/components/workspace/main-content-pane.tsx`

```typescript
interface MainContentPaneProps {
  // ... existing props
  messages?: MessageParam[];  // NEW
}

case "overview":
  return (
    <TaskOverview
      taskId={taskId}
      fileChanges={fileChanges}
      fullFileContents={validFileContents}
      workingDirectory={workingDirectory}
      filesLoading={filesLoading}
      messages={messages}
    />
  );
```

**File:** `src/components/workspace/task-workspace.tsx`

```typescript
<MainContentPane
  tab={activeTab}
  taskId={taskId}
  fileChanges={fileChanges}
  fullFileContents={fullFileContents}
  workingDirectory={workingDirectory}
  filesLoading={filesLoading}
  branchName={task.branchName}
  messages={messages}  // NEW - already available from threadState
/>
```

### Why This Approach

1. **Reactive, not polling** - Only refreshes when a Write to content.md actually completes
2. **No agent-side changes** - Works with existing tool call structure
3. **Efficient** - `countCompletedContentWrites` is memoized, only triggers effect when count changes
4. **Debounced by design** - Multiple rapid writes still only trigger one refresh per write completion

---

## Files to Modify (Updated)

1. `src/components/workspace/left-menu.tsx` - Remove Changes tab, update type
2. `src/components/workspace/task-overview.tsx` - Add diff viewer integration + content refresh on writes
3. `src/components/workspace/main-content-pane.tsx` - Remove changes case, update overview props, pass messages
4. `src/components/workspace/task-workspace.tsx` - Verify default tab handling, pass messages
5. `src/entities/tasks/service.ts` - Add refreshContent method
6. `src/lib/utils/content-write-detector.ts` - NEW: utility to detect content.md writes

---

## Testing Checklist (Updated)

- [ ] Markdown content renders correctly at top
- [ ] Diff viewer renders below markdown
- [ ] Single vertical scroll works for entire view
- [ ] Loading states work independently for each section
- [ ] Empty states handled (no content, no changes, both)
- [ ] File change badge appears on Overview tab
- [ ] Git tab still works independently
- [ ] Tags display correctly above markdown
- [ ] **Content refreshes when agent writes to content.md**
- [ ] **Content does NOT refresh for other Write tool calls**
- [ ] **Multiple writes in sequence each trigger refresh**
- [ ] **Initial content load still works (cold cache)**

---

## Questions for Clarification

1. Should the "Overview" tab be renamed to "Summary" or similar?
2. Should there be a visual header/divider between markdown and diff sections?
3. When there are no file changes, should the changes section be hidden entirely or show an empty state?
4. Should the file change count badge move to the Overview tab?
