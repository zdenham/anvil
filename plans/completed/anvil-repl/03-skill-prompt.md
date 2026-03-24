# Phase 3: Skill Prompt

Create the `/orchestrate` skill that teaches the agent how to use `mort-repl`.

## File: `plugins/mort/skills/orchestrate/SKILL.md`

```markdown
---
name: orchestrate
description: Orchestrate multiple agents programmatically using mort-repl
user-invocable: true
---

# Agent Orchestration

You can programmatically spawn and coordinate child agents using the `mort-repl` command. This runs JavaScript code with an injected `mort` SDK.

## Usage

Call the Bash tool with a `mort-repl` heredoc:

\```bash
mort-repl <<'MORT_REPL'
// your JavaScript code here
// `mort` object is available
MORT_REPL
\```

**Important**: This is JavaScript, not TypeScript. Do not use type annotations.

## API Reference

### `mort.spawn(options)` — Spawn a child agent

Spawns a new agent process and waits for it to complete. Returns the result.

\```javascript
const result = await mort.spawn({
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

### `mort.log(message)` — Log a message

\```javascript
mort.log("Starting parallel test fixes...");
\```

### `mort.context` — Parent context (read-only)

\```javascript
mort.context.threadId       // parent thread ID
mort.context.repoId         // repository ID
mort.context.worktreeId     // worktree ID
mort.context.workingDir     // parent working directory
mort.context.permissionModeId  // current permission mode
\```

## Patterns

### Parallel spawning

\```bash
mort-repl <<'MORT_REPL'
const results = await Promise.all([
  mort.spawn({ prompt: "Fix auth module tests" }),
  mort.spawn({ prompt: "Fix API endpoint tests" }),
  mort.spawn({ prompt: "Update documentation" }),
]);
return results.map(r => ({ threadId: r.threadId, status: r.status }));
MORT_REPL
\```

### Sequential with conditional logic

\```bash
mort-repl <<'MORT_REPL'
const analysis = await mort.spawn({ prompt: "Analyze test failures and list them" });

if (analysis.status === "error") {
  return { error: "Analysis failed", details: analysis.result };
}

const fix = await mort.spawn({
  prompt: `Fix these issues: ${analysis.result}`,
});

return { analysis: analysis.threadId, fix: fix.threadId, status: fix.status };
MORT_REPL
\```

## Notes

- The result of the code is returned as the Bash tool output. Use `return` to send data back.
- Spawned agents appear in the sidebar immediately and stream output in real-time.
- Each spawned agent is a fully independent process with its own conversation.
- `mort.spawn()` blocks until the child completes — use `Promise.all` for parallelism.
- Results over 50KB are truncated. Use the child's threadId to view full output.
```

## Notes on Skill Design

- The skill is `user-invocable: true` so users trigger it with `/orchestrate`
- The base system prompt never mentions mort-repl — the skill injects all context
- Agent sees the skill content as part of its conversation, then can use mort-repl in subsequent tool calls
- Examples are critical — they show the heredoc pattern and common orchestration patterns
