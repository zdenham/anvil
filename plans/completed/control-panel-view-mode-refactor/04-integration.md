# Sub-Plan 04: Integration & Verification

**Must run AFTER:** 01, 02, 03 are all complete
**Parallelizable with:** None

## Goal

Tie together all the pieces from the parallel sub-plans, fix any integration issues, and verify the complete implementation against success criteria.

## Integration Tasks

### Task 1: Verify Type Consistency

Ensure all files use the same `ControlPanelViewType` without any `tab` property:

```bash
# Should return no results
grep -r "tab:" src/components/control-panel/ --include="*.ts" --include="*.tsx" | grep -v "threadTab"
grep -r "\.tab" src/entities/events.ts
```

### Task 2: Wire SuggestedActionsPanel to Control Panel

**File:** `src/components/control-panel/control-panel-window.tsx`

Ensure `SuggestedActionsPanel` receives the current view:

```typescript
import { SuggestedActionsPanel } from "./suggested-actions-panel";

// In render:
<SuggestedActionsPanel
  view={view}
  isStreaming={isStreaming}
/>
```

### Task 3: Clean Up Legacy Code

Remove any remaining legacy code paths:

1. Remove `LegacyControlPanelViewType` if no longer used
2. Remove `initialView` handling if all code paths use `view`
3. Remove three-way toggle remnants

```bash
# Find legacy usage
grep -r "initialView" src/components/control-panel/
grep -r "LegacyControlPanelViewType" src/
```

### Task 4: Update Tests

Update any tests that reference the old structure:

```bash
# Find tests that might need updates
pnpm test src/components/control-panel/ --listTests
pnpm test src/stores/quick-actions --listTests
pnpm test src/lib/hotkey-service --listTests
```

Fix any failing tests due to:
- Changed prop signatures
- Removed `tab` from view type
- New action lists

### Task 5: Full Type Check

```bash
pnpm tsc --noEmit
```

Fix any remaining type errors.

### Task 6: Run Full Test Suite

```bash
pnpm test
```

Fix any failing tests.

### Task 7: Manual Integration Testing

Test the complete flow:

| Test Case | Steps | Expected |
|-----------|-------|----------|
| Open thread from inbox | Click thread in inbox | Control panel opens with conversation view |
| Toggle thread tabs | Press Tab in thread view | Switches between conversation and changes |
| Open plan from inbox | Click plan in inbox | Control panel opens with plan view (no tabs) |
| Plan quick actions | Open plan, check actions | See Create Thread, Edit, Delete |
| Thread quick actions | Open thread, check actions | See Archive, Mark Unread, Toggle View |
| Streaming actions | Start agent, check actions | See Cancel, Pause |
| Client-side switch | With panel open, click different item | View switches without focus flicker |
| Keyboard navigation | Hold Shift, press Up/Down | Items highlight in inbox |
| Keyboard open | Release Shift while item highlighted | Opens that item in control panel |

### Task 8: Documentation Update

Update any documentation that references the old tab structure:

- Check `docs/data-models.md` if it mentions control panel views
- Check component JSDoc comments

## Verification Checklist

All success criteria from parent plan:

- [ ] Opening a plan shows plan-only view (single view, no tabs)
- [ ] Opening a thread shows thread view with conversation/changes tabs (local state)
- [ ] Quick actions are appropriate for the current view mode
- [ ] Thread tab toggle cycles between two tabs (not three)
- [ ] Header displays mode-appropriate content
- [ ] Clicking a thread in inbox opens control panel with thread view
- [ ] Clicking a plan in inbox opens control panel with plan view
- [ ] Client-side switching works without focus flicker when panel already open
- [ ] Keyboard navigation (Shift+Up/Down) highlights items without opening panel
- [ ] Releasing Shift opens the selected item
- [ ] All existing tests pass
- [ ] No TypeScript errors

## Cleanup

After all verification passes:

1. Remove any TODO comments added during implementation
2. Remove any debug logging
3. Ensure consistent code style (run `pnpm lint --fix`)

## Completion

Once all tasks complete and verification passes:

```bash
# Final verification
pnpm tsc --noEmit && pnpm test && pnpm lint

# If all pass, the refactor is complete
```
