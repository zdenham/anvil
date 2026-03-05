# mort-repl: Live Agent Integration Test

Validate that mort-repl works end-to-end with a real Anthropic API call using `AgentTestHarness`. The existing unit tests mock everything — this verifies the actual agent→hook→transpile→execute→result pipeline with a live LLM.

## Test Location

`agents/src/experimental/__tests__/mort-repl.integration.test.ts`

Follows the established pattern: `describeWithApi` guard, `AgentTestHarness`, `assertAgent()` fluent assertions.

## Test Cases

### 1. Basic REPL execution — `return 42`

Prompt the agent with explicit instructions to call `mort-repl` with a simple expression. The hook intercepts the Bash call, executes the code, and returns the result as a deny reason. The agent should see `mort-repl result: 42` and report it back.

**Prompt strategy**: Be very explicit — tell the agent "Call the Bash tool with command `mort-repl \"return 42\"` and report the result." Agents follow direct tool instructions reliably. Don't rely on the agent knowing what mort-repl is (the `/orchestrate` skill prompt isn't injected in test context).

**Assertions**:
- `assertAgent(output).succeeded()`
- Agent used `Bash` tool (via `usedTools(["Bash"])`)
- Final assistant message text contains `42`
- Hook fired: final state's `toolStates` should show a Bash tool with `permissionDecision: "deny"` (the hook's interception mechanism)

**Timeout**: 60s — single API round-trip, no child spawning.

### 2. TypeScript code with types stripped

Prompt the agent to call mort-repl with TypeScript code including type annotations:
```
mort-repl <<'MORT_REPL'
interface Result { value: number; label: string }
const r: Result = { value: 99, label: "test" };
return r;
MORT_REPL
```

This validates that `ts.transpileModule()` strips types before `AsyncFunction` execution. If the transpiler fails, the agent sees an error instead of `{ value: 99, label: "test" }`.

