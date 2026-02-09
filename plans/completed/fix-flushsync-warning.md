# Fix flushSync Warning in LogsPage

## Problem

The LogsPage component triggers a React warning:
```
Warning: flushSync was called from inside a lifecycle method. React cannot flush when React is already rendering.
```

This occurs at `logs-page.tsx:27` which is inside the `useVirtualizer` hook configuration. The root cause is that `virtualizer.scrollToIndex()` is being called synchronously inside a `useEffect`, and TanStack Virtual's `scrollToIndex` internally uses `flushSync` to ensure immediate DOM updates.

## Root Cause Analysis

In the current code (lines 38-42):
```typescript
useEffect(() => {
  if (autoScroll && filteredLogs.length > 0) {
    virtualizer.scrollToIndex(filteredLogs.length - 1, { align: "end" });
  }
}, [filteredLogs.length, autoScroll, virtualizer]);
```

When `filteredLogs` changes (e.g., new logs arrive), this effect runs. The `scrollToIndex` call internally uses `flushSync` to immediately apply the scroll position, but this happens during React's commit phase when effects run, causing the warning.

## Solution

Wrap the `scrollToIndex` call in a microtask using `queueMicrotask()` or `setTimeout(..., 0)` to defer it until after React finishes its current render cycle. This follows React's recommendation in the warning message: "Consider moving this call to a scheduler task or micro task."

## Phases

- [x] Update the auto-scroll useEffect to defer scrollToIndex with queueMicrotask
- [x] Update the scrollToBottom callback similarly for consistency
- [ ] Test that auto-scroll still works correctly

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation

### Phase 1: Update auto-scroll useEffect

Change from:
```typescript
useEffect(() => {
  if (autoScroll && filteredLogs.length > 0) {
    virtualizer.scrollToIndex(filteredLogs.length - 1, { align: "end" });
  }
}, [filteredLogs.length, autoScroll, virtualizer]);
```

To:
```typescript
useEffect(() => {
  if (autoScroll && filteredLogs.length > 0) {
    queueMicrotask(() => {
      virtualizer.scrollToIndex(filteredLogs.length - 1, { align: "end" });
    });
  }
}, [filteredLogs.length, autoScroll, virtualizer]);
```

### Phase 2: Update scrollToBottom callback

Change from:
```typescript
const scrollToBottom = useCallback(() => {
  setAutoScroll(true);
  if (filteredLogs.length > 0) {
    virtualizer.scrollToIndex(filteredLogs.length - 1, { align: "end" });
  }
}, [filteredLogs.length, virtualizer]);
```

To:
```typescript
const scrollToBottom = useCallback(() => {
  setAutoScroll(true);
  if (filteredLogs.length > 0) {
    queueMicrotask(() => {
      virtualizer.scrollToIndex(filteredLogs.length - 1, { align: "end" });
    });
  }
}, [filteredLogs.length, virtualizer]);
```

### Phase 3: Verify

Open the Logs page in the app and confirm:
1. No flushSync warning appears in console
2. Auto-scroll still works when new logs arrive
3. Manual "Scroll to bottom" button still works
