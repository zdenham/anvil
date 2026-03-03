# Inline Diff Comments

Add the ability to leave inline comments on any line in a diff view, persist them per-worktree (with optional thread association), and spawn an agent to address all unresolved comments.

## Phases

- [ ] Define types and disk schema for inline comments
- [ ] Create comment store and service (entity layer)
- [ ] Add event definitions for comment lifecycle
- [ ] Add Zustand-in-context provider for diff comment scope
- [ ] Build UI: comment gutter button and inline comment form
- [ ] Build UI: comment display and resolution controls
- [ ] Wire diff components to render comments via context
- [ ] Add "Address Comments" agent spawn flow
- [ ] Add agent-side comment resolution protocol
- [ ] Hook up agent event listener to mark comments resolved in store
- [ ] Write tests for comment store, service, resolver, and archiving

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Architecture Overview

Comments are a new entity scoped to a **worktree** with an optional **thread association**. Since threads always live inside a worktree, `worktreeId` is the primary key — this means comments work in both thread diff views (where a threadId is available) and the standalone worktree changes view (where there's no thread).

Comments are persisted on disk at `~/.mort/comments/{worktreeId}.json` following the disk-as-truth pattern used by all other entities. The service uses `appData.readJson()` / `appData.writeJson()` with relative paths (e.g., `comments/{worktreeId}.json`).

### Data Flow

```
User clicks line → CommentForm → commentService.create() → disk + store + event
User clicks "Address Comments" → spawn agent with comment context in prompt
Agent resolves comment → emits COMMENT_RESOLVED event via socket
Frontend listener → commentService.resolve() → disk + store + UI update
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
- The UI filters by threadId when viewing a specific thread's changes
- The standalone worktree changes view shows all comments for that worktree
- "Address Comments" in a thread context sends only that thread's comments to the agent; in worktree context it sends all unresolved comments (or prompts the user to pick a thread to route to)

### Performance and Lifecycle

Comments can accumulate over time. The following strategies keep things performant:

**1. Archive resolved comments on load**

When `commentService.loadForWorktree()` reads from disk, it separates resolved comments older than 7 days into an archive file (`comments/{worktreeId}.archive.json`). The archive is append-only and never loaded into the store — it exists purely for historical reference. The active file keeps only unresolved comments and recently resolved ones (< 7 days).

```typescript
const RESOLVED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
```

This runs only at load time (not on every mutation), so the cost is bounded to one pass per diff view open. Stale comments are appended to the archive file and removed from the active file.

**2. Worktree lifecycle cleanup**

Comments are cleaned up on `WORKTREE_RELEASED` (see Phase 2 listeners). When a worktree is archived/deleted, both the active and archive files are removed from disk and the store is cleared. This is the primary cleanup mechanism — most worktrees are short-lived.

**3. Comment cap per worktree**

If a worktree file exceeds 200 unresolved comments, the service logs a warning and the UI shows a notice suggesting the user resolve or delete stale comments. This is a soft cap — no automatic deletion of unresolved comments.

**4. Memoized selectors in components**

Components that read comments use selectors with `useDiffCommentStore()` (Zustand-in-context) to avoid re-renders from unrelated store changes. Per-line comment lookups are pre-computed in the parent diff component (`Map<lineNumber, InlineComment[]>`) via `useMemo` and passed as props, not recomputed per row.

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
  worktreeId: z.string().uuid(),
  threadId: z.string().uuid().nullable(), // null when left on standalone worktree diff
  filePath: z.string(),                   // relative path within worktree
  lineNumber: z.number().int(),           // resolved line number (see Line Number Resolution below)
  lineType: z.enum(["addition", "deletion", "unchanged"]),
  content: z.string().min(1),
  resolved: z.boolean().default(false),
  resolvedAt: z.number().nullable().default(null),
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

**Changes from original:**
- `threadId` uses `.nullable()` instead of `.optional()` — nullable is more explicit for a field that's always present but may be null, and matches the disk format where the key is always written
- `resolvedAt` uses `.nullable().default(null)` instead of `.optional()` — same reasoning, always present in JSON

### Line Number Resolution

`AnnotatedLine.newLineNumber` and `oldLineNumber` are both `number | null`. When creating a comment, resolve the line number as:

```typescript
const lineNumber = line.newLineNumber ?? line.oldLineNumber;
// Skip lines where both are null (should not happen in practice)
if (lineNumber === null) return;
```

For deletions, `newLineNumber` is null so we fall back to `oldLineNumber`. For additions, `oldLineNumber` is null so `newLineNumber` is used. For unchanged lines, both are present and we prefer `newLineNumber`.

**Disk format:** `~/.mort/comments/{worktreeId}.json` (relative to `appData` root)

```json
{
  "version": 1,
  "comments": [
    {
      "id": "uuid",
      "worktreeId": "uuid",
      "threadId": null,
      "filePath": "src/foo.ts",
      "lineNumber": 42,
      "lineType": "addition",
      "content": "This should use a Map instead of an object",
      "resolved": false,
      "resolvedAt": null,
      "createdAt": 1708900000000,
      "updatedAt": 1708900000000
    }
  ]
}
```

---

## Phase 2: Comment Store and Service

**Files:**
- `src/entities/comments/types.ts` (new) — re-export from `@core/types/comments.js`
- `src/entities/comments/store.ts` (new)
- `src/entities/comments/service.ts` (new)
- `src/entities/comments/listeners.ts` (new)
- `src/entities/comments/index.ts` (new)

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
        // Remove existing comments for this worktree, add new ones
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
import { v4 as uuid } from "uuid";
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
      id: uuid(),
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
  // Agent resolved a comment — update disk + store
  eventBus.on(EventName.COMMENT_RESOLVED, async ({ worktreeId, commentId }) => {
    // Only process if this worktree is hydrated (we have the comment in store)
    if (!useCommentStore.getState().isHydrated(worktreeId)) return;
    // Skip if already resolved in store (prevent double-processing)
    const existing = useCommentStore.getState().comments[commentId];
    if (!existing || existing.resolved) return;
    await commentService.resolve(worktreeId, commentId);
  });

  // Clean up comments when a worktree is archived/deleted
  eventBus.on(EventName.WORKTREE_RELEASED, async ({ worktreeId }) => {
    await commentService.clearWorktree(worktreeId);
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

## Phase 3: Event Definitions

**Files:**
- `core/types/events.ts` (modify)

Add to `EventName` object:

```typescript
// Comments
COMMENT_ADDED: "comment:added",
COMMENT_UPDATED: "comment:updated",
COMMENT_RESOLVED: "comment:resolved",
COMMENT_DELETED: "comment:deleted",
```

Add to `EventPayloads` interface:

```typescript
[EventName.COMMENT_ADDED]: { worktreeId: string; commentId: string };
[EventName.COMMENT_UPDATED]: { worktreeId: string; commentId: string };
[EventName.COMMENT_RESOLVED]: { worktreeId: string; commentId: string };
[EventName.COMMENT_DELETED]: { worktreeId: string; commentId: string };
```

Add to `EventNameSchema` enum array:

```typescript
EventName.COMMENT_ADDED,
EventName.COMMENT_UPDATED,
EventName.COMMENT_RESOLVED,
EventName.COMMENT_DELETED,
```

Event payloads are intentionally minimal (just IDs) per the event bridge pattern — events are signals, not data carriers. Listeners refresh from disk.

---

## Phase 4: Zustand-in-Context Provider

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

### Why Zustand-in-context (not plain context or props)?

- **Consistent with codebase patterns**: All domain data access uses Zustand stores with selector-based subscriptions. A plain `React.createContext` would be a new pattern.
- **Selector subscriptions**: Components can select just `worktreeId` or just `threadId` without re-rendering when the other changes (though both are stable, this establishes the right pattern).
- **No prop drilling**: `worktreeId` and `threadId` are needed deep in the diff tree (comment gutter button, comment form, comment display). Passing them through every intermediate component is noisy.
- **Per-provider isolation**: Each diff view gets its own store instance via `createStore`. Thread changes tab and standalone worktree changes each get independent scopes.

### Integration Points

**Thread views** — in `content-pane.tsx`, wrap thread content:

```typescript
{view.type === "thread" && activeMetadata && (
  <DiffCommentProvider worktreeId={activeMetadata.worktreeId} threadId={view.threadId}>
    {threadTab === "conversation" && <ThreadContent ... />}
    {threadTab === "changes" && <ChangesTab ... />}
  </DiffCommentProvider>
)}
```

**Standalone worktree changes view** — in `changes-view.tsx`:

```typescript
<DiffCommentProvider worktreeId={worktreeId}>
  <ChangesDiffContent ... />
</DiffCommentProvider>
```

Also update `src/contexts/index.ts` to export the new context.

---

## Phase 5: UI — Comment Gutter Button and Inline Form

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
- Renders **outside** the `role="table"` structure to preserve ARIA semantics (see Phase 7)

**State management:** The "which line has an open form" state lives in the parent (`InlineDiffBlock.DiffContent` or `DiffFileCardContent`) as local React state (`activeCommentLine: number | null`), since it's purely UI state.

---

## Phase 6: UI — Comment Display and Resolution

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
- Renders **outside** the `role="table"` structure (see Phase 7)

### Comment Count Badge

In the `InlineDiffHeader` component (`src/components/thread/inline-diff-header.tsx`), show a badge with unresolved comment count per file. Reads `worktreeId` and `threadId` from `useDiffCommentStore()`, reads count from `useCommentStore` with a selective subscription.

Similarly in `FileHeader` (`src/components/diff-viewer/file-header.tsx`).

---

## Phase 7: Wire Diff Components to Render Comments

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

## Phase 8: "Address Comments" Agent Spawn Flow

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

## src/foo.ts:42
> This should use a Map instead of an object

## src/bar.ts:15
> Missing error handling for the API call

For each comment, make the requested change. After addressing each comment, use the following marker in your response to indicate resolution:

[COMMENT_RESOLVED: <commentId>]
```

### Message Delivery

The mechanism depends on agent state:

- **Agent is running** → use `sendQueuedMessage()` to inject a message mid-conversation via the hub server's socket connection (same as how users send follow-up messages)
- **Agent is idle/completed** → resume the agent with this prompt using `resumeThread()` (same as how the thread input triggers a new turn)

Both of these patterns already exist for user follow-up messages in the thread input flow. The "Address Comments" button reuses the same path, just with a generated prompt instead of user-typed text.

---

## Phase 9: Agent-Side Comment Resolution Protocol

**Files:**
- `agents/src/lib/comment-resolver.ts` (new)
- `agents/src/runners/message-handler.ts` (modify) — add parsing in `handleAssistant()`

### Protocol

The agent marks comments resolved by including a marker in its text output:

```
[COMMENT_RESOLVED: <commentId>]
```

This is parsed from assistant message text blocks in the message handler.

**Implementation:**

```typescript
// agents/src/lib/comment-resolver.ts
const RESOLVED_PATTERN = /\[COMMENT_RESOLVED:\s*([a-f0-9-]+)\]/g;

export function extractResolvedCommentIds(text: string): string[] {
  const ids: string[] = [];
  let match;
  while ((match = RESOLVED_PATTERN.exec(text)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}
```

```typescript
// In message-handler.ts handleAssistant(), when processing text blocks:
import { extractResolvedCommentIds } from "@/lib/comment-resolver.js";

for (const block of message.content) {
  if (block.type === "text") {
    const commentIds = extractResolvedCommentIds(block.text);
    for (const commentId of commentIds) {
      this.hubClient.sendEvent(EventName.COMMENT_RESOLVED, {
        worktreeId: this.worktreeId,
        commentId,
      });
    }
  }
}
```

**Note:** `worktreeId` is available in the message handler context since it's part of the thread metadata loaded at agent startup. If not currently on the handler, it can be passed from the runner which reads thread metadata.

This approach:
- Requires no new tools or SDK changes
- Works naturally with the agent's text output
- Is reliably parseable with regex
- Follows the pattern of `parsePhases()` in `agents/src/lib/phase-parser.ts`

---

## Phase 10: Frontend Event Listener

Already covered in Phase 2's `listeners.ts`. The `COMMENT_RESOLVED` event from the agent flows through:

```
Agent text output → message-handler parses marker → hubClient.sendEvent()
→ socket → agent-service (Tauri) → eventBus.emit()
→ setupCommentListeners() handler → commentService.resolve()
→ disk write + store update → UI re-renders
```

This is the standard event bridge flow used by all other entities.

---

## Phase 11: Tests

**Files:**
- `src/entities/comments/__tests__/store.test.ts` (new)
- `src/entities/comments/__tests__/service.test.ts` (new)
- `agents/src/lib/__tests__/comment-resolver.test.ts` (new)

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
- `delete()` removes from disk and store, emits event
- Rollback on disk write failure restores previous store state
- `clearWorktree()` deletes file and clears store

### Comment Resolver Tests

Test regex extraction:
- Extracts single comment ID
- Extracts multiple comment IDs from one text block
- Returns empty array for text without markers
- Handles malformed markers (missing UUID, extra whitespace)
- Does not match partial patterns

Run tests with: `cd src && pnpm test` and `cd agents && pnpm test`

---

## Key Design Decisions

### Why worktree-primary with optional thread association (not thread-only)?

The original plan scoped comments to threads. But there are two distinct diff views:
1. **Thread changes tab** — shows agent-generated changes, has a `threadId`
2. **Standalone worktree changes view** — shows git diff for a worktree, no `threadId`

If comments were thread-only, users couldn't leave comments on the standalone worktree diff (e.g., annotating code before asking an agent to fix it). Since threads always live inside a worktree, `worktreeId` is the natural primary key.

### Why one file per worktree (not per thread)?

- A worktree may have comments from multiple threads plus standalone comments
- The standalone worktree changes view wants all comments regardless of thread — one file makes this a single read
- Thread-filtered views are just in-memory filters on the loaded data

### Why `[COMMENT_RESOLVED: id]` text markers instead of a custom tool?

A text marker:
- Works within existing infrastructure (message parsing in `message-handler.ts`)
- Is naturally producible by the LLM
- Can be parsed reliably with regex
- Follows the pattern of `parsePhases()` in `agents/src/lib/phase-parser.ts`
- Requires no SDK changes

### Why lazy-load comments instead of hydrating at startup?

Comments are only relevant when viewing a diff. Loading all comments at startup would be wasteful. The lazy pattern (load when diff view opens) is efficient and matches how `ThreadState` is loaded on-demand.

### Why comments keyed by ID in store (not arrays per worktree)?

The entity stores pattern requires a single copy of each entity keyed by unique ID: `comments: Record<string, InlineComment>`. This enables O(1) lookup by comment ID (needed for resolve/delete operations) and prevents duplicate state. Worktree/thread/file filtering is done via selector methods that iterate the record.

### Why Zustand-in-context (not plain context or props)?

The codebase uses Zustand for all domain data access with selector-based subscriptions. A plain `React.createContext` would introduce a different pattern. Using `createStore` + context gives per-provider store instances with selector support — consistent with the existing Zustand approach. Prop drilling was considered but `worktreeId`/`threadId` are needed deep in the diff tree (comment gutter button, comment form, comment display), making the context approach cleaner.

### Why archive resolved comments to a separate file instead of deleting?

Resolved comments have historical value — they document what feedback was given and addressed. Rather than deleting them, stale resolved comments (> 7 days) are moved to `comments/{worktreeId}.archive.json` on load. The archive file is append-only and never loaded into the store, so it doesn't affect runtime performance. It's cleaned up along with the active file when the worktree is released.

### Why a soft cap (200) instead of hard limit?

Unresolved comments represent active review feedback. Automatically deleting them could lose user intent. The 200-comment threshold triggers a warning (logger + optional UI notice) but doesn't block or delete. This matches the terminal buffer pattern (hard cap for output, not for user-created data).

### Why read-modify-write for every mutation?

The comments file is shared between user actions (create/delete) and agent events (resolve). Without read-modify-write, rapid concurrent mutations could lose data. The service always reads the current disk state, applies the mutation, and writes back. This is the same pattern used by `threadService.update()`.

### Why render comments outside role="table"?

The diff uses `role="table"` with `role="row"` for line elements. Inserting non-row elements between rows breaks ARIA table semantics. Comment forms and displays render after each line row in a wrapper div, outside the table structure.
