---
name: orchestrate
description: Orchestrate multiple agents programmatically using anvil-repl
user-invocable: true
---

# Agent Orchestration

You can programmatically spawn and coordinate child agents using the `anvil-repl` command. This runs TypeScript/JavaScript code with an injected `anvil` SDK object.

## Usage

Call the Bash tool with a `anvil-repl` heredoc:

```bash
anvil-repl <<'ANVIL_REPL'
// your code here — `anvil` object is available
ANVIL_REPL
```

## API Reference

### `anvil.spawn({ prompt, contextShortCircuit? })` — Spawn a child agent

Spawns a new agent process and waits for it to complete. Returns the child's last assistant message as a string.

```javascript
const result = await anvil.spawn({ prompt: "Fix the failing auth tests" });
// result is a string — the child's last assistant message content
```

**Optional:** `contextShortCircuit` nudges the child to save progress when context pressure gets high:

```javascript
await anvil.spawn({
  prompt: "Implement the auth module",
  contextShortCircuit: {
    limitPercent: 80,
    message: "You are running low on context. Save progress to plans/auth-progress.md, then stop.",
  },
});
```

### `anvil.log(message)` — Log a message

```javascript
anvil.log("Starting parallel test fixes...");
```

### `anvil.context` — Parent context (read-only)

```javascript
anvil.context.threadId          // parent thread ID
anvil.context.repoId            // repository ID
anvil.context.worktreeId        // worktree ID
anvil.context.workingDir        // parent working directory
anvil.context.permissionModeId  // current permission mode
```

## Patterns

### Parallel spawning

```bash
anvil-repl <<'ANVIL_REPL'
const [authResult, apiResult] = await Promise.all([
  anvil.spawn({ prompt: "Fix auth module tests" }),
  anvil.spawn({ prompt: "Fix API endpoint tests" }),
]);
return `Auth: ${authResult.slice(0, 200)}\nAPI: ${apiResult.slice(0, 200)}`;
ANVIL_REPL
```

### Sequential with conditional logic

```bash
anvil-repl <<'ANVIL_REPL'
const analysis = await anvil.spawn({ prompt: "Analyze test failures and list them" });

const fix = await anvil.spawn({ prompt: `Fix these issues:\n${analysis}` });

return fix;
ANVIL_REPL
```

### Loop over items

```bash
anvil-repl <<'ANVIL_REPL'
const files = ["auth.ts", "api.ts", "db.ts"];
const results = await Promise.all(
  files.map(f => anvil.spawn({ prompt: `Review ${f} for security issues` }))
);
return results.map((r, i) => `${files[i]}: ${r.slice(0, 100)}`).join("\n");
ANVIL_REPL
```

## Notes

- **Do NOT use `run_in_background: true`** when invoking `anvil-repl`. The REPL manages long-running execution internally. Always run in the foreground.
- The result of your code is returned as the Bash tool output. Use `return` to send data back.
- `anvil.spawn()` returns a **string** — the child's last assistant message content.
- Spawned agents appear in the sidebar immediately and stream output in real-time.
- Each spawned agent is a fully independent process with its own conversation.
- `anvil.spawn()` blocks until the child completes — use `Promise.all` for parallelism.
- Results over 50KB are truncated. The child's threadId is logged for full output.
- TypeScript type annotations are supported (stripped at runtime via `ts.transpileModule`).
- **Keep REPL code minimal.** REPL scripts should be thin orchestration glue — primarily `anvil.spawn()` calls with `Promise.all`. Avoid writing business logic, file parsing, or complex algorithms in REPL code. If you need to read files, reason about data, or edit files, do that as the agent using your normal tools (Read/Edit/Write), not programmatically in the REPL.
