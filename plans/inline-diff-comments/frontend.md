# Frontend: Entity Layer, Context, UI Components, Wiring

All frontend work for inline diff comments. Depends on `foundation.md` completing first. Runs in parallel with `agent.md`.

**All files in this plan are under `src/` — no `agents/` or `core/` modifications.**

## Phases

- [ ] Create comment store and service (entity layer)
- [ ] Register COMMENT_* events in event bridge and agent routing
- [ ] Add Zustand-in-context provider for diff comment scope
- [ ] Build UI: comment gutter button and inline comment form
- [ ] Build UI: comment display and resolution controls
- [ ] Wire diff components to render comments via context
- [ ] Add "Address Comments" agent spawn flow
- [ ] Write frontend tests (store + service)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Comment Store and Service (Entity Layer)

**Files:**
- `src/entities/comments/types.ts` (new) — re-export from `@core/types/comments.js`
- `src/entities/comments/store.ts` (new)
- `src/entities/comments/service.ts` (new)
- `src/entities/comments/listeners.ts` (new)
- `src/entities/comments/index.ts` (new)
- `src/entities/index.ts` (modify) — register listeners

### Store (Zustand)

Follow the entity stores pattern: comments keyed by unique ID with derived lookups.

```typescript
// src/entities/comments/store.ts
import { create } from "zustand";
import type { InlineComment } from "@core/types/comments.js";
import type { Rollback } from "@/lib/optimistic";

interface CommentStoreState {
  comments: Record<string, InlineComment>; // keyed by comment.id
  _hydratedWorktrees: Set<string>;
}

interface CommentStoreActions {
  hydrate: (worktreeId: string, comments: InlineComment[]) => void;
  isHydrated: (worktreeId: string) => boolean;

  // Selectors — all filter in-memory from the keyed record
  getByWorktree: (worktreeId: string) => InlineComment[];
  getByThread: (worktreeId: string, threadId: string) => InlineComment[];
  getByFile: (worktreeId: string, filePath: string, threadId?: string | null) => InlineComment[];
  getUnresolved: (worktreeId: string, threadId?: string | null) => InlineComment[];
  getUnresolvedCount: (worktreeId: string, threadId?: string | null) => number;

  // Optimistic mutations — return rollback functions
  _applyAdd: (comment: InlineComment) => Rollback;
  _applyUpdate: (commentId: string, updates: Partial<InlineComment>) => Rollback;
  _applyDelete: (commentId: string) => Rollback;
  _applyClearWorktree: (worktreeId: string) => void;
}

export const useCommentStore = create<CommentStoreState & CommentStoreActions>(
  (set, get) => ({
    comments: {},
    _hydratedWorktrees: new Set(),

    hydrate: (worktreeId, comments) => {
      set((state) => {
        const filtered = Object.fromEntries(
          Object.entries(state.comments).filter(
            ([, c]) => c.worktreeId !== worktreeId,
          ),
        );
        const added = Object.fromEntries(comments.map((c) => [c.id, c]));
        const newHydrated = new Set(state._hydratedWorktrees);
        newHydrated.add(worktreeId);
        return {
          comments: { ...filtered, ...added },
          _hydratedWorktrees: newHydrated,
        };
      });
    },

    isHydrated: (worktreeId) => get()._hydratedWorktrees.has(worktreeId),

    getByWorktree: (worktreeId) =>
      Object.values(get().comments).filter((c) => c.worktreeId === worktreeId),

    getByThread: (worktreeId, threadId) =>
      Object.values(get().comments).filter(
        (c) => c.worktreeId === worktreeId && c.threadId === threadId,
      ),

    getByFile: (worktreeId, filePath, threadId) => {
      return Object.values(get().comments).filter((c) => {
        if (c.worktreeId !== worktreeId || c.filePath !== filePath) return false;
        if (threadId !== undefined) return c.threadId === threadId;
        return true;
      });
    },

    getUnresolved: (worktreeId, threadId) =>
      Object.values(get().comments).filter((c) => {
        if (c.worktreeId !== worktreeId || c.resolved) return false;
        if (threadId !== undefined) return c.threadId === threadId;
        return true;
      }),

    getUnresolvedCount: (worktreeId, threadId) =>
      get().getUnresolved(worktreeId, threadId).length,

    _applyAdd: (comment) => {
      set((state) => ({
        comments: { ...state.comments, [comment.id]: comment },
      }));
      return () =>
        set((state) => {
          const { [comment.id]: _, ...rest } = state.comments;
          return { comments: rest };
        });
    },

    _applyUpdate: (commentId, updates) => {
      const prev = get().comments[commentId];
      if (!prev) return () => {};
      set((state) => ({
        comments: {
          ...state.comments,
          [commentId]: { ...prev, ...updates },
        },
      }));
      return () =>
        set((state) => ({
          comments: { ...state.comments, [commentId]: prev },
        }));
    },

    _applyDelete: (commentId) => {
      const prev = get().comments[commentId];
      set((state) => {
        const { [commentId]: _, ...rest } = state.comments;
        return { comments: rest };
      });
      return () => {
        if (prev) {
          set((state) => ({
            comments: { ...state.comments, [commentId]: prev },
          }));
        }
      };
    },

    _applyClearWorktree: (worktreeId) => {
      set((state) => {
        const filtered = Object.fromEntries(
          Object.entries(state.comments).filter(
            ([, c]) => c.worktreeId !== worktreeId,
          ),
        );
        const newHydrated = new Set(state._hydratedWorktrees);
        newHydrated.delete(worktreeId);
        return { comments: filtered, _hydratedWorktrees: newHydrated };
      });
    },
  }),
);
```

