# Fix anvil-repl Blocking Behavior

## Problem

Thread `4392583d`: agent called `anvil-repl` via Bash with `run_in_background: true`. The hook didn't intercept — shell got exit 127 ("command not found").

### Known gaps

- The repl hook has **no `timeout`** — other hooks set `timeout: 3600`. SDK default is 60s which may fail open.
- The hook **ignores `AbortSignal`** — if the SDK aborts the hook, it continues executing silently.
- The hook has **no `run_in_background` guard** — no defense against backgrounding.

## Phases

- [x] Add timeout and signal handling to repl hook
- [x] Add `run_in_background` guard to repl hook
- [x] Add unit tests for new behavior

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add timeout and signal handling

### `agents/src/runners/shared.ts` — hook registration (~line 578)

Add `timeout: 86400` (24 hours) to the repl hook matcher. The repl is the outer loop of breadcrumb execution and should never time out from the SDK's perspective.

### `agents/src/hooks/repl-hook.ts` — accept signal parameter

Update the hook signature to accept the full SDK hook signature `(hookInput, toolUseId, { signal })`. If signal is already aborted when the hook starts, return deny immediately with an error message.

## Phase 2: Add `run_in_background` guard

### `agents/src/hooks/repl-hook.ts`

Before extracting code, check `toolInput.run_in_background`. If true, return deny with a system message instructing the agent to retry in foreground.

## Phase 3: Unit tests

### `agents/src/hooks/__tests__/repl-hook.test.ts`

1. Verify repl hook denies `run_in_background: true` with correct system message
2. Verify hook handles already-aborted AbortSignal (returns deny)
3. Verify existing foreground behavior unchanged
