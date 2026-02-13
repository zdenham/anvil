# Test Speed Optimization Plan

## Current State

Total test execution across the three packages:

| Package | Wall Time | Test Time | Tests | Failures |
|---------|-----------|-----------|-------|----------|
| Root (`pnpm test`) | ~62s | 182s | 1381 | 89 (17 files crash) |
| Agents (`cd agents && pnpm test`) | ~6m25s | 1377s | 234 | 16 |
| SDK (`cd core/sdk && pnpm test`) | ~2s | 3.8s | 48 | 0 |

Root test breakdown (sorted by test time):

| Test File | Tests | Duration |
|-----------|-------|----------|
| `agents/src/testing/__tests__/sub-agent.integration.test.ts` | 11 | **246s** |
| `agents/src/testing/__tests__/plan-thread-relations.integration.test.ts` | 7 | **130s** |
| `agents/src/testing/__tests__/plan-detection.integration.test.ts` | 5 | **84s** |
| `core/adapters/node/git-adapter.test.ts` | 26 | **83s** |
| `agents/src/testing/__tests__/events.test.ts` | 2 | **34s** |
| `agents/src/testing/__tests__/context-meter.integration.test.ts` | 2 | **33s** |
| `agents/src/testing/__tests__/skills.integration.test.ts` | 26 | **16s** |
| `src/components/control-panel/__tests__/content-verification.test.ts` | 7 | **13s** |
| `src/__tests__/build-verification.test.ts` | 2 | **5s** |
| Everything else (96 files, ~1200 tests) | | **<20s total** |

**The top 6 files account for ~610s of the ~615s total test time.**

---

## Root Causes (Ranked by Impact)

### 1. Live LLM API calls in integration tests (~500s)

**Files affected:** `sub-agent.integration.test.ts`, `plan-thread-relations.integration.test.ts`, `plan-detection.integration.test.ts`, `events.test.ts`, `context-meter.integration.test.ts`, `queued-messages.integration.test.ts`, `thread-history-live.test.ts`

These tests spawn real agent processes via `AgentTestHarness` which calls the Anthropic API. Each test takes 10-60s waiting for API responses. Sub-agent tests are worst because they spawn nested agent processes (parent spawns child).

Per-test timeouts are set extremely high: 120-240 seconds.

### 2. `pnpm test` runs ALL packages in a single vitest instance (~460s wasted)

The root `vitest.config.ts` has no `include`/`exclude` patterns, so vitest's default glob (`**/*.test.{ts,tsx}`) picks up:
- All `src/` tests (correct)
- All `core/` tests (correct)
- All `agents/` tests (redundant - agents has its own vitest config and `pnpm test`)
- All `core/sdk/` tests (redundant - sdk has its own vitest config and `pnpm test`)

This means **the entire agents integration suite (sub-agent, plan-detection, etc.) runs TWICE** - once via `pnpm test` in root and once via `cd agents && pnpm test`. The root run also uses the wrong vitest config for agents tests (root config uses `jsdom` environment, agents config uses `node`).

This also causes the 5+ "Worker exited unexpectedly" crashes - the agents tests call `process.exit(1)` which kills the vitest worker fork, because they're running in the wrong environment.

### 3. Git operations via `spawnSync` in `git-adapter.test.ts` (~83s)

26 tests, each creating temp directories + running multiple `git init`, `git add`, `git commit`, `git branch`, `git worktree add` via `spawnSync`. Each git operation spawns a new process. With ~5-10 git calls per test, that's 130-260 process spawns.

### 4. Filesystem-scanning "verification" tests (~18s)

- `content-verification.test.ts` (13s): Uses `glob()` to scan the entire project 7 times (once per test), reading every `.ts`, `.tsx`, `.rs`, `.json`, and `.html` file to check for stale naming conventions.
- `build-verification.test.ts` (5s): Runs `cargo check` as a subprocess.

These are essentially linting rules being enforced as test cases.

### 5. jsdom environment overhead (~29s total setup)

The root config uses `environment: "jsdom"` for ALL tests, even pure-logic tests that don't need DOM. jsdom initialization is expensive (~250ms per test file). The separate `vitest.config.ui.ts` uses `happy-dom` which is faster, but the root config still forces jsdom.

---

## Optimization Recommendations

### Phase 1: Fix test boundaries (largest win, easiest change)

**Add include/exclude to root `vitest.config.ts`** to stop running agents and SDK tests redundantly:

```ts
test: {
  environment: "jsdom",
  setupFiles: ["./src/test/setup.ts"],
  globals: true,
  include: [
    "src/**/*.test.{ts,tsx}",
    "core/**/*.test.{ts,tsx}",
  ],
  exclude: [
    "core/sdk/**",           // Has its own vitest config
    "**/node_modules/**",
  ],
}
```

**Expected savings: ~460s of test time eliminated** from root run (all agent tests + SDK tests stop running there). Root run drops from ~62s wall time to ~20-25s. Worker crashes also stop.

### Phase 2: Separate slow integration tests from fast unit tests

**Tag agent integration tests** so they don't run by default:

Option A: Move integration tests to a separate directory and add a `test:integration` script:
```json
{
  "test": "vitest run --exclude '**/integration*'",
  "test:integration": "vitest run --include '**/integration*'",
  "test:all": "vitest run"
}
```

Option B: Use Vitest's `pool` sequencing to at least run integration tests after unit tests complete, so fast feedback comes first.

**Expected savings:** Fast `pnpm test` in agents drops from 6m25s to ~5s (only unit tests). Integration tests still available via `test:integration`.

### Phase 3: Reduce git-adapter test overhead

The `git-adapter.test.ts` file creates a fresh git repo with worktrees for every test via `beforeEach`. Options:

- **Share repo across tests in the same describe block**: Create the repo once in `beforeAll` and only do per-test operations in `beforeEach`. Many tests only need a clean worktree, not a clean repo.
- **Use `--bare` repos** where possible to skip working tree creation overhead.
- **Batch git operations**: Use multi-arg git commands instead of sequential `spawnSync` calls.

**Expected savings: 60-70s** (reduce from ~83s to ~15s).

### Phase 4: Convert verification tests to linting

- `content-verification.test.ts`: Replace with a grep-based lint script or ESLint rule. The glob + readFileSync pattern is scanning thousands of files 7 times.
- `build-verification.test.ts`: Move `cargo check` to a CI-only script or pre-commit hook. It shouldn't block `pnpm test`.

**Expected savings: ~18s**.

### Phase 5: Environment optimization

**Use `environment: "node"` as the default** in root `vitest.config.ts`, and only set `environment: "jsdom"` for files that need it:

```ts
test: {
  environment: "node",  // Default to node (fast)
  environmentMatchGlobs: [
    ["src/components/**", "jsdom"],  // Only UI components need jsdom
    ["src/hooks/**/*.ui.test.*", "happy-dom"],
  ],
}
```

Alternatively, annotate individual test files with `// @vitest-environment jsdom` where needed.

**Expected savings: ~20s** (avoids jsdom setup for pure-logic tests).

### Phase 6: Mock the LLM in integration tests that don't need it live

Several integration tests already have a `MOCK_LLM_VAR` mechanism. Ensure ALL default test runs use mocked LLM. Live API tests should be opt-in only (e.g., `pnpm test:live`).

Currently, tests check `process.env.ANTHROPIC_API_KEY` and skip if missing. But if the key IS set (common in dev), all live tests run. Flip the default: require an explicit `RUN_LIVE_TESTS=1` flag.

**Expected savings: 300-500s** when API key is present.

---

## Summary of Expected Gains

| Optimization | Current | After | Savings |
|-------------|---------|-------|---------|
| Phase 1: Fix test boundaries | 62s root | ~20s root | **~42s** |
| Phase 2: Separate integration tests | 6m25s agents | ~5s agents (unit only) | **~6m20s** |
| Phase 3: Optimize git-adapter | 83s | ~15s | **~68s** |
| Phase 4: Remove verification tests | 18s | 0s (moved to lint) | **~18s** |
| Phase 5: Environment optimization | 29s env setup | ~5s env setup | **~24s** |
| Phase 6: Opt-in live LLM tests | 500s when key present | 0s (opt-in) | **~500s** |

**After all phases: `pnpm test` completes in ~10-15s** (down from 62s root + 6m25s agents).

---

## Phases

- [ ] Fix root vitest.config.ts include/exclude to stop running agents and SDK tests (Phase 1)
- [ ] Add `test:integration` and `test:unit` scripts to agents package.json (Phase 2)
- [ ] Optimize git-adapter.test.ts to share repo setup across tests (Phase 3)
- [ ] Move content-verification and build-verification to lint scripts (Phase 4)
- [ ] Set default environment to node, use environmentMatchGlobs for jsdom (Phase 5)
- [ ] Make live LLM tests opt-in with RUN_LIVE_TESTS flag (Phase 6)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->