### Service

Object-based service (follows the `questionService` / `permissionService` pattern). Uses `appData` for disk I/O with relative paths. All mutations use read-modify-write to handle concurrent access.

```typescript
// src/entities/comments/service.ts
// NOTE: Use crypto.randomUUID() — no uuid package in this codebase
import { logger } from "@/lib/logger-client";
import { appData } from "@/lib/app-data-store";
import { eventBus } from "@/entities/events";
import { EventName } from "@core/types/events.js";
import { CommentsFileSchema, type InlineComment } from "@core/types/comments.js";
import { useCommentStore } from "./store";

const RESOLVED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const UNRESOLVED_WARN_THRESHOLD = 200;

function commentsPath(worktreeId: string): string {
  return `comments/${worktreeId}.json`;
}

function archivePath(worktreeId: string): string {
  return `comments/${worktreeId}.archive.json`;
}

/** Separate stale resolved comments from active ones. */
function partitionStale(comments: InlineComment[]): {
  active: InlineComment[];
  stale: InlineComment[];
} {
  const cutoff = Date.now() - RESOLVED_TTL_MS;
  const active: InlineComment[] = [];
  const stale: InlineComment[] = [];
  for (const c of comments) {
    if (c.resolved && c.resolvedAt !== null && c.resolvedAt <= cutoff) {
      stale.push(c);
    } else {
      active.push(c);
    }
  }
  return { active, stale };
}

/** Append stale comments to the archive file (never loaded into store). */
async function appendToArchive(
  worktreeId: string,
  stale: InlineComment[],
): Promise<void> {
  const path = archivePath(worktreeId);
  const raw = await appData.readJson<unknown>(path);
  const parsed = raw ? CommentsFileSchema.safeParse(raw) : null;
  const existing = parsed?.success ? parsed.data.comments : [];
  await appData.writeJson(path, {
    version: 1,
    comments: [...existing, ...stale],
  });
}

/** Read-modify-write helper. Reads current file, applies mutation, writes back. */
async function readModifyWrite(
  worktreeId: string,
  mutate: (comments: InlineComment[]) => InlineComment[],
): Promise<void> {
  const path = commentsPath(worktreeId);
  const raw = await appData.readJson<unknown>(path);
  const parsed = raw ? CommentsFileSchema.safeParse(raw) : null;
  const existing = parsed?.success ? parsed.data.comments : [];
  const updated = mutate(existing);
  await appData.writeJson(path, { version: 1, comments: updated });
}

export const commentService = {
  /** Lazy-load comments for a worktree from disk. No-op if already hydrated. */
  async loadForWorktree(worktreeId: string): Promise<void> {
    if (useCommentStore.getState().isHydrated(worktreeId)) return;

    const raw = await appData.readJson<unknown>(commentsPath(worktreeId));
    if (!raw) {
      useCommentStore.getState().hydrate(worktreeId, []);
      return;
    }

    const parsed = CommentsFileSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("[CommentService] Invalid comments file, resetting", {
        worktreeId,
        error: parsed.error.message,
      });
      useCommentStore.getState().hydrate(worktreeId, []);
      return;
    }

    // Archive stale resolved comments to separate file
    const { active, stale } = partitionStale(parsed.data.comments);
    if (stale.length > 0) {
      await appendToArchive(worktreeId, stale);
      await appData.writeJson(commentsPath(worktreeId), {
        version: 1,
        comments: active,
      });
    }

    // Warn if unresolved count is high
    const unresolvedCount = active.filter((c) => !c.resolved).length;
    if (unresolvedCount >= UNRESOLVED_WARN_THRESHOLD) {
      logger.warn("[CommentService] High unresolved comment count", {
        worktreeId,
        unresolvedCount,
      });
    }

    useCommentStore.getState().hydrate(worktreeId, active);
  },

  async create(params: {
    worktreeId: string;
    filePath: string;
    lineNumber: number;
    lineType: InlineComment["lineType"];
    content: string;
    threadId?: string | null;
  }): Promise<InlineComment> {
    const now = Date.now();
    const comment: InlineComment = {
      id: crypto.randomUUID(),
      worktreeId: params.worktreeId,
      threadId: params.threadId ?? null,
      filePath: params.filePath,
      lineNumber: params.lineNumber,
      lineType: params.lineType,
      content: params.content,
      resolved: false,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const rollback = useCommentStore.getState()._applyAdd(comment);
    try {
      await readModifyWrite(params.worktreeId, (comments) => [
        ...comments,
        comment,
      ]);
      eventBus.emit(EventName.COMMENT_ADDED, {
        worktreeId: params.worktreeId,
        commentId: comment.id,
      });
    } catch (err) {
      rollback();
      throw err;
    }

    return comment;
  },

  async update(
    worktreeId: string,
    commentId: string,
    content: string,
  ): Promise<void> {
    const updates = { content, updatedAt: Date.now() };
    const rollback = useCommentStore.getState()._applyUpdate(commentId, updates);
    try {
      await readModifyWrite(worktreeId, (comments) =>
        comments.map((c) => (c.id === commentId ? { ...c, ...updates } : c)),
      );
      eventBus.emit(EventName.COMMENT_UPDATED, { worktreeId, commentId });
    } catch (err) {
      rollback();
      throw err;
    }
  },

  async resolve(worktreeId: string, commentId: string): Promise<void> {
    const updates = {
      resolved: true,
      resolvedAt: Date.now(),
      updatedAt: Date.now(),
    };
    const rollback = useCommentStore.getState()._applyUpdate(commentId, updates);
    try {
      await readModifyWrite(worktreeId, (comments) =>
        comments.map((c) => (c.id === commentId ? { ...c, ...updates } : c)),
      );
      eventBus.emit(EventName.COMMENT_RESOLVED, { worktreeId, commentId });
    } catch (err) {
      rollback();
      throw err;
    }
  },

  /** Called from COMMENT_RESOLVED listener only — same as resolve() but does NOT
   *  re-emit the event (avoids circular event loop when agent triggers resolution). */
  async _resolveFromEvent(worktreeId: string, commentId: string): Promise<void> {
    const updates = {
      resolved: true,
      resolvedAt: Date.now(),
      updatedAt: Date.now(),
    };
    const rollback = useCommentStore.getState()._applyUpdate(commentId, updates);
    try {
      await readModifyWrite(worktreeId, (comments) =>
        comments.map((c) => (c.id === commentId ? { ...c, ...updates } : c)),
      );
    } catch (err) {
      rollback();
      throw err;
    }
  },

  async unresolve(worktreeId: string, commentId: string): Promise<void> {
    const updates = {
      resolved: false,
      resolvedAt: null,
      updatedAt: Date.now(),
    };
    const rollback = useCommentStore.getState()._applyUpdate(commentId, updates);
    try {
      await readModifyWrite(worktreeId, (comments) =>
        comments.map((c) => (c.id === commentId ? { ...c, ...updates } : c)),
      );
      eventBus.emit(EventName.COMMENT_UPDATED, { worktreeId, commentId });
    } catch (err) {
      rollback();
      throw err;
    }
  },

  async delete(worktreeId: string, commentId: string): Promise<void> {
    const rollback = useCommentStore.getState()._applyDelete(commentId);
    try {
      await readModifyWrite(worktreeId, (comments) =>
        comments.filter((c) => c.id !== commentId),
      );
      eventBus.emit(EventName.COMMENT_DELETED, { worktreeId, commentId });
    } catch (err) {
      rollback();
      throw err;
    }
  },

  /** Remove all comments for a worktree (called on worktree archive/delete). */
  async clearWorktree(worktreeId: string): Promise<void> {
    useCommentStore.getState()._applyClearWorktree(worktreeId);
    await appData.deleteFile(commentsPath(worktreeId));
    await appData.deleteFile(archivePath(worktreeId));
  },
};
```

