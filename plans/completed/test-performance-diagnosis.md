# Test Performance Diagnosis

Slow tests hurt the coding agent's feedback loop — every extra second in `pnpm test` is a second the agent waits before iterating. This plan diagnoses where time is spent and identifies actionable fixes.

## Phases

- [x] Measure: collect baseline timing data across all test suites
- [x] Analyze: identify the slowest tests and root causes
- [x] Fix: apply targeted optimizations
- [x] Validate: confirm improvements with before/after numbers

**Results:** [`test-diagnostics/RESULTS.md`](../test-diagnostics/RESULTS.md) (gitignored, raw logs in same directory)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Measure

Collect wall-clock and per-file timing for every test suite. We need hard numbers before making changes.

### Commands to run

```bash
# Frontend unit/integration tests — verbose timing
pnpm test -- --reporter=verbose 2>&1 | tee /tmp/anvil-test-timing.log

# UI isolation tests
pnpm test:ui -- --reporter=verbose 2>&1 | tee /tmp/anvil-test-ui-timing.log

# Agent tests
cd agents && pnpm test -- --reporter=verbose 2>&1 | tee /tmp/anvil-test-agents-timing.log

# SDK tests
cd core/sdk && pnpm test -- --reporter=verbose 2>&1 | tee /tmp/anvil-test-sdk-timing.log
```

### What to record

For each suite, note:
- **Total wall-clock time** (the number Vitest prints at the end)
- **Top 5 slowest individual test files** (look for files taking >1s)
- **Setup/teardown overhead** (time before first test runs)
- **Any tests that are skipped** (53 `.skip` tests found — are they hiding expensive setup?)

## Phase 2: Analyze

With timing data in hand, investigate the likely culprits below. Each is a known pattern in this codebase that can cause slowness.

### Suspect 1: Agent integration tests spawn subprocesses

- **Where**: `agents/src/testing/__tests__/*.integration.test.ts` (12+ files)
- **Why slow**: `AgentTestHarness` calls `spawn("tsx", ...)` per test, boots a full Node process, sets up a `MockHubServer` socket, and waits up to 60s (`testTimeout: 60000`).
- **Investigate**: How many integration tests run during `pnpm test` in the agents workspace? Are they all spawning subprocesses? Could any be converted to unit tests using `MockClaudeClient` instead?

### Suspect 2: Test isolation overhead in frontend tests

- **Where**: `src/test/setup.ts`, `src/test/mocks/tauri-api.ts`
- **Why slow**: Every test runs `resetAllMocks()`, `TestStores.clear()`, `setupEntityListeners()` in `beforeEach`. With 90+ test files this adds up.
- **Investigate**: Profile `beforeEach` time. Is `setupEntityListeners()` doing expensive work (subscriptions, timers)? Is `resetAllMocks()` re-registering mocks from scratch?

### Suspect 3: jsdom environment for non-DOM tests

- **Where**: Root `vitest.config.ts` uses `environment: 'jsdom'`
- **Why slow**: jsdom is heavy. Any test file matched by the root config that doesn't need a DOM (e.g., pure service tests in `core/services/`) pays the jsdom boot cost for nothing.
- **Investigate**: Which test files matched by root config are pure logic tests? Could they run with `environment: 'node'` instead (via per-file `// @vitest-environment node` comments or a separate config)?

### Suspect 4: Vitest config overlap / double-running

- **Where**: Root config includes `src/**/*.test.ts`, UI config includes `src/**/*.ui.test.tsx`
- **Why slow**: If `pnpm test` (root config) also matches `.ui.test.tsx` files, those tests run twice — once under jsdom and once under happy-dom.
- **Investigate**: Check the root config's include/exclude patterns. Does it exclude `.ui.test.tsx` files? If not, this is an easy win.

### Suspect 5: SDK integration tests spawn processes

- **Where**: `core/sdk/__tests__/integration/*.test.ts`
- **Why slow**: `runQuickAction()` spawns a subprocess per test. Each creates a temp `.anvil` directory, runs the action, captures stdout.
- **Investigate**: How many integration tests exist? What's their per-test overhead? Could fixtures be shared across tests in the same file?

