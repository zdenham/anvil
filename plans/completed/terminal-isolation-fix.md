# Terminal Instance Isolation Fix

## Problem

Terminal instances are not fully isolated — switching between terminals shows blank screens (just a flashing cursor) instead of restoring the previous terminal's content.

## Root Cause Analysis (CONFIRMED by diagnostic logs 2026-02-16)

The issue stems from **four independent bugs**, with Bug 5 being the primary user-visible cause:

### Bug 5: `useState` initializer never re-runs on terminal switch (PRIMARY CAUSE — CONFIRMED)

**This is the actual root cause of the "blank screen on switch" behavior.**

`TerminalContent` is rendered at a stable position in the React tree (inside `ContentPane`) with **no `key` prop**:

```tsx
// content-pane.tsx:107-112
{view.type === "terminal" && (
  <TerminalContent
    terminalId={view.terminalId}   // prop changes
    onClose={onClose}
  />
)}
```

When switching from terminal 1 → terminal 2, React **reuses the same component instance** (same type, same tree position). The `terminalId` prop changes, which triggers the `useEffect` cleanup + re-run (the effect has `[terminalId]` in its deps). This correctly disposes the old xterm and creates a new one.

**However**, the `initialBuffer` is captured via `useState`:

```tsx
const [initialBuffer] = useState(
  () => useTerminalSessionStore.getState().outputBuffers[terminalId] || ""
);
```

`useState` initializers only run on **component mount**, not on prop changes. Since React reuses the component, the initializer never re-runs. When switching back to terminal 1, `initialBuffer` still holds the value from the original mount (terminal 1's buffer was empty at first mount) — so the buffer restoration always writes an empty string.

**Log evidence**: At `18:06:07.593`, terminal 1 remounts with `hasInitialBuffer:false` despite the store containing 658 bytes of accumulated output for terminal 1. At `18:06:08.329`, terminal 2 also shows `hasInitialBuffer:false`. Both terminals display only a flashing cursor.

**Fix**: Add `key={view.terminalId}` to force React to fully unmount/remount `TerminalContent` when switching terminals. This makes `useState` re-run its initializer with the correct `terminalId`. Alternatively, replace `useState` with `useMemo` keyed on `terminalId`.

### Bug 1: Broadcast Event Architecture (Rust → Frontend)

In `src-tauri/src/terminal.rs:137`, the Rust backend emits `terminal:output` events as **global broadcasts** via `app_clone.emit()`. Every event goes to every listener. The frontend has **two layers** of listeners for the same event:

1. **App-level listener** (`src/entities/terminal-sessions/listeners.ts:30`): Listens for `terminal:output` and calls `appendOutput(terminalId, text)` to build the scrollback buffer in the Zustand store. This listener correctly filters by `id` — it uses `event.payload.id` to route data to the correct buffer.

2. **Component-level listener** (`src/components/content-pane/terminal-content.tsx:203`): Each mounted `TerminalContent` component also listens for `terminal:output` and filters by `String(id) === terminalId` before writing to its xterm.js instance.

The **component-level filtering works correctly** — it checks `String(id) === terminalId` before writing. So live rendering to the wrong xterm instance does not happen.

### Bug 2: Triple Event Processing Across Webviews (CONFIRMED by logs)

All three webviews (main, spotlight, control-panel) call `setupEntityListeners()` → `setupTerminalListeners()`. Each maintains its own Zustand store and Tauri listener. Every `terminal:output` event is processed **3× independently**:

```
[web] [main]          [TerminalListeners] Appended output to buffer {"terminalId":"1",...}
[web] [spotlight]     [TerminalListeners] Appended output to buffer {"terminalId":"1",...}
[web] [control-panel] [TerminalListeners] Appended output to buffer {"terminalId":"1",...}
```

Only the `[main]` webview renders terminals. The spotlight and control-panel webviews waste resources building buffers nobody reads. This is a performance issue, not a correctness bug, but scoped events (Fix 1) would address it by only registering terminal listeners in the main webview.

### Bug 3: No Event Scoping — All Listeners Receive All Events

Tauri's `emit()` sends events to **all** listeners. Even though each `TerminalContent` component filters by terminal ID, every component still receives and processes every event from every terminal. With many terminals open simultaneously, each event is deserialized N×3 times (N per mounted terminal × 3 webviews).

### Bug 4: Async Listener Registration Leaks on Fast Unmount (CONFIRMED by logs)

Logs show terminal 1 (instance `gvbdny`) initializes at `46.764` and disposes at `46.789` — a 25ms lifecycle (React StrictMode double-render). At `46.823`, the warning fires:

```
[TerminalContent] Listener registered after dispose, cleaning up {"terminalId":"1","instanceId":"gvbdny"}
```

The `disposed` flag + immediate `unlisten()` in the `.then()` callback correctly handles this case — **the diagnostic fix from phase 1 already prevents leaked listeners**. No further action needed for this bug.

### Bug 6: Buffer restoration uses raw escape sequences (quality issue)

Even when `initialBuffer` is correctly read (after fixing Bug 5), the store accumulates raw PTY output including ANSI escape sequences. Replaying this raw buffer can cause visual artifacts (cursor repositioning, partial escape sequences). Serializing the rendered xterm buffer state on unmount would produce cleaner restoration.

## Recommended Fixes

### Fix 0: Add `key` to force remount on terminal switch (CRITICAL — fixes Bug 5)

**This single fix resolves the user-visible "blank screen" bug.** Add a `key` prop so React fully unmounts/remounts `TerminalContent` when the terminal ID changes:

```tsx
// content-pane.tsx
{view.type === "terminal" && (
  <TerminalContent
    key={view.terminalId}          // ← forces remount
    terminalId={view.terminalId}
    onClose={onClose}
  />
)}
```

This ensures `useState(() => store.outputBuffers[terminalId])` re-runs its initializer with the correct terminal ID on every switch. The xterm instance is fully disposed and recreated, eliminating any stale state.

### Fix 1: Use Scoped Event Channels Per Terminal (Rust + Frontend)

Replace the single `terminal:output` broadcast with per-terminal event channels.

**Rust side** (`terminal.rs`): Change the emit call to use a terminal-specific event name:

```rust
// Before:
app_clone.emit("terminal:output", json!({ "id": id, "data": &buf[..n] }));

// After:
app_clone.emit(&format!("terminal:output:{}", id), json!({ "data": &buf[..n] }));
```

Do the same for `terminal:exit` → `terminal:exit:{id}` and `terminal:killed` → `terminal:killed:{id}`.

**Frontend listeners** (`listeners.ts`): Instead of one global listener, register per-terminal listeners when a session is added:

```ts
// When a session is created, listen to its specific channel
listen<TerminalOutputPayload>(`terminal:output:${terminalId}`, (event) => {
  const text = new TextDecoder().decode(new Uint8Array(event.payload.data));
  useTerminalSessionStore.getState().appendOutput(terminalId, text);
});
```

**Component listeners** (`terminal-content.tsx`): Same pattern — listen to `terminal:output:${terminalId}` instead of the global event.

This eliminates all cross-terminal event interference and removes the need for client-side filtering.

### Fix 2: Decouple Buffer Accumulation from Live Rendering

The dual-write pattern (app-level listener writes to store buffer + component listener writes to xterm) creates potential replay duplication. Instead:

**Option A — Component-Owned Buffer**: Remove the app-level output listener entirely. Let the `TerminalContent` component own both xterm rendering and buffer accumulation. When the component unmounts, flush xterm's buffer content to the store for later restoration.

**Option B — Store-Only Buffer with Cursor Tracking**: Keep the app-level listener but track a "last rendered position" per terminal. On remount, only replay buffer content from the cursor position forward instead of replaying the entire buffer.

**Recommended: Option A** — it's simpler, eliminates the dual-listener pattern entirely, and aligns with single-responsibility (the component manages its own terminal's I/O).