**Key patterns applied:**
- **Disk-as-truth**: `readModifyWrite` always reads current disk state before writing
- **Optimistic updates**: `_apply*` returns rollback, called before `readModifyWrite`
- **Disk before event**: `eventBus.emit()` only after `readModifyWrite()` completes
- **Zod at boundaries**: `CommentsFileSchema.safeParse()` when loading from disk
- **Logger**: Uses `logger.warn` for invalid file detection, no `console.log`
- **Entity stores**: Comments keyed by `comment.id` in store, filtered by selectors

### Listeners

```typescript
// src/entities/comments/listeners.ts
import { eventBus } from "@/entities/events";
import { EventName } from "@core/types/events.js";
import { commentService } from "./service";
import { useCommentStore } from "./store";

export function setupCommentListeners(): void {
  // Agent resolved a comment — update disk + store.
  // Uses _resolveFromEvent (not commentService.resolve) to avoid re-emitting
  // COMMENT_RESOLVED and creating a circular event loop.
  eventBus.on(EventName.COMMENT_RESOLVED, async ({ worktreeId, commentId }) => {
    // Only process if this worktree is hydrated (we have the comment in store)
    if (!useCommentStore.getState().isHydrated(worktreeId)) return;
    // Skip if already resolved in store (prevent double-processing)
    const existing = useCommentStore.getState().comments[commentId];
    if (!existing || existing.resolved) return;
    await commentService._resolveFromEvent(worktreeId, commentId);
  });

  // Clean up comments when a worktree is released.
  // NOTE: WORKTREE_RELEASED payload is { threadId }, not { worktreeId }.
  // Look up the worktreeId from thread metadata before clearing.
  eventBus.on(EventName.WORKTREE_RELEASED, async ({ threadId }) => {
    const thread = useThreadStore.getState().threads[threadId];
    if (!thread?.worktreeId) return;
    await commentService.clearWorktree(thread.worktreeId);
  });
}
```

