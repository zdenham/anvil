# Phase 3: Skill Prompt

Create the `/orchestrate` skill that teaches the agent how to use `anvil-repl`.

## File: `plugins/anvil/skills/orchestrate/SKILL.md`

```markdown
---
name: orchestrate
description: Orchestrate multiple agents programmatically using anvil-repl
user-invocable: true
---

# Agent Orchestration

You can programmatically spawn and coordinate child agents using the `anvil-repl` command. This runs JavaScript code with an injected `anvil` SDK.

## Usage

Call the Bash tool with a `anvil-repl` heredoc:

\```bash
anvil-repl <<'ANVIL_REPL'
// your JavaScript code here
// `anvil` object is available
ANVIL_REPL
\```

**Important**: This is JavaScript, not TypeScript. Do not use type annotations.

## API Reference

### `anvil.spawn(options)` — Spawn a child agent

Spawns a new agent process and waits for it to complete. Returns the result.

\```javascript
const result = await anvil.spawn({
  prompt: "Fix the failing auth tests",   // required
  agentType: "general-purpose",           // optional, default: "general-purpose"
  cwd: "/path/to/dir",                    // optional, default: parent's cwd
  permissionMode: "implement",            // optional, default: parent's mode
});

// result shape:
// {
//   threadId: "uuid",
//   status: "completed" | "error" | "cancelled",
//   exitCode: 0,
//   result: "Last assistant message text...",
//   durationMs: 45000,
// }
\```

### `anvil.log(message)` — Log a message

\```javascript
anvil.log("Starting parallel test fixes...");
\```

### `anvil.context` — Parent context (read-only)

\```javascript
anvil.context.threadId       // parent thread ID
anvil.context.repoId         // repository ID
anvil.context.worktreeId     // worktree ID
anvil.context.workingDir     // parent working directory
anvil.context.permissionModeId  // current permission mode
\```

## Patterns

### Parallel spawning

\```bash
anvil-repl <<'ANVIL_REPL'
const results = await Promise.all([
  anvil.spawn({ prompt: "Fix auth module tests" }),
  anvil.spawn({ prompt: "Fix API endpoint tests" }),
  anvil.spawn({ prompt: "Update documentation" }),
]);
return results.map(r => ({ threadId: r.threadId, status: r.status }));
ANVIL_REPL
\```

### Sequential with conditional logic

\```bash
anvil-repl <<'ANVIL_REPL'
const analysis = await anvil.spawn({ prompt: "Analyze test failures and list them" });

if (analysis.status === "error") {
  return { error: "Analysis failed", details: analysis.result };
}

const fix = await anvil.spawn({
  prompt: `Fix these issues: ${analysis.result}`,
});

return { analysis: analysis.threadId, fix: fix.threadId, status: fix.status };
ANVIL_REPL
\```

## Notes

- The result of the code is returned as the Bash tool output. Use `return` to send data back.
- Spawned agents appear in the sidebar immediately and stream output in real-time.
- Each spawned agent is a fully independent process with its own conversation.
- `anvil.spawn()` blocks until the child completes — use `Promise.all` for parallelism.
- Results over 50KB are truncated. Use the child's threadId to view full output.
```

## Notes on Skill Design

- The skill is `user-invocable: true` so users trigger it with `/orchestrate`
- The base system prompt never mentions anvil-repl — the skill injects all context
- Agent sees the skill content as part of its conversation, then can use anvil-repl in subsequent tool calls
- Examples are critical — they show the heredoc pattern and common orchestration patterns
