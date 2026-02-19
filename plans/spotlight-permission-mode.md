# Spotlight Permission Mode Cycling

## Summary

Add permission mode cycling to the spotlight, display the current mode next to "Create thread", and reassign the worktree cycling shortcut since Shift+Tab is being taken over.

## Current State

- **Shift+Tab** in spotlight currently cycles worktrees backward (Tab cycles forward)
- **Arrow Left/Right** also cycle worktrees but only when the query is empty, and they show an overlay
- "Create thread" row shows worktree info in its subtitle (`repo / worktree · Tab to change`)
- Permission mode is **not present** in the spotlight at all — it defaults to `"implement"` on thread creation
- The `PERMISSION_MODE_CYCLE` order is: implement → plan → approve
- Existing status bar component (`thread-input-status-bar.tsx`) already has mode colors and tooltips we can reuse

## Phases

- [ ] Reassign worktree cycling shortcut (remove Shift+Tab, add new shortcut)
- [ ] Add permission mode state and Shift+Tab cycling to spotlight
- [ ] Display permission mode next to "Create thread" in results tray
- [ ] Pass selected permission mode through to thread creation

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Reassign Worktree Cycling Shortcut

Currently both `Tab` and `Shift+Tab` cycle worktrees. We need to free up `Shift+Tab` for permission mode cycling.

### Proposed Shortcut Options for Worktree Change

| Option | Shortcut | Pros | Cons |
|--------|----------|------|------|
| **A (Recommended)** | `Cmd+[` / `Cmd+]` | Intuitive bracket navigation (like browser tabs), doesn't conflict with typing | Uses Cmd modifier |
| **B** | `` ` `` (backtick, empty query only) | Single key, fast | Only works with empty query, might feel hidden |
| **C** | `Ctrl+Tab` / `Ctrl+Shift+Tab` | Mirrors browser tab switching convention | Ctrl+Tab may be captured by OS on macOS |
| **D** | Keep `Tab` only (forward), drop backward cycling | Simplest change, Tab already cycles forward | Lose backward cycling entirely |

**Recommendation: Option A (`Cmd+[` / `Cmd+]`)** — It's a well-known "previous/next" pattern (VS Code panels, browser history). Won't conflict with text input. Works whether query is empty or not.

### Changes

**File: `src/components/spotlight/spotlight.tsx`**

- In the `handleKeyDown` `case "Tab"` block: remove the `Shift+Tab` backward-cycling branch
- Add new `case` for the chosen shortcut to handle worktree cycling (both forward and backward)
- Update the worktree overlay hint text from "switch worktree ↵" to show the new shortcut

**File: `src/components/spotlight/results-tray.tsx`**

- Update the hint text in the "Create thread" subtitle from `" · Tab to change"` to reflect the new shortcut

## Phase 2: Add Permission Mode State + Shift+Tab Cycling

### Changes

**File: `src/components/spotlight/spotlight.tsx`**

- Add `permissionMode: PermissionModeId` to `SpotlightState` (default: `"implement"`)
- Import `PERMISSION_MODE_CYCLE` and `PermissionModeId` from `@core/types/permissions`
- In `handleKeyDown`, change the `case "Tab"` + `e.shiftKey` branch to cycle permission modes:
  ```ts
  if (e.shiftKey) {
    e.preventDefault();
    setState(prev => {
      const idx = PERMISSION_MODE_CYCLE.indexOf(prev.permissionMode);
      const next = PERMISSION_MODE_CYCLE[(idx + 1) % PERMISSION_MODE_CYCLE.length];
      return { ...prev, permissionMode: next };
    });
  }
  ```
- Pass `permissionMode` down to `ResultsTray` via `worktreeInfo` (or a new prop)

## Phase 3: Display Permission Mode Next to "Create Thread"

### Changes

**File: `src/components/spotlight/results-tray.tsx`**

- Accept `permissionMode` in the component props (add to `WorktreeInfo` or add a separate prop)
- In the `getResultDisplay()` function for the `"thread"` result type, render the permission mode label next to "Create thread":
  ```
  [MortLogo]  Create thread · Implement    [repo / worktree · Cmd+[ to change]
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
│             🔀 mortician / main · Cmd+[ to change    │
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
| `src/components/spotlight/spotlight.tsx` | Add permission state, Shift+Tab cycling, new worktree shortcut, pass mode to thread creation |
| `src/components/spotlight/results-tray.tsx` | Display permission mode label next to "Create thread", update worktree shortcut hint |
| `src/components/spotlight/spotlight.tsx` (WorktreeOverlay) | Update overlay hint text for new shortcut |
