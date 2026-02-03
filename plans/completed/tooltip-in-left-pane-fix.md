# Tooltip Appearing Automatically When Creating New Thread

## Problem Summary

When a user creates a new thread (via Cmd+N), a tooltip appears automatically in the left side pane (tree menu) without the user hovering. The tooltip should only appear on hover, not when a thread is created/selected.

## Root Cause Analysis

### The Bug Flow

1. User presses Cmd+N to create a new thread
2. `main-window-layout.tsx:149` calls `navigationService.navigateToThread(thread.id, { autoFocus: true })`
3. Navigation service updates tree selection via `treeMenuService.setSelectedItem(threadId)`
4. The newly created thread item receives **focus** (keyboard focus for accessibility)
5. **Radix UI tooltips trigger on both hover AND focus by default**
6. With `delayDuration={0}` set in `item-preview-tooltip.tsx:26`, the tooltip appears instantly on focus

### The Core Issue

Radix UI's `TooltipPrimitive.Trigger` responds to focus events, not just hover. This is documented behavior and there's a known GitHub issue about it: [radix-ui/primitives#2248](https://github.com/radix-ui/primitives/issues/2248).

The problematic code in `src/components/tree-menu/item-preview-tooltip.tsx`:

```tsx
<TooltipPrimitive.Provider delayDuration={0}>  // Instant trigger
  <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    // Tooltip triggers on BOTH hover and focus
```

## Proposed Fix

### Option 1: Disable Focus Trigger via `disableHoverableContent` (Recommended)

Use the `disableHoverableContent` prop combined with preventing focus events from triggering the tooltip:

**File**: `src/components/tree-menu/item-preview-tooltip.tsx`

```tsx
export function ItemPreviewTooltip({
  children,
  itemId,
  itemType,
}: ItemPreviewTooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={0}>
      <TooltipPrimitive.Root disableHoverableContent>
        <TooltipPrimitive.Trigger asChild>
          {/* Wrap children to stop focus from triggering tooltip */}
          <div onFocusCapture={(e) => e.stopPropagation()}>
            {children}
          </div>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipContent itemId={itemId} itemType={itemType} />
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
```

**Note**: The extra `<div>` wrapper may affect styling. An alternative is to use `onFocusCapture` directly on the Trigger element.

### Option 2: Use Controlled Open State (More Control)

Use a controlled tooltip that only opens on `pointerenter`:

```tsx
export function ItemPreviewTooltip({
  children,
  itemId,
  itemType,
}: ItemPreviewTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <TooltipPrimitive.Provider delayDuration={0}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
        <TooltipPrimitive.Trigger
          asChild
          onPointerEnter={() => setOpen(true)}
          onPointerLeave={() => setOpen(false)}
          onFocus={() => {}} // Prevent focus from opening
          onBlur={() => {}}  // Prevent blur from closing
        >
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipContent itemId={itemId} itemType={itemType} />
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
```

### Option 3: Skip Tooltip for Empty Content (Defense in Depth)

Even if Option 1 or 2 is implemented, we should also skip rendering the tooltip entirely for newly created threads that have no messages:

```tsx
export function ItemPreviewTooltip({
  children,
  itemId,
  itemType,
}: ItemPreviewTooltipProps) {
  const threadPreview = useThreadPreview(itemType === "thread" ? itemId : "");
  const { preview: planPreview } = usePlanPreview(itemType === "plan" ? itemId : null);

  const hasContent = itemType === "thread" ? !!threadPreview : !!planPreview;

  // Don't wrap in tooltip at all if there's no content to show
  if (!hasContent) {
    return <>{children}</>;
  }

  // ... rest of tooltip implementation
}
```

## Recommended Implementation

Combine **Option 1** (or Option 2) with **Option 3**:
1. Prevent focus from triggering tooltips (fixes the immediate bug)
2. Skip tooltip rendering entirely when there's no content (belt and suspenders)

## Files to Modify

1. `src/components/tree-menu/item-preview-tooltip.tsx` - Main fix location

## Testing

1. Create a new thread via Cmd+N
2. Verify **no tooltip appears** when the new thread is created and selected
3. Move mouse away, then hover over the new (empty) thread
4. Verify **no tooltip appears** (thread has no messages yet)
5. Send a message in the thread
6. Hover over the thread in sidebar
7. Verify tooltip **now appears** with the message preview
8. Test existing threads with messages still show tooltips on hover
9. Test plan items still show tooltips on hover
10. Verify keyboard navigation still works (up/down arrows)
11. Verify focus outline still appears on focused items (accessibility)

## References

- [Radix UI Tooltip Documentation](https://www.radix-ui.com/primitives/docs/components/tooltip)
- [GitHub Issue #2248: Tooltip within popover opens automatically due to trigger receiving focus](https://github.com/radix-ui/primitives/issues/2248)
