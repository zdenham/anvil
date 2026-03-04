# Plan Mode Prompt Fix: Two-Layer Confusion

## Problem

The SDK's `ExitPlanMode` tool teaches the agent "exit plan mode → start implementing." Mort's plan mode has no implementation phase — the agent's job ends when the plan file is written. The agent calls `ExitPlanMode`, thinks it can now write code, gets denied by Mort's permission rules, and spirals.

Current prompting is too quiet: `Mode: Plan — read all, write only to plans/` gets drowned out by the SDK's built-in tool descriptions.

## Fix

Two changes: **deny the tool** and **tighten the prompt**.

### 1. Deny `ExitPlanMode` in PLAN_MODE rules

`core/types/permissions.ts` — remove `ExitPlanMode` from the allow list, add explicit deny:

```typescript
rules: [
  { toolPattern: "^(Read|Glob|Grep|WebFetch|WebSearch|TodoWrite|EnterPlanMode|AskUserQuestion)$", decision: "allow" },
  { toolPattern: "^Bash$", decision: "allow" },
  { toolPattern: "^Task$", decision: "allow" },
  { toolPattern: "^(Write|Edit|NotebookEdit)$", pathPattern: "^plans/", decision: "allow" },
  { toolPattern: "^(Write|Edit|NotebookEdit)$", decision: "deny", reason: "Plan mode: file writes are restricted to the plans/ directory." },
  { toolPattern: "^ExitPlanMode$", decision: "deny", reason: "Plan mode: write your plan to plans/ and stop. There is no implementation phase — the user will switch modes when ready." },
],
```

The deny reason does the heavy lifting. It tells the agent _why_ and _what to do instead_ in one sentence.

### 2. Tighten plan mode prompt in context.ts

`agents/src/context.ts` — replace the current `planHint` ternary with:

```typescript
if (thread.permissionModeId === "plan") {
  context += `\n\n<permissions>
Mode: ${desc}
Write plans to plans/ (kebab-case .md files).
Do not call ExitPlanMode or attempt implementation — writes outside plans/ will be denied.
</permissions>`;
} else {
  context += `\n\n<permissions>\nMode: ${desc}\n</permissions>`;
}
```

One extra line. No bullet list, no "CRITICAL CONSTRAINT" banner. The deny reason on `ExitPlanMode` carries most of the weight — this just sets expectations up front so the agent never tries.

### 3. Strengthen mode-change reminder

`agents/src/runner.ts` (line 217-219) — when switching _to_ plan mode, add a constraint reminder:

```typescript
const planContext = newMode.id === "plan"
  ? " Write plans to plans/. Do not call ExitPlanMode or implement code."
  : "";
```

## Open Question

**Does the SDK's internal plan mode block Write/Edit even when Mort's hook allows it?**

If yes, denying `ExitPlanMode` would trap the agent — it couldn't write plan files either. Needs a manual test: enter plan mode → try `Write` to `plans/test.md` without calling `ExitPlanMode`. If the write succeeds, the deny approach works. If not, keep `ExitPlanMode` allowed and rely on prompt-only.

## Phases

- [x] Deny ExitPlanMode in PLAN_MODE rules (`core/types/permissions.ts`)
- [x] Tighten plan mode prompt (`agents/src/context.ts`)
- [x] Strengthen mode-change reminder (`agents/src/runner.ts`)
- [ ] Manual test: verify writes to plans/ work without ExitPlanMode

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files

| File | Change |
|------|--------|
| `core/types/permissions.ts` | Remove `ExitPlanMode` from allow, add deny rule |
| `agents/src/context.ts` | Replace planHint with one-line constraint |
| `agents/src/runner.ts` | Add constraint to plan mode change message |
