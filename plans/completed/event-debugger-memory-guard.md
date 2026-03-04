# Event Debugger Memory Guard

## Context

The event debugger is already opt-in (`isCapturing` defaults to `false`). The UI has Record/Stop buttons. Just need a Clear button to flush the buffer when done.

## Phases

- [x] Add a Clear button to the event debugger toolbar that calls `clearEvents()`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Clear Button

**File:** `src/components/debug-panel/event-list.tsx`

- Add a Clear button next to the existing Record/Stop controls
- Wired to `clearEvents()` from `event-debugger-store.ts`
- Disabled when buffer is empty
