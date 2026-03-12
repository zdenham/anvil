# Simplify Decompose Skill — Minimal REPL Code

## Problem

The `/decompose` skill contains a ~100-line mort-repl template (SKILL.md lines 92-189) that does file parsing, topological sorting, status tracking, and wave execution all in JavaScript. When agents use the skill, they copy this template nearly verbatim, producing bloated REPL code that:

1. **Duplicates agent capabilities** — regex-parsing markdown tables and computing topological order are things the LLM can do natively by reading the file
2. **Is fragile** — programmatic markdown parsing breaks on formatting variations
3. **Misuses the REPL** — the REPL should be a thin orchestration layer for `mort.spawn()`, not a general-purpose scripting environment
4. **Obscures intent** — the actual task (spawn N agents in parallel) is buried under infrastructure code

## Desired Behavior

The agent should:
1. Read the `readme.md` dependency table itself
2. Determine the topological waves using its own reasoning
3. For each wave, write a minimal REPL script that's just a `Promise.all` of `mort.spawn()` calls
4. Between waves, the agent updates status in the readme.md using its normal file editing tools
5. Sub-agents get `/decompose <path>` in their prompt

Example of what a wave execution should look like:

```bash
mort-repl <<'MORT_REPL'
const results = await Promise.all([
  mort.spawn({ prompt: "Use /decompose to execute: plans/my-task/01-setup.md" }),
  mort.spawn({ prompt: "Use /decompose to execute: plans/my-task/02-auth.md" }),
]);
return results.map((r, i) => `Task ${i + 1}: ${r.slice(0, 200)}`).join("\n");
MORT_REPL
```

That's it. No file parsing, no topological sort in JS, no status update helpers. The agent handles everything else.

## Changes

### 1. Rewrite `plugins/mort/skills/decompose/SKILL.md`

**Remove:**
- The entire mort-repl template (Step 4, lines 84-191)
- All programmatic parsing logic, topological sort code, status update helpers

**Replace with:**
- Instructions telling the agent to read the dependency table, determine waves by reasoning, and execute one wave at a time
- A minimal REPL example showing just `Promise.all` + `mort.spawn()`
- Clear guidance: "Do NOT write file-parsing or graph-sorting code in the REPL. You can read and reason about the dependency table yourself."
- Instructions that the agent should update the readme.md status and write .result.md files using its own tools (Read/Edit/Write), not from within the REPL

### 2. Update `plugins/mort/skills/orchestrate/SKILL.md`

Add a **"Keep REPL code minimal"** principle to the Notes section:
- REPL scripts should be thin orchestration glue — primarily `mort.spawn()` calls with `Promise.all`
- Avoid writing business logic, file parsing, or complex algorithms in REPL code
- If you need to read files, reason about data, or edit files, do that as the agent (using your normal tools), not programmatically in the REPL

### 3. Update `plans/recursive-decomposition/readme.md`

Update the execution section to reflect the new minimal-REPL approach. The pseudocode in the "Execution: Topological Waves" section currently shows the same programmatic pattern. Replace with the agent-driven approach.

## Phases

- [x] Rewrite decompose SKILL.md — remove the programmatic template, replace with agent-driven wave execution using minimal REPL
- [x] Add minimal-REPL guidance to orchestrate SKILL.md
- [x] Update recursive-decomposition plan to reflect new approach

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design Rationale

**Why agent-level reasoning over programmatic parsing?**
The LLM is already reading the readme.md to understand the plan. Having it also write JS to regex-parse the same file is redundant. The agent can determine "01 and 02 have no deps, 03 depends on both" just by reading the table. The only thing it can't do natively is spawn parallel agents — that's what the REPL is for.

**Why one wave at a time instead of a loop?**
Between waves, the agent needs to:
- Check results and update status
- Write .result.md files
- Decide if blocked tasks should be unblocked or if failures change the plan

These are judgment calls, not mechanical operations. Keeping the agent in the loop between waves preserves its ability to adapt.

**Why update status outside the REPL?**
The agent has Read/Edit tools that work reliably on markdown files. Regex replacement from JS is fragile and duplicates capability the agent already has.
