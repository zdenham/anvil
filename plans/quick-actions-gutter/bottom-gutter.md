# Bottom Gutter (VS Code-style Status Bar)

Add a thin bottom gutter spanning the full window width, matching the window titlebar's dashed border style. Moves the status legend and quick actions out of the sidebar into this shared bar.

## Current State

- **StatusLegend** lives at the bottom of the left sidebar (`main-window-layout.tsx:779-781`), wrapped in `px-3 py-2 border-t border-surface-800`
- **QuickActionsPanel** (`quick-actions-panel.tsx`) is currently commented out / disabled in `ThreadInputSection` — it was above the thread input but there's not enough space
- Quick actions have arrow-key navigation for cycling through them (`quick-actions-panel.tsx:97-184`) which should be removed
- Quick action hotkeys already exist (`use-quick-action-hotkeys.ts`) using `Cmd+0-9` — these are the "custom hotkeys" that replace arrow nav

## Design

```
┌─────────────────────────────────────────────────────┐
│ Window Titlebar  (border-b border-dashed ...)       │
├─────────────────────────────────────────────────────┤
│ Left Panel │        Center Panel       │ Right Panel │
│            │                           │             │
│            │                           │             │
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤
│ ● Running  ● Needs Input  ● Unread    /commit  /pr │
└─────────────────────────────────────────────────────┘
```

- Full-width bar below all panels (outside the flex row, same level as titlebar)
- Border: `border-t border-dashed border-surface-600/40` (matches titlebar's `border-b border-dashed border-surface-600/40`)
- Height: thin — same density as titlebar (~24-28px), using `text-xs` / `text-[10px]`
- Background: `bg-surface-900` (same as main window)
- Left side: StatusLegend (as-is)
- Right side: Quick actions, rendered more muted (`text-surface-600` instead of `text-surface-500`, no border on pills, no selected state)

## Phases

- [ ] Create `BottomGutter` component with legend left, quick actions right
- [ ] Wire into `MainWindowLayout` — place after main flex row, before debug panel
- [ ] Remove StatusLegend from left sidebar
- [ ] Simplify `QuickActionsPanel` — strip arrow-key navigation, remove selected state, make muted styling
- [ ] Re-enable `useQuickActionHotkeys` in `MainWindowLayout` (currently commented out on line 75)
- [ ] Clean up unused code (selectedIndex state, keyboard handler, findThreadInput, focus management)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### 1. `BottomGutter` component

New file: `src/components/ui/bottom-gutter.tsx`

```tsx
// Thin full-width bar at bottom of window
// Left: StatusLegend
// Right: QuickActionsPanel (muted variant)
// Border matches titlebar: border-t border-dashed border-surface-600/40
```

- Uses `flex items-center justify-between px-3 py-1`
- Renders `<StatusLegend />` on the left
- Renders a simplified quick actions list on the right

### 2. Layout placement in `MainWindowLayout`

Insert `<BottomGutter />` between the main `flex flex-1 min-h-0` row and the debug panel:

```tsx
{/* Main horizontal layout */}
<div className="flex flex-1 min-h-0">
  {/* ... panels ... */}
</div>

{/* Bottom gutter */}
<BottomGutter />

{/* Debug Panel (Cmd+Shift+D) */}
{debugPanelOpen && ( ... )}
```

### 3. Remove legend from sidebar

Delete lines 779-781 in `main-window-layout.tsx`:
```tsx
// Remove this:
<div className="px-3 py-2 border-t border-surface-800">
  <StatusLegend />
</div>
```

### 4. Simplify QuickActionsPanel

Strip out:
- `selectedIndex` state and all related logic
- `handleKeyDown` keyboard handler (arrow nav, Enter, Escape)
- `findThreadInput` helper
- `focusin` / `input` event listeners
- `isSelected` prop from `ActionItem`

Keep:
- Action list rendering
- Click-to-execute
- `isExecuting` / `executingAction` state
- Empty state (but update to fit gutter context — no border, just text)

Restyle `ActionItem` to be more muted:
- Remove `border` — use plain text buttons
- `text-surface-600 hover:text-surface-400` (more muted than current `text-surface-500`)
- Keep `font-mono text-[10px]` sizing
- Add hotkey hint badge: small `text-surface-700` label like `⌘1` next to the action title

### 5. Re-enable hotkeys

Uncomment `useQuickActionHotkeys()` on line 75 of `main-window-layout.tsx`. The existing `Cmd+0-9` implementation is correct and guards against input focus, modals, and non-main views.

### 6. Cleanup

- Remove `QuickActionsPanel` import from `thread-input-section.tsx` if still present
- Remove the `contextType` prop from `QuickActionsPanel` if no longer needed (gutter always shows all actions)
- Delete the arrow-nav related code (~90 lines from `quick-actions-panel.tsx`)