### Index

```typescript
// src/entities/comments/index.ts
export { useCommentStore } from "./store.js";
export { commentService } from "./service.js";
export { setupCommentListeners } from "./listeners.js";
export type { InlineComment, CommentsFile } from "./types.js";
```

### Entity Registration

Add to `src/entities/index.ts`:

```typescript
import { setupCommentListeners } from "./comments/listeners.js";

// In setupEntityListeners():
setupCommentListeners();
```

Comments are **not** added to `hydrateEntities()` — they load lazily when a diff view opens via `commentService.loadForWorktree()`.

---

## Phase 2: Event Bridge Registration

Agent-emitted `COMMENT_*` events travel: Agent → hub socket → Tauri `agent:message` → `routeAgentEvent()` → `eventBus.emit()`. Events must be explicitly registered in two places to complete this path.

**Files:**
- `src/lib/agent-service.ts` (modify) — add cases in `routeAgentEvent()`
- `src/lib/event-bridge.ts` (modify) — add to `BROADCAST_EVENTS` array

### Agent Service Routing

In `routeAgentEvent()` (around line 221 in `agent-service.ts`), add cases for the four comment events. These events carry `{ worktreeId, commentId }` payloads and should be emitted on the frontend `eventBus`:

```typescript
case EventName.COMMENT_ADDED:
case EventName.COMMENT_UPDATED:
case EventName.COMMENT_RESOLVED:
case EventName.COMMENT_DELETED:
  eventBus.emit(event.name, event.payload);
  break;
```

