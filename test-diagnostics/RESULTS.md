# Test Performance Diagnostic Results

**Date:** 2026-02-16
**Machine:** macOS Darwin 25.2.0

---

## Executive Summary

The root `pnpm test` command has **two critical misconfigurations**:

### 1. Watch mode in multi-agent environment (CRITICAL)

`pnpm test` runs `vitest` (watch mode), NOT `vitest run`. This means:
- **Every invocation starts a persistent file watcher** that never exits
- **Multiple simultaneous agents each spawn their own watcher** on the same files
- **Any file edit by one agent re-triggers test runs in all other agents' watchers** — cascading re-runs, interleaved output, wasted CPU
- **Agent processes hang** waiting for watch mode to exit (it won't — it's waiting for stdin)

The agents and SDK workspaces already use `vitest run`. The root is the outlier.

### 2. No include scope — matches entire monorepo

The root config has no `include` pattern, so it matches all 124 test files (agents, SDK, core, frontend, UI) under a single jsdom environment. This causes:
- **66s wall-clock time** for `pnpm test` (should be ~5s for just frontend tests)
- **97 test failures** (many due to wrong environment — jsdom instead of node)
- **Worker crashes** from agent tests calling `process.exit()` inside Vitest workers
- **Live LLM API calls** running during every `pnpm test` invocation (costing real money)

**The two highest-impact fixes:** (1) Change `vitest` to `vitest run` in root test script, (2) Add `include` patterns to scope root config to `src/` files only.

---

## Baseline Measurements

### Root: `pnpm test` (vitest run)

| Metric | Value |
|--------|-------|
| **Wall-clock time** | **66.14s** |
| Test files | 124 (18 failed, 97 passed) |
| Individual tests | 1521 (97 failed, 1361 passed, 1 skipped) |
| Unhandled errors | 12 |
| Transform time | 4.49s |
| Setup time | 4.58s |
| Import time | 12.66s |
| Test execution time | 200.02s (parallelized down to 66s) |
| Environment init time | 29.50s |

**Critical finding:** Root config has NO `include` pattern, so Vitest's default glob (`**/*.test.{ts,tsx}`) matches ALL test files in the repo — including `agents/`, `core/sdk/`, and `.ui.test.tsx` files. This means:
- Agent tests run under jsdom (wrong — they need `node`)
- SDK integration tests run under jsdom (wrong — they need `node`)
- UI tests (`.ui.test.tsx`) run under jsdom (wrong — they need `happy-dom`), AND they also run separately under `pnpm test:ui`
- Agent tests that call `process.exit()` crash Vitest worker forks

### UI Tests: `pnpm test:ui` (vitest run --config vitest.config.ui.ts)

| Metric | Value |
|--------|-------|
| **Wall-clock time** | **4.80s** |
| Test files | 23 (2 failed, 21 passed) |
| Individual tests | 311 (12 failed, 299 passed) |
| Transform time | 6.30s |
| Setup time | 9.98s |
| Import time | 9.20s |
| Test execution time | 4.35s |
| Environment init time | 6.34s |

**Note:** The 2 failing test files (`thread-with-diffs.ui.test.tsx`, `plan-and-changes-tabs.ui.test.tsx`) are pre-existing test failures, not environment issues.

### Agent Tests: `cd agents && pnpm test` (vitest run)

| Metric | Value |
|--------|-------|
| **Wall-clock time** | **~3-4 min** (killed before summary printed) |
| Test files | 27 |
| Live LLM test files | 8+ |
| Node environment | Correct |

**Key finding:** Agent tests include **8+ live LLM integration tests** that make real Anthropic API calls. Each takes 12-48 seconds. These run during every `pnpm test` invocation from root.

### SDK Tests: `cd core/sdk && pnpm test` (vitest run)

| Metric | Value |
|--------|-------|
| **Wall-clock time** | **13.30s** |
| Test files | 7 (all passed) |
| Individual tests | 48 (all passed) |
| Transform time | 133ms |
| Setup time | 0ms |
| Import time | 211ms |
| Test execution time | 41.86s (parallelized down to 13s) |
| Environment init time | 0ms |

**Note:** SDK tests spawn subprocesses (`runQuickAction()`) — each integration test takes 1.5-3.5s. This is acceptable for their workspace-scoped run.

---

## Slowest Individual Tests (>1s)

