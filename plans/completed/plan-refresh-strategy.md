# Plan Refresh Strategy for Deleted/Moved Files

## Problem Statement

Plans in Anvil consist of two parts:
1. **Metadata** stored in `~/.anvil/plans/{id}/metadata.json` (managed by us)
2. **Markdown content** stored in `{repo}/plans/{relativePath}` (user-controlled)

Since users can delete, move, or rename plan files outside of our application, we need to handle these cases gracefully.

## Current Behavior

| Scenario | Current Behavior |
|----------|------------------|
| File deleted | Shows "Plan file not found" error in UI, metadata remains orphaned |
| File moved | Same as deleted - metadata points to old location |
| File renamed | Same as deleted |
| Metadata corrupted | Skipped during hydration, logged as warning |

## Proposed Solution: Lazy Validation with Stale Detection

### Core Principle

**Validate on access, not on startup.** When a user tries to view a plan, check if the file exists. If not, mark it as "stale" and offer resolution options.

### Implementation

#### 1. Add `stale` flag to PlanMetadata

```typescript
// core/types/plans.ts
export interface PlanMetadata {
  // ... existing fields
  stale?: boolean;        // True if file was not found on last access
  lastVerified?: number;  // Timestamp of last successful file access
}
```

#### 2. Validate file existence when loading content

In `planService.getPlanContent()`:

```typescript
async getPlanContent(planId: string): Promise<string | null> {
  const plan = usePlanStore.getState().getPlan(planId);
  if (!plan) return null;

  try {
    const absolutePath = await resolvePlanPath(plan);
    const content = await fs.readFile(absolutePath);

    // File exists - clear stale flag if it was set
    if (plan.stale) {
      await this.markAsValid(planId);
    }

    return content;
  } catch (err) {
    // File not found - mark as stale
    await this.markAsStale(planId);
    return null;
  }
}
```

#### 3. Add stale management methods

```typescript
// planService
async markAsStale(planId: string): Promise<void> {
  const plan = usePlanStore.getState().getPlan(planId);
  if (!plan || plan.stale) return; // Already stale or doesn't exist

  const updated = { ...plan, stale: true };
  usePlanStore.getState()._applyUpdate(planId, updated);
  await persistence.writeJson(`plans/${planId}/metadata.json`, updated);
}

async markAsValid(planId: string): Promise<void> {
  const plan = usePlanStore.getState().getPlan(planId);
  if (!plan || !plan.stale) return;

  const updated = { ...plan, stale: false, lastVerified: Date.now() };
  usePlanStore.getState()._applyUpdate(planId, updated);
  await persistence.writeJson(`plans/${planId}/metadata.json`, updated);
}
```

#### 4. Add "Find Plan" recovery flow

When a plan is stale, offer the user options:

```typescript
// In plan-view.tsx or plan-tab.tsx
if (plan.stale || content === null) {
  return (
    <StaleplanView
      plan={plan}
      onLocate={handleLocatePlan}
      onDelete={handleDeleteMetadata}
    />
  );
}
```

**StalePlanView** shows:
- Message: "This plan file appears to have been moved or deleted"
- Expected path: `plans/{relativePath}`
- Actions:
  1. **Locate File** - Opens file picker, user selects the moved file, we update `relativePath`
  2. **Delete** - Removes the orphaned metadata
  3. **Dismiss** - Closes the panel (metadata remains for future recovery)

#### 5. Background stale cleanup (optional)

Periodically clean up very old stale plans:

```typescript
async cleanupStalePlans(maxAgeDays: number = 30): Promise<void> {
  const plans = usePlanStore.getState().getPlans();
  const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

  for (const plan of plans) {
    if (plan.stale && plan.updatedAt < cutoff) {
      await this.delete(plan.id);
    }
  }
}
```

This could run on app startup or be user-triggered from settings.

### UI Changes

#### Inbox/List Views

- Show stale plans with a warning indicator (muted icon, strikethrough, or badge)
- Optionally: filter toggle to hide/show stale plans
- Stale plans should not count toward "unread" badges

#### Control Panel

- Clear "File not found" state with recovery options
- Show last known path for context

### Edge Cases

| Case | Handling |
|------|----------|
| File restored to original location | Auto-recovers on next access (clears stale flag) |
| File moved to different repo | User must use "Locate" and we detect new repo from path |
| File in worktree that no longer exists | Show error, offer delete only |
| Repository removed from settings | Plan becomes inaccessible, offer delete |
| Metadata deleted externally | Plan disappears from app (no action needed) |

### Migration

Existing plans without `stale` field are assumed valid (`stale: undefined` treated as `false`).

## Alternative Approaches Considered

### 1. File watcher on plans directories
- **Pros**: Real-time updates
- **Cons**: Complex, resource-intensive, unreliable across platforms, doesn't work when app is closed
- **Verdict**: Overkill for this use case

### 2. Periodic full validation scan
- **Pros**: Catches all stale plans
- **Cons**: Expensive for many plans, delays startup
- **Verdict**: Could add as optional background task, but not primary mechanism

### 3. Store absolute paths and track moves
- **Pros**: Could potentially detect renames
- **Cons**: Breaks portability, complex change detection
- **Verdict**: Not worth the complexity

### 4. Content hash for identity
- **Pros**: Could match moved files by content
- **Cons**: Expensive, false positives with similar plans, breaks on content edits
- **Verdict**: Too unreliable

## Implementation Order

1. Add `stale` field to schema and migration
2. Implement `markAsStale()` / `markAsValid()` in service
3. Update `getPlanContent()` to set stale flag on failure
4. Create `StalePlanView` component with delete action
5. Update inbox views to show stale indicator
6. (Optional) Add "Locate File" recovery flow
7. (Optional) Add background cleanup

## Summary

This approach:
- **Simple**: Only validates when user accesses a plan
- **Graceful**: Stale plans remain visible with clear status
- **Recoverable**: Auto-heals if file is restored, manual locate for moves
- **Non-destructive**: Never auto-deletes metadata, user decides
- **Performant**: No file system scanning or watching
