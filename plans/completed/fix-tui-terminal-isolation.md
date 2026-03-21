# Fix TUI Terminal Session Isolation

## Problem

Multiple Claude Code TUI sessions all render the same terminal content when switching between them. Input from one session bleeds into others.

## Root Cause

This is the **exact same bug** as Bug 5 from `plans/completed/terminal-isolation-fix.md` — but on the TUI thread rendering path, which was missed when the original fix was applied.

### The Fix That Was Applied (regular terminals)

In `content-pane.tsx`, regular terminals got a `key` prop added:

```tsx
// line 211 — correctly forces remount on switch
<TerminalContent
  key={view.terminalId}
  terminalId={view.terminalId}
  onClose={onClose}
/>
```

### The Path That Was Missed (TUI threads)

TUI threads render via a different branch — `view.type === "thread"` with `threadKind` set:

```tsx
// line 161-163 — NO key prop
{view.type === "thread" && activeMetadata?.threadKind && (
  <TuiThreadContent thread={activeMetadata} />
)}
```

When switching from TUI thread A → TUI thread B:

1. Both are `view.type === "thread"` with `threadKind` set
2. React **reuses** the same `TuiThreadContent` instance (same position, same type)
3. Inside `TuiThreadContent`, `TerminalContent` is also reused (no key)
4. `TerminalContent`'s `useState(() => getOutputBuffer(terminalId))` **never re-runs its initializer** — it keeps the first terminal's buffer forever

### Why Input Bleeds

While `handleInput` recreates correctly via `useCallback` deps, the `isInitializedRef` guard and `useState` stale closure mean:

- The xterm instance may not properly reinitialize
- The `initialBuffer` replay shows wrong content
- The output subscription switches correctly, but buffer replay creates the illusion of shared state

### Additionally: `TuiThreadContent` Has No Key Either

`TuiThreadContent` itself has no key, so any internal state (`useState`, refs) carries over between different TUI threads.

## Fix

### Primary Fix: Add `key` to force remount on TUI thread switch

In `content-pane.tsx`, add `key={view.threadId}` to the `TuiThreadContent` render:

```tsx
{view.type === "thread" && activeMetadata?.threadKind && (
  <TuiThreadContent key={view.threadId} thread={activeMetadata} />
)}
```

This forces React to fully unmount/remount when switching between TUI threads, ensuring:

- `useState` initializer re-runs with the correct `terminalId`
- xterm.js instance is fully disposed and recreated
- All event subscriptions are fresh for the new terminal
- No stale closures or refs carry over

### Optional: Add key inside TuiThreadContent too (belt and suspenders)

In `tui-thread-content.tsx`:

```tsx
return <TerminalContent key={thread.terminalId} terminalId={thread.terminalId} />;
```

This protects against future cases where `TuiThreadContent` might be reused without a key from the parent.

## Phases

- [x] Add `key={view.threadId}` to `TuiThreadContent` in `content-pane.tsx` (line 162)

- [x] Add `key={thread.terminalId}` to `TerminalContent` inside `tui-thread-content.tsx` (line 21)

- [ ] Verify by opening 2+ TUI threads and switching between them

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Files to Modify

| File | Change |
| --- | --- |
| `src/components/content-pane/content-pane.tsx` | Add `key={view.threadId}` to `TuiThreadContent` (line 162) |
| `src/components/content-pane/tui-thread-content.tsx` | Add `key={thread.terminalId}` to inner `TerminalContent` (line 21) |
