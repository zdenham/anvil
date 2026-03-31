# Cmd+K Quick Action Menu

Bring back the quick action menu that was removed in `d7189de` and `473f53a`. The new behavior: **Cmd+K toggles a quick action panel above the thread input** — fully open or fully closed, no collapsed state.

Also restore the **archive** and **mark unread** actions that were removed in `473f53a`.

## Phases

- [ ] Add Cmd+K toggle state and keybinding
- [ ] Re-render the quick actions panel above the thread input
- [ ] Restore archive and mark unread actions
- [ ] Wire up action handlers for archive and mark unread

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Context & History

The quick action menu was disabled in two commits:
- **`d7189de`** — Commented out `<BottomGutter />` and `useQuickActionHotkeys()` in `MainWindowLayout`
- **`473f53a`** — Removed `archive` and `markUnread` from action types, default actions, and control panel handler

All infrastructure still exists on disk:
- `src/components/quick-actions/quick-actions-panel.tsx` — renders action buttons
- `src/components/ui/bottom-gutter.tsx` — old bottom bar (won't reuse this, see below)
- `src/hooks/use-quick-action-hotkeys.ts` — Cmd+1-9 per-action hotkeys
- `src/hooks/use-quick-action-executor.ts` — action execution
- `src/entities/quick-actions/store.ts` — SDK-based quick actions store
- `src/stores/quick-actions-store.ts` — older UI-level quick actions store (action configs, navigation state)

## Design

### Placement
The old `BottomGutter` was a persistent bar at the very bottom of the window. The new design places the quick action menu **directly above the `ThreadInputSection`**, inside each content pane (thread, plan, empty). This is better because:
- It's contextually adjacent to the input
- It doesn't take permanent screen space
- It's scoped to the active pane

### Toggle Behavior
- **Cmd+K** toggles the panel open/closed (binary, no collapsed state)
- When open, the panel shows available quick actions for the current context (thread/plan/empty)
- Pressing Cmd+K again, pressing Escape, or executing an action closes the panel
- The panel should animate open/closed with a short transition

### Quick Action Hotkeys (Cmd+1-9)
The existing `useQuickActionHotkeys` hook should be re-enabled. These fire actions directly without needing the panel open.

---

## Phase 1: Add Cmd+K toggle state and keybinding

**Goal:** Create a simple boolean toggle that Cmd+K controls.

1. **Add `isQuickActionPanelOpen` to an appropriate store.** The simplest option is adding it to `src/stores/quick-actions-store.ts` since it already manages quick action UI state:
   - Add `isQuickActionPanelOpen: boolean` (default `false`)
   - Add `toggleQuickActionPanel: () => void`
   - Add `closeQuickActionPanel: () => void`

2. **Register the Cmd+K global keydown listener** in `MainWindowLayout`:
   - On `Cmd+K`: call `toggleQuickActionPanel()`
   - Guard: don't toggle if a modal is open
   - Guard: only on main views (thread, plan, empty)

3. **Re-enable `useQuickActionHotkeys()`** — uncomment the import and call in `main-window-layout.tsx` (lines 51 and 78).

## Phase 2: Re-render the quick actions panel above the thread input

**Goal:** Show the `QuickActionsPanel` above the input when the toggle is open.

1. **Modify `ThreadInputSection`** (`src/components/reusable/thread-input-section.tsx`):
   - Read `isQuickActionPanelOpen` from the store
   - When open, render a container above the `ThreadInput` that includes `QuickActionsPanel`
   - Style: a small panel with `bg-surface-800` or similar, rounded top corners, subtle border, same max-width as the input
   - Use a short height transition or simple appear/disappear

2. **Restyle `QuickActionsPanel`** for inline-above-input use (currently styled for the bottom gutter's tiny 10px text):
   - Increase text size slightly (e.g. `text-xs` instead of `text-[10px]`)
   - Show action descriptions alongside titles
   - Each action should be a clearly clickable row/button
   - Show hotkey hints (Cmd+1, Cmd+2, etc.)

3. **Close on action execution:** After any action executes, call `closeQuickActionPanel()`.

4. **Close on Escape:** Add Escape key handler that closes the panel if open.

## Phase 3: Restore archive and mark unread actions

**Goal:** Add `archive` and `markUnread` back to the action type system and default action lists.

1. **`src/stores/quick-actions-store.ts`:**
   - Add `"archive"` and `"markUnread"` back to the `ActionType` union
   - Add them back to `threadDefaultActions`:
     ```ts
     { key: "archive", label: "Archive", description: "complete and file away" },
     { key: "markUnread", label: "Mark unread", description: "return to inbox for later" },
     ```
   - Add them back to `planDefaultActions` as well

2. **Verify the SDK-based quick actions store** (`src/entities/quick-actions/store.ts`) doesn't need changes — it's generic and driven by registered action metadata.

## Phase 4: Wire up action handlers for archive and mark unread

**Goal:** Make archive and mark unread actually work when selected.

1. **In `control-panel-window.tsx`** (around the quick action handler, ~line 550), restore the handler cases:
   ```ts
   } else if (action === "archive") {
     await threadService.archive(threadId, instanceId);
     await navigateToNextItemOrFallback(currentItem, { actionType: "archive" });
   } else if (action === "markUnread") {
     await useThreadStore.getState().markThreadAsUnread(threadId);
     await navigateToNextItemOrFallback(currentItem, { actionType: "markUnread" });
   }
   ```

2. **Verify `threadService.archive`** and `markThreadAsUnread` still exist and work. Check imports.

3. **Close the Cmd+K panel** after executing archive or markUnread.

---

## Files to Modify

| File | Change |
|---|---|
| `src/stores/quick-actions-store.ts` | Add toggle state, restore action types |
| `src/components/main-window/main-window-layout.tsx` | Cmd+K listener, re-enable hotkeys |
| `src/components/reusable/thread-input-section.tsx` | Render quick action panel above input |
| `src/components/quick-actions/quick-actions-panel.tsx` | Restyle for above-input placement |
| `src/components/control-panel/control-panel-window.tsx` | Restore archive/markUnread handlers |

## Out of Scope
- Settings page for quick actions (already exists, leave as-is)
- Bottom gutter / status legend (stays disabled)
- Quick action SDK executor changes (existing infra works)
