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

## Approach

The `useDraftSync` hook saves the current input as a draft on navigation away and restores the draft on navigation to a context. It uses `useInputStore` as the bridge — but `ThreadInput` doesn't read from `useInputStore` either. We need to connect these layers.

Two options:

**Option A (Recommended): Wire `useDraftSync` into the parent components that know the context**

- Call `useDraftSync({ type: 'thread', id: threadId })` in `ThreadContent`
- Call `useDraftSync({ type: 'plan', id: planId })` in the plan view component
- Call `useDraftSync({ type: 'empty' })` in `EmptyPaneContent`
- Modify `ThreadInput` to read/write `useInputStore` instead of local state
- On submit, call `clearCurrentDraft()` alongside the existing clear

**Option B: Make `ThreadInput` context-aware**

- Pass context info (`type`/`id`) into `ThreadInput` as props
- Have it call `useDraftSync` internally

Option A is better because it follows existing separation of concerns — `ThreadInput` stays a dumb input, and the context-aware logic lives in the components that know the context.

## Phases

- [ ] Make `ThreadInput` use `useInputStore` instead of local `useState` for its value
- [ ] Call `useDraftSync` in `ThreadContent`, `EmptyPaneContent`, and plan view
- [ ] Call `clearCurrentDraft` on successful message send
- [ ] Wire up `PlanInputArea` drafts (uses its own local textarea, not `ThreadInput`)
- [ ] Verify no regressions with trigger search, prompt history, and optimistic messages

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Make `ThreadInput` use `useInputStore`

**File:** `src/components/reusable/thread-input.tsx`

Replace the local `useState("")` with `useInputStore`:

```diff
- const [value, setValue] = useState("");
+ const value = useInputStore((s) => s.content);
+ const setStoreContent = useInputStore((s) => s.setContent);
```

Update `handleChange` to write to the store:

```diff
  const handleChange = useCallback((newValue: string) => {
    resetHistory();
-   setValue(newValue);
+   setStoreContent(newValue);
  }, [resetHistory]);
```

Update `handleSubmit` to clear via store:

```diff
  const handleSubmit = useCallback(() => {
    if (value.trim() && !disabled) {
      onSubmit(value.trim());
-     setValue("");
+     setStoreContent("");
      resetHistory();
    }
  }, [value, disabled, onSubmit, resetHistory]);
```

Update history navigation callback:

```diff
  const { handleHistoryNavigation, resetHistory, isInHistoryMode } = usePromptHistory({
    onQueryChange: (query: string) => {
-     setValue(query);
+     setStoreContent(query);
```

## Phase 2: Call `useDraftSync` in parent components

### `ThreadContent` (`src/components/content-pane/thread-content.tsx`)

```typescript
import { useDraftSync } from '@/hooks/useDraftSync.js';

// Inside ThreadContent, near the top:
useDraftSync({ type: 'thread', id: threadId });
```

### `EmptyPaneContent` (find the empty state component)

```typescript
useDraftSync({ type: 'empty' });
```

### Plan view component (if it uses `ThreadInput`)

```typescript
useDraftSync({ type: 'plan', id: planId });
```

## Phase 3: Clear draft on send

In `ThreadContent.handleSubmit`, after the message is sent successfully:

```typescript
import { clearCurrentDraft } from '@/hooks/useDraftSync.js';

// After successful send:
clearCurrentDraft({ type: 'thread', id: threadId });
```

In `EmptyPaneContent`, same pattern with `{ type: 'empty' }`.

## Phase 4: Wire up `PlanInputArea`

`PlanInputArea` uses its own local `useState` and a raw `<textarea>`, not `ThreadInput` or `useInputStore`. Two options:

1. **Minimal:** Add save/restore calls directly using `draftService` in `useEffect` (save on unmount, restore on mount)
2. **Consistent:** Refactor to use `useInputStore` + `useDraftSync` like threads

Option 1 is simpler and doesn't require changing the component structure:

```typescript
// In PlanInputArea:
useEffect(() => {
  // Restore on mount
  const draft = draftService.getPlanDraft(planId);
  if (draft) setMessage(draft);

  // Save on unmount
  return () => {
    const current = /* get current message */;
    if (current) draftService.savePlanDraft(planId, current);
  };
}, [planId]);
```

## Phase 5: Regression check

Verify these still work correctly:
- Trigger search (`@` mentions, `/` skills) — depends on `value` state
- Prompt history (arrow keys) — depends on `setValue`
- Optimistic messages — depends on input clearing on submit
- Focus management — `useInputStore.requestFocus` should now integrate naturally
- Multiple panes — each pane has its own `ThreadContent`, but they share `useInputStore` — **this may be a problem if multi-pane is active** (both panes would share the same draft). If multi-pane is supported, we may need per-pane input stores or a different approach. Investigate before implementing.

## Risk: Multi-Pane Input Store Sharing

`useInputStore` is a singleton. If two `ThreadContent` instances exist (multi-pane), they'd fight over the same `content` value. Check if multi-pane with two thread inputs is currently possible. If so, the `useDraftSync` approach needs adjustment — possibly keying the input store by pane ID, or falling back to `draftService` directly.
