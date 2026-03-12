---
name: breadcrumb-loop
description: Run a long task across multiple agent contexts using breadcrumb progress files
user-invocable: true
---

# Breadcrumb Loop

Run a long-running task that spans multiple agent contexts. Each agent picks up where the last left off via the `/breadcrumb` skill.

## Instructions

Given the user's goal in `$ARGUMENTS`:

1. **Create a task slug** from the goal (kebab-case, e.g., `implement-auth-module`)
2. **Create the breadcrumb directory** at `plans/breadcrumbs/<task-slug>/`
3. **Write `readme.md`** in that directory with:
   - The full objective (from `$ARGUMENTS`)
   - Acceptance criteria (infer from the goal, or ask the user if unclear)
   - Any relevant context you know about the codebase
4. **Run the loop** below, substituting your task slug

## Loop

```bash
mort-repl <<'MORT_REPL'
const DIR = "plans/breadcrumbs/<task-slug>";

for (let i = 1; i <= 100; i++) {
  mort.log(`Iteration ${i}`);

  const result = await mort.spawn({
    prompt: `/breadcrumb ${DIR} ${i}`,
    contextShortCircuit: {
      limitPercent: 75,
      message: "Your context is running low. Stop new work and save your progress now.",
    },
  });

  if (result.includes("BREADCRUMB_COMPLETE")) {
    mort.log("Task completed!");
    break;
  }
}
MORT_REPL
```
