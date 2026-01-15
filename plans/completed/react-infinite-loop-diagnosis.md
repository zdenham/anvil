# React Infinite Loop Diagnosis: TaskRow Component

## Problem Summary

The TaskRow component is causing a React infinite loop with the error:

- **Primary Error**: "Maximum update depth exceeded"
- **Root Warning**: "The result of getSnapshot should be cached to avoid an infinite loop"
- **Component**: TaskRow at `src/components/tasks/task-row.tsx:24:31`

## Root Cause Analysis

### The Issue

The infinite loop is caused by **line 17** in TaskRow:

```tsx
const allThreads = useThreadStore((s) => Object.values(s.threads));
```

### Why This Causes an Infinite Loop

1. **Object.values() Creates New Array on Every Render**:

   - `Object.values(s.threads)` creates a brand new array reference every time
   - Even if the underlying thread data hasn't changed, the array reference is different
   - This violates React's referential equality optimization

2. **Zustand Store Re-subscription Cycle**:

   - TaskRow subscribes to the thread store using `Object.values(s.threads)`
   - Every render gets a new array reference from `Object.values()`
   - This triggers Zustand to think the data has changed
   - Zustand notifies all subscribers (including this TaskRow)
   - TaskRow re-renders, creating another new array reference
   - **Infinite cycle begins**

3. **getSnapshot Warning Context**:
   - The "getSnapshot should be cached" warning refers to Zustand's internal subscription mechanism
   - Zustand uses `getSnapshot` to determine if store data has changed
   - When the selector returns a new reference every time, it can't properly detect actual changes

## Recent Changes That Triggered This

Looking at the git diff, the TaskRow component was recently refactored:

- **Before**: Used static `STATUS_DOT_COLORS` mapping
- **After**: Added `useThreadStore((s) => Object.values(s.threads))` on line 17
- **Purpose**: To call `getTaskDotColor(task, allThreads)` for dynamic task dot colors based on thread activity

## Impact

- **Severity**: Critical - Complete UI breakdown
- **Scope**: Affects any page showing TaskRow components (task lists, boards)
- **User Experience**: App becomes unusable with infinite re-renders

## Solutions

### Option 1: Use Zustand Store Selector (Recommended)

Replace direct `Object.values()` call with a proper Zustand selector:

```tsx
// Replace line 17
const allThreads = useThreadStore(
  useCallback((s) => Object.values(s.threads), [])
);
```

### Option 2: Use Store Method (Better)

Add a `getAllThreads()` method to the thread store that returns a cached array:

```tsx
// In thread store
const threadsArray = useMemo(() => Object.values(threads), [threads]);
getAllThreads: () => get().threadsArray,

// In TaskRow
const allThreads = useThreadStore((s) => s.getAllThreads());
```

### Option 3: Optimize with useMemo (Alternative)

Cache the threads array in the component:

```tsx
const threads = useThreadStore((s) => s.threads);
const allThreads = useMemo(() => Object.values(threads), [threads]);
```

## Recommended Fix

**Option 2** is the best approach because:

1. It moves the optimization to the store level (single source of truth)
2. All components benefit from the cached array
3. Prevents future similar issues
4. Maintains clean component code

## Prevention

- **Code Review**: Always check that Zustand selectors return stable references
- **Linting**: Consider adding ESLint rules to detect `Object.values()` in store selectors
- **Testing**: Add tests that verify component stability over multiple renders

## Priority

**HIGH** - This is a critical bug that breaks core functionality and should be fixed immediately.
