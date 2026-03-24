# Breadcrumb System Improvements

Three fixes: less prescriptive breadcrumbs, proper per-task plan directories, and a critical context utilization bug.

## 1. Breadcrumbs Are Too Prescriptive

**Problem**: The breadcrumb file format and child prompt encourage the next agent to follow a detailed playbook instead of exercising judgment. Look at `003-progress.md` — it contains 50+ lines of specific chapter content, character bios, and step-by-step instructions. The "Next Steps" section essentially scripts the next agent's entire session. This defeats the design principle stated in the breadcrumb protocol: "Don't just follow a checklist from the previous breadcrumb; use your own judgment."

**Fix**: Revise both `plugins/anvil/skills/breadcrumb/SKILL.md` and `plugins/anvil/skills/breadcrumb-loop/SKILL.md` to:

- **Shrink the breadcrumb format**. Replace the current 6-section template with a leaner one:

  ```markdown
  # Progress NNN
  
  ## Done
  - [what was accomplished — facts, not instructions]
  
  ## Remaining
  - [what's left — scope, not how-to]
  
  ## Context
  - [decisions made, blockers hit, non-obvious discoveries]
  ```

  Drop the "Next Steps" and "Files Changed" sections entirely. The next agent reads the goal and the codebase — it doesn't need a playbook. "Context" captures anything non-obvious that would be lost between contexts (e.g., "the API returns 404 for deleted users, not 400 — the tests expect this").

- **Update the child prompt** (in `breadcrumb-loop/SKILL.md`) to say:

  > Your breadcrumb should capture what you did and what remains. Keep it factual and concise — under 50 lines. Do NOT write instructions for the next agent. They will read the goal and codebase themselves. Only include context that would be lost between sessions (decisions, blockers, surprises).

- **Cap breadcrumb size** at 50 lines instead of 200. Forces conciseness.

## 2. Give Breadcrumb Tasks Their Own Plan Directory

**Problem**: Breadcrumb progress files currently live under `plans/breadcrumbs/<task-slug>/`, a shared subdirectory that doesn't follow the standard folder-per-task convention used by the rest of `plans/`.

**Fix**: Each breadcrumb task gets its own top-level plan directory at `plans/<task-slug>/`, just like any other plan. The key changes:

- Change the default breadcrumb directory from `plans/breadcrumbs/<task-slug>/` to `plans/<task-slug>/`
- **Rename** `goal.md` **to** `readme.md` so the task shows up properly as a named folder in the sidebar (consistent with the `decompose` skill which already uses `readme.md` as the parent file)
- Update both [SKILL.md](http://SKILL.md) files and the plan doc to reference the new path and filename
- Remove the `plans/breadcrumbs/` nesting — each task is a direct child of `plans/`
- Delete existing `plans/breadcrumbs/` directory (already deleted on this branch)

## 3. Context Utilization Bug — `cumulativeInputTokens` Double-Counts

**Problem**: Agents hit the `limitPercent: 75` short-circuit WAY earlier than 75% real context usage. Looking at `message-handler.ts:185-186`:

```ts
const totalContextTokens = totalInput + cacheCreation + cacheRead;
this.cumulativeInputTokens += totalContextTokens;
```

This **accumulates** input tokens across turns. But each turn's `input_tokens + cache_creation + cache_read` already represents the **full conversation context** for that API call (the entire history is re-sent every turn). Summing across turns double/triple/N-counts the history.

Example with 200k context window:

- Turn 1: 10k total → cumulative = 10k → utilization = 5% (real: 5%)
- Turn 2: 15k total → cumulative = 25k → utilization = 12.5% (real: 7.5%)
- Turn 3: 20k total → cumulative = 45k → utilization = 22.5% (real: 10%)
- Turn 10: 50k total → cumulative = \~300k → utilization = 150% (real: 25%)

By the time real utilization hits \~25-30%, the cumulative calculation already shows 75%+. This explains why the novel-writing agents burn through 3 contexts without writing a single chapter — they're being nudged to wrap up almost immediately.

**Fix** in `message-handler.ts`:

- Change `cumulativeInputTokens` to track the **latest turn's** total, not a running sum:

  ```ts
  // Before (wrong — accumulates across turns):
  this.cumulativeInputTokens += totalContextTokens;
  
  // After (correct — latest turn = current context usage):
  this.latestInputTokens = totalContextTokens;
  ```

- Update `getUtilization()` to use `this.latestInputTokens`

- Keep the cumulative sum if it's still needed for `CONTEXT_PRESSURE` drain events (rename to make intent clear), but `getUtilization()` must use the latest value

**Note on** `CONTEXT_PRESSURE` **drain events**: The existing threshold-based drain events (`checkContextPressure()`) use the same `cumulativeInputTokens` and have the same bug. They'll fire at wrong thresholds too. Fix those to use the latest turn's tokens as well.

**Validation**: The existing integration test at `agents/src/testing/__tests__/context-short-circuit.integration.test.ts` uses `limitPercent: 1` which will still trigger. We should also check that the test's assertions make sense with the corrected calculation. A real utilization of \~1.5% (3k/200k) on the first turn should still trigger the 1% threshold correctly.

## Phases

- [x] Fix context utilization bug in `message-handler.ts` — use latest turn tokens instead of cumulative sum for `getUtilization()` and `checkContextPressure()`

- [x] Revise breadcrumb format in `plugins/anvil/skills/breadcrumb/SKILL.md` — leaner template, no "Next Steps" playbook, 50 line cap

- [x] Revise child prompt in `plugins/anvil/skills/breadcrumb-loop/SKILL.md` — instruct concise factual breadcrumbs, no instructions for next agent

- [x] Update breadcrumb directory from `plans/breadcrumbs/<task-slug>/` to `plans/<task-slug>/` and rename `goal.md` → `readme.md` in both [SKILL.md](http://SKILL.md) files

- [x] Verify integration test still passes with the utilization fix

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Files to Change

| File | Change |
| --- | --- |
| `agents/src/runners/message-handler.ts` | Fix `getUtilization()` and `checkContextPressure()` to use latest turn tokens, not cumulative sum |
| `plugins/anvil/skills/breadcrumb/SKILL.md` | Leaner breadcrumb template (Done/Remaining/Context, 50 line cap) |
| `plugins/anvil/skills/breadcrumb-loop/SKILL.md` | Update child prompt, breadcrumb dir path (`plans/<task-slug>/`), and rename `goal.md` → `readme.md` |
| `plugins/anvil/skills/breadcrumb/SKILL.md` | Also update `goal.md` → `readme.md` references |
| `plans/breadcrumb-skill-system.md` | Update directory references and format description |
