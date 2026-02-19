# Draft Preservation Wiring

**Goal:** Preserve input drafts when switching between threads/plans so the user can pick up where they left off.

## Context

The entire draft infrastructure already exists but is **not wired up** to any components:

| Layer | File | Status |
|-------|------|--------|
| Zustand store | `src/entities/drafts/store.ts` | Built |
| Service (debounced disk writes) | `src/entities/drafts/service.ts` | Built |
| Types / Zod schema | `src/entities/drafts/types.ts` | Built |
| Sync hook | `src/hooks/useDraftSync.ts` | Built |
| Hydration | `src/entities/index.ts` line 140 | Built |
| **Component wiring** | — | **Missing** |

### The Problem

`ThreadInput` (`src/components/reusable/thread-input.tsx`) uses a local `useState("")` for its value. When the user navigates away, the state is destroyed. When they return, it starts empty again. The `useDraftSync` hook exists to solve this but is never called.

Similarly, `PlanInputArea` (`src/components/control-panel/plan-input-area.tsx`) uses local `useState("")` for its message — same issue.

### The Multi-Area Problem

`ThreadInput` appears in **two independent areas** of the app that can be visible simultaneously:

1. **Content pane** (right side) — via `ThreadContent`, `EmptyPaneContent`, `PlanContent`
2. **Control panel** (left side) — via `PlanView` (uses `ThreadInput` directly) and `ControlPanelWindow` (uses `ThreadInputSection`)

A singleton `useInputStore` would cause both areas to share the same `content` value, making them fight over state. We need scoped input stores.

## Approach: Context-Scoped Input Store

Replace the singleton `useInputStore` with a **context-scoped pattern** using `zustand/createStore` + React context. Each area of the app gets its own store instance via a provider, while `ThreadInput` stays dumb — it just reads from whichever provider is above it in the tree.

### New file: `src/stores/input-store.tsx`

Replaces the current `input-store.ts` with a context-based version:

```tsx
import { createStore, useStore } from 'zustand';
import { createContext, useContext, useRef, type ReactNode } from 'react';

interface InputState {
  content: string;
  focusRequested: boolean;
  setContent: (content: string) => void;
  appendContent: (content: string) => void;
  clearContent: () => void;
  requestFocus: () => void;
  clearFocusRequest: () => void;
}

type InputStore = ReturnType<typeof createInputStore>;

const createInputStore = () =>
  createStore<InputState>((set) => ({
    content: '',
    focusRequested: false,
    setContent: (content) => set({ content }),
    appendContent: (content) => set((s) => ({ content: s.content + content })),
    clearContent: () => set({ content: '' }),
    requestFocus: () => set({ focusRequested: true }),
    clearFocusRequest: () => set({ focusRequested: false }),
  }));

const InputStoreContext = createContext<InputStore | null>(null);

export function InputStoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<InputStore>(null);
  if (!storeRef.current) storeRef.current = createInputStore();
  return (
    <InputStoreContext value={storeRef.current}>
      {children}
    </InputStoreContext>
  );
}

// Hook for React components — reads from nearest provider
export function useInputStore<T>(selector: (s: InputState) => T): T {
  const store = useContext(InputStoreContext);
  if (!store) throw new Error('useInputStore must be used within InputStoreProvider');
  return useStore(store, selector);
}

// Imperative access for non-React code (quick-action-executor)
// Returns the store from the nearest provider — but since quick actions
// execute in a specific area context, we need a registration pattern.
// See Phase 3 for details.
export { createInputStore, type InputStore, type InputState };
```

### Provider Placement

Two `<InputStoreProvider>` instances, one per area:

1. **Content pane:** Wrap the content area in `ContentPane` (around `EmptyPaneContent`, `ThreadContent`, `PlanContent`)
2. **Control panel:** Wrap in `ControlPanelWindow` or `PlanView` (around their `ThreadInput` usage)

Only one content view mounts at a time within each area, so `useDraftSync` works naturally — navigation save/restore happens within each provider's independent store.

## Phases

