# Inline Diff Comments

Add the ability to leave inline comments on any line in a diff view, persist them per-thread, and spawn an agent to address all unresolved comments.

## Phases

- [ ] Define types and disk schema for inline comments
- [ ] Create comment store and service (entity layer)
- [ ] Add event definitions for comment lifecycle
- [ ] Add thread context provider (Zustand provider pattern)
- [ ] Build UI: comment gutter button and inline comment form
- [ ] Build UI: comment display and resolution controls
- [ ] Wire diff components to render comments via context
- [ ] Add "Address Comments" agent spawn flow
- [ ] Add agent-side comment resolution protocol
- [ ] Hook up agent event listener to mark comments resolved in store

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Architecture Overview

Comments are a new entity scoped to a **thread** (which already binds to a worktree + branch). They are persisted on disk at `~/.mort/threads/{threadId}/comments.json` following the disk-as-truth pattern used by all other entities.

### Data Flow

```
User clicks line → CommentForm → commentService.create() → disk + store + event
User clicks "Address Comments" → spawn agent with comment context in prompt
Agent resolves comment → emits COMMENT_RESOLVED event via socket
Frontend listener → commentService.markResolved() → disk + store + UI update
```

---

## Phase 1: Types and Disk Schema

**Files:**
- `core/types/comments.ts` (new)

**Types:**

```typescript
// core/types/comments.ts
import { z } from "zod";

export const InlineCommentSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid(),
  filePath: z.string(),           // relative path within worktree
  lineNumber: z.number().int(),   // new-side line number (from AnnotatedLine.newLineNumber)
  lineType: z.enum(["addition", "deletion", "unchanged"]),
  content: z.string().min(1),     // the comment text
  resolved: z.boolean().default(false),
  resolvedAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type InlineComment = z.infer<typeof InlineCommentSchema>;

export const CommentsFileSchema = z.object({
  version: z.literal(1),
  comments: z.array(InlineCommentSchema),
});
export type CommentsFile = z.infer<typeof CommentsFileSchema>;
```

**Disk format:** `~/.mort/threads/{threadId}/comments.json`

```json
{
  "version": 1,
  "comments": [
    {
      "id": "uuid",
      "threadId": "uuid",
      "filePath": "src/foo.ts",
      "lineNumber": 42,
      "lineType": "addition",
      "content": "This should use a Map instead of an object",
      "resolved": false,
      "createdAt": 1708900000000,
      "updatedAt": 1708900000000
    }
  ]
}
```

---

## Phase 2: Comment Store and Service

**Files:**
- `src/entities/comments/types.ts` (new) — re-export from core/types
- `src/entities/comments/store.ts` (new)
- `src/entities/comments/service.ts` (new)
- `src/entities/comments/listeners.ts` (new)
- `src/entities/comments/index.ts` (new)

Follow the `questions` entity pattern (newest entity in the codebase).

**Store** (Zustand):

```typescript
interface CommentStoreState {
  // Comments keyed by threadId
  commentsByThread: Record<string, InlineComment[]>;
  _hydrated: boolean;
}

interface CommentStoreActions {
  hydrate: (threadId: string, comments: InlineComment[]) => void;
  getByThread: (threadId: string) => InlineComment[];
  getByFile: (threadId: string, filePath: string) => InlineComment[];
  getUnresolved: (threadId: string) => InlineComment[];
  getUnresolvedCount: (threadId: string) => number;
  _applyAdd: (comment: InlineComment) => Rollback;
  _applyUpdate: (id: string, threadId: string, updates: Partial<InlineComment>) => Rollback;
  _applyDelete: (id: string, threadId: string) => Rollback;
}
```

**Service** (follows `planService` pattern — disk-as-truth with optimistic store updates):

