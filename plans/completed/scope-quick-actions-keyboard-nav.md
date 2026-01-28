# Scope Quick Actions Keyboard Navigation to Control Panel

## Problem

The up/down arrow keyboard navigation for quick actions is attached to the `document` level, which intercepts keyboard events globally. This causes issues where:

- Arrow keys meant for other UI elements (e.g., text editors, lists) are captured by the quick actions handler
- The navigation behavior is active even when focus is outside the control panel
- Other components can't implement their own arrow key navigation without conflicts

**Current implementation** (`src/components/control-panel/control-panel-window.tsx:560-615`):
```typescript
// Global keyboard navigation for quick actions
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // ... handler logic
  };

  document.addEventListener("keydown", handleKeyDown);  // <-- Problem: document-level
  return () => document.removeEventListener("keydown", handleKeyDown);
}, [/* deps */]);
```

## Solution

Scope the keyboard event listener to the control panel container element instead of the entire document. Use a ref-based approach with focus management.

## Implementation

### 1. Add a ref for the container element

```typescript
const containerRef = useRef<HTMLDivElement>(null);
```

### 2. Change listener from document to container

Replace:
```typescript
document.addEventListener("keydown", handleKeyDown);
return () => document.removeEventListener("keydown", handleKeyDown);
```

With:
```typescript
const container = containerRef.current;
if (!container) return;

container.addEventListener("keydown", handleKeyDown);
return () => container.removeEventListener("keydown", handleKeyDown);
```

### 3. Attach ref to the root container

```tsx
<div
  ref={containerRef}
  tabIndex={-1}  // Make focusable but not in tab order
  className={cn(
    "control-panel-container flex flex-col h-screen text-surface-50 relative overflow-hidden",
    // ...
  )}
>
```

### 4. Ensure initial focus on mount

Add to the component:
```typescript
useEffect(() => {
  // Focus the container on mount so keyboard nav works immediately
  containerRef.current?.focus();
}, []);
```

### 5. Handle focus restoration

When actions complete or follow-up input closes, restore focus to the container so keyboard navigation continues to work:

```typescript
// In setShowFollowUpInput(false) handlers:
setShowFollowUpInput(false);
setFollowUpValue("");
containerRef.current?.focus();  // Restore focus to container
```

## Files to Modify

- `src/components/control-panel/control-panel-window.tsx`

## Considerations

1. **Focus state**: The container needs to be focusable (`tabIndex={-1}`) for the keydown listener to work when the container is focused
2. **Child focus**: When a child element (like ThreadInput) has focus, events will bubble up to the container - this is fine because:
   - ThreadInput already has its own `onKeyDown` handler with `stopPropagation()` for certain keys
   - The quick actions handler checks `showFollowUpInput` state before handling
3. **Outline styling**: Add `outline-none` or `focus:outline-none` to prevent visible focus ring on the container
4. **Escape key**: Escape handling should still work since events bubble from children

## Testing

1. Open control panel, verify up/down arrows navigate quick actions
2. Focus on an input field outside the control panel (if any exist), verify arrows don't trigger quick action navigation
3. Type in the ThreadInput, verify arrows move cursor (not quick actions)
4. Press Escape in follow-up input, verify it closes and keyboard nav resumes
5. Verify Enter still triggers the selected quick action
