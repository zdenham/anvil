---
name: decompose
description: Recursively decompose a task into sub-plans with dependency ordering, then execute in topological waves
user-invocable: true
---

# Recursive Decomposition

Break a complex task into sub-plans with explicit dependencies, then execute them in topological waves using `mort-repl`. Every agent — root or child — runs this same algorithm.

## The Algorithm

```
decompose(plan_path):
  1. Read the plan file
  2. If I can implement this directly → do it, write .result.md, done
  3. Otherwise → decompose into sub-plans with a dependency table
  4. Compute topological waves from the dependency graph
  5. Execute wave by wave (full parallelism within each wave)
  6. Summarize results
```

## Instructions

Given the user's task in `$ARGUMENTS`:

### Step 1: Determine the Plan Path

- If `$ARGUMENTS` is a path to an existing `.md` file → use it directly (you're a child executing a sub-plan)
- Otherwise → create a new plan directory and root plan:
  1. Derive a task slug from the goal (kebab-case)
  2. Create `plans/<task-slug>/readme.md` with the task description
  3. Use that as your plan path

### Step 2: Read and Assess the Plan

Read the plan file. If you're a child with dependencies, also read the dependency table from your parent's `readme.md` and load any `.result.md` files for your upstream dependencies. These give you context about what prior tasks produced.

**Base case check:** Can you implement this task directly in a single agent context? Consider:
- Is the scope narrow enough to implement without further breakdown?
- Can you hold the full implementation in your head?

If yes → implement it directly, then write your result (see "Writing Results" below). You're done.

If no → proceed to decomposition.

### Step 3: Decompose into Sub-Plans

Create numbered sub-plan files in the same directory as your plan:

```
<plan-dir>/
  readme.md                # Your plan + dependency table
  01-setup-database.md     # Sub-plan
  02-auth-module.md        # Sub-plan
  03-api-endpoints.md      # Sub-plan (depends on 01, 02)
```

Each sub-plan file should describe **what** needs to happen, not **how**. Include enough context for an independent agent to understand the goal, constraints, and expected outputs.

Then add a dependency table to your `readme.md`:

```markdown
## Dependencies

| Sub-Plan | Depends On | Status |
|----------|-----------|--------|
| 01-setup-database | — | pending |
| 02-auth-module | — | pending |
| 03-api-endpoints | 01-setup-database, 02-auth-module | blocked |
```

**Status values:**
- `pending` — ready to execute (no unmet dependencies)
- `in-progress` — currently being executed
- `completed` — finished successfully
- `blocked` — waiting on incomplete dependencies
- `failed` — execution failed

A sub-plan is `blocked` when any dependency has not `completed`. When all dependencies complete, update it to `pending`.

### Step 4: Execute in Topological Waves

Read the dependency table you just wrote. Determine which tasks can run in parallel by reasoning about the dependency graph:

1. **Identify waves** — tasks with no unmet dependencies form the next wave. You can figure this out by reading the table; do NOT write graph-sorting code in the REPL.
2. **Execute one wave at a time** — write a minimal `mort-repl` script that spawns the wave's tasks in parallel:

> **The slash command must be the first thing in the prompt.** Claude Code only auto-expands skills into `<command-name>` tags when the `/command` appears at the start of the message. If buried mid-sentence, the agent must make an extra Skill tool call to load the skill content.

```bash
mort-repl <<'MORT_REPL'
const results = await Promise.all([
  mort.spawn({ prompt: "/mort:decompose plans/my-task/01-setup-database.md" }),
  mort.spawn({ prompt: "/mort:decompose plans/my-task/02-auth-module.md" }),
]);
return results.map((r, i) => `Task ${i + 1}: ${r.slice(0, 200)}`).join("\n");
MORT_REPL
```

3. **Between waves**, use your normal tools (Read/Edit/Write) to:
   - Check the results and write `.result.md` files for each completed task
   - Update the dependency table statuses in `readme.md`
   - Unblock the next wave (change `blocked` → `pending` for tasks whose deps all completed)
   - Decide if failures change the plan

4. **Repeat** for each subsequent wave until all tasks are done or blocked by failures.

**Important:** Do NOT write file-parsing, topological-sorting, or status-update code in the REPL. You can read and reason about the dependency table yourself. The REPL is only for `mort.spawn()` calls with `Promise.all`.

### Step 5: Writing Results

When you finish (either by implementing directly or after orchestrating sub-plans), write a `.result.md` file summarizing what was accomplished. If you're a child agent, this file is how your parent and downstream siblings learn what you produced.

The result file should include:
- What was implemented or accomplished
- Key artifacts produced (files created/modified, APIs added, etc.)
- Anything downstream tasks need to know

**If implementing directly (base case):** write `<plan-dir>/<your-plan-name>.result.md` as a sibling to the sub-plan file that was assigned to you. The parent orchestrator handles writing this for children spawned via mort-repl, but if you are the root agent implementing directly, write it yourself.

**If you decomposed:** your result is the summary of all sub-task results.

## Child Context Discovery

When a child agent is spawned on a sub-plan, it discovers its own context:

1. Read its assigned sub-plan file (the goal)
2. Read the parent's `readme.md` to find the dependency table
3. Identify its upstream dependencies from the table
4. Read the `.result.md` files for those dependencies (they exist because the parent only spawns you after your deps complete)
5. Use that context to inform implementation

This means children are self-orienting — the orchestrator doesn't need to pass context explicitly.

## Further Decomposition

If a child decides its sub-plan needs further breakdown, it creates a subdirectory:

```
<plan-dir>/
  readme.md
  01-setup-database.md
  02-auth-module/              # Child decomposed further
    readme.md                  # Its own dependency table
    01-password-hashing.md
    02-session-management.md
    03-middleware.md
  03-api-endpoints.md
```

The child replaces its `.md` file with a directory of the same name (minus extension), creates its own `readme.md` with a dependency table, and runs the same wave-based execution. The recursion is natural.

## Failure Handling

- If a child fails, mark it `failed` in the dependency table and log the error
- Continue executing other tasks whose dependencies are all met
- Tasks depending on a failed task remain `blocked` — they are **not** executed
- At the end, report which tasks failed and which succeeded
- Do not retry automatically — let the user decide

## Key Principles

- **No distinction between root and child.** Every agent runs this same algorithm.
- **The base case is judgment, not a heuristic.** You decide whether to implement or decompose further based on your assessment of the task's complexity.
- **Data flows through disk.** Sub-plans are `.md` files. Results are `.result.md` files. Children read their own context from the filesystem.
- **Each level owns its dependency table.** Only the orchestrating agent at a given level modifies its `readme.md`. No race conditions.
- **Sub-plans describe what, not how.** Give children goals and constraints, not step-by-step instructions. They have full autonomy over implementation.
