# Fix Panel Quick Actions and Input Padding

## Problem

Two issues exist in the control panel window:

1. **Legacy Quick Actions Rendered on Top of New Pill Actions**: The `ControlPanelWindow` renders both `SuggestedActionsPanel` (legacy collapsible quick actions) AND `QuickActionsPanel` (new pill-based actions), causing visual duplication.

2. **Missing Horizontal Padding Around Message Input**: The control panel lacks the `px-2.5` padding that exists in the normal `ThreadContent` pane, causing the message input to extend edge-to-edge.

## Root Cause Analysis

### Issue 1: Duplicate Quick Actions

In `src/components/control-panel/control-panel-window.tsx` (lines ~696-724), the input section renders:
```tsx
<div className="w-full max-w-[900px] mx-auto">
  <SuggestedActionsPanel ... />  {/* Legacy - REMOVE */}
  <QuickActionsPanel contextType="thread" />  {/* New pills - KEEP */}
  <QueuedMessagesBanner messages={queuedMessages} />
  <div className={...}>
    <ThreadInput ... />
  </div>
</div>
```

The `SuggestedActionsPanel` is the legacy collapsible component that should be removed in favor of the new `QuickActionsPanel`.

### Issue 2: Missing Padding

In `ThreadContent` (content pane), the outer wrapper has `px-2.5`:
```tsx
<div className="flex flex-col h-full text-surface-50 relative overflow-hidden px-2.5">
```

In `ControlPanelWindow`, the input section wrapper lacks this padding:
```tsx
<div className="w-full max-w-[900px] mx-auto">  {/* No px-2.5 */}
```

## Phases

- [x] Remove legacy SuggestedActionsPanel from control-panel-window.tsx
- [x] Add horizontal padding to control panel input section
- [x] Clean up unused SuggestedActionsPanel imports and potentially the component if unused elsewhere
- [x] Verify plan-view.tsx doesn't have the same issues

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### Phase 1: Remove Legacy SuggestedActionsPanel

**File:** `src/components/control-panel/control-panel-window.tsx`

1. Remove the import for `SuggestedActionsPanel`
2. Remove the `<SuggestedActionsPanel ... />` JSX from the input section
3. Remove any related props/state that are only used by SuggestedActionsPanel (e.g., `handleFollowUpSubmit`, `selectedActionIndex` if only used there)

### Phase 2: Add Horizontal Padding

**File:** `src/components/control-panel/control-panel-window.tsx`

Change the input section wrapper from:
```tsx
<div className="w-full max-w-[900px] mx-auto">
```
To:
```tsx
<div className="w-full max-w-[900px] mx-auto px-2.5">
```

This matches the padding used in `ThreadContent`.

### Phase 3: Clean Up Unused Components

1. Check if `SuggestedActionsPanel` is used elsewhere:
   - `src/components/control-panel/suggested-actions-panel.tsx` - the component itself
   - `src/components/content-pane/suggested-actions-panel.tsx` - re-export wrapper
   - `src/components/control-panel/plan-view.tsx` - may use it

2. If no longer used anywhere, consider:
   - Removing `src/components/control-panel/suggested-actions-panel.tsx`
   - Removing `src/components/content-pane/suggested-actions-panel.tsx`
   - Cleaning up related stores/state in `src/stores/quick-actions-store.ts` if applicable

### Phase 4: Verify Plan View

**File:** `src/components/control-panel/plan-view.tsx`

Check if plan-view.tsx has the same issues and apply consistent fixes if needed.

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/control-panel/control-panel-window.tsx` | Remove SuggestedActionsPanel, add px-2.5 padding |
| `src/components/control-panel/suggested-actions-panel.tsx` | Potentially delete if unused |
| `src/components/content-pane/suggested-actions-panel.tsx` | Potentially delete if unused |
| `src/components/control-panel/plan-view.tsx` | Verify and fix if needed |

## Testing

1. Open the control panel and verify:
   - Only pill-based quick actions appear (no collapsible legacy panel)
   - Message input has consistent horizontal padding matching the main content pane
2. Navigate to different states (empty thread, active thread, streaming) and verify quick actions display correctly
3. Test keyboard navigation on the new pill quick actions still works
