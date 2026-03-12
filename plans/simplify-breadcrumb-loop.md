# Simplify Breadcrumb Loop

The breadcrumb-loop skill has too much programmatic logic. The mort-repl code builds elaborate prompts, manages file numbering, constructs wrap-up messages, and reads final results — all things the agent can infer. The fix: make `/breadcrumb` user-invocable and self-sufficient, then reduce the loop to a thin `mort.spawn` wrapper.

## Current Problem

**`breadcrumb-loop/SKILL.md`** (100+ lines) contains:
- A 25-line prompt template embedded in JS
- File number calculation (`lastBreadcrumb`, `nextBreadcrumb`, zero-padding)
- A custom `WRAP_UP_MESSAGE` with string replacement
- Post-loop `fs.readdirSync` to summarize results
- Inline instructions that duplicate what the breadcrumb skill already says

**`breadcrumb/SKILL.md`** is `user-invocable: false` — it's just a reference doc that nobody invokes. All the real instructions get baked into the loop's programmatic prompt.

## Design

### Make `/breadcrumb` the brain

Change `breadcrumb` to `user-invocable: true`. It receives `$ARGUMENTS` = `<iteration-number> <breadcrumb-dir>` (e.g., `/breadcrumb 3 plans/implement-auth`).

The skill contains all the intelligence:
- Read `readme.md` for the objective
- Scan for existing `NNN-progress.md` files to understand prior state
- Work autonomously
- Write `NNN-progress.md` (derive NNN from iteration number)
- Signal `BREADCRUMB_COMPLETE` only when 100% done
- Handle the context short-circuit nudge

### Make the loop dumb

The `breadcrumb-loop` mort-repl code shrinks to ~15 lines:

```javascript
const BREADCRUMB_DIR = "plans/<task-slug>";
const MAX_ITERATIONS = 100;

for (let i = 0; i < MAX_ITERATIONS; i++) {
  mort.log(`Iteration ${i + 1}`);

  const result = await mort.spawn({
    prompt: `/breadcrumb ${i + 1} ${BREADCRUMB_DIR}`,
    contextShortCircuit: {
      limitPercent: 75,
      message: "Context running low — stop new work and save your breadcrumb now.",
    },
  });

  if (result.includes("BREADCRUMB_COMPLETE")) {
    mort.log("Task completed!");
    break;
  }
}
```

No prompt building, no file number math, no post-loop file reading. The loop just runs `/breadcrumb` with the iteration number and checks for the completion signal.

### What moves from loop → breadcrumb skill

| Concern | Before (in loop's JS) | After (in breadcrumb skill) |
|---|---|---|
| Read readme.md | Prompt says "read readme.md" | Skill says "read readme.md" |
| Find latest breadcrumb | JS calculates `lastBreadcrumb` | Skill says "scan for existing progress files" |
| Next breadcrumb filename | JS calculates `nextBreadcrumb` | Skill derives from `$ARGUMENTS` iteration number |
| Wrap-up instructions | Inline in prompt + `WRAP_UP_MESSAGE` | Skill has the protocol |
| Breadcrumb format | Duplicated in both skills | Single source in breadcrumb skill |
| Completion signal | Explained in prompt | Explained in breadcrumb skill |

## Files to Change

| File | Change |
|---|---|
| `plugins/mort/skills/breadcrumb/SKILL.md` | Make user-invocable, accept `$ARGUMENTS`, add full self-contained instructions |
| `plugins/mort/skills/breadcrumb-loop/SKILL.md` | Strip to minimal: create dir + readme.md, run simple loop |

## Phases

- [ ] Rewrite `breadcrumb/SKILL.md` — make user-invocable, accept iteration number + dir from `$ARGUMENTS`, contain all breadcrumb protocol instructions
- [ ] Rewrite `breadcrumb-loop/SKILL.md` — strip to: create task dir + readme.md, run minimal mort-repl loop that invokes `/breadcrumb N dir`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