### Fix 3: Serialize xterm Buffer on Unmount

When `TerminalContent` unmounts, serialize the xterm buffer state (via `terminal.buffer.active`) rather than relying on the raw output accumulator. This prevents escape sequence artifacts from partial replays.

## Implementation Order

### Fix 0 (key prop) is the highest-priority, lowest-effort fix. It immediately resolves the blank-screen-on-switch bug.

### Fix 1 (scoped events) is the next most impactful fix. It:
- Eliminates all cross-terminal event delivery
- Reduces frontend event processing by N×3 (N terminals × 3 webviews)
- Makes the system correct by construction rather than relying on filtering

### Fix 2 (decouple buffer) addresses potential buffer replay/duplication and should be done alongside Fix 1.

### Fix 3 (serialize xterm state) is a polish fix that prevents escape sequence artifacts in restored buffers.

## Phases

- [x] Add diagnostic logging to trace data flow (terminal-content.tsx, listeners.ts, terminal.rs)
- [x] Reproduce and confirm root cause with diagnostic logs
- [x] Fix Bug 5: Add `key={view.terminalId}` to TerminalContent in content-pane.tsx
- [ ] Implement scoped event channels (Rust emit + frontend listeners)
- [ ] Decouple buffer accumulation from live rendering (Option A)
- [ ] Serialize xterm buffer state on unmount for clean restoration

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/content-pane/content-pane.tsx` | **Add `key={view.terminalId}`** to `TerminalContent` — fixes blank screen bug |
| `src-tauri/src/terminal.rs` | Emit scoped events: `terminal:output:{id}`, `terminal:exit:{id}`, `terminal:killed:{id}` |
| `src/entities/terminal-sessions/listeners.ts` | Register per-terminal listeners on session creation; unregister on archive |
| `src/entities/terminal-sessions/store.ts` | Add listener lifecycle management; optionally add buffer cursor tracking |
| `src/entities/terminal-sessions/service.ts` | Coordinate listener registration with session creation/archival |
| `src/components/content-pane/terminal-content.tsx` | Listen to scoped events; own buffer lifecycle; serialize xterm state on unmount |
