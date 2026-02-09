# Terminal UI Fixes Plan

## Problem

### Flashing on Keystroke
**Symptom**: Terminal flashes/flickers every time you type. The zsh `%` marker (PROMPT_EOL_MARK) appears on every new line because the terminal is being constantly recreated.

**Root Cause**: The `outputBuffer` is in the useEffect dependency array (`terminal-content.tsx:223`):
```typescript
}, [terminalId, handleInput, handleResize, outputBuffer]);
```

Every keystroke triggers this chain:
1. User types → PTY echoes keystroke back as `terminal:output` event
2. Global listener (`listeners.ts:38`) appends to `outputBuffers` in Zustand store
3. Component subscribes to `outputBuffer` via `useTerminalSessionStore` (line 73-75)
4. Changed `outputBuffer` triggers useEffect re-run
5. useEffect **disposes and recreates the entire xterm.js Terminal instance**
6. Flash occurs as DOM is torn down and rebuilt
7. The `%` marker appears because zsh detects incomplete line endings during recreation

---

## Solution

### Remove `outputBuffer` from useEffect Dependencies

The buffer should only be used **once at mount time** for reconnection scenarios (closing and reopening a terminal pane). It should NOT cause re-renders during live usage.

**Change in `terminal-content.tsx`**:

```typescript
// BEFORE (line 72-75):
const outputBuffer = useTerminalSessionStore(
  (state) => state.outputBuffers[terminalId] || ""
);

// AFTER - use a ref to capture initial value only:
const initialBufferRef = useRef<string | null>(null);
if (initialBufferRef.current === null) {
  initialBufferRef.current = useTerminalSessionStore.getState().outputBuffers[terminalId] || "";
}
```

Then update the useEffect:
1. Use `initialBufferRef.current` instead of `outputBuffer` for buffer restoration
2. Remove `outputBuffer` from the dependency array

---

## Phases

- [x] Fix outputBuffer dependency causing re-renders
- [ ] Test terminal no longer flashes on input
- [ ] Verify scrollback restoration still works on pane reopen

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/content-pane/terminal-content.tsx` | Use ref for initial buffer, remove from deps |

## Risk

Low - this is a targeted fix that doesn't change the data flow, only when React re-renders occur.
