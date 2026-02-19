# Fix Smart Thread Naming (Model Retired)

## Root Cause

`claude-3-5-haiku-20241022` was **retired today (February 19, 2026)**. Requests to retired models fail outright. Both naming services use `claude-3-5-haiku-latest`, which resolved to this now-retired model.

Anthropic's recommended replacement: **`claude-haiku-4-5-20251001`** (aliased as `claude-haiku-4-5`).

Source: [Anthropic Model Deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)

## Affected Files

| File | Issue |
|------|-------|
| `agents/src/services/thread-naming-service.ts:47` | Uses `claude-3-5-haiku-latest` |
| `agents/src/services/worktree-naming-service.ts:49` | Uses `claude-3-5-haiku-latest` |

## Current Error Handling Assessment

The fire-and-forget pattern silently swallows failures:

- **`simple-runner-strategy.ts:575`** — `.catch()` logs a warning, thread stays "New Thread" forever
- **`shared.ts:643`** — `.catch()` logs a warning for sub-agent threads
- **No retry logic** — a single failure permanently loses the name
- **No user-visible feedback** — failures only appear in agent process logs
- **Fallback is silent** — UI shows "New Thread" with no indication naming failed

This is actually why the breakage went unnoticed — the error handling makes it invisible.

## Phases

- [ ] Update model identifier in both naming services
- [ ] Add retry logic and improve error resilience
- [ ] Centralize model constant to prevent future breakage

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Update Model Identifier

Replace `claude-3-5-haiku-latest` → `claude-haiku-4-5-20251001` in:

- `agents/src/services/thread-naming-service.ts` (line 47)
- `agents/src/services/worktree-naming-service.ts` (line 49)

Use the date-stamped version rather than `claude-haiku-4-5` so we get a clear compile-time reference and aren't surprised by future alias changes.

## Phase 2: Add Retry Logic and Improve Error Resilience

Currently a single LLM failure permanently loses the thread name. Add:

1. **Single retry with backoff** — one retry after 2s delay on failure. Keep it simple (not exponential, not configurable). If both attempts fail, fall through to fallback.

2. **Deterministic fallback name** — when LLM fails entirely, generate a usable name from the first ~30 chars of the prompt rather than leaving "New Thread". Truncate at a word boundary.

3. **Structured warning** — emit a more descriptive log when falling back so it's diagnosable:
   ```
   [thread-naming] LLM failed after retry, using fallback: "fix the login..." (error: 404 model not found)
   ```

Implementation in `thread-naming-service.ts` and `worktree-naming-service.ts`.

## Phase 3: Centralize Model Constant

Extract the model identifier to a shared constant so future model migrations are a one-line change:

```typescript
// agents/src/services/naming-config.ts (or similar)
export const NAMING_MODEL = "claude-haiku-4-5-20251001";
```

Both `thread-naming-service.ts` and `worktree-naming-service.ts` import from this single source.
