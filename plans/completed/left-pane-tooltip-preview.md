# Left Pane Tooltip Preview

## Overview

Add instant hover tooltips to items in the left pane (tree menu) that show a preview of the content to the right of the panel. No animation - tooltips should appear immediately on hover.

- **Threads**: Display the most recent user message (from `turns` array)
- **Plans**: Display the first X characters of the plan content (plaintext)

## Current State

- Left pane items are rendered in `src/components/tree-menu/thread-item.tsx` and `src/components/tree-menu/plan-item.tsx`
- An existing `Tooltip` component exists at `src/components/ui/tooltip.tsx` using Radix UI
- Thread data (including `turns` array with user prompts) is accessible via `useThreadStore`
- Plan content is accessible via `usePlanContent` hook (async) or `planService.getPlanContent()`

## Implementation Plan

### Step 1: Create Preview Tooltip Component

Create a new component `src/components/tree-menu/item-preview-tooltip.tsx` that:

- Wraps children with Radix UI tooltip primitives
- Positions tooltip to the `side="right"` of the trigger
- Sets `delayDuration={0}` for instant display (no animation delay)
- Removes default animations from the tooltip content styles
- Accepts `itemId` and `itemType` props to fetch appropriate preview content

```tsx
interface ItemPreviewTooltipProps {
  children: React.ReactNode;
  itemId: string;
  itemType: "thread" | "plan";
}
```

### Step 2: Create Preview Content Hooks

#### Thread Preview Hook

Create `src/hooks/use-thread-preview.ts`:

```tsx
export function useThreadPreview(threadId: string): string | null {
  const thread = useThreadStore((s) => s.getThread(threadId));

  if (!thread?.turns?.length) return null;

  // Get the most recent user message (last turn's prompt)
  const lastTurn = thread.turns[thread.turns.length - 1];
  return lastTurn?.prompt ?? null;
}
```

#### Plan Preview Hook

Modify or create `src/hooks/use-plan-preview.ts`:

- Use the existing `usePlanContent` hook internally
- Extract first ~200 characters of plaintext content
- Handle loading state (return null or loading indicator while fetching)

```tsx
const MAX_PREVIEW_LENGTH = 200;

export function usePlanPreview(planId: string): { preview: string | null; isLoading: boolean } {
  const { content, isLoading } = usePlanContent(planId);

  if (!content) return { preview: null, isLoading };

  const preview = content.slice(0, MAX_PREVIEW_LENGTH) + (content.length > MAX_PREVIEW_LENGTH ? "..." : "");
  return { preview, isLoading };
}
```

### Step 3: Style the Preview Tooltip

The tooltip content should:

- Have a fixed max-width (e.g., 300px) to prevent overly wide tooltips
- Use `whitespace-pre-wrap` to preserve line breaks in messages
- Have a subtle background that matches the app theme
- Use smaller font size for readability
- Have no entrance/exit animations (instant appear/disappear)

```tsx
className={cn(
  "z-50 px-3 py-2 text-xs",
  "bg-white text-neutral-900",
  "rounded-md shadow-lg border border-neutral-200",
  "max-w-[300px] whitespace-pre-wrap",
  // No animation classes - instant appear/disappear
)}
```

### Step 4: Integrate with ThreadItem

In `src/components/tree-menu/thread-item.tsx`:

```tsx
import { ItemPreviewTooltip } from "./item-preview-tooltip";

export function ThreadItem({ item, isSelected, onSelect, tabIndex }: ThreadItemProps) {
  return (
    <ItemPreviewTooltip itemId={item.id} itemType="thread">
      <div
        role="button"
        // ... existing props
      >
        {/* existing content */}
      </div>
    </ItemPreviewTooltip>
  );
}
```

### Step 5: Integrate with PlanItem

In `src/components/tree-menu/plan-item.tsx`:

```tsx
import { ItemPreviewTooltip } from "./item-preview-tooltip";

export function PlanItem({ item, isSelected, onSelect, tabIndex }: PlanItemProps) {
  return (
    <ItemPreviewTooltip itemId={item.id} itemType="plan">
      <div
        role="button"
        // ... existing props
      >
        {/* existing content */}
      </div>
    </ItemPreviewTooltip>
  );
}
```

### Step 6: Handle Edge Cases

1. **Empty content**: If no preview is available, either don't show tooltip or show "No preview available"
2. **Loading state for plans**: Show "Loading..." text while plan content is being fetched
3. **Very long messages**: Truncate thread messages to a reasonable length (e.g., 500 chars)
4. **Markdown in plans**: Strip markdown formatting for plaintext preview, or keep it simple and just truncate raw content

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/components/tree-menu/item-preview-tooltip.tsx` | Create |
| `src/hooks/use-thread-preview.ts` | Create |
| `src/hooks/use-plan-preview.ts` | Create |
| `src/components/tree-menu/thread-item.tsx` | Modify - wrap with tooltip |
| `src/components/tree-menu/plan-item.tsx` | Modify - wrap with tooltip |

## Configuration Options (Future)

Consider making these configurable in settings:

- Preview character limit
- Tooltip delay (if users want a slight delay)
- Enable/disable preview tooltips entirely

## Testing

1. Hover over a thread item - should instantly show the last user message
2. Hover over a plan item - should instantly show first ~200 chars of plan content
3. Move mouse away - tooltip should disappear immediately
4. Verify tooltips appear to the right of the left pane, not overlapping it
5. Test with long content to ensure proper truncation
6. Test with threads that have no turns (edge case)
7. Test with plans that fail to load (stale plans)
