# Replace workingDirectory prop drilling with a zustand store

## Problem

`workingDirectory` is prop-drilled through 6 intermediate components that don't use it:

```
thread-content.tsx → thread-view.tsx → message-list.tsx → turn-renderer.tsx → assistant-message.tsx → text-block.tsx → markdown-renderer.tsx
```

The only consumer is `markdown-renderer.tsx`, which uses it to resolve relative file paths when clicking links.

## Recommendation

Create a per-thread working directory store following the `tool-expand-store.ts` pattern — a zustand store keyed by `threadId`.

### New store: `src/stores/working-directory-store.ts`

```ts
import { create } from 'zustand';

interface WorkingDirectoryState {
  /** Map of threadId -> resolved working directory path */
  directories: Record<string, string>;

  setWorkingDirectory: (threadId: string, directory: string) => void;
  getWorkingDirectory: (threadId: string) => string;
  clearThread: (threadId: string) => void;
}

export const useWorkingDirectoryStore = create<WorkingDirectoryState>((set, get) => ({
  directories: {},

  setWorkingDirectory: (threadId, directory) => {
    set((state) => ({
      directories: { ...state.directories, [threadId]: directory },
    }));
  },

  getWorkingDirectory: (threadId) => {
    return get().directories[threadId] ?? '';
  },

  clearThread: (threadId) => {
    set((state) => {
      const { [threadId]: _, ...rest } = state.directories;
      return { directories: rest };
    });
  },
}));
```

### Changes

**thread-content.tsx** — Write instead of pass:
```ts
// Instead of passing workingDirectory as a prop to ThreadView,
// write it into the store whenever it changes.
const workingDirectory = useWorkingDirectory(activeMetadata);

useEffect(() => {
  if (threadId && workingDirectory) {
    useWorkingDirectoryStore.getState().setWorkingDirectory(threadId, workingDirectory);
  }
}, [threadId, workingDirectory]);
```

Remove `workingDirectory` from the `<ThreadView>` props.

**markdown-renderer.tsx** — Read from store:
```ts
// Already receives threadId as a prop (threaded through the same chain).
// Use it to read from the store directly.
const resolvedWorkingDirectory = useWorkingDirectoryStore(
  useCallback((s) => s.directories[threadId ?? ''] ?? '', [threadId])
);
```

**Remove `workingDirectory` prop from all intermediate components:**
- `thread-view.tsx`
- `message-list.tsx`
- `turn-renderer.tsx`
- `assistant-message.tsx`
- `text-block.tsx`

Each of these just deletes the prop from their interface and stops passing it down.

### Why this approach

1. **Matches existing convention.** `tool-expand-store.ts` uses the exact same `Record<threadId, T>` pattern. This isn't a new abstraction — it's the established way this codebase scopes per-thread data.

2. **threadId already flows through the chain.** `markdown-renderer.tsx` already has access to `threadId` (it's passed through the same prop chain as `workingDirectory`). So the store lookup key is already available — no new plumbing needed.

3. **Single writer, single reader.** `thread-content.tsx` is the only place that resolves working directories (via `useWorkingDirectory` hook). `markdown-renderer.tsx` is the only consumer. The store is just a clean handoff point between them.

4. **Async derivation stays where it is.** The `useWorkingDirectory` hook does async repo settings lookups. That logic stays in `thread-content.tsx` unchanged — we just write the result to the store instead of passing it as a prop.

5. **Cleanup is straightforward.** Call `clearThread(threadId)` when a thread is unmounted/closed, same as `useToolExpandStore.clearThread`.

### What NOT to do

- Don't move the async resolution logic (`useWorkingDirectory` hook) into the store. Zustand stores should hold resolved state, not perform async side effects. The hook pattern in `thread-content.tsx` is the right place for that.
- Don't create a generic "thread metadata cache" store. Working directory is a single derived value with one consumer. Keep it simple and purpose-specific.
