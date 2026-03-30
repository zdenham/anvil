# Progress 001

## Done
- Created `sidecar/src/testing/sidecar-test-harness.ts` — SidecarTestHarness class
- Created `sidecar/src/__tests__/hook-lifecycle.integration.test.ts` — 3 integration tests
- All 3 integration tests pass against real claude CLI + isolated sidecar
- Tests auto-skip when ANTHROPIC_API_KEY or claude CLI is unavailable

## Remaining
- Acceptance criteria mentions testing for `INIT → APPEND_USER_MESSAGE → COMPLETE` action sequence, but `-p` mode doesn't fire `SessionStart` (so no INIT action). Tests verify state/events from the hooks that do fire.
- Could add more granular assertions on the user message content in state.json
- Could add test for denied tool producing TOOL_DENIED event (would need a prompt that triggers a denied tool)

## Context
- `--plugin-dir` must point to the **parent** directory (e.g., `dataDir`), not the `hooks/` subdirectory. Claude Code looks for `<plugin-dir>/hooks/hooks.json`.
- In `-p` mode, the hook sequence is: `UserPromptSubmit → PreToolUse → PostToolUse → Stop`. `SessionStart` does NOT fire.
- The `ThreadStateWriter` auto-initializes state on first action, so state.json gets created even without the INIT action from SessionStart.
- Pre-existing test failure in `agent-hub-roundtrip.test.ts` is unrelated to this work.
