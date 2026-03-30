# Progress 002

## Done
- Created `sidecar/src/__tests__/hook-lifecycle-sequence.test.ts` — 4 tests exercising full lifecycle via direct HTTP (no CLI/API key needed, runs in CI)
  - Full sequence: INIT → APPEND_USER_MESSAGE → MARK_TOOL_RUNNING → MARK_TOOL_COMPLETE → COMPLETE with state assertions at each step
  - Multi-tool tracking: verifies independent tool state management and file change extraction
  - Broadcast verification: confirms all action types are broadcast with full payloads
  - Event timestamp ordering: verifies ascending order in events.jsonl
- Strengthened `hook-lifecycle.integration.test.ts` assertions:
  - Single-turn test now verifies user message content in state.json
  - Tool test now verifies toolName in state, full event sequence ordering (TOOL_STARTED < TOOL_COMPLETED < SESSION_ENDED), and event payload fields
- All new tests pass (4/4 sequence tests, 3/3 integration tests skipped without API key as expected)

## Remaining
- Pre-existing `agent-hub-roundtrip.test.ts` failure is unrelated (timeout + response ID mismatch)
- Could add tests for error paths (tool_result_is_error: true, denied tools producing TOOL_DENIED events)
- Could add test for transcript sync in post-tool-use/stop hooks (requires mock transcript file)

## Context
- The sequence tests are fast (~60ms total) since they hit the hook routes directly without spawning CLI
- The integration tests still require ANTHROPIC_API_KEY + claude CLI and are auto-skipped in CI