### Event Bridge Broadcast

Add the four events to the `BROADCAST_EVENTS` array in `event-bridge.ts` (around line 15) so they broadcast across windows in multi-pane layouts:

```typescript
EventName.COMMENT_ADDED,
EventName.COMMENT_UPDATED,
EventName.COMMENT_RESOLVED,
EventName.COMMENT_DELETED,
```

---

## Phase 3: Zustand-in-Context Provider

**Files:**
- `src/contexts/diff-comment-context.tsx` (new)
- `src/components/content-pane/content-pane.tsx` (modify)
- `src/components/changes/changes-view.tsx` (modify)

### DiffCommentStore (Zustand-in-Context)

Uses `createStore` (not `create`) to produce per-provider store instances, held in a React context. This gives selector-based subscriptions (no re-renders from unrelated changes) while scoping `worktreeId` + `threadId` to the diff subtree without prop drilling.

```typescript
// src/contexts/diff-comment-context.tsx
import { createContext, useContext, useRef, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";

interface DiffCommentState {
  worktreeId: string;
  threadId: string | null;
}

function createDiffCommentStore(
  worktreeId: string,
  threadId: string | null,
): StoreApi<DiffCommentState> {
  return createStore<DiffCommentState>(() => ({
    worktreeId,
    threadId,
  }));
}

const DiffCommentStoreContext =
  createContext<StoreApi<DiffCommentState> | null>(null);

export function DiffCommentProvider({
  worktreeId,
  threadId,
  children,
}: {
  worktreeId: string;
  threadId?: string | null;
  children: ReactNode;
}) {
  const storeRef = useRef<StoreApi<DiffCommentState>>(null);
  if (storeRef.current === null) {
    storeRef.current = createDiffCommentStore(worktreeId, threadId ?? null);
  }
  return (
    <DiffCommentStoreContext.Provider value={storeRef.current}>
      {children}
    </DiffCommentStoreContext.Provider>
  );
}

/** Hook with selector support. Throws if not inside a DiffCommentProvider. */
export function useDiffCommentStore<T>(
  selector: (state: DiffCommentState) => T,
): T {
  const store = useContext(DiffCommentStoreContext);
  if (!store) {
    throw new Error(
      "useDiffCommentStore must be used within DiffCommentProvider",
    );
  }
  return useStore(store, selector);
}

/** Returns null if not inside a DiffCommentProvider (for optional usage). */
export function useOptionalDiffCommentStore(): StoreApi<DiffCommentState> | null {
  return useContext(DiffCommentStoreContext);
}
```

### Integration Points

**Thread views** — in `content-pane.tsx`, wrap the thread content block inside `InputStoreProvider` (around line 139). The component already renders `ThreadContent` and `ChangesTab` conditionally based on `threadTab` state. Wrap both with `DiffCommentProvider`:

