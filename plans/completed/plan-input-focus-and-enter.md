# Plan: Auto-focus plan input & Enter-to-implement

## Problem

1. **No autofocus**: When clicking a plan in the sidebar, the thread input is not focused. `PlanContent` never passes `autoFocus` to `ThreadInputSection` — unlike `EmptyPaneContent` which always passes `autoFocus` and `ThreadContent` which passes it based on a prop.

2. **Enter on empty input does nothing**: When the input is empty and the user presses Enter, nothing happens. The "implement" button is visible but Enter doesn't trigger it. The guard on line 141 of `thread-input.tsx` requires `content.trim()` to be truthy before handling Enter.

## Phases

- [x] Add autofocus to PlanContent's ThreadInputSection
- [x] Make Enter on empty input trigger implement in plan context

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add autofocus to PlanContent's ThreadInputSection

**File**: `src/components/content-pane/plan-content.tsx`

Add `autoFocus` to the `ThreadInputSection` in PlanContent:

```tsx
// line 263
<ThreadInputSection
  ref={inputRef}
  onSubmit={handleMessageSubmit}
  workingDirectory={workingDirectory ?? null}
  contextType="plan"
  placeholder="Type a message to start a thread about this plan..."
  permissionMode={permissionMode}
  onCycleMode={handleCycleMode}
  autoFocus  // <-- add this
/>
```

This will flow through `ThreadInputSection` → `ThreadInput` → `TriggerSearchInput` which already supports `autoFocus`.

## Phase 2: Make Enter on empty input trigger implement in plan context

**File**: `src/components/reusable/thread-input.tsx`

In `handleKeyDown` (line 141), the Enter handler currently requires `content.trim()`. Add a branch: when `contextType === "plan"` and input is empty, trigger `handleImplementPlan` instead.

```tsx
// Current (line 141):
if (e.key === "Enter" && !e.shiftKey && !triggerState?.isActive && content.trim()) {

// Change to:
if (e.key === "Enter" && !e.shiftKey && !triggerState?.isActive) {
  e.preventDefault();
  e.stopPropagation();
  if (content.trim()) {
    handleSubmit();
  } else if (contextType === "plan") {
    handleImplementPlan();
  }
  return;
}
```

This way, pressing Enter with an empty input in plan context sends `"implement this plan"` — same as clicking the button.