### Category 1: Live LLM Tests (10-48s each)

These tests make real Anthropic API calls and are the most expensive:

| Test File | Test Name | Duration | Status |
|-----------|-----------|----------|--------|
| `agents/.../plan-thread-relations.integration.test.ts` | persists "created" relation | **47,783ms** | Passed |
| `agents/.../plan-detection.integration.test.ts` | emits PLAN_DETECTED event | **39,137ms** | Passed |
| `agents/.../tools.test.ts` | uses Read tool to inspect files | **39,926ms** | Failed (timeout) |
| `agents/.../state.test.ts` | transitions from running to complete | **40,745ms** | Failed |
| `agents/.../events.test.ts` | emits thread:created on startup | **30,004ms** | Failed (timeout) |
| `agents/.../context-meter.integration.test.ts` | emits token usage | **28,414ms** | Passed |
| `agents/.../queued-messages.integration.test.ts` | schedules queued messages | **25,746ms** | Failed |
| `agents/.../thread-history-live.test.ts` | should NOT know UUID (control) | **16,697ms** | Failed |
| `agents/.../thread-history-live.test.ts` | should remember UUID | **12,730ms** | Failed |
| `agents/.../skills.integration.test.ts` | creates skill fixtures | **11,360ms** | Passed |

### Category 2: Subprocess/Git Tests (1-16s each)

| Test File | Test Name | Duration | Status |
|-----------|-----------|----------|--------|
| `agents/.../harness-self-test.ts` | removes directory on cleanup | **16,362ms** | Passed |
| `core/adapters/node/git-adapter.test.ts` | should remove worktree | **15,449ms** | Failed |
| `src/__tests__/build-verification.test.ts` | cargo check compiles | **14,314ms** | Passed |
| `core/services/git/branch-service.test.ts` | delete - should handle errors | **13,806ms** | Failed |
| `core/services/git/branch-service.test.ts` | create - should handle duplicates | **13,756ms** | Passed |
| `agents/.../harness-self-test.ts` | initializes git repository | **12,848ms** | Passed |

### Category 3: SDK Subprocess Tests (1-3.5s each)

| Test File | Test Name | Duration |
|-----------|-----------|----------|
| `core/sdk/.../debug.test.ts` | shows resolved paths | 3,520ms |
| `core/sdk/.../next-unread.test.ts` | works from any context type | 3,564ms |
| `core/sdk/.../close-panel.test.ts` | emits ui:closePanel event | 2,533ms |
| `core/sdk/.../archive.test.ts` | emits thread:archive event | 2,536ms |
| `core/sdk/.../mark-unread.test.ts` | emits events | 3,521ms |
| `core/sdk/.../error-handling.test.ts` | invalid action returns error | 2,007ms |

---

## Root Cause Analysis

### Finding 1: Root Config Matches Everything (CRITICAL)

**Impact: Adds ~60s to every `pnpm test` run**

`vitest.config.ts` has no `include` pattern:
```ts
test: {
  environment: "jsdom",
  setupFiles: ["./src/test/setup.ts"],
  globals: true,
}
```

Without `include`, Vitest defaults to `**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}`, which matches **all 124 test files** across the monorepo:
- 41 files in `agents/`
- 7 files in `core/sdk/`
- 21 `.ui.test.tsx` files (also run by `pnpm test:ui`)
- 2 files in `core/adapters/` and `core/services/`
- 1 build verification test
- ~52 files in `src/` (the actual intended scope)

This causes:
1. **Wrong environment**: Agent/SDK tests forced into jsdom → failures
2. **Double-running**: UI tests run twice (once in jsdom, once in happy-dom)
3. **Worker crashes**: Agent `runner.ts` calls `process.exit(1)` → kills Vitest workers
4. **API costs**: Live LLM tests run on every `pnpm test` invocation

### Finding 2: Live LLM Tests Not Gated (HIGH)

**Impact: ~3 minutes of API calls per agent test run**

8+ agent integration tests make real Anthropic API calls. They ARE gated behind `process.env.ANTHROPIC_API_KEY` checks, but any developer with the key set (which is everyone) runs them on every `pnpm test`.

There is no separate `test:integration` script in the agents workspace. All tests — unit and live LLM — run together.

### Finding 3: jsdom Environment for Non-DOM Tests (MEDIUM)

**Impact: ~30s of environment init time in root tests**

