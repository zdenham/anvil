---
name: breadcrumb
description: Pick up a long-running task from a breadcrumb directory, make progress, and save state
user-invocable: true
---

# Breadcrumb

Pick up a long-running task, make as much progress as possible, then save your state so the next agent can continue.

## Arguments

`$ARGUMENTS` contains: `<breadcrumb-directory> <iteration-number>`

Example: `/breadcrumb plans/my-task 3`

- **breadcrumb-directory**: path to the directory containing `readme.md` and `NNN-progress.md` files
- **iteration-number**: your iteration (used for naming your breadcrumb file)

## Steps

### 1. Orient

- Read `readme.md` in the breadcrumb directory for the full objective and acceptance criteria
- List `*-progress.md` files in the directory — read the latest one (and older ones if you need more history)
- If this is iteration 1, there won't be any progress files yet — just use `readme.md`
- Explore the codebase as needed to understand the current state of the work

### 2. Work

You have full autonomy. Explore the codebase, make decisions, edit files, run tests, refactor — whatever moves the goal forward. Don't just follow a checklist from the previous breadcrumb; use your own judgment about what's most impactful.

Commit frequently — logical units as you go. This ensures your work is preserved even if something goes wrong.

### 3. Save State

When you're done working (or when you receive a context pressure message telling you to wrap up):

1. **Stop new work** — don't start anything you can't finish
2. **Write your breadcrumb file** to `<breadcrumb-directory>/<NNN>-progress.md` where NNN is your iteration number zero-padded to 3 digits (e.g., iteration 3 → `003-progress.md`)
3. **Commit** all work including the breadcrumb file

Your breadcrumb should capture what you did and what remains. Keep it factual and concise — **under 50 lines**. Do NOT write instructions for the next agent. They will read the goal and codebase themselves. Only include context that would be lost between sessions (decisions, blockers, surprises).

```markdown
# Progress NNN

## Done
- [what was accomplished — facts, not instructions]

## Remaining
- [what's left — scope, not how-to]

## Context
- [decisions made, blockers hit, non-obvious discoveries]
```

### 4. Completion Signal

**Only** include `BREADCRUMB_COMPLETE` in your final message if you have **100% confidence** the overall goal is fully met — all acceptance criteria satisfied, tests passing, no loose ends.

If there is *any* remaining work, *any* untested edge case, *any* uncertainty — do NOT signal completion. Another agent will pick up where you left off. It's always better to run one extra iteration than to prematurely stop.