```typescript
<InputStoreProvider active>
  {view.type === "thread" && (
    <DiffCommentProvider worktreeId={worktreeId} threadId={view.threadId}>
      {threadTab === "conversation" && <ThreadContent ... />}
      {threadTab === "changes" && <ChangesTab ... />}
    </DiffCommentProvider>
  )}
  ...
</InputStoreProvider>
```

Note: `worktreeId` must be resolved from thread metadata. The component already has access to the thread view — look up `worktreeId` from the thread's metadata store (same pattern used by `ChangesTab`).

**Standalone worktree changes view** — in `changes-view.tsx`:

```typescript
<DiffCommentProvider worktreeId={worktreeId}>
  <ChangesDiffContent ... />
</DiffCommentProvider>
```

Also update `src/contexts/index.ts` to export the new context.

---

## Phase 4: UI — Comment Gutter Button and Inline Form

**Files:**
- `src/components/diff-viewer/comment-gutter-button.tsx` (new)
- `src/components/diff-viewer/inline-comment-form.tsx` (new)

### Comment Gutter Button

A small `+` icon button that appears on hover in the gutter area of each line row. Clicking it opens the inline comment form below that line.

- Rendered inside `AnnotatedLineRow` as an absolutely-positioned overlay on the old-line-number cell
- Only visible when `onLineClick` prop is provided (diff viewer is in "commentable" mode)
- Shows on hover via CSS (`opacity-0 group-hover:opacity-100`)
- `AnnotatedLineRow` currently has: `[old-line-no] [new-line-no] [+/-] [content]`

### Inline Comment Form

A small textarea that appears below the target line when the gutter button is clicked.

- Spans the full width of the diff area
- Submit on `Cmd+Enter` or button click
- Cancel on `Escape`
- Reads `worktreeId` and `threadId` from `useDiffCommentStore()`, calls `commentService.create()` on submit
- Auto-focuses textarea on mount
- Renders **outside** the `role="table"` structure to preserve ARIA semantics (see Phase 6)

**State management:** The "which line has an open form" state lives in the parent (`InlineDiffBlock.DiffContent` or `DiffFileCardContent`) as local React state (`activeCommentLine: number | null`), since it's purely UI state.

---

## Phase 5: UI — Comment Display and Resolution

**Files:**
- `src/components/diff-viewer/inline-comment-display.tsx` (new)

### Comment Display

For each line that has comments, render a comment block below the line row:

- Shows comment content, relative timestamp
- "Resolve" button → calls `commentService.resolve()`
- "Delete" button → calls `commentService.delete()`
- Resolved comments shown with dimmed styling and a "Reopen" button (calls `commentService.unresolve()`)
- Unresolved comments shown with accent left-border (amber/yellow)
- When in a thread view, only shows comments for that thread (filtered by `threadId` from `useDiffCommentStore()`)
- When in standalone worktree view, shows all comments
- Renders **outside** the `role="table"` structure (see Phase 6)

### Comment Count Badge

In the `InlineDiffHeader` component (`src/components/thread/inline-diff-header.tsx`), show a badge with unresolved comment count per file. Reads `worktreeId` and `threadId` from `useDiffCommentStore()`, reads count from `useCommentStore` with a selective subscription.

Similarly in `FileHeader` (`src/components/diff-viewer/file-header.tsx`).

---

## Phase 6: Wire Diff Components to Render Comments

**Files:**
- `src/components/thread/inline-diff-block.tsx` (modify)
- `src/components/diff-viewer/diff-file-card.tsx` (modify)
- `src/components/diff-viewer/annotated-line-row.tsx` (modify)

### Current Diff Rendering Architecture

Two distinct rendering paths both need comment support:

1. **`InlineDiffBlock`** (`src/components/thread/inline-diff-block.tsx`) — Used by `ChangesTab`, `ChangesDiffContent`, and `ToolUseBlock`. Has its own `DiffContent` inner component that renders `AnnotatedLineRow` directly.

