# anvil-repl: Programmatic Agent Orchestration

Allow agents to write and execute TypeScript orchestration code via a `anvil-repl` Bash tool interception. The agent outputs code that uses an injected `anvil` SDK object, enabling loops, `Promise.all` parallelism, and conditional logic for recursive agent spawning.

> Builds on prior design decisions from `plans/completed/bash-sub-agent-spawning.md` (thread `1e8e5a31`).

## Design Decisions

1. **No VM/sandbox** — code runs directly in the runner's Node.js process via `AsyncFunction`
2. **PreToolUse:Bash hook interception** — detect `anvil-repl` prefix, deny actual bash execution, run the code, return result as deny reason
3. **`anvil.spawn()` returns a promise** — blocking by default, agent can `Promise.all` for parallelism
4. **Skills as invocation mechanism** — base system prompt does NOT mention anvil-repl; a skill (`/orchestrate`) injects the instructions + API reference
5. **`AsyncFunction` for code execution** — `Object.getPrototypeOf(async function(){}).constructor` supports `await` and `return`
6. **TypeScript via `ts.transpileModule()`** — agent writes TypeScript, we strip types with `typescript`'s `ts.transpileModule(code, { compilerOptions: { target: ScriptTarget.ESNext, module: ModuleKind.ESNext } })` before passing to `AsyncFunction`. `typescript` is already a direct dependency — no new packages needed. Slightly slower than esbuild (~5ms vs ~0.5ms) but negligible for REPL snippets.
7. **`spawn()` returns a string** — the last assistant message content from the child. The agent almost always wants "what did the child say," not metadata.

## How It Works

```
Agent calls Bash tool:
  command: anvil-repl <<'ANVIL_REPL'
  const [a, b] = await Promise.all([
    anvil.spawn({ prompt: 'fix auth tests' }),
    anvil.spawn({ prompt: 'fix api tests' }),
  ]);
  return { auth: a, api: b };
  ANVIL_REPL
        ↓
PreToolUse:Bash hook fires
  → Detects "anvil-repl" prefix
  → Extracts code from heredoc (or quoted string)
  → ts.transpileModule(code) → strips types → plain JS
  → Creates AsyncFunction with `anvil` as parameter
  → Executes with AnvilReplSdk instance (has full parent context)
  → anvil.spawn() creates child thread on disk, spawns child_process, waits for exit, reads last assistant message
  → Returns deny decision with formatted result as reason
        ↓
Agent sees the result string as tool output
```

The **deny mechanism** is how results get back to the agent. The SDK surfaces deny reasons as tool error messages, which the agent reads and acts on. This is the same pattern as `anvil-resolve-comment`.

## `anvil` SDK Shape

```typescript
// Available as `anvil` in the REPL context

// Spawn a child agent and wait for completion
// Returns the child's last assistant message (string)
const result: string = await anvil.spawn({
  prompt: 'fix the auth tests',    // required — the task prompt
  agentType: 'general-purpose',    // optional — default: "general-purpose"
  cwd: '/path/to/dir',             // optional — default: parent's cwd
  permissionMode: 'bypassPermissions', // optional — default: parent's mode
});

// Log output (visible in runner logs)
anvil.log('message');

// Read-only parent context
anvil.context // { threadId, repoId, worktreeId, workingDir, permissionModeId }
```

## Child Spawning Mechanism

