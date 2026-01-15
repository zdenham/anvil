# Fix: Threads Page Displays Nothing in Main Window

## Problem

Clicking on the threads page in the main window displays nothing.

## Root Cause

In `src/components/main-window/threads-list-page.tsx` (line 6):

```typescript
const threads = useThreadStore((s) => Object.values(s.threads));
```

The issue is that `Object.values()` creates a **new array reference** on every render. Zustand uses referential equality (`===`) to determine if the selector result changed. Since a new array is created each time, Zustand sees it as "changed" every render, causing rendering issues.

## Solution

Fix the selector to return the object directly, then derive the array in the component:

**Before:**
```typescript
const threads = useThreadStore((s) => Object.values(s.threads));
```

**After:**
```typescript
const threadsMap = useThreadStore((s) => s.threads);
const threads = Object.values(threadsMap);
```

## File to Modify

- `src/components/main-window/threads-list-page.tsx`

## Implementation Steps

1. Change the `useThreadStore` selector to return `s.threads` (the object) instead of `Object.values(s.threads)`
2. Add a line to derive the threads array from the object using `Object.values()`
3. Test that the threads list now displays correctly
