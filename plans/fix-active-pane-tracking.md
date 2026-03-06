# Fix Active Pane Tracking

## Problem

When multi-pane splits are active, new tabs (from sidebar clicks, Cmd+N, Cmd+T) always open in the topmost pane instead of the user's currently focused pane.

**Root cause**: `activeGroupId` in the pane layout store is not reliably tracking which pane the user is interacting with.

Issues:
1. **`PaneGroup` uses `onClick` to set active group** (`pane-group.tsx:53`) — if any child calls `stopPropagation()`, the event never reaches the wrapper, so `activeGroupId` stays stale.
2. **Splitting doesn't activate the new group** — `splitGroup()` / `splitAndMoveTab()` create a new group but don't set it as active.
3. **No pane group context** — child components (inputs, content views) have no way to know which group they belong to, so they can't activate their pane on interaction.

## Approach

Instead of relying on a single event handler at the `PaneGroup` wrapper, provide a `PaneGroupContext` so **multiple triggers** can activate a pane:

- **Pointer down** (capture phase) — catches clicks/taps anywhere in a pane
- **Input focus** — typing in the message input activates that pane
- **Tab creation / split** — newly created panes auto-activate

## Phases

- [x] Add `PaneGroupContext` providing group ID + activate helper
- [x] Wire up activation triggers (pointer down, input focus, split/tab creation)
- [x] Add tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `PaneGroupContext`

Create a small context so any descendant can activate its pane.

**New file**: `src/components/split-layout/pane-group-context.tsx`

```tsx
import { createContext, useContext, useCallback } from "react";
import { paneLayoutService } from "@/stores/pane-layout/service";
import { usePaneLayoutStore } from "@/stores/pane-layout";

interface PaneGroupContextValue {
  groupId: string;
  activate: () => void;
}

const PaneGroupCtx = createContext<PaneGroupContextValue | null>(null);

export function PaneGroupProvider({ groupId, children }: { groupId: string; children: React.ReactNode }) {
  const activate = useCallback(() => {
    const { activeGroupId } = usePaneLayoutStore.getState();
    if (activeGroupId !== groupId) {
      paneLayoutService.setActiveGroup(groupId);
    }
  }, [groupId]);

  return <PaneGroupCtx.Provider value={{ groupId, activate }}>{children}</PaneGroupCtx.Provider>;
}

export function usePaneGroup() {
  const ctx = useContext(PaneGroupCtx);
  if (!ctx) throw new Error("usePaneGroup must be used within PaneGroupProvider");
  return ctx;
}

/** Optional — returns null outside a pane (e.g., sidebar). */
export function usePaneGroupMaybe() {
  return useContext(PaneGroupCtx);
}
```

## Phase 2: Wire up activation triggers

### 2a. `PaneGroup` — pointer down + provide context

**File**: `src/components/split-layout/pane-group.tsx`

- Wrap children in `<PaneGroupProvider groupId={groupId}>`
- Replace `onClick={handleActivate}` with `onPointerDownCapture={handleActivate}`
- `handleActivate` reads store imperatively (no stale closure from `isActiveGroup` dep)

```tsx
<PaneGroupProvider groupId={groupId}>
  <div
    onPointerDownCapture={handleActivate}
    className="relative flex flex-col h-full overflow-hidden"
  >
    ...
  </div>
</PaneGroupProvider>
```

### 2b. `ThreadInput` — activate pane on focus

**File**: `src/components/reusable/thread-input.tsx`

Use `usePaneGroupMaybe()` to activate the pane when the textarea receives focus:

```tsx
const paneGroup = usePaneGroupMaybe();

const handleFocus = useCallback(() => {
  paneGroup?.activate();
}, [paneGroup]);
```

Pass `onFocus={handleFocus}` to the underlying `TriggerSearchInput`.

### 2c. `paneLayoutService` — activate new group on split/tab creation

**File**: `src/stores/pane-layout/service.ts`

In `splitGroup()` and `splitAndMoveTab()`, set the new group as active:

```ts
// splitGroup() — after _applySplitGroup:
usePaneLayoutStore.getState()._applySetActiveGroup(newGroup.id);

// splitAndMoveTab() — after _applySplitAndMoveTab:
usePaneLayoutStore.getState()._applySetActiveGroup(newGroupId);
```

### 2d. Clean up `PaneGroupContainer`

**File**: `src/components/split-layout/pane-group-container.tsx`

This file is a legacy placeholder (comment says "Will be replaced by the full tab bar + content system"). It duplicates `PaneGroup`'s focus logic via `onMouseDown`. Either:
- Remove it if unused (check imports)
- Or align it with the new `PaneGroupProvider` approach

## Phase 3: Tests

- **`pane-group-context.test.tsx`**: `usePaneGroup()` returns groupId and activate calls `setActiveGroup`
- **`pane-group.tsx` test**: `pointerDownCapture` on a non-active group sets it active
- **`service.test.ts`**: `splitGroup` and `splitAndMoveTab` update `activeGroupId` to the new group
- **`thread-input` test**: focusing the input calls `activate` on the pane group context
