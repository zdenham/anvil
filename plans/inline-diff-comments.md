# Inline Diff Comments

Add the ability to leave inline comments on any line in a diff view, persist them per-worktree (with optional thread association), and spawn an agent to address all unresolved comments.

## Phases

- [ ] Define types and disk schema for inline comments
- [ ] Create comment store and service (entity layer)
- [ ] Add event definitions for comment lifecycle
- [ ] Add diff context provider (worktreeId + optional threadId)
- [ ] Build UI: comment gutter button and inline comment form
- [ ] Build UI: comment display and resolution controls
- [ ] Wire diff components to render comments via context
- [ ] Add "Address Comments" agent spawn flow
- [ ] Add agent-side comment resolution protocol
- [ ] Hook up agent event listener to mark comments resolved in store

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Architecture Overview

Comments are a new entity scoped to a **worktree** with an optional **thread association**. Since threads always live inside a worktree, `worktreeId` is the primary key — this means comments work in both thread diff views (where a threadId is available) and the standalone worktree changes view (where there's no thread).

Comments are persisted on disk at `~/.mort/comments/{worktreeId}.json` following the disk-as-truth pattern used by all other entities.

### Data Flow

```
User clicks line → CommentForm → commentService.create() → disk + store + event
User clicks "Address Comments" → spawn agent with comment context in prompt
Agent resolves comment → emits COMMENT_RESOLVED event via socket
Frontend listener → commentService.markResolved() → disk + store + UI update
```

### Scoping Model

```
Worktree (primary key)
├── Comment A (threadId: "abc-123")    ← left in thread changes tab
├── Comment B (threadId: "abc-123")    ← left in thread changes tab
├── Comment C (threadId: null)         ← left in standalone worktree changes view
└── Comment D (threadId: "def-456")    ← left in a different thread's changes tab
```

- All comments for a worktree are stored together and loaded together
- The UI can filter by threadId when viewing a specific thread's changes
- The standalone worktree changes view shows all comments for that worktree
- "Address Comments" in a thread context sends only that thread's comments to the agent; in worktree context it sends all unresolved comments (or prompts the user to pick a thread to route to)

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
  worktreeId: z.string().uuid(),        // primary scope — every comment belongs to a worktree
  threadId: z.string().uuid().optional(), // optional — null when left on standalone worktree diff
  filePath: z.string(),                  // relative path within worktree
  lineNumber: z.number().int(),          // new-side line number (from AnnotatedLine.newLineNumber)
  lineType: z.enum(["addition", "deletion", "unchanged"]),
  content: z.string().min(1),            // the comment text
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

**Disk format:** `~/.mort/comments/{worktreeId}.json`

```json
{
  "version": 1,
  "comments": [
    {
      "id": "uuid",
      "worktreeId": "uuid",
      "threadId": "uuid-or-null",
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

**Why `~/.mort/comments/{worktreeId}.json` instead of nesting under threads or repositories?**
- Comments are worktree-scoped, so `worktreeId` is the natural file key
- A flat `comments/` directory keeps the layout simple and avoids coupling to the repository directory structure
- Loading is straightforward: one file per worktree, load when any diff for that worktree opens

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
  // Comments keyed by worktreeId
  commentsByWorktree: Record<string, InlineComment[]>;
  _hydratedWorktrees: Set<string>;
}

interface CommentStoreActions {
  hydrate: (worktreeId: string, comments: InlineComment[]) => void;
  getByWorktree: (worktreeId: string) => InlineComment[];
  getByThread: (worktreeId: string, threadId: string) => InlineComment[];
  getByFile: (worktreeId: string, filePath: string, threadId?: string) => InlineComment[];
  getUnresolved: (worktreeId: string, threadId?: string) => InlineComment[];
  getUnresolvedCount: (worktreeId: string, threadId?: string) => number;
  _applyAdd: (comment: InlineComment) => Rollback;
  _applyUpdate: (id: string, worktreeId: string, updates: Partial<InlineComment>) => Rollback;
  _applyDelete: (id: string, worktreeId: string) => Rollback;
}
```

Key difference from the old thread-scoped plan: the store is keyed by `worktreeId`. Query methods accept an optional `threadId` filter — when provided, they only return comments for that thread; when omitted, they return all comments for the worktree.

**Service** (follows `planService` pattern — disk-as-truth with optimistic store updates):

- `create(worktreeId, filePath, lineNumber, lineType, content, threadId?)` → write to disk, apply to store, emit event
- `update(worktreeId, commentId, content)` → update on disk, apply to store, emit event
- `resolve(worktreeId, commentId)` → set `resolved: true, resolvedAt: Date.now()`, persist, emit event
- `unresolve(worktreeId, commentId)` → set `resolved: false`, persist, emit event
- `delete(worktreeId, commentId)` → remove from disk, apply to store, emit event
- `loadForWorktree(worktreeId)` → read from disk, hydrate store (lazy — called when diff view opens)

Comments are loaded **lazily** per-worktree (not at app startup), since they're only relevant when viewing a diff. The `_hydratedWorktrees` set tracks which worktrees have been loaded to avoid redundant disk reads.

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
[EventName.COMMENT_ADDED]: { worktreeId: string; commentId: string; threadId?: string };
[EventName.COMMENT_UPDATED]: { worktreeId: string; commentId: string };
[EventName.COMMENT_RESOLVED]: { worktreeId: string; commentId: string };
[EventName.COMMENT_DELETED]: { worktreeId: string; commentId: string };
```

Also add to `EventNameSchema` enum array.

---

## Phase 4: Diff Context Provider

**Files:**
- `src/contexts/diff-comment-context.tsx` (new)
- `src/components/content-pane/content-pane.tsx` (modify)
- `src/components/changes/changes-view.tsx` (modify)

### Problem

Comments need two pieces of info deep in the diff tree: `worktreeId` (always) and `threadId` (when in a thread view). Currently neither flows all the way down to `AnnotatedLineRow`. Rather than adding a thread-only context (which wouldn't work for standalone worktree diffs), we use a single context that carries both.

### DiffCommentContext Provider

```typescript
// src/contexts/diff-comment-context.tsx
import { createContext, useContext, type ReactNode } from "react";

interface DiffCommentContextValue {
  worktreeId: string;
  threadId: string | null;  // null when viewing standalone worktree changes
}

const DiffCommentContext = createContext<DiffCommentContextValue | null>(null);

export function DiffCommentProvider({
  worktreeId,
  threadId,
  children,
}: {
  worktreeId: string;
  threadId?: string | null;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ worktreeId, threadId: threadId ?? null }),
    [worktreeId, threadId],
  );
  return (
    <DiffCommentContext.Provider value={value}>
      {children}
    </DiffCommentContext.Provider>
  );
}

