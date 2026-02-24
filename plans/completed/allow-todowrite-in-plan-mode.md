# Allow TodoWrite, ExitPlanMode, and AskUserQuestion in Plan Mode

## Problem

`TodoWrite`, `ExitPlanMode`, and `AskUserQuestion` are blocked in plan mode because `PLAN_MODE` in `core/types/permissions.ts` uses `defaultDecision: "deny"` and only explicitly allows a handful of tools. These tools match no rule, so they fall through to the default deny.

**Confirmed:** `ExitPlanMode` is also blocked — attempting to call it from plan mode returns the same "not in the allowed tool list" error. This means the agent literally cannot exit plan mode via the tool.

These are all UI/control-flow tools with no codebase side effects. Blocking them in plan mode is unintentional.

## Phases

- [x] Add TodoWrite, ExitPlanMode, AskUserQuestion, and EnterPlanMode to PLAN_MODE allow rules in `core/types/permissions.ts`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix

**File:** `core/types/permissions.ts` (line 98)

Change the first allow rule from:

```typescript
{ toolPattern: "^(Read|Glob|Grep|WebFetch|WebSearch)$", decision: "allow" },
```

to:

```typescript
{ toolPattern: "^(Read|Glob|Grep|WebFetch|WebSearch|TodoWrite|ExitPlanMode|EnterPlanMode|AskUserQuestion)$", decision: "allow" },
```

These are all **UI/control-flow tools** with zero codebase side effects:

| Tool | Purpose | Why safe |
|------|---------|----------|
| `TodoWrite` | In-memory task list for progress tracking | No disk writes |
| `ExitPlanMode` | Signal that plan is ready for approval | Control flow only |
| `EnterPlanMode` | Enter plan mode | Control flow only |
| `AskUserQuestion` | Ask user a clarifying question | Control flow only |

### Why group them with the existing rule?

They're the same category — tools that are always safe regardless of permission mode. Keeping them in one rule makes intent clear.

### Also consider for APPROVE_MODE

`APPROVE_MODE` (line 119) has `defaultDecision: "ask"`, so these tools would prompt for approval rather than being silently denied. This is less broken but still annoying — the user shouldn't need to approve a todo list update. The same fix should be applied there too:

```typescript
// Line 120 — change:
{ toolPattern: "^(Read|Glob|Grep|WebFetch|WebSearch)$", decision: "allow" },
// to:
{ toolPattern: "^(Read|Glob|Grep|WebFetch|WebSearch|TodoWrite|ExitPlanMode|EnterPlanMode|AskUserQuestion)$", decision: "allow" },
```