2. **`DiffFileCard`** (`src/components/diff-viewer/diff-file-card.tsx`) — Used by `DiffViewer`. Has `DiffFileCardContent` that also renders `AnnotatedLineRow`.

Both use `AnnotatedLineRow` at the leaf level. The comment gutter button lives in `AnnotatedLineRow` and activates only when `useOptionalDiffCommentStore()` returns a store (i.e., inside a `DiffCommentProvider`).

### Accessibility: Comments Outside Table Structure

Both rendering paths use `role="table"` → `role="rowgroup"` → `role="row"` for the diff lines. Comment forms and displays must **not** be inserted between `role="row"` elements inside the table, as this breaks ARIA semantics.

**Solution:** Restructure the rendering so each line + its comments are grouped together:

```tsx
{renderItems.map((item) => {
  const lineNumber = item.line.newLineNumber ?? item.line.oldLineNumber;
  const commentsForLine = commentsByLine.get(lineNumber) ?? [];
  return (
    <div key={item.key}>
      {/* Table row stays inside role="table" */}
      <AnnotatedLineRow line={item.line} onLineClick={handleCommentClick} />
      {/* Comment UI renders outside the table */}
      {isCommentable && (
        <>
          {activeCommentLine === lineNumber && (
            <InlineCommentForm
              filePath={filePath}
              lineNumber={lineNumber}
              lineType={item.line.type}
              onClose={() => setActiveCommentLine(null)}
            />
          )}
          <InlineCommentDisplay comments={commentsForLine} />
        </>
      )}
    </div>
  );
})}
```

Note: `InlineCommentForm` and `InlineCommentDisplay` read `worktreeId`/`threadId` from `useDiffCommentStore()` internally — no need to pass them as props.

The `role="table"` wrapper moves to wrap only the `AnnotatedLineRow` elements, or each line group uses `role="row"` only on the line itself (not the wrapping div).

### Changes

1. **`AnnotatedLineRow`** (modify): Add hover overlay for `CommentGutterButton`. Uses `useOptionalDiffCommentStore()` to decide whether to show (returns null when not inside a provider):
   - `onLineClick?: (lineNumber: number) => void` — already exists, repurposed for opening comment form
   - Add `hasComments?: boolean` — shows a small indicator dot in the gutter when true
   - Add `className="group"` to enable `group-hover:` CSS for the gutter button

2. **`InlineDiffBlock`** (modify its inner `DiffContent`): When `useOptionalDiffCommentStore()` returns a store:
   - Reads `worktreeId` and `threadId` from `useDiffCommentStore()`
   - Calls `commentService.loadForWorktree(worktreeId)` on mount (lazy loading, via `useEffect`)
   - Reads comments for this file from `useCommentStore` with a selective subscription
   - Pre-computes `commentsByLine: Map<number, InlineComment[]>` via `useMemo` — avoids per-row filtering
   - Manages `activeCommentLine` local state
   - Renders `InlineCommentForm` and `InlineCommentDisplay` after each `AnnotatedLineRow`
   - Passes `onLineClick` and `hasComments` to each `AnnotatedLineRow`

3. **`DiffFileCardContent`** (modify): Same pattern as `InlineDiffBlock` — reads from `useDiffCommentStore()` for scope, reads from `useCommentStore` for data, manages local comment form state, renders comment UI after line rows.

4. **`DiffViewer`** (no changes needed): Stays a pure component. The `DiffCommentProvider` wraps it upstream.

### Data Flow Summary

| Data | Mechanism | Reason |
|---|---|---|
| `worktreeId` + `threadId` | `useDiffCommentStore()` (Zustand-in-context) | Consistent Zustand pattern, avoids prop drilling |
| Comment data | `useCommentStore` (global Zustand store) | Standard entity store access |
| `onLineClick` | Existing prop from parent | Per-file UI callback |
| `hasComments` | New prop from parent | Derived per-line, computed in parent via `commentsByLine` Map |
| `activeCommentLine` | Local state in parent | Ephemeral UI state |
| `commentsByLine` | `useMemo` in parent | Pre-computed Map for O(1) per-row lookup |