export function useDiffCommentContext(): DiffCommentContextValue {
  const ctx = useContext(DiffCommentContext);
  if (!ctx) throw new Error("useDiffCommentContext must be used within DiffCommentProvider");
  return ctx;
}

export function useOptionalDiffCommentContext(): DiffCommentContextValue | null {
  return useContext(DiffCommentContext);
}
```

### Why a plain context (not Zustand-in-context)?

The previous plan used a Zustand store wrapped in React Context for `ThreadProvider`. That pattern is useful when the context value changes frequently and you want to avoid re-renders (Zustand's selector pattern). But `worktreeId` and `threadId` are stable for the lifetime of a view — they don't change while viewing a diff. A plain React context with `useMemo` is simpler and sufficient.

### Integration Points

**Thread views** — in `content-pane.tsx`, wrap thread content in the provider:

```typescript
{view.type === "thread" && activeMetadata && (
  <DiffCommentProvider worktreeId={activeMetadata.worktreeId} threadId={view.threadId}>
    {threadTab === "conversation" && <ThreadContent ... />}
    {threadTab === "changes" && <ChangesTab ... />}
  </DiffCommentProvider>
)}
```

**Standalone worktree changes view** — in `changes-view.tsx`, wrap the view in the provider (no threadId):

```typescript
<DiffCommentProvider worktreeId={worktreeId}>
  <ChangesDiffContent ... />
