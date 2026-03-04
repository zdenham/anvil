# Fix Tool Block Path Flash

## Problem

Every tool block (Read, Edit, Grep, Glob, Write, LSP) shows a brief flash when rendering. The subtext line (second line showing the file path) initially renders with the **full absolute path**, then re-renders with the **relative path** after an async resolution completes.

### Root Cause

Each tool block independently calls `useWorkspaceRoot(threadId)` → `useWorkingDirectory(thread)`. The hook initializes with `useState("")` and then asynchronously resolves the working directory via `loadSettings()`. During the first render:

1. `workspaceRoot = ""` (empty string)
2. `toRelativePath("/Users/zac/.../src/foo.ts", "")` → returns the full absolute path
3. After async `loadSettings` resolves → `workspaceRoot = "/Users/zac/.../mortician"`
4. Re-render: `toRelativePath(...)` → returns `"src/foo.ts"`

This flash happens on **every** tool block mount — including when the virtualizer recycles items during scrolling.

### Why It's Redundant

`ThreadContent` already resolves `workingDirectory` at the top level and passes it through `MessageList` → `TurnRenderer` → `AssistantMessage`. But `AssistantMessage` doesn't forward it to individual tool blocks, so each one re-resolves independently (N async `loadSettings` calls per thread).

## Approach: Local Context Provider

Use a React context (matching existing `ToolPermissionContext` pattern) instead of prop drilling:

- Provider placed in `AssistantMessage`, receives `workingDirectory` from its existing prop
- Tool blocks consume via `useWorkspaceRoot()` (no args) instead of `useWorkspaceRoot(threadId)`
- Module-level cache in `useWorkingDirectory` prevents the flash on initial thread load

## Phases

- [x] Add module-level cache to `useWorkingDirectory` to prevent flash at `ThreadContent` level
- [x] Create `WorkspaceContext` provider + convert `useWorkspaceRoot` hook to be context-based
- [x] Place provider in `AssistantMessage` and migrate tool blocks to the context-based hook
- [x] Clean up dead code

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Cache `useWorkingDirectory`

**File**: `src/hooks/use-working-directory.ts`

Add a module-level `Map<string, string>` cache keyed by `thread.id`. Initialize `useState` from the cache. Write to cache on resolution.

```ts
const resolvedCache = new Map<string, string>();

export function useWorkingDirectory(thread: ThreadMetadata | undefined): string {
  const cacheKey = thread?.id ?? "";
  const [workingDirectory, setWorkingDirectory] = useState(
    () => resolvedCache.get(cacheKey) ?? ""
  );

  useEffect(() => {
    // ... existing logic, but on resolve:
    resolvedCache.set(thread.id, dir);
    setWorkingDirectory(dir);
  }, [thread?.id, thread?.repoId, thread?.worktreeId]);

  return workingDirectory;
}
```

This prevents the flash at the `ThreadContent` level (the single remaining consumer after phase 3). The cache is populated on first thread load and available synchronously on subsequent mounts.

## Phase 2: Create `WorkspaceContext` + convert `useWorkspaceRoot`

**File**: `src/hooks/use-workspace-root.ts` (rewrite in place)

Convert from a hook-that-calls-another-hook to a context provider + consumer pair, following the `ToolPermissionContext` pattern:

```ts
import { createContext, useContext } from "react";

const WorkspaceRootContext = createContext<string>("");

/** Provider — placed in AssistantMessage, fed from the workingDirectory prop */
export const WorkspaceRootProvider = WorkspaceRootContext.Provider;

/** Consumer — used by tool blocks, no args needed */
export function useWorkspaceRoot(): string {
  return useContext(WorkspaceRootContext);
}
```

## Phase 3: Wire up provider + migrate tool blocks

**Provider placement** — `src/components/thread/assistant-message.tsx`:
- Already receives `workingDirectory` prop
- Wrap the content `<div>` with `<WorkspaceRootProvider value={workingDirectory ?? ""}>`

**Tool block migrations** (6 files):
- `read-tool-block.tsx` — `useWorkspaceRoot(threadId)` → `useWorkspaceRoot()`
- `edit-tool-block.tsx` — same
- `grep-tool-block.tsx` — same
- `glob-tool-block.tsx` — same
- `write-tool-block.tsx` — same
- `lsp-tool-block.tsx` — same

Each is a one-line change: drop the `threadId` arg and remove the `useWorkspaceRoot` import path if it changed.

## Phase 4: Clean up

- Remove `useThreadStore` / `useWorkingDirectory` imports from deleted `use-workspace-root.ts` (already rewritten)
- Verify no other consumers of the old `useWorkspaceRoot(threadId)` signature remain via grep
- Remove `useWorkspaceRoot` from any tool block that still imports it with the old signature
