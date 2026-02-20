# Spotlight Permission Mode Cycling

## Summary

Add permission mode cycling via Shift+Tab to the spotlight, display the current mode next to "Create thread", and simplify the worktree shortcut to Tab-only (forward) since Shift+Tab is being repurposed.

## Current State

- **Shift+Tab** in spotlight currently cycles worktrees backward (Tab cycles forward)
- **Arrow Left/Right** also cycle worktrees but only when the query is empty, and they show an overlay
- "Create thread" row shows worktree info in its subtitle (`repo / worktree · Tab to change`)
- Permission mode is **not present** in the spotlight at all — it defaults to `"implement"` on thread creation
- The `PERMISSION_MODE_CYCLE` order is: implement → plan → approve
- Existing status bar component (`thread-input-status-bar.tsx`) already has mode colors and tooltips we can reuse

## Phases

- [x] Simplify worktree cycling to Tab-only (remove Shift+Tab backward cycling)
- [x] Add permission mode state and Shift+Tab cycling to spotlight
- [x] Display permission mode next to "Create thread" in results tray
- [x] Pass selected permission mode through to thread creation

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Simplify Worktree Cycling to Tab-Only

Drop backward worktree cycling entirely. Tab continues to cycle worktrees forward, and Arrow Left/Right remain for overlay-based cycling (which already supports both directions when the query is empty).

### Changes

**File: `src/components/spotlight/spotlight.tsx`**

- In the `handleKeyDown` `case "Tab"` block: remove the `if (e.shiftKey)` branch that cycles worktrees backward. The remaining `Tab` (no shift) forward-cycling stays as-is.

**File: `src/components/spotlight/results-tray.tsx`**

- No changes needed — the hint already says `" · Tab to change"` which is still correct for forward-only cycling.

## Phase 2: Add Permission Mode State + Shift+Tab Cycling

### Changes

**File: `src/components/spotlight/spotlight.tsx`**

- Add `permissionMode: PermissionModeId` to `SpotlightState` (default: `"implement"`)
- Add `"implement"` to `INITIAL_STATE`
- Import `PERMISSION_MODE_CYCLE` and `PermissionModeId` from `@core/types/permissions`
- In `handleKeyDown`, the `case "Tab"` block now handles two branches:
  ```ts
  case "Tab": {
    e.preventDefault();
    if (e.shiftKey) {
      // Shift+Tab = cycle permission mode
      setState(prev => {
        const idx = PERMISSION_MODE_CYCLE.indexOf(prev.permissionMode);
        const next = PERMISSION_MODE_CYCLE[(idx + 1) % PERMISSION_MODE_CYCLE.length];
        return { ...prev, permissionMode: next };
      });
    } else {
      // Tab = cycle worktree forward (existing behavior)
      if (repoWorktrees.length > 1) {
        setState(prev => ({
          ...prev,
          selectedWorktreeIndex: (prev.selectedWorktreeIndex + 1) % prev.repoWorktrees.length,
        }));
      }
    }
    break;
  }
  ```
- Pass `permissionMode` down to `ResultsTray` via `worktreeInfo` (or a new prop)

## Phase 3: Display Permission Mode Next to "Create Thread"

### Changes

**File: `src/components/spotlight/results-tray.tsx`**

- Accept `permissionMode` in the component props (add to `WorktreeInfo` or add a separate prop)
- In the `getResultDisplay()` function for the `"thread"` result type, render the permission mode label next to "Create thread":
  ```
  [MortLogo]  Create thread · Implement    [repo / worktree · Tab to change]
  ```
- Reuse the color scheme from `thread-input-status-bar.tsx`:
  - Plan: `text-blue-400`
  - Implement: `text-green-400`
  - Approve: `text-amber-400`
- Add a small hint like `(⇧Tab)` after the mode label so users discover the shortcut

### Visual Layout

```
┌─────────────────────────────────────────────────────┐
│ [MortLogo]  Create thread · Implement (⇧Tab)        │
│             🔀 mortician / main · Tab to change      │
└─────────────────────────────────────────────────────┘
```

The mode label is colored and appears inline with "Create thread" in the title area. The worktree info stays in the subtitle.

## Phase 4: Pass Permission Mode Through to Thread Creation

### Changes

**File: `src/components/spotlight/spotlight.tsx`**

- In the `activateResult` callback, when `result.type === "thread"`, pass `state.permissionMode` to `createSimpleThread()`
- Update `createSimpleThread()` signature to accept `permissionMode?: PermissionModeId`
- Forward it to the `createThread()` call from `thread-creation-service.ts`

The thread creation service already supports `permissionMode` in `CreateThreadOptions` — it's just never passed from the spotlight today.

## Files Changed

| File | Change |
|------|--------|
| `src/components/spotlight/spotlight.tsx` | Remove Shift+Tab worktree cycling, add permission mode state + Shift+Tab cycling, pass mode to thread creation |
| `src/components/spotlight/results-tray.tsx` | Display permission mode label next to "Create thread" |