- [x] Create context-scoped `InputStoreProvider` and refactor `useInputStore`
- [x] Make `ThreadInput` read from the scoped store instead of local `useState`
- [x] Update external consumers (`quick-action-executor`, `useDraftSync`, `useInputControl`)
- [x] Place `InputStoreProvider` in content pane and control panel areas
- [x] Call `useDraftSync` in parent components and `clearCurrentDraft` on send
- [x] Wire up `PlanInputArea` drafts (control panel, uses own textarea)
- [x] Verify no regressions with triggers, prompt history, quick actions, and focus

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Create context-scoped `InputStoreProvider`

**File:** `src/stores/input-store.tsx` (rename from `.ts` → `.tsx`)

Replace the singleton `create()` store with:
- `createInputStore()` factory using `createStore()` (vanilla Zustand)
- `InputStoreContext` via `createContext`
- `InputStoreProvider` component that creates a store instance per mount
- `useInputStore(selector)` hook that reads from the nearest provider

Keep the same `InputState` interface so all consumers compile unchanged.

Export `createInputStore` and `InputStore` type for imperative access needs (Phase 3).

## Phase 2: Make `ThreadInput` use the scoped store

**File:** `src/components/reusable/thread-input.tsx`

Replace the local `useState("")` with the context-scoped store:

```diff
- const [value, setValue] = useState("");
+ const value = useInputStore((s) => s.content);
+ const setStoreContent = useInputStore((s) => s.setContent);
```

Update `handleChange`, `handleSubmit`, and `onQueryChange` (history nav) to use `setStoreContent` instead of `setValue`.

`ThreadInput` doesn't need to know which area it's in — it reads from whichever `InputStoreProvider` is above it in the tree.

## Phase 3: Update external consumers

### `useDraftSync` (`src/hooks/useDraftSync.ts`)

Currently imports `useInputStore` as a singleton and calls `.getState()` in the cleanup function. Refactor to:
- Use the hook-based `useInputStore(selector)` for reactive reads
- For the unmount cleanup, accept the store instance via a ref or pass it from the provider context

One clean approach: `useDraftSync` uses `useInputStore` hook for `content` and `setContent`, and captures content in a ref for the cleanup callback (already has `previousContext` ref pattern):

```tsx
const contentRef = useRef(content);
contentRef.current = content;

return () => {
  if (previousContext.current) {
    draftService.saveDraftForContext(previousContext.current, contentRef.current);
  }
};
```

### `clearCurrentDraft` (`src/hooks/useDraftSync.ts`)

Currently calls `useInputStore.getState().clearContent()` — this is a standalone function, not a hook. Convert to accept a store instance parameter, or have the calling component pass in the clear function:

```tsx
export function clearCurrentDraft(context: Context, clearContent: () => void) {
  draftService.clearDraftForContext(context);
  clearContent();
}
```

Callers get `clearContent` from `useInputStore((s) => s.clearContent)`.

### `useInputControl` (`src/hooks/use-input-control.ts`)

Uses `useInputStore` — just needs the import path. Since it calls the hook version, it will automatically read from the nearest provider. No changes needed beyond the import.

### `quick-action-executor` (`src/lib/quick-action-executor.ts`)

This is the tricky one — it's non-React code that calls `useInputStore.getState()`. Options:

**Option A (Recommended): Active store registry.** The `InputStoreProvider` registers its store instance in a module-level variable when it's the "active" area (the one the user is currently interacting with). Quick action executor reads from that:

```tsx
// In input-store.tsx
let activeStore: InputStore | null = null;
export function setActiveInputStore(store: InputStore | null) { activeStore = store; }
export function getActiveInputStore() { return activeStore; }
```

The content pane provider calls `setActiveInputStore(store)` on focus/mount. The executor calls `getActiveInputStore()?.getState()`.

**Option B:** Pass the store through the quick action execution context. More explicit but requires threading it through more layers.

Option A is simpler and mirrors how the app already works — one area is "active" at a time.

## Phase 4: Place `InputStoreProvider` in areas

### Content pane (`src/components/content-pane/content-pane.tsx`)

Wrap the view content:

```tsx
import { InputStoreProvider } from '@/stores/input-store';

// In render, around the view-switching block:
<InputStoreProvider>
  {view.type === "empty" && <EmptyPaneContent />}
  {view.type === "thread" && threadTab === "conversation" && (
    <ThreadContent ... />
  )}
  {view.type === "plan" && <PlanContent ... />}
  {/* other views don't use ThreadInput, but wrapping is harmless */}
</InputStoreProvider>
```

### Control panel — `PlanView` (`src/components/control-panel/plan-view.tsx`)

Wrap the `ThreadInput` area:

```tsx
<InputStoreProvider>
  <ThreadInput ref={inputRef} ... />
</InputStoreProvider>
```

### Control panel — `ControlPanelWindow` (`src/components/control-panel/control-panel-window.tsx`)

Wrap the `ThreadInputSection`:

```tsx
<InputStoreProvider>
  <ThreadInputSection ref={inputRef} ... />
</InputStoreProvider>
```

Each provider creates an independent store — the content pane and control panel inputs are fully isolated.

## Phase 5: Call `useDraftSync` in parent components

### Content pane parents

Since all content pane views share one `InputStoreProvider` (in `ContentPane`), `useDraftSync` goes in each view component:

**`ThreadContent`** (`src/components/content-pane/thread-content.tsx`):
```tsx
useDraftSync({ type: 'thread', id: threadId });
```

**`EmptyPaneContent`** (`src/components/content-pane/empty-pane-content.tsx`):
```tsx
useDraftSync({ type: 'empty' });
```

**`PlanContent`** (`src/components/content-pane/plan-content.tsx`):
```tsx
useDraftSync({ type: 'plan', id: planId });
```

When the user navigates from a thread to a plan, `useDraftSync` fires its cleanup (saves draft for old thread) and its effect (restores draft for the plan). The `InputStoreProvider` persists across these swaps since it's at the `ContentPane` level.

### Clear on send

In each component's submit handler, after successful send:

```tsx
const clearContent = useInputStore((s) => s.clearContent);
// In handleSubmit:
clearCurrentDraft({ type: 'thread', id: threadId }, clearContent);
```

### Control panel

`PlanView` and `ControlPanelWindow` each have their own `InputStoreProvider`, so `useDraftSync` in those components is scoped to their own store. Add `useDraftSync` calls with the appropriate context in each.

## Phase 6: Wire up `PlanInputArea` drafts

`PlanInputArea` (`src/components/control-panel/plan-input-area.tsx`) uses its own local `useState` and a raw `<textarea>`, not `ThreadInput`. Since it's already inside the control panel, two options:

1. **Minimal:** Use `draftService` directly in a `useEffect` (save on unmount, restore on mount)
2. **Consistent:** Refactor to use the scoped `useInputStore` + `useDraftSync`

Option 1 is simpler and avoids coupling `PlanInputArea` to the input store pattern:

```tsx
useEffect(() => {
  const draft = draftService.getPlanDraft(planId);
  if (draft) setMessage(draft);
  return () => {
    const current = /* get current message from ref */;
    if (current.trim()) draftService.savePlanDraft(planId, current);
  };
}, [planId]);
```

## Phase 7: Regression check

Verify these still work correctly:

- **Trigger search** (`@` mentions, `/` skills) — depends on `value` which now comes from the scoped store
- **Prompt history** (arrow keys) — depends on `setContent` which now writes to the scoped store
- **Quick actions** — `quick-action-executor` calls `ui:setInput` etc. — must use the active store registry
- **Focus management** — `requestFocus()` should target the active area's store
- **Draft persistence** — navigate thread→plan→thread, verify content preserved
- **Independent areas** — type in content pane input, verify control panel input stays empty

## Key Design Decision: Active Store Registry

The quick-action-executor and any future non-React code needs imperative access to "the current input store." Rather than a global singleton, we use a lightweight registry:

```
setActiveInputStore(store)  — called by the focused area's provider
getActiveInputStore()       — called by executor, returns store or null
```

This preserves the scoping while giving imperative code a single entry point. The "active" concept maps naturally to the app — the user interacts with one area at a time.