</DiffCommentProvider>
```

This means comments are available in **both** diff contexts:
- Thread changes tab → `worktreeId` + `threadId` (comments associated with thread)
- Standalone worktree changes → `worktreeId` only (comments with `threadId: null`)

---

## Phase 5: UI — Comment Gutter Button and Inline Form

**Files:**
- `src/components/diff-viewer/comment-gutter-button.tsx` (new)
- `src/components/diff-viewer/inline-comment-form.tsx` (new)

### Comment Gutter Button

A small `+` icon button that appears on hover in the gutter area of each line row. Clicking it opens the inline comment form below that line.

- Rendered inside `AnnotatedLineRow` as an extra cell (between the type indicator and content, or overlaying the old-line-number gutter)
- Only appears when `useOptionalDiffCommentContext()` returns a value (the diff viewer is in "commentable" mode)
- Uses absolute positioning in the line number gutter area
- The `AnnotatedLineRow` currently has: `[old-line-no] [new-line-no] [+/-] [content]` — the button overlays the old-line-number cell on hover

### Inline Comment Form

A small textarea that appears below the target line when the gutter button is clicked.

- Spans the full width of the diff row area
- Submit on `Cmd+Enter` or button click
- Cancel on `Escape`
- Gets `worktreeId` and `threadId` from `useDiffCommentContext()` and calls `commentService.create()` on submit
- Auto-focuses textarea on mount

**State management:** The "which line has an open form" state lives in the parent (`InlineDiffBlock.DiffContent` or `DiffFileCardContent`) as local React state (`activeCommentLine: number | null`), since it's purely UI state.

---

## Phase 6: UI — Comment Display and Resolution

**Files:**
- `src/components/diff-viewer/inline-comment-display.tsx` (new)

### Comment Display

For each line that has comments, render a comment block below the line row:

- Shows comment content, timestamp
- "Resolve" button → calls `commentService.resolve()`
- "Delete" button → calls `commentService.delete()`
- Resolved comments shown with strikethrough / dimmed styling and a "Reopen" button
- Unresolved comments shown with accent border (e.g., amber/yellow)
- When in a thread view, only shows comments for that thread (filtered by `threadId`)
- When in standalone worktree view, shows all comments

### Comment Count Badge

In the `InlineDiffHeader` component (used by `InlineDiffBlock`), show a badge with unresolved comment count per file (e.g., "3 comments"). Uses `useOptionalDiffCommentContext()` + `useCommentStore.getByFile()`.

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

Both paths use `AnnotatedLineRow` at the leaf level. The comment gutter button lives in `AnnotatedLineRow` and activates only when `useOptionalDiffCommentContext()` provides a value.

### Strategy: Context over Props

The `DiffCommentProvider` from Phase 4 wraps diff views at the `ContentPane` / `ChangesView` level. Any descendant can read `worktreeId` + `threadId` via `useOptionalDiffCommentContext()` — no prop changes needed at intermediate levels.

### Changes

1. **`AnnotatedLineRow`** (modify): Add the `CommentGutterButton` (Phase 5) as an overlay on hover. Uses `useOptionalDiffCommentContext()` to decide whether to show. Accepts new optional props:
   - `onCommentClick?: (lineNumber: number) => void` — opens comment form for this line
   - `commentCount?: number` — shows small indicator dot when > 0
   - These are passed from the parent (`DiffContent` / `DiffFileCardContent`), not from context, since they're per-file UI state

2. **`InlineDiffBlock`** (modify its inner `DiffContent`): When `useOptionalDiffCommentContext()` returns a value:
   - Calls `commentService.loadForWorktree(worktreeId)` on mount (lazy loading)
   - Reads comments for this file from `useCommentStore.getByFile(worktreeId, filePath, threadId)`
   - Manages `activeCommentLine` local state
   - Renders `InlineCommentForm` and `InlineCommentDisplay` between `AnnotatedLineRow` elements
   - Passes `onCommentClick` and `commentCount` to each `AnnotatedLineRow`

3. **`DiffFileCardContent`** (modify): Same pattern as `InlineDiffBlock` — reads from comment store when in diff comment context, manages local comment form state, renders comment UI between line rows.

4. **`DiffViewer`** (no changes needed): Stays a pure component. The `DiffCommentProvider` wraps it upstream.

### What stays as props vs. what uses context

| Data | Mechanism | Reason |
|---|---|---|
| `worktreeId` + `threadId` | `useDiffCommentContext()` | Stable for entire subtree, avoids drilling |
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

**In thread context** (`threadId` is set):
1. Collects unresolved comments for this thread via `useCommentStore.getUnresolved(worktreeId, threadId)`
2. Formats them into a structured prompt and sends to the thread's agent (see below)

**In standalone worktree context** (`threadId` is null):
1. Collects all unresolved comments via `useCommentStore.getUnresolved(worktreeId)`
2. Prompts the user to select which thread/agent to route them to (or create a new thread)
3. Once a thread is selected, sends the formatted prompt

### Prompt Format

```
Please address the following code review comments on this branch:

