# Fix QuickActionsPanel Infinite Loop

## Problem

The `QuickActionsPanel` component causes an infinite render loop with the error:
```
Warning: The result of getSnapshot should be cached to avoid an infinite loop
Error: Maximum update depth exceeded
```

## Root Cause

In `src/components/quick-actions/quick-actions-panel.tsx:13`:
```ts
const actions = useQuickActionsStore((s) => s.getForContext(contextType));
```

The `getForContext` method in the store (`src/entities/quick-actions/store.ts:31-34`) creates a **new array on every call**:
```ts
getForContext: (context) => {
  return Object.values(get().actions)
    .filter(a => a.enabled && (a.contexts.includes(context) || a.contexts.includes('all')))
    .sort((a, b) => a.order - b.order);
}
```

Zustand selectors must return stable references. When a selector returns a new object/array each time, Zustand detects a "change" and triggers a re-render, which calls the selector again, creating an infinite loop.

## Solution

Use Zustand's `useShallow` hook to perform shallow equality comparison on the array:

```ts
import { useShallow } from 'zustand/react/shallow';

// In the component:
const actions = useQuickActionsStore(
  useShallow((s) => s.getForContext(contextType))
);
```

This compares array elements by reference instead of comparing the array reference itself, breaking the infinite loop.

## Files to Modify

- `src/components/quick-actions/quick-actions-panel.tsx`

## Implementation

1. Add import for `useShallow` from `zustand/react/shallow`
2. Wrap the selector with `useShallow`

## Alternative Approaches (not recommended)

1. **Memoize in the store** - Could memoize `getForContext` results, but adds complexity to the store
2. **Use `subscribeWithSelector`** - More complex middleware setup
3. **Manual shallow comparison** - `useShallow` already does this cleanly
