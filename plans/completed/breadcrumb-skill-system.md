# Breadcrumb Skill System

## Summary

Two new skills — `breadcrumb-loop` (user-invocable) and `breadcrumb` (sub-agent only) — that enable long-running tasks to span multiple agent contexts. A parent agent runs a sequential loop of child agents, each picking up where the last left off via concise progress files ("breadcrumbs").

## Motivation

Single agents hit context limits on large tasks. Today the user must manually re-prompt continuations. The breadcrumb system automates this: a loop spawns agents sequentially, each reading prior breadcrumbs and writing their own before context runs out, so progress compounds across iterations.

## Architecture

```
User invokes /breadcrumb-loop "Implement the auth module"
  │
  ├─ Parent agent (breadcrumb-loop skill):
  │   1. Creates breadcrumb dir: plans/breadcrumbs/<task-slug>/
  │   2. Writes goal.md with the overall objective
  │   3. Runs anvil-repl loop (sequential, not parallel)
  │       │
  │       ├─ Iteration 1: anvil.spawn({ prompt, contextShortCircuit })
  │       │   Prompt says: "no prior breadcrumbs, write 001-progress.md"
  │       │   Child reads goal.md, explores, works, writes 001-progress.md
  │       │
  │       ├─ Iteration 2: anvil.spawn({ prompt, contextShortCircuit })
  │       │   Prompt says: "latest breadcrumb: 001-progress.md, write 002-progress.md"
  │       │   Child reads goal.md + breadcrumbs as needed, continues work
  │       │
  │       └─ ... until goal is met or max iterations reached
  │
  └─ Parent checks last child result for completion signal → exits loop
```

## Skill Definitions

### `breadcrumb-loop` (user-invocable)

**File**: `plugins/anvil/skills/breadcrumb-loop/SKILL.md`

This skill instructs the parent agent to:

1. **Parse the goal** from `$ARGUMENTS`
2. **Create the breadcrumb directory** at `plans/breadcrumbs/<task-slug>/` with a `goal.md` summarizing the objective, acceptance criteria, and any relevant context
3. **Run a anvil-repl loop** that spawns child agents sequentially:
   - Each child gets the same well-crafted prompt (see "Child Prompt Design" below)
   - Each child uses `contextShortCircuit` (depends on context-short-circuit plan being implemented)
   - After each child completes, the parent checks its result for a **completion signal** (`BREADCRUMB_COMPLETE`) — if found, exit the loop
   - Cap at a configurable max iterations (default: 100) as a safety valve
4. **Report final status** — summarize what was accomplished by reading the breadcrumb trail

The anvil-repl code the parent writes would look roughly like:

```javascript
const BREADCRUMB_DIR = "plans/breadcrumbs/<task-slug>";
const MAX_ITERATIONS = 100;

for (let i = 0; i < MAX_ITERATIONS; i++) {
  const num = String(i + 1).padStart(3, "0");
  const lastBreadcrumb = i === 0 ? null : `${String(i).padStart(3, "0")}-progress.md`;
  const nextBreadcrumb = `${num}-progress.md`;

  anvil.log(`Breadcrumb iteration ${i + 1}/${MAX_ITERATIONS}`);

  const result = await anvil.spawn({
    prompt: buildChildPrompt(BREADCRUMB_DIR, { lastBreadcrumb, nextBreadcrumb }),
    contextShortCircuit: {
      limitPercent: 75,
      message: WRAP_UP_MESSAGE,
    },
  });

  // Check for completion signal — child must have 100% confidence
  if (result.includes("BREADCRUMB_COMPLETE")) {
    anvil.log("Task completed!");
    break;
  }
}

return readFinalSummary(BREADCRUMB_DIR);
```

**Key**: The skill should tell the parent agent to write this anvil-repl code itself — the SKILL.md provides the pattern, not a hardcoded script. This lets the parent adapt the loop parameters (max iterations, limitPercent, directory name) based on the specific task.

### `breadcrumb` (sub-agent only, NOT user-invocable)

**File**: `plugins/anvil/skills/breadcrumb/SKILL.md`

This skill is NOT user-invocable (`user-invocable: false`). It gets referenced in the child agent's prompt so the agent knows how to behave. The child agent doesn't invoke it — the instructions are embedded directly in the prompt the parent constructs.

The breadcrumb skill defines the **protocol** each child agent follows. The protocol is deliberately loose — children are autonomous agents, not script executors. They decide how to approach the work, what to read, and how to organize their effort. The protocol only constrains the *handoff* mechanics (reading/writing breadcrumbs).

1. **Orient yourself**: Read `goal.md` and the latest breadcrumb file (the parent tells you which one) to understand the objective and current state. Read older breadcrumbs if you need more context — but you may not need all of them.
2. **Work on the task**: You have full autonomy. Explore the codebase, make decisions, edit files, run tests, refactor — whatever moves the goal forward. Don't just follow a checklist from the previous breadcrumb; use your own judgment about what's most impactful.
3. **Commit work frequently**: Don't batch — commit logical units as you go.
4. **When nudged to wrap up** (context short-circuit message appears):
   - Write your breadcrumb file (`NNN-progress.md`) — see format below
   - Make a final commit including the breadcrumb file
   - **Completion signal**: Only include `BREADCRUMB_COMPLETE` in your final message if you have **100% confidence** the overall goal is fully met. This means: all acceptance criteria satisfied, tests passing, no loose ends. If there is *any* remaining work, *any* untested edge case, *any* uncertainty — do NOT signal completion. Leave no stone unturned. Another agent will pick up where you left off, and that's fine.
5. **Breadcrumb file format**: Concise, <200 lines, structured as:

```markdown
# Progress: [brief description]

## Completed
- [concrete items done this iteration]

## Remaining
- [concrete items still to do — be specific]

## Next Steps
- [what the next agent should tackle first and why]
- [specific files, functions, or areas to focus on]
- [any shortcuts or patterns you discovered that would save the next agent time]
- [commands to run, tests to check, etc.]

## Decisions & Notes
- [any architectural decisions, blockers, or context the next agent needs]

## Files Changed
- [list of files modified this iteration]
```

The **Next Steps** section is critical — it's your gift to the next agent. Be specific and actionable. Don't just say "continue implementing X"; say "the validation logic in `src/auth/validate.ts` is stubbed out — the Zod schema is defined but the three edge cases in the TODO comments still need handlers. Run `pnpm test -- auth` to see the two failing tests." The more concrete you are, the faster the next agent ramps up.

## Child Prompt Design

The prompt should be **minimal and trust the agent**. Don't over-specify how to work — just tell them where to find context, what file to write when wrapping up, and the completion bar. Let them read the goal and breadcrumbs themselves and decide how to proceed.

The parent supplies:
- The breadcrumb directory path
- The last breadcrumb file number (or "none" if first iteration)
- The next breadcrumb file number to write
- The protocol for wrapping up

The parent does **NOT** inline `goal.md` contents into the prompt. The child reads it themselves — this lets them decide how much context to pull in and when.

Template (the parent agent fills this in):

```
You are picking up a long-running task. Previous agents may have made progress.
Your job: make as much progress as possible, then save your state before context
runs out.

## Breadcrumb Directory

plans/breadcrumbs/<task-slug>/

- Read `goal.md` for the full objective and acceptance criteria
- Latest breadcrumb: <NNN-progress.md | "none — you're the first agent">
  (older breadcrumbs exist too if you need more history)

## When You're Done (or context pressure hits)

1. Write your breadcrumb to: plans/breadcrumbs/<task-slug>/<NEXT_NNN>-progress.md
2. Commit all work including the breadcrumb file
3. ONLY include "BREADCRUMB_COMPLETE" in your final message if the goal is
   100% met — all acceptance criteria satisfied, tests passing, no loose ends.
   If ANY work remains, do not signal completion.

Your breadcrumb should include: what you did, what remains, and — critically —
specific next steps for the agent that follows you (files to look at, commands
to run, patterns you discovered, shortcuts to save them time).

## Context Short-Circuit

You will receive a message when your context is running low. When you see it,
stop new work and focus on saving your progress as described above.
```

## Dependency: context-short-circuit

This plan depends on the `contextShortCircuit` option from `plans/context-short-circuit.md` being implemented. Without it, child agents won't know when to wrap up and will just hit the hard context limit.

**Fallback without context-short-circuit**: The child prompt could instruct the agent to be conservative and self-manage ("after completing each sub-task, check if you should save progress"), but this is unreliable. The context-short-circuit mechanism provides the actual pressure signal.

## Files to Create/Change

| File | Change |
| --- | --- |
| `plugins/anvil/skills/breadcrumb-loop/SKILL.md` | New skill — user-invocable, instructs parent to set up breadcrumb dir and anvil-repl loop |
| `plugins/anvil/skills/breadcrumb/SKILL.md` | New skill — NOT user-invocable, defines the child agent breadcrumb protocol |

**No code changes needed** — both skills are pure SKILL.md prompt files. The actual orchestration logic is written by the parent agent at runtime using anvil-repl (same as the orchestrate skill pattern). The `contextShortCircuit` API changes are covered by the separate context-short-circuit plan.

## Phases

- [x] Write `breadcrumb-loop/SKILL.md` — user-invocable skill with anvil-repl loop pattern, goal.md setup, iteration/completion logic
- [x] Write `breadcrumb/SKILL.md` — sub-agent protocol: read breadcrumbs, work, write progress, completion signal
- [ ] Test end-to-end with a real task (requires context-short-circuit to be implemented first)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design Decisions

### Why sequential, not parallel?
Each agent builds on the prior one's work. Parallel agents would create merge conflicts and duplicate effort. The breadcrumb trail is inherently sequential.

### Why `plans/breadcrumbs/` and not a temp directory?
Breadcrumbs are useful artifacts — they document the journey, aid debugging, and can be committed to the repo. Using `plans/` keeps them visible and follows existing conventions.

### Why embed the protocol in the prompt instead of having children invoke the breadcrumb skill?
Children need the handoff protocol from the start — they need to know where to find context and how to save progress. But the prompt is deliberately minimal: just paths, file numbers, and the wrap-up protocol. The child decides *how* to work. We don't inline goal.md or prescribe their approach — just the mechanics of the breadcrumb handoff.

### Why not inline goal.md in the child prompt?
The child should read goal.md itself. This keeps the prompt small, lets the child decide how much context to pull in, and avoids the parent's interpretation filtering the original goal. The child reads the source of truth directly.

### Why `BREADCRUMB_COMPLETE` as a signal?
Simple string matching in the parent's anvil-repl loop. No structured output parsing needed. The child includes it in its final message only when it has **100% confidence** the goal is fully met — all acceptance criteria satisfied, tests passing, no remaining work. The bar is intentionally high: it's better to run one extra iteration than to prematurely signal completion. If in doubt, don't signal — the next agent will verify and complete.

### Max iterations safety valve
Without a cap, a confused agent could loop forever. Default 100 gives ample runway for large tasks — most tasks should complete well before hitting the cap. The parent can adjust based on task scope.

### Breadcrumb file naming: `NNN-progress.md`
Zero-padded three-digit prefix (001, 002, ...) ensures correct sort order when globbed. The parent tells each child two things: the *last* breadcrumb file (so they know where to start reading) and the *next* file number to write. The child can read older breadcrumbs if they want more history, but they always know exactly which file is the most recent.
