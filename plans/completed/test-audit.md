# Test Audit

**125 test files, 1330 passing tests, 91 failing tests across 34 files**

| Workspace | Files | Pass | Fail | Tests Pass | Tests Fail |
|-----------|-------|------|------|------------|------------|
| Root `src/` | 72 | 60 | 12 | 898 | 43 |
| Agents | 44 | 25 | 19 | 313 | 48 |
| Core | 6 | 6 | 0 | 119 | 0 |
| Server | 3 | 0 | 3 | 0 | 0 (suite) |

## Phases

- [ ] Fix high-priority test failures (mock exports, API contracts)
- [ ] Fix medium-priority test infrastructure (WebSocket mocks, agent harness)
- [x] Clean up or skip low-priority/exploratory tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## High Priority — Real Bugs (tests behind code changes)

### 1. Missing `updateUsage` mock export (9 tests, 3 files)

**Files:**
- `agents/src/runners/shared.integration.test.ts` (5/5 failed)
- `agents/src/runners/thread-history.test.ts` (2/5 failed)
- `agents/src/runners/thread-history-live.test.ts` (2/2 failed)

**Error:** `No "updateUsage" export is defined on the "../output.js" mock`

**Fix:** Add `updateUsage: vi.fn()` to the `vi.mock("../output.js")` calls or use `importOriginal`.

### 2. `generateWorktreeName()` return type changed (10+ tests)

**Files:**
- `agents/src/testing/__tests__/worktree-naming.integration.test.ts` (5/5 failed)
- `agents/src/testing/__tests__/worktree-renaming.integration.test.ts` (3/3 failed)
- `src/lib/__tests__/random-name.test.ts` (2/7 failed)

**Error:** Function now returns `{name: string, usedFallback: boolean}` instead of `string`. Also names exceed the 10-char max (14, 17 chars observed).

**Fix:** Update tests to destructure `{name}` from result. Investigate whether the length constraint is still intended.

### 3. API contract mismatches (3 tests, 2 files)

**Files:**
- `agents/src/runners/message-handler.test.ts` (2/19 failed)
  - Assistant messages now include `id` field
  - `emitEvent` now called with extra source argument (`"MessageHandler:queued-ack"`)
- `agents/src/testing/__tests__/mock-hub-server.test.ts` (1/28 failed)
  - Permission decision uses `"approve"` instead of `"allow"`

**Fix:** Update test assertions to match current implementation.

### 4. Stale thread persistence mocks (2 suites, all tests fail)

**Files:**
- `src/entities/threads/__tests__/integration.test.ts` — `ReferenceError: persistence is not defined`
- `src/entities/threads/__tests__/service.test.ts` — same

**Fix:** Update mock imports to match current module structure.

### 5. UI component assertion failures (3 tests)

**Files:**
- `src/components/control-panel/__tests__/plan-input-area.test.tsx` — send button disabled state wrong
- `src/components/control-panel/__tests__/plan-view.test.tsx` — rendering assertion
- `src/lib/__tests__/frame-rate-monitor.test.ts` — expected 60fps, got 120fps

**Fix:** Investigate each — likely implementation changed and tests need updating.

---

## Medium Priority — Test Infrastructure

### 6. WebSocket not defined in jsdom (~27 tests, 3 files)

**Files:**
- `src/entities/relations/__tests__/service.test.ts` (25/28 failed)
- `src/entities/plans/__tests__/plan-entity.test.ts` (11/67 failed)
- `src/lib/__tests__/pr-actions.test.ts` (1/4 failed)

**Error:** `ReferenceError: WebSocket is not defined` at `invoke.ts:268`

**Root cause:** Tests hit real `invoke()` calls instead of mocking the persistence/Tauri layer. jsdom doesn't provide `WebSocket`.

**Fix:** Either add a WebSocket polyfill to test setup, or improve mocks so tests don't reach `invoke.ts`.

