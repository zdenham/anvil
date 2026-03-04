# Fix Sub-Agent Integration Tests (SDK 0.2.64: Task → Agent)

## Context

SDK 0.2.64 renamed the sub-agent tool from `"Task"` to `"Agent"`. The production code (`shared.ts`, frontend registry, formatters, icons) already handles both names. But the integration tests hardcode `"Task"` in 33 places across 2 files. Since `toolState.toolName` now comes from the SDK as `"Agent"`, all sub-agent tests fail.

## Phases

- [x] Replace all "Task" references with "Agent" in sub-agent integration tests
- [x] Replace "Task" references in sub-agent usage test
- [x] Verify compilation passes

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Approach

Straight replacement — no alias maps, no shared constants. The tool is called `"Agent"` now; tests should say `"Agent"`. The `usedTools()` assertion helper stays unchanged (exact match is correct behavior).

## Changes

### File 1: `agents/src/testing/__tests__/sub-agent.integration.test.ts`

31 replacements in three categories:

**Prompt strings (11 instances)** — `"Use the Task tool"` → `"Use the Agent tool"`
- Lines 31, 91, 122, 169, 199, 265, 321, 391, 476, 568, 958

**`usedTools()` assertions (7 instances)** — `usedTools(["Task"])` → `usedTools(["Agent"])`
- Lines 39, 270, 326, 396, 481, 929, 963

**Direct `toolName` comparisons (5 instances)**
- Line 439: `hasToolType(parentState, "Task")` → `"Agent"`
- Line 457: `toolName !== "Task"` → `toolName !== "Agent"`
- Line 512: `state.toolName === "Task"` → `"Agent"`
- Line 1016: `toContain("Task")` → `toContain("Agent")`
- Line 1031: `state.toolName === "Task"` → `"Agent"`

**Comments and descriptions (~8 instances)** — update to reference "Agent tool" instead of "Task tool"

### File 2: `agents/src/testing/__tests__/sub-agent-usage.integration.test.ts`

2 replacements:
- Line 23: prompt `"Use the Task tool"` → `"Use the Agent tool"`
- Line 28: `usedTools(["Task"])` → `usedTools(["Agent"])`

### Files NOT changed

- `assertions.ts` — `usedTools()` exact match is correct, no alias needed
- `shared.ts` — already handles both names
- `background-task-lifecycle.test.ts` — its "Task" refs are in prompts (still work) and diagnostic greps (not assertions)

## Verification

```bash
cd agents && pnpm test          # Compilation check (integration tests skip without API key)
```

With `ANTHROPIC_API_KEY` set, run the full suite to verify child thread state population:
```bash
cd agents && pnpm test sub-agent.integration
```
