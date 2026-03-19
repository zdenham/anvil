---
name: orchestrate
description: Orchestrate multiple agents programmatically using mort-repl
user-invocable: true
---

# Agent Orchestration

You can programmatically spawn and coordinate child agents using the `mort-repl` command. This runs TypeScript/JavaScript code with an injected `mort` SDK object.

## Usage

Call the Bash tool with a `mort-repl` heredoc:

```bash
mort-repl <<'MORT_REPL'
// your code here — `mort` object is available
MORT_REPL
```

## API Reference

### `mort.spawn({ prompt, contextShortCircuit? })` — Spawn a child agent

Spawns a new agent process and waits for it to complete. Returns the child's last assistant message as a string.

```javascript
const result = await mort.spawn({ prompt: "Fix the failing auth tests" });
// result is a string — the child's last assistant message content
```

**Optional:** `contextShortCircuit` nudges the child to save progress when context pressure gets high:

```javascript
await mort.spawn({
  prompt: "Implement the auth module",
  contextShortCircuit: {
    limitPercent: 80,
    message: "You are running low on context. Save progress to plans/auth-progress.md, then stop.",
  },
});
```

### `mort.log(message)` — Log a message

```javascript
mort.log("Starting parallel test fixes...");
```

### `mort.context` — Parent context (read-only)

```javascript
mort.context.threadId          // parent thread ID
mort.context.repoId            // repository ID
mort.context.worktreeId        // worktree ID
mort.context.workingDir        // parent working directory
mort.context.permissionModeId  // current permission mode
```

## Patterns

### Parallel spawning

```bash
mort-repl <<'MORT_REPL'
const [authResult, apiResult] = await Promise.all([
  mort.spawn({ prompt: "Fix auth module tests" }),
  mort.spawn({ prompt: "Fix API endpoint tests" }),
]);
return `Auth: ${authResult.slice(0, 200)}\nAPI: ${apiResult.slice(0, 200)}`;
MORT_REPL
```

### Sequential with conditional logic

```bash
mort-repl <<'MORT_REPL'
const analysis = await mort.spawn({ prompt: "Analyze test failures and list them" });

const fix = await mort.spawn({ prompt: `Fix these issues:\n${analysis}` });

return fix;
MORT_REPL
```

### Loop over items

```bash
mort-repl <<'MORT_REPL'
const files = ["auth.ts", "api.ts", "db.ts"];
const results = await Promise.all(
  files.map(f => mort.spawn({ prompt: `Review ${f} for security issues` }))
);
return results.map((r, i) => `${files[i]}: ${r.slice(0, 100)}`).join("\n");
MORT_REPL
```

## Notes

- **Do NOT use `run_in_background: true`** when invoking `mort-repl`. The REPL manages long-running execution internally. Always run in the foreground.
- The result of your code is returned as the Bash tool output. Use `return` to send data back.
- `mort.spawn()` returns a **string** — the child's last assistant message content.
- Spawned agents appear in the sidebar immediately and stream output in real-time.
- Each spawned agent is a fully independent process with its own conversation.
- `mort.spawn()` blocks until the child completes — use `Promise.all` for parallelism.
- Results over 50KB are truncated. The child's threadId is logged for full output.
- TypeScript type annotations are supported (stripped at runtime via `ts.transpileModule`).
- **Keep REPL code minimal.** REPL scripts should be thin orchestration glue — primarily `mort.spawn()` calls with `Promise.all`. Avoid writing business logic, file parsing, or complex algorithms in REPL code. If you need to read files, reason about data, or edit files, do that as the agent using your normal tools (Read/Edit/Write), not programmatically in the REPL.
