# Fix Plan `.md` Extension Display in Mission Control List

## Problem

When plans are displayed in the Mission Control list, the `.md` file extension is being stripped from the filename. The user expects to see the full filename including the `.md` extension.

## Root Cause

There are two `getPlanDisplayName` functions that explicitly strip the `.md` extension:

1. **`src/components/inbox/utils.ts:8-13`** (primary - used by mission control list)
   ```typescript
   export function getPlanDisplayName(plan: PlanMetadata): string {
     const parts = plan.relativePath.split(/[/\\]/);
     const filename = parts[parts.length - 1] || plan.relativePath;
     return filename.replace(/\.md$/, "");  // <-- Strips .md extension
   }
   ```

2. **`src/entities/plans/utils.ts:99-103`** (canonical utility)
   ```typescript
   export function getPlanDisplayName(plan: PlanMetadata): string {
     const parts = plan.relativePath.split('/');
     const filename = parts[parts.length - 1];
     return filename.replace(/\.md$/, '');  // <-- Strips .md extension
   }
   ```

The `createUnifiedList` function in `src/components/inbox/utils.ts:35` calls `getPlanDisplayName(p)` to set the `displayText` for plan items in the mission control list.

Interestingly, the control panel header (`src/components/control-panel/control-panel-header.tsx:70`) does NOT strip the extension - it just extracts the filename:
```typescript
const planLabel = plan?.relativePath?.split('/').pop() ?? planId.slice(0, 8) + "...";
```

## Proposed Fix

Remove the `.replace(/\.md$/, "")` call from both `getPlanDisplayName` functions to preserve the `.md` extension.

### Changes Required

#### 1. `src/components/inbox/utils.ts`

**Before (lines 8-13):**
```typescript
export function getPlanDisplayName(plan: PlanMetadata): string {
  // Extract filename from path (works with both / and \ separators)
  const parts = plan.relativePath.split(/[/\\]/);
  const filename = parts[parts.length - 1] || plan.relativePath;
  return filename.replace(/\.md$/, "");
}
```

**After:**
```typescript
export function getPlanDisplayName(plan: PlanMetadata): string {
  // Extract filename from path (works with both / and \ separators)
  const parts = plan.relativePath.split(/[/\\]/);
  return parts[parts.length - 1] || plan.relativePath;
}
```

#### 2. `src/entities/plans/utils.ts`

**Before (lines 99-103):**
```typescript
export function getPlanDisplayName(plan: PlanMetadata): string {
  const parts = plan.relativePath.split('/');
  const filename = parts[parts.length - 1];
  return filename.replace(/\.md$/, '');
}
```

**After:**
```typescript
export function getPlanDisplayName(plan: PlanMetadata): string {
  const parts = plan.relativePath.split('/');
  return parts[parts.length - 1];
}
```

#### 3. Update JSDoc comments

Both functions have a JSDoc comment saying "filename without extension" - this should be updated to reflect the new behavior:

**Before:**
```typescript
/**
 * Get the display name for a plan (filename without extension).
 */
```

**After:**
```typescript
/**
 * Get the display name for a plan (filename from relative path).
 */
```

## Files to Modify

1. `src/components/inbox/utils.ts` - Lines 5-13
2. `src/entities/plans/utils.ts` - Lines 96-103

## Impact

- Mission Control list will now show plan filenames with `.md` extension (e.g., `my-plan.md` instead of `my-plan`)
- Control panel header already shows the extension, so this creates consistency
- No breaking changes to API or data structures

## Testing

1. Open Mission Control list
2. Verify plans display with `.md` extension
3. Verify control panel header still shows correct filename (should be unchanged)
4. Verify archived plans also show `.md` extension
