# Recursive Decomposition Skill

## Summary

A new skill (`/decompose`) where every agent — root or child — runs the same algorithm: read the task, decide whether to implement directly or break it down, and if breaking it down, create sub-plans with dependencies and spawn children who each run `/decompose` on their sub-plan. The recursion is natural: each agent owns its subtree completely.

## Motivation

Large tasks today require manual decomposition. The orchestrate skill handles parallel execution, and breadcrumb handles sequential continuation, but neither handles **structured decomposition with dependency ordering**. This skill automates the full cycle: decompose → order → execute → recurse.

## The Recursive Unit

Every invocation of `/decompose` follows the same contract regardless of depth:

```
decompose(plan_path):
  // 1. Base case — implement directly
  if I can implement this myself:
    implement it
    return result    // what I did, what I produced — written to .result.md

  // 2. Decomposition phase — break into sub-plans
  sub_plans = create_sub_plans(task)   // writes .md files + dependency table

  // 3. Execution phase — topological waves with parallelism
  waves = topological_sort(sub_plans)  // e.g. [[01], [02, 03], [04]]

  for wave in waves:
    await parallel(wave.map(plan =>
      decompose(plan.path)             // recursive — child discovers deps from disk
    ))

  return summarize()
```

The algorithm has two clear phases after the base-case check: **decompose** (break the task into sub-plans with a dependency table) then **execute** (run sub-plans in topological waves, each wave fully parallel). Each child runs `decompose` again — same algorithm, same contract.

Data flows through disk: when a child completes, its result is written to a `.result.md` file. Downstream children discover their dependencies from the parent's `readme.md` and read the corresponding `.result.md` files themselves. The orchestrator just manages ordering — it doesn't broker data.

There is no distinction between root and child. Every agent runs this exact algorithm. The base case is the agent's own judgment — "can I implement this, or should it be further decomposed?" — with no prescribed heuristics.

## Plan Directory Structure

The skill doesn't hardcode a directory. The root invocation specifies a plan path (e.g. `plans/my-feature/readme.md`), and all decomposition happens relative to that directory. Each decomposition creates a directory with a `readme.md` (dependency table) and numbered sub-plan files:

```
<plan-dir>/
  readme.md              # Summary + dependency table
  01-setup-database.md   # Sub-plan
  02-auth-module.md      # Sub-plan
  03-api-endpoints.md    # Sub-plan (depends on 01, 02)
```

When a child decides to decompose further, it creates a subdirectory named after its sub-plan:

```
<plan-dir>/
  readme.md
  01-setup-database.md
  02-auth-module/         # Child decomposed further
    readme.md             # Its own dependency table
    01-password-hashing.md
    02-session-management.md
    03-middleware.md       # depends on 01, 02
  03-api-endpoints.md     # depends on 02 (the whole subtree)
```

This mirrors the recursion: each directory is a self-contained decomposition with its own dependency graph. The caller chooses where the plan tree lives — `plans/`, a temp directory, wherever makes sense.

## Dependency Table Format

Each `readme.md` declares dependencies between its immediate children:

```markdown
## Dependencies

| Sub-Plan | Depends On | Status |
|----------|-----------|--------|
| 01-setup-database | — | pending |
| 02-auth-module | 01-setup-database | pending |
| 03-api-endpoints | 01-setup-database, 02-auth-module | blocked |
```

Status values: `pending` (ready to run), `in-progress`, `completed`, `blocked` (waiting on dependencies), `failed`.

A sub-plan is `blocked` when any dependency is not `completed`. When all dependencies complete, it becomes `pending`. Only the orchestrating agent at that level modifies its own `readme.md` — no race conditions.

### Result Files

When a child completes, the orchestrator writes its result to a sibling file:

```
<plan-dir>/
  readme.md
  01-setup-database.md          # sub-plan (input)
  01-setup-database.result.md   # what the child produced (output)
  02-auth-module.md
  03-api-endpoints.md
```

The `.result.md` file is the child's returned summary — what it did, what it produced, any artifacts downstream tasks need to know about. Children with dependencies read the `.result.md` files for their upstream tasks themselves — the orchestrator doesn't need to pass them.

This keeps the information flow on disk and inspectable. You can read the result files to understand what happened at any point in the execution. Children discover their own context rather than having it spoon-fed.

## Execution: Topological Waves

After decomposition, the orchestrating agent determines the topological wave order by reading and reasoning about the dependency table — no programmatic graph sorting needed. Execution proceeds one wave at a time:

1. **The agent identifies the next wave** — tasks whose dependencies have all completed (or that have no dependencies).
2. **The agent writes a minimal REPL script** that spawns the wave in parallel:

