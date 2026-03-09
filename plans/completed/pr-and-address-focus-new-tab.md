# Focus New Thread on Create PR / Address Comments + Changes Header PR Button

## Problem

1. **Create PR** (tree menu + button, `pr-actions.ts:spawnCreatePrAgent`) and **Address Comments** (`floating-address-button.tsx`) both create new agent threads but don't open them in a new tab or show a loading state while the thread spins up.
2. The **Changes content pane header** has a "Create PR" button but it's styled subtly (muted text, no accent color). User wants it bright/accent-colored to match the floating address button.

## Optimistic Update Compliance

Both `pr-actions.ts` and `floating-address-button.tsx` already use the shared `createThread()` from `thread-creation-service.ts`, which follows the established optimistic pattern:

1. `createThread()` generates a UUID, calls `threadService.createOptimistic()` (instant store insert with `_isOptimistic: true`, `status: "running"`, and first prompt as a turn), broadcasts `THREAD_OPTIMISTIC_CREATED` event to all windows, then spawns agent in background (non-blocking).
2. The returned `threadId` is immediately valid for navigation — the thread is already in the store.
3. `ThreadContent` picks up the thread from the store and renders it immediately (prompt visible, status "running").

This is the same pattern used by **EmptyPaneContent** (`setActiveTabView` after `createThread`) and **Spotlight** (`openControlPanel`/`showMainWindowWithView` after `createThread`).

**What's missing is only navigation** — the optimistic creation is already correct. No changes needed to the thread creation flow itself.

### FloatingAddressButton — existing thread path

When sending to an existing thread, the button calls `sendQueuedMessage`/`resumeSimpleAgent`. These handle their own message flow through the agent service. Unlike `ThreadContent.handleSubmit` (which dispatches `APPEND_USER_MESSAGE` into the store for immediate rendering since the user is already viewing that thread), we do NOT need to optimistically insert the message — we're navigating the user TO the thread, where they'll see the message arrive via normal streaming. The navigation itself is the optimistic action.

## Phases

- [x] Update `handleCreatePr` / `spawnCreatePrAgent` to open thread in new tab

- [x] Update `FloatingAddressButton` to open thread in new tab with loader

- [x] Restyle Changes header "Create PR" button with accent color

- [x] Add loading state to Changes header "Create PR" button

- [x] Write/update tests

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Update `spawnCreatePrAgent` — open in new tab

**File:** `src/lib/pr-actions.ts`

Current behavior (line 88-104): `spawnCreatePrAgent` calls `createThread()` then `paneLayoutService.setActiveTabView(...)` which replaces the current tab's view.

The optimistic thread is already in the store after `createThread()` returns. We just need to change navigation from "replace current tab" to "open new tab".

### Concrete changes

In `src/lib/pr-actions.ts`, `spawnCreatePrAgent` function:

```diff
- import { paneLayoutService } from "@/stores/pane-layout";
+ import { navigationService } from "@/stores/navigation-service";

  // In spawnCreatePrAgent — change permission mode from "approve" to "implement":
- permissionMode: "approve",
+ permissionMode: "implement",

  // Navigate to new tab instead of replacing current:
- paneLayoutService.setActiveTabView({ type: "thread", threadId });
+ await navigationService.navigateToThread(threadId, { newTab: true });
```

Also update `openExistingPr` for consistency:

```diff
- paneLayoutService.setActiveTabView({ type: "pull-request", prId: pr.id });
+ await navigationService.navigateToPullRequest(pr.id, { newTab: true });
```

Remove the `paneLayoutService` import since it's no longer used.

## Phase 2: Update `FloatingAddressButton` — navigate to thread in new tab

**File:** `src/components/diff-viewer/floating-address-button.tsx`

**New thread path** (line 52-53): Calls `createThread(...)` but doesn't navigate. It already omits `permissionMode`, which defaults to `"implement"` — no change needed there. Just add navigation:

```ts
const { threadId: newThreadId } = await createThread({ prompt, repoId, worktreeId, worktreePath });
await navigationService.navigateToThread(newThreadId, { newTab: true });
```

**Existing thread path** (line 45-51): Sends message to existing thread but doesn't navigate. Add navigation after the send/resume:

```ts
// After sendQueuedMessage or resumeSimpleAgent:
await navigationService.navigateToThread(threadId, { newTab: true });
```

Note: We do NOT need to optimistically insert the user message into the store here (unlike `ThreadContent.handleSubmit`). The user is navigating TO the thread — they'll see the message arrive via normal streaming once the thread tab opens. Inserting optimistically would cause a duplicate once the agent echoes it back.

**Loading state**: The existing `isSending` state with "Sending..." label already covers the loader. `createThread()` is instant (optimistic), so the loader is mainly for the `sendQueuedMessage`/`resumeSimpleAgent` network calls.

## Phase 3: Restyle Changes header "Create PR" button

**File:** `src/components/content-pane/content-pane-header.tsx`, `ChangesHeader` function (line 483-542)

Current button styling (line 523-530):

```tsx
className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs text-surface-300 hover:text-surface-100 hover:bg-surface-700 transition-colors"
```

Change to match the floating address button's accent styling (`bg-accent-500 text-accent-900 hover:bg-accent-400`):

```tsx
className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-accent-500 text-accent-900 hover:bg-accent-400 transition-colors shadow-sm"
```

Only show the bright accent style when there is **no** existing PR (i.e. "Create PR" mode). When viewing an existing PR, keep the current muted style since it's just a navigation action.

## Phase 4: Add loading state to Changes header "Create PR" button

**File:** `src/components/content-pane/content-pane-header.tsx`, `ChangesHeader` function

Add a `[isCreating, setIsCreating]` state. Wrap `handlePrClick` to set loading before calling `handleCreatePr`, reset after. Show a `Loader2` spinner when loading, disable the button.

```tsx
const [isCreating, setIsCreating] = useState(false);

const handlePrClick = useCallback(async () => {
  const worktreePath = getWorktreePath(repoId, worktreeId);
  setIsCreating(true);
  try {
    await handleCreatePr(repoId, worktreeId, worktreePath);
  } finally {
    setIsCreating(false);
  }
}, [repoId, worktreeId, getWorktreePath]);
```

Note: `handleCreatePr` already awaits through the full flow (gh CLI check → createThread → navigate). The loading state will show briefly while the PR detection + thread creation happens. Once `createThread` returns, the new tab opens instantly with the optimistic thread.

## Phase 5: Tests

- Update `src/lib/__tests__/pr-actions.test.ts` to assert `navigationService.navigateToThread` is called with `{ newTab: true }` instead of `paneLayoutService.setActiveTabView`.
- Verify existing `floating-address-button` tests (if any) or add a basic test for the navigation behavior.

## Files to modify

| File | Change |
| --- | --- |
| `src/lib/pr-actions.ts` | Use `navigationService` for new-tab navigation |
| `src/components/diff-viewer/floating-address-button.tsx` | Navigate to thread after create/send |
| `src/components/content-pane/content-pane-header.tsx` | Accent-style PR button + loading state |
| `src/lib/__tests__/pr-actions.test.ts` | Update mocks/assertions for new navigation |
