# Replace workingDirectory prop drilling with a zustand store

## Problem

`workingDirectory` is prop-drilled through 6 intermediate components that don't use it:

```
thread-content.tsx → thread-view.tsx → message-list.tsx → turn-renderer.tsx → assistant-message.tsx → text-block.tsx → markdown-renderer.tsx
```

The only consumer is `markdown-renderer.tsx`, which uses it to resolve relative file paths when clicking links.

I audited every other prop in this chain (`threadId`, `isStreaming`, `toolStates`, `messages`, `onToolResponse`) — they're all consumed at intermediate layers, not just passed through. `workingDirectory` is the only pure pass-through prop.

## Why the thread doesn't already have the path

Thread metadata stores `repoId` (UUID) and `worktreeId` (UUID), but **not** the resolved filesystem path. The path lives in `RepositorySettings.worktrees[].path`, loaded from disk (`~/.anvil/repositories/{slug}/settings.json`) via `loadSettings()`. The current `useWorkingDirectory` hook does this async lookup.

The repo store (`useRepoStore`) is hydrated at startup with `Repository` objects (which have `sourcePath`), but the **full settings** — including the `worktrees` array with per-worktree paths — are not in any zustand store.

## Recommendation

Create a `useThreadWorkingDirectory(threadId)` hook that reads from a small zustand store. Wrap `MarkdownRenderer` in a thin component that calls this hook, so `MarkdownRenderer` itself stays pure (props-only, easy to test).

### New store: `src/stores/working-directory-store.ts`

Follows the `tool-expand-store.ts` `Record<threadId, T>` pattern:

```ts
import { create } from 'zustand';

interface WorkingDirectoryState {
  directories: Record<string, string>;
  setWorkingDirectory: (threadId: string, directory: string) => void;
  clearThread: (threadId: string) => void;
}

export const useWorkingDirectoryStore = create<WorkingDirectoryState>((set) => ({
  directories: {},
  setWorkingDirectory: (threadId, directory) =>
    set((s) => ({ directories: { ...s.directories, [threadId]: directory } })),
  clearThread: (threadId) =>
    set((s) => { const { [threadId]: _, ...rest } = s.directories; return { directories: rest }; }),
}));

/** Read the resolved working directory for a thread */
export function useThreadWorkingDirectory(threadId: string): string {
  return useWorkingDirectoryStore((s) => s.directories[threadId] ?? '');
}
```

### New wrapper: `ConnectedMarkdownRenderer`

Lives alongside `markdown-renderer.tsx`. This is the component that assistant-message/text-block render instead of `MarkdownRenderer` directly. It resolves `workingDirectory` from the store so `MarkdownRenderer` stays a pure presentational component:

```ts
export function ConnectedMarkdownRenderer({
  threadId,
  ...props
}: { threadId: string } & Omit<MarkdownRendererProps, 'workingDirectory'>) {
  const workingDirectory = useThreadWorkingDirectory(threadId);
  return <MarkdownRenderer {...props} workingDirectory={workingDirectory} />;
}
```

### Changes

**thread-content.tsx** — Write to store instead of passing as prop:
```ts
const workingDirectory = useWorkingDirectory(activeMetadata);

useEffect(() => {
  if (threadId && workingDirectory) {
    useWorkingDirectoryStore.getState().setWorkingDirectory(threadId, workingDirectory);
  }
}, [threadId, workingDirectory]);
```
Remove `workingDirectory` from `<ThreadView>` props.

**text-block.tsx** — Accept `threadId` instead of `workingDirectory`, render `ConnectedMarkdownRenderer`:
```ts
<ConnectedMarkdownRenderer threadId={threadId} content={content} isStreaming={isStreaming} />
```

`threadId` is already available one level up in `assistant-message.tsx` (it already passes it to `ToolUseBlock`), so passing it to `TextBlock` is natural.

**Remove `workingDirectory` prop from:**
- `thread-view.tsx`
- `message-list.tsx`
- `turn-renderer.tsx`
- `assistant-message.tsx`

### Why this shape

1. **`MarkdownRenderer` stays pure.** It still accepts `workingDirectory` as a prop — easy to test, no store coupling. The wrapper handles the store read.

2. **The hook is reusable.** If any other component later needs the working directory for a thread, it calls `useThreadWorkingDirectory(threadId)`. No new plumbing.

3. **Single writer, hook readers.** `thread-content.tsx` is the only writer (via the existing `useWorkingDirectory` async hook). All readers go through `useThreadWorkingDirectory`. The async derivation logic doesn't move.

4. **Follows existing convention.** Same `Record<threadId, T>` pattern as `tool-expand-store.ts`.

5. **`threadId` is already there.** `assistant-message.tsx` already has `threadId` and already passes it to child components (every `ToolUseBlock` gets it). Adding it to `TextBlock` is one small addition, not a new drill.
