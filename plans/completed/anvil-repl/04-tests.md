# Phase 4: Tests

## Unit Tests

### `agents/src/lib/anvil-repl/__tests__/repl-runner.test.ts`

Test `AnvilReplRunner`:
- `extractCode()` — heredoc extraction, quoted string extraction, non-anvil-repl passthrough returns null
- `execute()` — simple return value, anvil.log() capture, async code, error handling (syntax error, runtime error)
- `formatResult()` — success formatting, error formatting, truncation at 50KB

### `agents/src/lib/anvil-repl/__tests__/child-spawner.test.ts`

Test `ChildSpawner` (mock `child_process.spawn` and filesystem):
- Creates correct thread metadata on disk
- Emits `thread:created` event
- Spawns process with correct CLI args
- Reads result from child's state.json after exit
- Handles child process errors (non-zero exit, missing state.json)
- Result truncation works

### `agents/src/hooks/__tests__/repl-hook.test.ts`

Test the PreToolUse hook:
- Passes through non-anvil-repl bash commands (`{ continue: true }`)
- Intercepts anvil-repl commands and returns deny with result
- Handles invalid anvil-repl syntax (no code body)
- Formats error correctly when code execution fails

## Integration Test (optional, live API)

### `agents/src/lib/anvil-repl/__tests__/repl-integration.test.ts`

Guard with `process.env.ANTHROPIC_API_KEY`:
- Spawn a real child agent with a trivial prompt ("respond with just 'hello'")
- Verify thread metadata created on disk
- Verify child process exits cleanly
- Verify result contains expected response