---

## Phase 7: "Address Comments" Agent Spawn Flow

**Files:**
- `src/components/diff-viewer/address-comments-button.tsx` (new)
- `src/components/thread/inline-diff-header.tsx` (modify) — add button next to expand/collapse
- `src/components/diff-viewer/file-header.tsx` (modify) — add button slot

### UX

Add an "Address Comments" button that is visible when there are unresolved comments. It appears in:
1. **`InlineDiffHeader`** — per-file, next to the expand/collapse controls
2. **`FileHeader`** — per-file in the DiffViewer rendering path

Clicking it:

**In thread context** (`threadId` is set):
1. Collects unresolved comments for this thread via `useCommentStore.getUnresolved(worktreeId, threadId)`
2. Formats them into a structured prompt
3. Sends to the thread's agent (see Message Delivery below)

**In standalone worktree context** (`threadId` is null):
1. Collects all unresolved comments via `useCommentStore.getUnresolved(worktreeId)`
2. Prompts the user to select which thread/agent to route them to (or create a new thread)
3. Once a thread is selected, sends the formatted prompt

### Prompt Format

```
Please address the following code review comments on this branch:

## src/foo.ts:42 (comment-id: abc-123)
> This should use a Map instead of an object

## src/bar.ts:15 (comment-id: def-456)
> Missing error handling for the API call

For each comment, make the requested change. After addressing a comment, mark it resolved:
mort-resolve-comment "abc-123,def-456"
```

Note: The `mort-resolve-comment` CLI is intercepted by the agent's PreToolUse hook (see `agent.md`). The prompt format must include comment IDs so the agent can reference them in the resolution command.

### Message Delivery

The mechanism depends on agent state:

- **Agent is running** → use `sendQueuedMessage()` to inject a message mid-conversation via the hub server's socket connection
- **Agent is idle/completed** → resume the agent with this prompt using `resumeSimpleAgent(threadId, prompt, sourcePath)` from `src/lib/agent-service.ts` (same as how the thread input triggers a new turn)

Both of these patterns already exist for user follow-up messages in the thread input flow.

---

## Phase 8: Frontend Tests

**Files:**
- `src/entities/comments/__tests__/store.test.ts` (new)
- `src/entities/comments/__tests__/service.test.ts` (new)

### Store Tests

Test all store operations:
- `hydrate()` loads comments and sets hydration flag
- `hydrate()` replaces existing comments for a worktree
- `getByWorktree()`, `getByThread()`, `getByFile()` filter correctly
- `getByFile()` with `threadId` filter vs. without
- `getUnresolved()` excludes resolved comments
- `_applyAdd()` adds comment and returns working rollback
- `_applyUpdate()` updates fields and returns working rollback
- `_applyDelete()` removes comment and returns working rollback
- `_applyClearWorktree()` removes all comments for a worktree

### Service Tests

Mock `appData` and test:
- `loadForWorktree()` reads from disk, validates with Zod, hydrates store
- `loadForWorktree()` handles missing file (empty hydration)
- `loadForWorktree()` handles corrupted file (warns, empty hydration)
- `loadForWorktree()` no-ops if already hydrated
- `loadForWorktree()` archives resolved comments older than 7 days to `.archive.json`
- `loadForWorktree()` preserves recently resolved comments (< 7 days old) in active file
- `loadForWorktree()` logs warning when unresolved count >= 200
- `clearWorktree()` deletes both active and archive files
- `create()` writes to disk via read-modify-write, updates store, emits event
- `resolve()` sets resolved fields, persists, emits event
- `_resolveFromEvent()` sets resolved fields, persists, does NOT emit event
- `delete()` removes from disk and store, emits event
- Rollback on disk write failure restores previous store state

Run tests with: `pnpm test` from project root (or `cd src && pnpm test`)