**Assertions**:
- Agent succeeded
- Final text contains `99` and `test` (the returned object's values)

**Timeout**: 60s.

### 3. mort.log() output appears in result

Prompt the agent to call:
```
mort-repl <<'MORT_REPL'
mort.log("hello from repl");
return "done";
MORT_REPL
```

The formatted result should include the log line. Validates SDK log capture works end-to-end.

**Assertions**:
- Agent succeeded
- Final text contains both `hello from repl` and `done`

**Timeout**: 60s.

### 4. mort.spawn() — child agent execution (the big one)

Prompt the agent to call mort-repl with a `mort.spawn()` that creates a real child agent. The child prompt should be trivial so it finishes fast: `"Reply with exactly the word PINEAPPLE and nothing else."`

```
mort-repl <<'MORT_REPL'
const result = await mort.spawn({
  prompt: 'Reply with exactly the word PINEAPPLE and nothing else.',
});
return result;
MORT_REPL
```

This validates the full spawn flow: disk thread creation → `child_process.spawn` → child runs `runAgentLoop()` → child writes state → parent reads last assistant message → returns to REPL.

**Important considerations**:
- Child connects to hub independently — but in test, the hub socket path is `MORT_HUB_SOCKET_PATH` from the harness. The child inherits the parent's env, so it will try to connect to the same mock hub socket. This should work: MockHubServer accepts multiple connections and tracks messages by threadId.
- Child needs `ANTHROPIC_API_KEY` — inherited from parent env, which is inherited from test process.
- Child creates its own thread dir on disk in the harness's temp mort directory.

**Assertions**:
- Agent succeeded
- Final text contains `PINEAPPLE` (the child's response, propagated through mort.spawn() → REPL result → agent text)
- Child thread directory exists on disk: scan `mortDir/threads/` for a directory other than the parent threadId
- `thread:created` event was emitted (via `assertAgent(output).hasEvent("thread:created")`)

**Timeout**: 120s — two API calls (parent + child).

### 5. Error handling — syntax error in REPL code

Prompt the agent to call mort-repl with invalid code:
```
mort-repl "const x: = 42;"
```

The transpiler or AsyncFunction should throw. The hook returns the error as a deny reason. The agent should see `mort-repl error:` and report it.

**Assertions**:
- Agent succeeded (the agent itself doesn't crash — it gets an error message from the hook and reports it)
- Final text references an error or syntax issue

**Timeout**: 60s.

## Implementation Notes

### Harness setup

```typescript
const harness = new AgentTestHarness({ timeout: 120_000 });
```

No custom `setupEnvironment` needed — the default `TestMortDirectory` + `TestRepository` are sufficient. The repl hook is wired into the standard runner via `shared.ts`, so it fires automatically.

### Prompt engineering

The agent doesn't have the `/orchestrate` skill prompt injected in test context, so it doesn't inherently know about mort-repl. Each test prompt must be explicit: "Call the Bash tool with this exact command." The Haiku-class models follow these instructions reliably.

For the spawn test specifically, include in the system prompt area (via the prompt itself) that mort-repl is a special Bash prefix that executes TypeScript code with a `mort` SDK object available.

### Extracting agent final text

Use the same pattern as `tools.test.ts` — get final state from `output.states`, find last assistant message content blocks, extract text. The `assertAgent()` helpers don't have a `finalTextContains()` yet, so we'll write a small helper or use raw state inspection.

### Cost awareness

Each test makes 1-2 live API calls. The spawn test makes 2 (parent + child). Mark the describe block with `.skip` after validation (same pattern as existing experimental spikes) so they don't run in CI. Use `describeWithApi` guard for local runs.

## Phases

- [x] Write the integration test file with all 5 test cases
- [x] Run tests locally with `ANTHROPIC_API_KEY` to validate, fix any issues
- [x] Mark tests as `.skip` after validation (spike pattern — not for CI regression)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Initial Run Results (2026-03-04)

**5/5 tests passing** (after ChildSpawner tsx fix)

```
 ✓ basic REPL execution — return 42                  (8939ms)
 ✓ TypeScript code with types stripped                (12880ms)
 ✓ mort.log() output appears in result                (9488ms)
 ✓ mort.spawn() — child agent execution               (15675ms)
 ✓ error handling — runtime error in REPL code        (10889ms)

 Test Files  1 passed (1)
 Tests       5 passed (5)
 Duration    58.05s
```

### Key Implementation Findings

1. **Harness states array is empty** — The runner now emits `thread_action` messages (not `state`/`state_event`), so the harness `collectMessages()` never populates `output.states[]`. Workaround: read final state from disk via `readStateFromDisk()` helper. This is fine since disk is the source of truth.

2. **toolStates on disk lack `toolName` and `permissionDecision`** — The deny hook interception doesn't populate these fields in the disk state. The original plan's assertion for `permissionDecision: "deny"` doesn't work via disk. Changed to verify the agent used a Bash `tool_use` block and the final text contains the expected result.

3. **Test 5 revised: syntax error → runtime error** — `ts.transpileModule()` is lenient: `const x: = 42;` is treated as a type annotation stripped to `const x = 42;`, producing `undefined` (valid JS). Changed to `throw new Error('kaboom')` which reliably triggers the error path.

4. **ChildSpawner tsx fix (Open Question #2 resolved)** — `ChildSpawner` used `node runnerPath` where `runnerPath = import.meta.url` resolves to the `.ts` source file when running via tsx. Fixed in `child-spawner.ts`: detect `.ts` extension and use `tsx` as executable. All 5 tests now pass including `mort.spawn()`.

### Changes Made

- `agents/src/experimental/__tests__/mort-repl.integration.test.ts` — New integration test file (5 tests, `.skip` for CI)
- `agents/src/lib/mort-repl/child-spawner.ts` — Detect `.ts` runnerPath and use `tsx` executable

---

## Open Questions

1. ~~**MockHubServer + child agent**~~: **RESOLVED** — MockHubServer handles multiple connections fine. The child thread registers with a different threadId and the parent reads results from disk regardless.

2. ~~**Runner path in test**~~ **RESOLVED**: Fixed `ChildSpawner` to detect `.ts` extension on `runnerPath` and use `tsx` instead of `node`. Both compiled (`node dist/runner.js`) and source (`tsx src/runner.ts`) contexts now work.
