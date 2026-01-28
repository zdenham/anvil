# Responsive Breadcrumbs Implementation Plan

## Goal

Show full breadcrumb hierarchy (repo > worktree > threads/plans > name) in the content pane header, but only when there is sufficient width. Hide the extended hierarchy on narrow screens, falling back to the current simple breadcrumb.

## Current State

- **File**: `src/components/content-pane/content-pane-header.tsx`
- **Current breadcrumb**: Only shows 2 levels (e.g., "threads > thread-name" or "plans > plan-name")
- **Thread data available**: `ThreadMetadata` has `repoId` and `worktreeId` fields (lines 27-28 in `core/types/threads.ts`)
- **Repository data**: `useRepoStore` provides repo lookup by ID, repos contain `worktrees` array with `WorktreeState` objects
- **No existing responsive width logic**: The codebase only uses fixed `max-w-[Xpx]` with `truncate` for text overflow

## Implementation Approach

Use a **container query** approach with CSS `@container` queries (modern, performant, no JS resize observers needed). This is cleaner than JavaScript-based measurement.

### Why Container Queries?

1. **Pure CSS** - no JS overhead or ResizeObserver complexity
2. **Well-supported** - available in all modern browsers (Chrome 105+, Firefox 110+, Safari 16+)
3. **Semantic** - styles respond to the container's width, not the viewport
4. **Performant** - browser-native, no layout thrashing

## Implementation Steps

### Step 1: Create a breadcrumb context lookup hook

Create a new hook `useBreadcrumbContext` that takes a `repoId` and `worktreeId` and returns the display names:

```typescript
// src/components/content-pane/use-breadcrumb-context.ts
export function useBreadcrumbContext(repoId: string | undefined, worktreeId: string | undefined) {
  const repo = useRepoStore(s => repoId ? s.repositories[repoId] : undefined);
  const worktree = repo?.worktrees?.find(w => w.id === worktreeId);

  return {
    repoName: repo?.name,
    worktreeName: worktree?.name,
  };
}
```

### Step 2: Update the header container to be a container query context

Wrap the header in a container that can be queried:

```tsx
// In ThreadHeader and PlanHeader
<div className="@container flex items-center gap-2.5 px-3 py-2 border-b border-surface-700">
```

### Step 3: Create responsive breadcrumb component

Create a new `Breadcrumb` component that shows/hides segments based on container width:

```tsx
// src/components/content-pane/breadcrumb.tsx
interface BreadcrumbProps {
  repoName?: string;
  worktreeName?: string;
  category: "threads" | "plans";
  itemLabel: string;
  onCategoryClick: () => void;
}

export function Breadcrumb({ repoName, worktreeName, category, itemLabel, onCategoryClick }: BreadcrumbProps) {
  return (
    <div className="flex items-center gap-1.5 text-xs min-w-0">
      {/* Extended context - hidden at narrow widths */}
      {repoName && (
        <div className="hidden @[400px]:flex items-center gap-1.5">
          <span className="text-surface-500 truncate max-w-[120px]">{repoName}</span>
          <ChevronRight size={12} className="text-surface-600 shrink-0" />
          {worktreeName && (
            <>
              <span className="text-surface-500 truncate max-w-[100px]">{worktreeName}</span>
              <ChevronRight size={12} className="text-surface-600 shrink-0" />
            </>
          )}
        </div>
      )}

      {/* Always visible: category > name */}
      <button onClick={onCategoryClick} className="text-surface-400 hover:text-surface-200 ...">
        {category}
      </button>
      <ChevronRight size={12} className="text-surface-500 shrink-0" />
      <span className="text-surface-300 truncate max-w-[200px]">{itemLabel}</span>
    </div>
  );
}
```

### Step 4: Add Tailwind container query plugin (if not already present)

Check `tailwind.config.ts` for `@tailwindcss/container-queries` plugin. If not present, add it:

```bash
npm install @tailwindcss/container-queries
```

```js
// tailwind.config.ts
plugins: [
  require('@tailwindcss/container-queries'),
]
```

### Step 5: Update ThreadHeader and PlanHeader

Replace the inline breadcrumb JSX with the new `Breadcrumb` component:

```tsx
function ThreadHeader({ threadId, ... }) {
  const thread = useThreadStore(s => s.threads[threadId]);
  const { repoName, worktreeName } = useBreadcrumbContext(thread?.repoId, thread?.worktreeId);

  // ... existing code ...

  return (
    <div className="@container flex items-center gap-2.5 px-3 py-2 border-b border-surface-700">
      <StatusDot variant={...} />
      <Breadcrumb
        repoName={repoName}
        worktreeName={worktreeName}
        category="threads"
        itemLabel={threadLabel}
        onCategoryClick={onClose}
      />
      {/* ... right-side actions ... */}
    </div>
  );
}
```

Similarly for `PlanHeader` (though plans may need a different lookup since they don't have repoId directly - would need to derive from context or store).

### Step 6: Handle edge cases

1. **Single-repo mode**: If there's only one repo, consider always hiding repo name
2. **Main worktree**: If viewing the main worktree (not a secondary one), could hide worktree segment
3. **Plans**: Plans may not have direct repo/worktree association - check how they're stored and linked

## Breakpoint Recommendation

| Container Width | Displayed |
|-----------------|-----------|
| < 300px | category > name |
| 300-400px | category > name (with truncation) |
| 400px+ | repo > worktree > category > name |

The exact breakpoint (400px suggested) should be tuned based on:
- Typical repo/worktree name lengths
- Space needed for right-side action buttons
- Visual balance

## Alternative Approaches Considered

1. **ResizeObserver hook**: More flexible but adds JS complexity and potential performance overhead
2. **Viewport media queries**: Doesn't respond to actual pane width (bad for side-panel scenarios)
3. **Progressive truncation only**: Doesn't give clean hierarchy removal

## Files to Modify

1. `src/components/content-pane/content-pane-header.tsx` - Add container class, use new component
2. `src/components/content-pane/breadcrumb.tsx` - New file for breadcrumb component
3. `src/components/content-pane/use-breadcrumb-context.ts` - New hook for repo/worktree lookup
4. `tailwind.config.ts` - Add container queries plugin (if needed)
5. `package.json` - Add `@tailwindcss/container-queries` dependency (if needed)

## Testing

1. Resize the content pane to various widths and verify breadcrumb segments appear/disappear smoothly
2. Test in pop-out windows (smaller by default)
3. Test with very long repo/worktree names
4. Verify truncation works correctly at each level