**Key principle: reuse the existing runner, don't reinvent it.** `child-spawner.ts` is a thin wrapper that creates thread state on disk and invokes the same `agents/dist/runner.js` entry point that the frontend uses. The only difference is that the parent agent spawns the child directly via Node's `child_process` (since we're inside a hook, not the frontend/Tauri layer).

`anvil.spawn()` internally:
1. Creates child thread directory + `metadata.json` + `state.json` on disk (same pattern as PreToolUse:Task hook in `shared.ts:710-842`)
2. Emits `thread:created` event so frontend picks it up in sidebar
3. Spawns `child_process.spawn('node', ['agents/dist/runner.js', '--thread-id', childId, '--repo-id', repoId, ...])` — same CLI args as `agent-service.ts:spawnSimpleAgent()`, same runner entry point, same env vars (inherits `ANTHROPIC_API_KEY`, `ANVIL_DATA_DIR`, etc.)
4. Child connects to hub independently, runs the existing `runAgentLoop()`, writes state to disk — **no custom agent loop logic in child-spawner**
5. Parent waits for process exit, reads child's `state.json` to extract last assistant message content
6. Returns the message content string to the calling code

Children are **fully independent agent processes** — their messages stream through the hub to the frontend in real-time. The parent only gets the final result string after the child exits.

### Runner Path Resolution

`agents/src/runner.ts:11` already exports `runnerPath = fileURLToPath(import.meta.url)`. This resolves to `agents/dist/runner.js` at runtime — the same entry point the frontend uses via Tauri. `ChildSpawner` imports this directly: `import { runnerPath } from "../../runner.js"`.

### Child PID Tracking & Cleanup

The parent **must** register all spawned child PIDs and kill them on parent exit. This is not optional.

- `ChildSpawner` maintains a `Set<number>` of active child PIDs
- **Integration point**: `runner.ts` already registers `process.on("SIGTERM"/"SIGINT"/"exit", cleanup)` handlers. `ChildSpawner` registers its own listener on `process.on("exit")` to SIGTERM all tracked children. This is independent of the Tauri-side `AgentPidMap` (which only tracks frontend→backend spawns).
- On child exit (normal or error), remove its PID from the set
- If the REPL code throws (e.g., one `Promise.all` branch fails), kill all still-running children from that execution before propagating the error

### Parent-Child Mapping

Unlike the SDK's Task tool (which uses `parentToolUseId` for inline rendering), REPL-spawned agents use:
- `parentThreadId` on child metadata → establishes the relationship
- `parentToolUseId` set to the Bash call's `tool_use_id` → allows UI to render spawned agents inline with the anvil-repl call
- Multiple children from one REPL call share the same `parentToolUseId`

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `agents/src/lib/anvil-repl/repl-runner.ts` | `AnvilReplRunner` — parses code, esbuild-transforms TS→JS, creates AsyncFunction, executes with SDK |
| `agents/src/lib/anvil-repl/anvil-sdk.ts` | `AnvilReplSdk` — the injected `anvil` object with `spawn()`, `log()`, `context` |
| `agents/src/lib/anvil-repl/child-spawner.ts` | `ChildSpawner` — thin wrapper: creates thread on disk, spawns existing `runner.js` via `child_process`, tracks PIDs, waits for exit, reads result. No custom agent loop logic. |
| `agents/src/lib/anvil-repl/types.ts` | Shared types (`SpawnOptions`, `SpawnResult`, `ReplContext`) |
| `agents/src/lib/anvil-repl/index.ts` | Barrel export |
| `agents/src/hooks/repl-hook.ts` | PreToolUse hook — detects `anvil-repl`, delegates to `AnvilReplRunner` |
| `plugins/anvil/skills/orchestrate/SKILL.md` | Skill prompt teaching the agent how to use anvil-repl + API reference |

### Modified Files

| File | Change |
|------|--------|
| `agents/src/runners/shared.ts` | Add repl hook to PreToolUse:Bash chain (before comment resolution hook) |

## Phases

- [x] Phase 0 spike — `agents/src/experimental/ts-transpile-spike-runner.ts`: verify `ts.transpileModule()` survives tsup bundle and produces valid JS for `AsyncFunction`. Temporarily add to tsup `entry` array, `pnpm build`, run `node dist/ts-transpile-spike-runner.js`, confirm TS→JS + async execution works. Remove from entry array after. Tests: (1) plain JS passthrough, (2) TS with type annotations stripped, (3) async code with `await`, (4) error case with invalid syntax.
- [x] Core infrastructure — repl-hook, repl-runner, TS→JS via ts.transpileModule, code extraction + AsyncFunction execution (no spawning, just `return 42` works)
- [x] Child spawning — child-spawner, anvil-sdk with `spawn()` returning last assistant message, wire into repl-runner, emit thread:created
- [x] Skill prompt — create `/orchestrate` skill with API reference and usage examples
- [x] Tests — unit tests for repl-runner + child-spawner, integration test with live API

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Potential Challenges

1. **Deny reason length** — child results could be very large. Truncate to ~50KB with a note.
2. **Agent interpreting "deny" as failure** — prefix results with `anvil-repl result:` so the agent recognizes success. Skill prompt teaches this.
3. **TypeScript transform errors** — if the agent writes invalid TypeScript, `ts.transpileModule()` will emit diagnostics. Surface these directly as the deny reason so the agent can fix its code.
4. **Hub registration race** — child connects to hub independently. If hub is unreachable, child still writes state to disk. Parent reads from disk after exit, so hub is not required for result retrieval.
5. **~~Process cleanup~~** — addressed above in "Child PID Tracking & Cleanup" as a hard requirement.