- `create(threadId, filePath, lineNumber, lineType, content)` → write to disk, apply to store, emit event
- `update(threadId, commentId, content)` → update on disk, apply to store, emit event
- `resolve(threadId, commentId)` → set `resolved: true, resolvedAt: Date.now()`, persist, emit event
- `unresolve(threadId, commentId)` → set `resolved: false`, persist, emit event
- `delete(threadId, commentId)` → remove from disk, apply to store, emit event
- `loadForThread(threadId)` → read from disk, hydrate store (lazy — called when diff view opens)

Comments are loaded **lazily** per-thread (not at app startup like plans), since they're only relevant when viewing a specific thread's diff.

---

## Phase 3: Event Definitions

**Files:**
- `core/types/events.ts` (modify)

Add to `EventName`:

```typescript
// Comments
COMMENT_ADDED: "comment:added",
COMMENT_UPDATED: "comment:updated",
COMMENT_RESOLVED: "comment:resolved",
COMMENT_DELETED: "comment:deleted",
```

Add to `EventPayloads`:

```typescript
[EventName.COMMENT_ADDED]: { threadId: string; commentId: string };
[EventName.COMMENT_UPDATED]: { threadId: string; commentId: string };
[EventName.COMMENT_RESOLVED]: { threadId: string; commentId: string };
[EventName.COMMENT_DELETED]: { threadId: string; commentId: string };
```

Also add to `EventNameSchema` enum array.

---

## Phase 4: Thread Context Provider

**Files:**
- `src/contexts/thread-context.tsx` (new)
- `src/components/content-pane/content-pane.tsx` (modify)

### Problem

Currently `threadId` flows through props in the content pane: `ContentPane` renders `ThreadContent` with `threadId` directly, and `ChangesTab` receives full `threadMetadata`. For the changes tab specifically, threadId is accessible through `threadMetadata.id`. But once inside `ChangesTab → InlineDiffBlock → AnnotatedLineRow`, adding inline comments would require threading `threadId` through every level. A context provider eliminates this prop drilling.

### ThreadContext Provider

Follows the `InputStoreProvider` pattern from `src/stores/input-store.tsx` — a Zustand store wrapped in React Context:

```typescript
// src/contexts/thread-context.tsx
import { createStore, useStore } from "zustand";
import { createContext, useContext, useRef, type ReactNode } from "react";

interface ThreadContextState {
  threadId: string;
}

type ThreadContextStore = ReturnType<typeof createThreadContextStore>;

const createThreadContextStore = (threadId: string) =>
  createStore<ThreadContextState>(() => ({ threadId }));

const ThreadContext = createContext<ThreadContextStore | null>(null);

export function ThreadProvider({
  threadId,
  children,
}: {
  threadId: string;
  children: ReactNode;
}) {
  const storeRef = useRef<ThreadContextStore | null>(null);
  if (!storeRef.current) storeRef.current = createThreadContextStore(threadId);
  return (
    <ThreadContext.Provider value={storeRef.current}>
      {children}
    </ThreadContext.Provider>
  );
}

export function useThreadContext(): string {
  const store = useContext(ThreadContext);
  if (!store) throw new Error("useThreadContext must be used within ThreadProvider");
  return useStore(store, (s) => s.threadId);
}

export function useOptionalThreadContext(): string | null {
  const store = useContext(ThreadContext);
  if (!store) return null;
  return useStore(store, (s) => s.threadId);
}
```

### Why no WorktreeContext?

The original plan proposed a separate `WorktreeProvider`. After reviewing the codebase, this is unnecessary:

- `ChangesTab` already receives `threadMetadata` which has `worktreeId` and `repoId` — it resolves `workingDirectory` via `useWorkingDirectory(threadMetadata)` internally
- `ChangesView` (the standalone changes pane) receives `repoId` and `worktreeId` as direct props from `ContentPaneView`
- `DiffViewer` receives `workingDirectory` as a direct prop
- No component deep in the tree needs worktree info that doesn't already have it

Only `threadId` genuinely needs to pierce through layers it currently doesn't flow through (specifically down into `InlineDiffBlock → AnnotatedLineRow` for comment gutter buttons).

### Integration with ContentPane

In `content-pane.tsx`, wrap both the conversation and changes tab in the `ThreadProvider`:

```typescript
// content-pane.tsx — inside the render
<InputStoreProvider active>
  {view.type === "thread" && (
    <ThreadProvider threadId={view.threadId}>
      {threadTab === "conversation" && (
        <ThreadContent ... />
      )}
      {threadTab === "changes" && activeMetadata && (
        <ChangesTab ... />
      )}
    </ThreadProvider>
  )}
  ...
</InputStoreProvider>
```

This keeps the provider at the ContentPane level (where threadId is already known) and makes it available to all descendants. The `empty` and `plan` views remain unaffected — they don't render inside the provider.

---

## Phase 5: UI — Comment Gutter Button and Inline Form

**Files:**
- `src/components/diff-viewer/comment-gutter-button.tsx` (new)
- `src/components/diff-viewer/inline-comment-form.tsx` (new)

### Comment Gutter Button

A small `+` icon button that appears on hover in the gutter area of each line row. Clicking it opens the inline comment form below that line.

- Rendered inside `AnnotatedLineRow` as an extra cell (between the type indicator and content, or overlaying the old-line-number gutter)
- Only appears when `useOptionalThreadContext()` returns a threadId (the diff viewer is in "commentable" mode)
- Uses absolute positioning in the line number gutter area
- The `AnnotatedLineRow` currently has: `[old-line-no] [new-line-no] [+/-] [content]` — the button overlays the old-line-number cell on hover

### Inline Comment Form

A small textarea that appears below the target line when the gutter button is clicked.

- Spans the full width of the diff row area
- Submit on `Cmd+Enter` or button click
- Cancel on `Escape`
- Gets `threadId` from `useThreadContext()` and calls `commentService.create()` on submit
- Auto-focuses textarea on mount

**State management:** The "which line has an open form" state lives in the parent (`InlineDiffBlock.DiffContent` or `DiffFileCardContent`) as local React state (`activeCommentLine: number | null`), since it's purely UI state.

---

## Phase 6: UI — Comment Display and Resolution

**Files:**
- `src/components/diff-viewer/inline-comment-display.tsx` (new)

### Comment Display

For each line that has comments, render a comment block below the line row:

- Shows comment content, timestamp
- "Resolve" button → calls `commentService.resolve()` (gets `threadId` from `useThreadContext()`)
- "Delete" button → calls `commentService.delete()`
- Resolved comments shown with strikethrough / dimmed styling and a "Reopen" button
- Unresolved comments shown with accent border (e.g., amber/yellow)

### Comment Count Badge

In the `InlineDiffHeader` component (used by `InlineDiffBlock`), show a badge with unresolved comment count per file (e.g., "3 comments"). Uses `useOptionalThreadContext()` + `useCommentStore.getByFile()`.

Similarly in `FileHeader` (used by `DiffFileCard`).

---

## Phase 7: Wire Diff Components to Render Comments

**Files:**
- `src/components/thread/inline-diff-block.tsx` (modify)
- `src/components/diff-viewer/diff-file-card.tsx` (modify)
- `src/components/diff-viewer/annotated-line-row.tsx` (modify)

### Current Diff Rendering Architecture

There are **two distinct diff rendering paths** that both need comment support:

1. **`InlineDiffBlock`** (`src/components/thread/inline-diff-block.tsx`) — Used in:
   - `ChangesTab` (thread changes view) — renders `InlineDiffBlock` per file
   - `ChangesDiffContent` (standalone changes pane via `react-virtuoso`) — renders `InlineDiffBlock` per file
   - `ToolUseBlock` (inline tool results in conversation) — renders `InlineDiffBlock` for Edit/Write results
   - This component has its own `DiffContent` inner component that renders `AnnotatedLineRow` directly

2. **`DiffFileCard`** (`src/components/diff-viewer/diff-file-card.tsx`) — Used in:
   - `DiffViewer` (the full diff viewer component) — renders `DiffFileCard` per file
   - Has its own `DiffFileCardContent` inner component that also renders `AnnotatedLineRow`

