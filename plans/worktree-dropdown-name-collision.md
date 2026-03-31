# Fix: Worktree dropdown doesn't update when switching between repos with same worktree name

## Problem

The file dropdown in the right sidebar always displays the first matching worktree name instead of the currently selected one. This happens because `RightPanelSubheader` resolves `currentWorktreeId` by matching on `worktreeName` (a non-unique string) rather than by worktree ID.

**Root cause** — `right-panel-subheader.tsx:49`:
```typescript
currentWorktreeId={worktreeOptions.find((o) => o.name === worktreeName)?.id ?? ""}
```

When two repos both have a worktree named "main", `.find()` always returns the first one in the array. The parent `RightPanelContainer` already computes the correct `finalWorktreeId` (line 85) but only passes `worktreeName` (a string) to the subheader, losing the disambiguation.

## Fix

Pass `worktreeId` as a new prop to `RightPanelSubheader` and use it directly instead of doing the name-based lookup.

## Phases

- [ ] Add `worktreeId` prop and remove ambiguous lookup
- [ ] Verify with type-check

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `worktreeId` prop and remove ambiguous lookup

### `src/components/right-panel/right-panel-subheader.tsx`

1. Add `worktreeId: string | null` to `RightPanelSubheaderProps`
2. Change line 49 from:
   ```typescript
   currentWorktreeId={worktreeOptions.find((o) => o.name === worktreeName)?.id ?? ""}
   ```
   to:
   ```typescript
   currentWorktreeId={worktreeId ?? ""}
   ```

### `src/components/right-panel/right-panel-container.tsx`

3. Pass `worktreeId={finalWorktreeId ?? null}` to `<RightPanelSubheader>` (line 103-110).

## Phase 2: Verify with type-check

Run `pnpm tsc --noEmit` to confirm no type errors.