```bash
mort-repl <<'MORT_REPL'
const results = await Promise.all([
  mort.spawn({ prompt: "Use /decompose to execute: plans/my-task/01-setup.md" }),
  mort.spawn({ prompt: "Use /decompose to execute: plans/my-task/02-auth.md" }),
]);
return results.map((r, i) => `Task ${i + 1}: ${r.slice(0, 200)}`).join("\n");
MORT_REPL
```

3. **Between waves**, the agent uses its normal tools (Read/Edit/Write) to check results, write `.result.md` files, update statuses in `readme.md`, and decide if failures change the plan.
4. **Repeat** for each subsequent wave.

The wave structure makes the execution predictable: all tasks in wave N complete before any task in wave N+1 starts. Within a wave, everything runs in parallel. The REPL is only used for `mort.spawn()` calls — all file reading, status updates, and decision-making happen at the agent level.

## Child Prompt

The child prompt is just a plan path and a skill invocation:

```
Use /decompose to execute the sub-plan at: plans/my-task/03-api-endpoints.md
```

That's it. The child invokes `/decompose`, which loads the same skill instructions, reads the sub-plan file, discovers its dependencies from the parent's `readme.md`, reads their `.result.md` files, and runs the same algorithm: implement directly or decompose further. The recursion happens through the skill system, and context flows through disk.

## Failure Handling

If a child agent fails:
- Mark the sub-plan as `failed`
- Log the error
- Continue executing other unblocked tasks (tasks depending on the failed one remain `blocked`)
- At the end, report which tasks failed and which succeeded
- Do not retry — let the user decide

## Mid-Execution Adaptation

Decomposition happens upfront, but execution reveals new information. Rather than adding re-planning machinery, we trust children to adapt. Each child reads its sub-plan (the goal) and its upstream `.result.md` files (the reality). If upstream results shift the context — an assumption was wrong, a sub-plan is partially obsolete, or new considerations emerged — the child adapts on its own. Sub-plans describe *what* needs to happen, not *how*, so they're naturally resilient to upstream surprises.

If a child discovers its sub-plan is entirely unnecessary, it says so in its result. If the task changed shape, it addresses what actually needs doing. No signal protocol, no re-decomposition step — just agent judgment at every leaf.

## Cycle Detection

The dependency graph must be a DAG. The `topologicalSort` step validates this — if the graph has cycles, it throws before any execution begins. This is caught at decomposition time, not discovered mid-execution.

## File Changes

| File | Change |
|------|--------|
| `plugins/mort/skills/decompose/SKILL.md` | New skill — the complete self-similar decomposition + execution protocol |

No code changes. The skill is a pure SKILL.md prompt. The agent reasons about dependencies and writes minimal REPL scripts (just `Promise.all` + `mort.spawn()`) for parallel execution.

## Phases

- [x] Research: review existing decomposed plan examples and the breadcrumb/orchestrate skills to confirm the mort-repl patterns work for nested spawning
- [x] Write `plugins/mort/skills/decompose/SKILL.md` — the complete self-contained skill with: decompose protocol, dependency table format, mort-repl loop pattern, self-propagating child prompt template, failure/deadlock handling
- [ ] Smoke test: invoke `/decompose` on a medium-complexity task and verify the recursive decomposition + dependency-ordered execution works

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design Decisions

### Why is every node identical?

The root agent and every child run the same algorithm. This makes the system simple to reason about — there's one set of instructions, not a "root mode" and "child mode." It also means the depth of recursion is emergent, determined entirely by the agents' judgment about task complexity.

### No prescribed heuristics for the base case

The agent decides whether to implement or decompose based on its own assessment. Prescribing rules like "< 500 lines = implement" would be arbitrary and fragile. The agent has context about the specific task, the codebase, and its own capabilities — let it decide.

### Recursion via the skill system

Children are spawned with a prompt that invokes `/decompose` on their sub-plan path. The skill system loads the same SKILL.md at every level, so children run the identical algorithm without the parent embedding protocol instructions in the prompt. This keeps child prompts minimal and avoids the protocol growing stale across levels.

### No hardcoded output directory

The skill operates on whatever path it's given. The caller decides where plans live — `plans/`, a project-specific directory, wherever. This keeps the skill generic and avoids imposing directory structure opinions.

### Race condition safety

Each orchestrating agent only modifies its own `readme.md`. Children modify their own sub-plan files and the codebase, but never their parent's readme. Since each level of the tree has exactly one writer for its dependency table, there are no concurrent modification issues.

### Complementary to breadcrumbs

Breadcrumbs handle sequential continuation (one agent after another on the same long task). Decomposition handles parallel execution of independent sub-tasks. A future enhancement: if a leaf agent implementing a sub-task hits context limits, it could use breadcrumbs to continue.
