# Programmatic Agent Orchestration (anvil-eval)

> **Supersedes** the original "bash sub-agent spawning" plan (shell wrapper + env vars). After discussion in thread `1e8e5a31`, we pivoted to a programmatic TypeScript approach that runs inside the runner process.

Allow agents to write and execute TypeScript orchestration code via a `anvil-eval` Bash tool interception. The agent outputs TypeScript that uses an injected `anvil` SDK object, enabling loops, `Promise.all` parallelism, and conditional logic — far more powerful than a shell CLI.

## Design Decisions

These were made in the conversation thread and should be treated as settled:

1. **No VM/sandbox** — code runs directly in the runner's Node.js process via `AsyncFunction`
2. **No env vars or shell wrapper** — parent context is injected via the `anvil` SDK object; `setupAnvilCommand()` can be removed
3. **PreToolUse:Bash hook interception** — detect `anvil-eval` prefix, deny actual bash execution, run the code, return result as deny reason
4. **`anvil.spawn()` returns a promise** — blocking by default, agent can `Promise.all` for parallelism
5. **Skills as invocation mechanism** — base system prompt does NOT mention anvil-eval; a skill (e.g., `/orchestrate`) injects the instructions
6. **`AsyncFunction` for code execution** — `Object.getPrototypeOf(async function(){}).constructor` supports `await` and `return`

## How It Works

```
Agent calls Bash tool:
  command: "anvil-eval <<'EOF'
  const [a, b] = await Promise.all([
    anvil.spawn({ prompt: 'fix auth tests' }),
    anvil.spawn({ prompt: 'fix api tests' }),
  ]);
  return { auth: a.result, api: b.result };
  EOF"
        ↓
PreToolUse:Bash hook fires
  → Detects "anvil-eval" prefix
  → Extracts TypeScript code from heredoc
  → Creates AsyncFunction with `anvil` as parameter
  → Executes with AnvilEvalSdk instance (has full parent context)
  → anvil.spawn() creates child thread on disk, spawns child_process, waits for exit, reads result
  → Returns deny decision with formatted result as reason
        ↓
Agent sees the result string as tool output
```

Key insight: the **deny mechanism** is how results get back to the agent. The SDK surfaces deny reasons as tool error messages, which the agent can read and act on. This is well-documented existing behavior.

## `anvil` SDK Shape

```typescript
class AnvilEvalSdk {
  // Spawn a child agent and wait for completion
  async spawn(options: {
    prompt: string;
    agentType?: string;       // default: "general-purpose"
    cwd?: string;             // default: parent's cwd
    permissionMode?: string;  // default: parent's mode
  }): Promise<{
    threadId: string;
    status: string;           // "completed" | "error"
    exitCode: number;
    result: string;           // last assistant message from child
    durationMs: number;
  }>;

  // Log debug output (visible in runner logs)
  log(message: string): void;

  // Read-only parent context
  get context(): {
    threadId: string;
    repoId: string;
    worktreeId: string;
    workingDir: string;
    permissionModeId: string;
  };
}
```

## Child Spawning Mechanism

`anvil.spawn()` internally:
1. Creates child thread directory + `metadata.json` + `state.json` on disk (same pattern as PreToolUse:Task hook)
2. Emits `thread:created` event so frontend sees it
3. Spawns `child_process.spawn('node', [runnerPath, '--thread-id', childId, ...])` with all parent context as CLI args
4. Child connects to hub independently, runs full agent loop, writes state to disk
5. Parent waits for process exit, reads child's `state.json` to extract last assistant message
6. Returns structured result to the calling TypeScript code

Children are **fully independent agent processes** — their messages go directly through the hub to the frontend. The parent only gets the final result after the child exits.

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `agents/src/lib/anvil-eval/eval-runner.ts` | `AnvilEvalRunner` class — parses code, creates AsyncFunction, executes with SDK |
| `agents/src/lib/anvil-eval/anvil-sdk.ts` | `AnvilEvalSdk` class — the injected `anvil` object |
| `agents/src/lib/anvil-eval/child-spawner.ts` | `ChildSpawner` class — spawns child process, waits, reads result |
| `agents/src/lib/anvil-eval/types.ts` | Shared types (`SpawnOptions`, `SpawnResult`, `EvalContext`) |
| `agents/src/lib/anvil-eval/index.ts` | Barrel export |
| `plugins/anvil/skills/orchestrate/SKILL.md` | Skill prompt teaching the agent how to use anvil-eval |

### Modified Files

| File | Change |
|------|--------|
| `agents/src/runners/shared.ts` | Add PreToolUse:Bash hook for anvil-eval interception (~25 lines) |
| `agents/src/runner.ts` | Remove `setupAnvilCommand()` and its call |

## Phases

- [ ] Core eval infrastructure (eval-runner, code extraction, PreToolUse:Bash hook — no spawning yet, just `return 42` works)
- [ ] Child spawning (child-spawner, anvil-sdk, wire into eval-runner)
- [ ] Skill prompt and cleanup (create `/orchestrate` skill, remove `setupAnvilCommand()`)
- [ ] Tests (unit tests for eval-runner + child-spawner, integration test with live API)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Potential Challenges

1. **Deny reason length** — child results could be very large. Truncate to ~50KB with a note.
2. **Agent interpreting "deny" as failure** — prefix results with `anvil-eval result:` so the agent recognizes success. Skill prompt teaches this.
3. **TypeScript vs JavaScript** — `AsyncFunction` evaluates JavaScript, not TypeScript. Agent code must be valid JS (no type annotations). Skill prompt notes this.
4. **Hub registration race** — child connects to hub independently. If hub is unreachable, child still writes state to disk. Parent reads from disk after exit, so hub is not required for result retrieval.

## Thread History

This plan evolved through discussion in thread `1e8e5a31-5be6-4fd4-a58d-0955703a2233` ("node agent spawn mechanism"):

- **Original plan**: Shell wrapper (`bin/anvil`) + env vars for context discovery
- **Critique**: Why do we need a CLI? No env vars needed — the hook already has parent context. Why not spawn directly from Node.js?
- **Pivot**: Instead of a CLI, expose a programmatic SDK where the agent writes TypeScript code
- **Refinement**: No VM/sandbox, just `AsyncFunction` in the runner process. `anvil.spawn` blocks but agent can `Promise.all`. API taught via skills, not system prompt.

Detailed implementation plan was produced by a child thread `4ebac685-3605-4e21-8e92-2b78a7b67692` ("anvil eval typescript orchestration").