The root config uses `environment: "jsdom"` for all matched files. The Duration breakdown shows **29.50s spent in environment initialization** — this is jsdom being spun up for every test file, including pure logic tests that don't need a DOM.

Files in `src/` that are pure logic and don't need jsdom:
- `src/lib/__tests__/random-name.test.ts`
- `src/entities/plans/__tests__/plan-entity.test.ts`
- `src/entities/settings/settings.test.ts`
- `src/hooks/__tests__/use-tree-data.test.ts`
- `src/components/permission/use-permission-keyboard.test.ts`
- `src/__tests__/build-verification.test.ts`
- `src/entities/relations/__tests__/service.test.ts`
- `src/components/control-panel/__tests__/content-verification.test.ts`
- `src/components/control-panel/__tests__/naming-verification.test.ts`

### Finding 4: Agent Tests Call process.exit() (HIGH)

**Impact: Worker crashes, 12 unhandled errors**

`agents/src/runner.ts:400` calls `process.exit(1)`. When this code is imported by Vitest workers (because root config matches agent test files), it crashes the workers:
```
Error: process.exit unexpectedly called with "1"
Caused by: Worker exited unexpectedly
```

This causes **12 unhandled "Worker forks emitted error" messages** that slow down and destabilize the test run.

### Finding 5: UI Tests Partially Failing (LOW)

**Impact: 12 tests failing, likely pre-existing**

2 UI test files fail:
- `thread-with-diffs.ui.test.tsx` — tests look for `data-testid="inline-diff--src-foo-ts"` but the rendered component uses `data-testid="edit-tool-edit-1"`. Likely a component refactor that didn't update tests.
- `plan-and-changes-tabs.ui.test.tsx` — similar test/component mismatch.

### Finding 6: Missing Mock Export in Agent Tests (MEDIUM)

**Impact: 10+ agent tests failing**

Multiple agent tests fail with:
```
[vitest] No "updateUsage" export is defined on the "../output.js" mock
```

The mock for `output.js` is missing the `updateUsage` function. This affects `shared.integration.test.ts`, `thread-history.test.ts`, and `thread-history-live.test.ts`.

---

## Recommended Fixes (Priority Order)

### 1. Scope Root Config to `src/` Only (CRITICAL — ~60s savings)

Add `include` and `exclude` to `vitest.config.ts`:
```ts
test: {
  environment: "jsdom",
  setupFiles: ["./src/test/setup.ts"],
  globals: true,
  include: ["src/**/*.test.{ts,tsx}"],
  exclude: ["src/**/*.ui.test.{ts,tsx}", "node_modules"],
}
```

This:
- Stops matching agent/SDK/core tests
- Excludes `.ui.test.tsx` files (they have their own config)
- Drops test count from 1521 → ~370 tests
- Eliminates worker crashes from agent `process.exit()`
- Stops double-running UI tests

**Expected improvement: 66s → ~5-10s**

### 2. Split Agent Integration Tests (HIGH — removes API cost)

Add to `agents/package.json`:
```json
"test": "vitest run --exclude 'src/testing/__tests__/*.integration.test.ts' --exclude 'src/runners/*-live.test.ts'",
"test:integration": "vitest run --include 'src/testing/__tests__/*.integration.test.ts' 'src/runners/*-live.test.ts'"
```

This separates fast unit tests (~1s) from slow live LLM tests (~3min).

### 3. Switch Pure-Logic Tests to Node Environment (MEDIUM — ~15s savings)

Add `// @vitest-environment node` to test files that don't need jsdom. This eliminates jsdom boot cost (~250ms per file × ~10 files = ~2.5s direct savings, plus reduced contention).

### 4. Fix Missing `updateUsage` Mock (MEDIUM — correctness)

Add `updateUsage` to the agent test mock for `output.js`. This fixes 10+ test failures.

### 5. Fix UI Test Failures (LOW — correctness)

Update test IDs in `thread-with-diffs.ui.test.tsx` to match current component output.

---

## Raw Log Files

All raw verbose test output is preserved in this directory:
- `root-tests-verbose.log` — First root run (watch mode, partial)
- `root-tests-run.log` — Clean `vitest run` output with full summary
- `ui-tests-verbose.log` — UI test suite
- `agents-tests-verbose.log` — Agent test suite
- `sdk-tests-verbose.log` — SDK test suite