Both paths use `AnnotatedLineRow` at the leaf level. The comment gutter button lives in `AnnotatedLineRow` and activates only when `useOptionalThreadContext()` provides a threadId.

### Strategy: Context over Props

The `ThreadProvider` from Phase 4 wraps thread views at the `ContentPane` level. Any descendant can read `threadId` via `useOptionalThreadContext()` — no prop changes needed at intermediate levels.

### Changes

1. **`AnnotatedLineRow`** (modify): Add the `CommentGutterButton` (Phase 5) as an overlay on hover. Uses `useOptionalThreadContext()` to decide whether to show. Accepts new optional props:
   - `onCommentClick?: (lineNumber: number) => void` — opens comment form for this line
   - `commentCount?: number` — shows small indicator dot when > 0
   - These are passed from the parent (`DiffContent` / `DiffFileCardContent`), not from context, since they're per-file UI state

2. **`InlineDiffBlock`** (modify its inner `DiffContent`): When `useOptionalThreadContext()` returns a threadId:
   - Calls `commentService.loadForThread(threadId)` on mount (lazy loading)
   - Reads comments for this file from `useCommentStore.getByFile(threadId, filePath)`
   - Manages `activeCommentLine` local state
   - Renders `InlineCommentForm` and `InlineCommentDisplay` between `AnnotatedLineRow` elements
   - Passes `onCommentClick` and `commentCount` to each `AnnotatedLineRow`

3. **`DiffFileCardContent`** (modify): Same pattern as `InlineDiffBlock` — reads from comment store when in thread context, manages local comment form state, renders comment UI between line rows.

4. **`DiffViewer`** (no changes needed): Stays a pure component. The `ThreadProvider` wraps it upstream.

### What stays as props vs. what uses context

| Data | Mechanism | Reason |
|---|---|---|
| `threadId` | `useThreadContext()` | Stable for entire subtree, avoids drilling |
| `onCommentClick` | Props from parent | Per-file UI callback, not global context |
| `commentCount` | Props from parent | Derived per-line, computed in parent |
| `activeCommentLine` | Local state in parent | Ephemeral UI state |

---

## Phase 8: "Address Comments" Agent Spawn Flow

**Files:**
- `src/components/diff-viewer/address-comments-button.tsx` (new)
- `src/components/thread/inline-diff-header.tsx` (modify) — add button slot
- `src/components/diff-viewer/diff-header.tsx` (modify) — add button slot

### UX

Add an "Address Comments" button in two locations:
1. **`InlineDiffHeader`** — per-file, next to the expand/collapse controls (for the `InlineDiffBlock` rendering path used by `ChangesTab`)
2. **`DiffHeader`** — aggregate, next to Expand/Collapse All (for the `DiffViewer` rendering path)

The button is visible when there are unresolved comments. Clicking it:

1. Gets `threadId` via `useThreadContext()`, then collects all unresolved comments via `useCommentStore.getUnresolved(threadId)`
2. Formats them into a structured prompt:

```
Please address the following code review comments on this branch:

## src/foo.ts:42
> This should use a Map instead of an object

## src/bar.ts:15
> Missing error handling for the API call

For each comment, make the requested change. After addressing each comment, use the following marker in your response to indicate resolution:

[COMMENT_RESOLVED: <commentId>]
```

3. Sends this as a **queued message** (via `sendQueuedMessageSocket`) if the agent is already running, or spawns a new agent with this as the initial prompt.

### Decision: Queued Message vs. New Agent

- If the thread's agent is currently **running** → send as queued message (injected mid-conversation)
- If the thread is **idle/completed** → resume the agent with this prompt (via `resumeSimpleAgent`)
- This mirrors how users already send follow-up messages to agents

---

## Phase 9: Agent-Side Comment Resolution Protocol

**Files:**
- `agents/src/runners/shared.ts` (modify) — add parsing in message handler
- `agents/src/lib/comment-resolver.ts` (new)

### Protocol

The agent marks comments resolved by including a marker in its text output:

```
[COMMENT_RESOLVED: <commentId>]
```

This is parsed from the agent's assistant message blocks in the message handler. The pattern is intentionally simple — it's a text convention the agent can produce naturally without needing a custom tool.

**Implementation in `shared.ts`:**

Add parsing in the message handler's assistant message processing. When an assistant message contains `[COMMENT_RESOLVED: <uuid>]`, emit a `COMMENT_RESOLVED` event:

```typescript
// In comment-resolver.ts
const resolvedPattern = /\[COMMENT_RESOLVED:\s*([a-f0-9-]+)\]/g;

export function extractResolvedCommentIds(text: string): string[] {
  const ids: string[] = [];
  let match;
  while ((match = resolvedPattern.exec(text)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}
```

```typescript
// In shared.ts message handler, when processing assistant text blocks
for (const commentId of extractResolvedCommentIds(block.text)) {
  emitEvent(EventName.COMMENT_RESOLVED, { threadId, commentId });
}
```

This approach:
- Requires no new tools or SDK changes
- Works naturally with the agent's text output
- Is easily parseable
- Agent doesn't need to know implementation details — just include the marker

---

## Phase 10: Frontend Event Listener

**Files:**
- `src/entities/comments/listeners.ts` (modify)

### Listener

Register an event listener on `EventName.COMMENT_RESOLVED`:

```typescript
eventBus.on(EventName.COMMENT_RESOLVED, async ({ threadId, commentId }) => {
  await commentService.resolve(threadId, commentId);
});
```

This closes the loop: agent emits event → frontend listener → service updates disk + store → UI reactively updates (comment shows as resolved).

Register this listener in the app initialization alongside other entity listeners (in `src/entities/comments/index.ts`).

---

## Key Design Decisions

### Why per-thread comments (not per-worktree)?
A thread represents a single task with a specific diff against `initialCommitHash`. Comments are about specific changes in that diff. If the worktree is reused for another thread, those comments are irrelevant. Thread-scoping matches the existing data model.

### Why `[COMMENT_RESOLVED: id]` text markers instead of a custom tool?
Adding a custom tool to the Claude Agent SDK requires SDK-level changes and increases complexity. A text marker:
- Works within existing infrastructure (message parsing)
- Is naturally producible by the LLM
- Can be parsed reliably with regex
- Follows the pattern of other convention-based features (plan detection via file patterns)

### Why lazy-load comments instead of hydrating at startup?
Comments are only relevant when viewing a specific thread's diff. Loading all comments for all threads at startup would be wasteful. The lazy pattern (load when diff view opens) is more efficient and matches how `ThreadState` is already loaded on-demand.

### Why ThreadContext but no WorktreeContext?
The original plan proposed both. After reviewing the codebase, worktree info (workingDirectory, worktreeId, repoId) is already available everywhere it's needed through direct props:
- `ChangesTab` receives `threadMetadata` and resolves `workingDirectory` via `useWorkingDirectory()`
- `ChangesView` receives `repoId`/`worktreeId` as props from `ContentPaneView`
- `DiffViewer` receives `workingDirectory` as a direct prop

Only `threadId` genuinely needs to flow to deeply nested components (`AnnotatedLineRow` level) for comment functionality. One provider is simpler than two.

### Why modify both InlineDiffBlock and DiffFileCard?
There are two separate rendering paths for diffs:
1. `InlineDiffBlock` → used by `ChangesTab`, `ChangesDiffContent`, and `ToolUseBlock`
2. `DiffFileCard` → used by `DiffViewer`

Both render `AnnotatedLineRow` at the leaf level but have their own wrapper logic. Both need comment support when inside a `ThreadProvider`. The gutter button in `AnnotatedLineRow` is shared, but the comment form/display management lives in each wrapper's local state.

### Why not use the existing PR comments pattern?
PR comments (`PullRequestDetails.reviewComments`) are read-only data fetched from GitHub. Inline diff comments are locally created, mutable, and need bidirectional agent communication. Different enough to warrant a separate entity.
