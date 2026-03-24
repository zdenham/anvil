# Simplify Breadcrumb Loop Skill

## Problem

The breadcrumb-loop skill is overly complex. It constructs a huge prompt programmatically, manages breadcrumb file naming with zero-padded counters, inlines wrap-up instructions, and duplicates logic that the breadcrumb skill already (or should) contain. This rigidity hurts quality — the child agents should be given a simple task and trusted to figure things out.

## Approach

**Move intelligence into the `/breadcrumb` skill. Make the loop dumb.**

The loop should do almost nothing: spawn a child with `/breadcrumb <iteration>` and check if it signals completion. All the protocol knowledge (how to orient, how to write breadcrumbs, when to signal completion) lives in the breadcrumb skill.

## Phases

- [x] Rewrite the breadcrumb skill to be user-invocable and self-contained
- [x] Rewrite the breadcrumb-loop skill to be a minimal loop
- [x] Verify consistency between the two skills

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Rewrite the breadcrumb skill

Make it `user-invocable: true`. The skill receives `$ARGUMENTS` which will contain the iteration number and the breadcrumb directory path. The skill itself contains all the protocol instructions:

```yaml
---
name: breadcrumb
description: Pick up a long-running task from a breadcrumb directory, make progress, and save state
user-invocable: true
---
```

The skill body should instruct the agent to:

1. **Parse arguments** — expect the breadcrumb directory path and iteration number (e.g., `/breadcrumb plans/my-task 3`)
2. **Orient** — read `readme.md` for the objective, read the latest `*-progress.md` files for prior state
3. **Work** — make as much progress as possible, commit frequently
4. **Save state** — write `NNN-progress.md` (using the iteration number) with what was done and what remains
5. **Signal completion** — only include `BREADCRUMB_COMPLETE` in final message if 100% done

Key changes from current breadcrumb skill:
- Now user-invocable (can be called as `/breadcrumb`)
- Receives arguments instead of relying on parent to embed everything in the prompt
- Self-contained — all protocol details live here, not in the loop

## Phase 2: Rewrite the breadcrumb-loop skill

The new loop is radically simpler. The REPL code should be ~15 lines:

```
1. Create task slug + breadcrumb directory + readme.md (same as today)
2. Run anvil-repl with a simple loop:
   - anvil.spawn({ prompt: "/breadcrumb plans/<slug> <i>" }) with contextShortCircuit
   - Check result for BREADCRUMB_COMPLETE
   - Break or continue
3. Return summary
```

Key simplifications:
- **No giant prompt template** — just `/breadcrumb <dir> <iteration>`
- **No programmatic breadcrumb file naming** — the breadcrumb skill handles that
- **No inline wrap-up instructions** — the contextShortCircuit message just says "wrap up now" and the breadcrumb skill already knows what that means
- **No fs.readdirSync at the end** — just return the last spawn result or a simple log

The contextShortCircuit message becomes minimal:
```
"Your context is running low. Stop new work and save your progress now."
```

The breadcrumb skill already has the full wrap-up protocol, so we don't need to repeat it.

## Phase 3: Verify consistency

Ensure the breadcrumb skill's argument format matches what the loop passes. Ensure the completion signal (`BREADCRUMB_COMPLETE`) is referenced consistently in both files.
