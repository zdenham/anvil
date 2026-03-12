# Fix Orphaned Child Threads from Denied Sub-Agent Spawns

## Problem

Sub-agents spawned in plan mode are immediately denied, leaving orphaned child threads. The SDK renamed the tool from `Task` to `Agent` (≥0.2.64), but the permission rules in `core/types/permissions.ts` only matched `^Task$`. The `Agent` tool fell through to `defaultDecision: "deny"` in plan and approve modes.

## Phases

- [x] Fix permission rules to allow the `Agent` tool

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix: Permission rules updated

**File:** `core/types/permissions.ts`

Changed `^Task$` → `^(Task|Agent)$` in both `PLAN_MODE` (line 101) and `APPROVE_MODE` (line 124). `IMPLEMENT_MODE` already allows everything via `defaultDecision: "allow"`.
