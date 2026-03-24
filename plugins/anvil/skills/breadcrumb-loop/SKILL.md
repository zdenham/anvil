---
name: breadcrumb-loop
description: Run a long task across multiple agent contexts using breadcrumb progress files
user-invocable: true
---

# Breadcrumb Loop

Run a long-running task that spans multiple agent contexts. Each agent picks up where the last left off via the `/anvil:breadcrumb` skill.

## Instructions

Given the user's goal in `$ARGUMENTS`:

1. **Create a task slug** from the goal (kebab-case, e.g., `implement-auth-module`)
2. **Create the breadcrumb directory** at `plans/<task-slug>-breadcrumb-log/`
3. **Write `readme.md`** in that directory with:
   - The full objective (from `$ARGUMENTS`)
   - Acceptance criteria (infer from the goal, or ask the user if unclear)
   - Any relevant context you know about the codebase
4. **Run the loop** below, substituting your task slug

## Important

**Do NOT use `run_in_background: true`** when invoking `anvil-repl`. The REPL manages long-running execution internally via child agent processes. Always run it in the foreground.

## Loop

```bash
anvil-repl <<'ANVIL_REPL'
const DIR = "plans/<task-slug>-breadcrumb-log";

for (let i = 1; i <= 100; i++) {
  anvil.log(`Iteration ${i}`);

  // The slash command must lead the prompt — Claude Code only auto-expands
  // skills into <command-name> tags when /command is at the start of the message.
  const result = await anvil.spawn({
    prompt: `/anvil:breadcrumb ${DIR} ${i}`,
    contextShortCircuit: {
      limitPercent: 50,
      message: "Your context is running low. Stop new work and save your progress now.",
    },
  });

  if (/^BREADCRUMB_COMPLETE$/m.test(result)) {
    anvil.log("Task completed!");
    break;
  }
}
ANVIL_REPL
```

## After the Loop

Breadcrumb agents commit their work directly to the branch. When the loop finishes:

1. Run `git log --oneline` to see what the breadcrumb agents committed
2. Read the latest `*-progress.md` file in the breadcrumb log directory for a summary