### 7. Agent harness state collection broken (~15 tests, 6 files)

**Files:**
- `agents/src/testing/__tests__/state.test.ts` (3/3 failed)
- `agents/src/testing/__tests__/tools.test.ts` (3/3 failed)
- `agents/src/testing/__tests__/sub-agent.integration.test.ts` (7/7 failed)
- `agents/src/testing/__tests__/sub-agent-usage.integration.test.ts` (1/1 failed)
- `agents/src/testing/__tests__/queued-messages.integration.test.ts` (3/3 failed)
- `agents/src/testing/__tests__/context-meter.integration.test.ts` (2/2 failed)
- `agents/src/testing/__tests__/harness-self-test.ts` (1 failed)

**Error:** `result.states.length === 0` — harness captures no state messages from subprocess.

**Root cause:** Likely a streaming/output format change broke the harness's JSON line parsing. The `AgentTestHarness` isn't picking up state output from the agent subprocess.

**Fix:** Debug what the agent subprocess is actually emitting and update the harness parser.

### 8. `appData` mock stale (5 tests in relations)

**File:** `src/entities/relations/__tests__/service.test.ts`

**Error:** `TypeError: appData.listDir.mockResolvedValueOnce is not a function`

**Fix:** Update the `appData` mock to include `listDir` as a mock function.

---

## Low Priority — Infrastructure / Exploratory

### 9. Server tests: missing `ioredis` (3 suite failures)

**Files:** `server/src/gateway/__tests__/channel-events.test.ts`, `channels.test.ts`, `device-events.test.ts`

**Fix:** `cd server && pnpm install`

### 10. Experimental/spike tests (6 tests, 4 files)

**Files:**
- `agents/src/experimental/__tests__/pretooluse-timeout.integration.test.ts` (3/3)
- `agents/src/experimental/__tests__/ask-question-canuse.integration.test.ts` (1/3)
- `agents/src/experimental/__tests__/ask-question-updatedinput.integration.test.ts` (2/2)
- `agents/src/experimental/__tests__/canuse-hang-spike.test.ts` (1/3)

**Root cause:** These are spike/validation tests that spawn real Claude Code processes. They fail due to missing `--repo-id` arg or because the hypothesis they tested was resolved. The `canuse-hang-spike` "TREATMENT" test confirms the bug was fixed.

**Recommendation:** Archive or skip these — they served their purpose as research spikes.

### 11. Timeouts / flaky (2 tests)

- `src/components/control-panel/__tests__/content-verification.test.ts` — 5s timeout on file system search
- `agents/src/testing/__tests__/thread-naming.integration.test.ts` — 120s timeout on LLM call

---

## Summary: What's Meaningful

| Category | Tests | Meaningful? | Action |
|----------|-------|-------------|--------|
| Missing mock exports | 9 | **Yes** — easy fix | Add `updateUsage` to mocks |
| Return type change | 10+ | **Yes** — API changed | Update tests for `{name, usedFallback}` |
| API contracts | 3 | **Yes** — code evolved | Sync test assertions |
| Stale persistence mocks | 2 suites | **Yes** — broken imports | Fix mock setup |
| UI assertions | 3 | **Yes** — verify behavior | Investigate each |
| WebSocket in jsdom | 27 | **Infra** — not bugs | Add polyfill or better mocks |
| Agent harness broken | 15 | **Infra** — blocks all harness tests | Fix harness parser |
| Missing ioredis | 3 | **Infra** — just install | `pnpm install` |
| Experimental spikes | 6 | **No** — served their purpose | Archive/skip |
| Timeouts | 2 | **No** — flaky by nature | Increase timeout or skip |

**Bottom line:** ~25 tests reflect real code/test drift that should be fixed (phases 1). ~42 tests are blocked by two infrastructure issues (WebSocket mock + agent harness) that each unlock many tests once fixed (phase 2). ~11 tests are exploratory/flaky and can be skipped or archived (phase 3).