### Suspect 6: Serial vs parallel execution

- **Where**: All vitest configs
- **Why slow**: Vitest runs test files in parallel by default but tests within a file run serially. If one file has many slow tests, it becomes a bottleneck.
- **Investigate**: Are there test files with 10+ tests that each take >500ms? Are any configs setting `sequence` or `pool` options that limit parallelism? Check for `--no-threads` or `singleThread` settings.

### Suspect 7: The EPIPE handler in test startup

- **Where**: Root package.json: `NODE_OPTIONS='--require ./src/test/epipe-handler.cjs'`
- **Why slow**: Adds a `--require` that runs before Vitest even starts. Probably negligible but worth checking.
- **Investigate**: Read `src/test/epipe-handler.cjs` — is it doing anything expensive?

## Phase 3: Fix

Based on analysis findings, apply fixes in priority order (highest impact first):

### CRITICAL: `pnpm test` runs in watch mode

> **This is the single most dangerous finding.** The root `package.json` line 23 defines:
> ```
> "test": "NODE_OPTIONS='--require ./src/test/epipe-handler.cjs' vitest"
> ```
> That's `vitest` — **watch mode**, not `vitest run`. This means:
>
> - **Every `pnpm test` invocation starts a persistent file watcher** that never exits on its own
> - **Multiple agents running simultaneously = multiple watchers** on the same files
> - **Any file edit by one agent re-triggers test runs in all other agents' watchers** — cascading re-runs across every concurrent agent
> - **Agents hang** waiting for the process to exit (watch mode waits for stdin)
>
> The agents and SDK workspaces already use `vitest run` correctly. The root is the outlier.
>
> **Fix:** Change to `vitest run`. Add a separate `test:watch` script for interactive use (matching the existing `test:ui` / `test:ui:watch` convention already in the file).

### High impact (likely)
1. **Change `pnpm test` from `vitest` to `vitest run`** — eliminates watch-mode cross-agent interference. This is a one-line fix with massive impact on multi-agent stability.
2. **Scope root vitest config to `src/` only** — add `include: ["src/**/*.test.{ts,tsx}"]` and `exclude: ["src/**/*.ui.test.{ts,tsx}"]`. Currently matches all 124 files across the monorepo (agents, SDK, core) under jsdom, causing 97 failures, worker crashes, and 60s of wasted time.
3. **Split agent integration tests into a separate test command** so they don't block the fast feedback loop.
4. **Switch pure-logic tests to `node` environment** to avoid jsdom overhead.

### Medium impact (depends on findings)
4. **Share fixtures across tests** in SDK integration files instead of creating/destroying per test.
5. **Reduce `beforeEach` overhead** — lazy-init expensive mocks, only reset what each test touches.
6. **Convert subprocess-based agent tests to unit tests** where the subprocess isn't actually needed (i.e., the test is really testing logic, not process lifecycle).

### Low impact (polish)
7. **Increase parallelism** — ensure no configs are accidentally serializing test files.
8. **Add `--bail` or `--reporter=dot`** to agent test commands for faster feedback in CI.

## Phase 4: Validate

After applying fixes:

```bash
# Re-run all suites, compare wall-clock times to Phase 1 baselines
pnpm test -- --reporter=verbose 2>&1 | tee /tmp/anvil-test-timing-after.log
pnpm test:ui -- --reporter=verbose 2>&1 | tee /tmp/anvil-test-ui-timing-after.log
cd agents && pnpm test -- --reporter=verbose 2>&1 | tee /tmp/anvil-test-agents-timing-after.log
cd core/sdk && pnpm test -- --reporter=verbose 2>&1 | tee /tmp/anvil-test-sdk-timing-after.log
```

Record improvements per suite. Target: **50%+ reduction in total test wall-clock time** for the suites the coding agent runs most often (`pnpm test` and `pnpm test:ui`).