## src/foo.ts:42
> This should use a Map instead of an object

## src/bar.ts:15
> Missing error handling for the API call

For each comment, make the requested change. After addressing each comment, use the following marker in your response to indicate resolution:

[COMMENT_RESOLVED: <commentId>]
```

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
  emitEvent(EventName.COMMENT_RESOLVED, { worktreeId, commentId });
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
eventBus.on(EventName.COMMENT_RESOLVED, async ({ worktreeId, commentId }) => {
  await commentService.resolve(worktreeId, commentId);
});
```

This closes the loop: agent emits event → frontend listener → service updates disk + store → UI reactively updates (comment shows as resolved).

Register this listener in the app initialization alongside other entity listeners (in `src/entities/comments/index.ts`).

---

## Key Design Decisions

### Why worktree-primary with optional thread association (not thread-only)?

The original plan scoped comments to threads. But there are two distinct diff views:
1. **Thread changes tab** — shows agent-generated changes, has a `threadId`
2. **Standalone worktree changes view** — shows git diff for a worktree, no `threadId`

If comments were thread-only, users couldn't leave comments on the standalone worktree diff (e.g., annotating code before asking an agent to fix it). Since threads always live inside a worktree, `worktreeId` is the natural primary key. The optional `threadId` association lets us filter comments per-thread when that context exists, while still supporting the worktree-only case.

### Why one file per worktree (not per thread)?

- A worktree may have comments from multiple threads plus standalone comments — storing them together avoids loading multiple files
- When viewing the standalone worktree changes, you want all comments regardless of thread — one file makes this a single read
- Thread-filtered views are just an in-memory filter on the loaded data

### Why `[COMMENT_RESOLVED: id]` text markers instead of a custom tool?

Adding a custom tool to the Claude Agent SDK requires SDK-level changes and increases complexity. A text marker:
- Works within existing infrastructure (message parsing)
- Is naturally producible by the LLM
- Can be parsed reliably with regex
- Follows the pattern of other convention-based features (plan detection via file patterns)

### Why lazy-load comments instead of hydrating at startup?

Comments are only relevant when viewing a diff. Loading all comments for all worktrees at startup would be wasteful. The lazy pattern (load when diff view opens) is more efficient and matches how `ThreadState` is already loaded on-demand.

### Why DiffCommentContext instead of separate ThreadContext + WorktreeContext?

The previous plan proposed a `ThreadContext` provider that only carried `threadId`. This wouldn't work for standalone worktree diffs. Instead, a single `DiffCommentContext` carries both `worktreeId` (always present) and `threadId` (present only in thread views). This:
- Works in both diff contexts with one provider
- Avoids needing two separate context providers
- Keeps the context surface small (just two IDs)
- Uses plain React context since both values are stable per-view

### Why modify both InlineDiffBlock and DiffFileCard?

There are two separate rendering paths for diffs:
1. `InlineDiffBlock` → used by `ChangesTab`, `ChangesDiffContent`, and `ToolUseBlock`
2. `DiffFileCard` → used by `DiffViewer`

Both render `AnnotatedLineRow` at the leaf level but have their own wrapper logic. Both need comment support when inside a `DiffCommentProvider`. The gutter button in `AnnotatedLineRow` is shared, but the comment form/display management lives in each wrapper's local state.

### Why not use the existing PR comments pattern?

PR comments (`PullRequestDetails.reviewComments`) are read-only data fetched from GitHub. Inline diff comments are locally created, mutable, and need bidirectional agent communication. Different enough to warrant a separate entity.
