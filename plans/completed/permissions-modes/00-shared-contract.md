# Shared Contract: Permission Types & Events

**Must be completed first** — the other three sub-plans depend on these types existing.

## Phases

- [x] Extend `core/types/permissions.ts` with rules engine types
- [x] Add `PERMISSION_MODE_CHANGED` event to `core/types/events.ts`
- [x] Add `permissionMode` to thread metadata schema

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Context

The other sub-plans (01, 02, 03) all import from `core/types/`. This plan defines the shared type surface so those plans can proceed in parallel once this is done.

## Phase 1: Extend `core/types/permissions.ts`

The file already has `PermissionRequest`, `PermissionDecision` ("approve" | "deny"), `PermissionStatus`, `isDangerousTool()`. We need to **add** types for the rules engine without breaking existing consumers.

### Types to add

```typescript
// ── Rules Engine Types ──────────────────────────────────────────────

/** Decision the evaluator can return (superset of user-facing PermissionDecision) */
export type EvaluatorDecision = "allow" | "deny" | "ask";

/** A single permission rule — first match wins */
export interface PermissionRule {
  toolPattern: string;        // regex on tool name (e.g. "^(Write|Edit)$")
  pathPattern?: string;       // regex on relative file path (e.g. "^plans/")
  commandPattern?: string;    // regex on Bash command argument
  decision: EvaluatorDecision;
  reason?: string;            // surfaced to agent on deny
}

/** The three built-in permission mode IDs */
export type PermissionModeId = "plan" | "implement" | "approve";

/** A permission mode definition with ordered rules */
export interface PermissionModeDefinition {
  id: PermissionModeId;
  name: string;               // Display name: "Plan", "Implement", "Approve"
  description: string;
  rules: PermissionRule[];    // evaluated in order, first match wins
  defaultDecision: EvaluatorDecision; // if no rules match
}

/** Full config passed to the evaluator */
export interface PermissionConfig {
  mode: PermissionModeDefinition;
  overrides: PermissionRule[];  // evaluated FIRST, before mode rules — can't be bypassed
  workingDirectory: string;
}

/** Cycle order for Shift+Tab */
export const PERMISSION_MODE_CYCLE: PermissionModeId[] = ["plan", "implement", "approve"];
```

### Built-in mode definitions

Also export these as constants from `core/types/permissions.ts`:

```typescript
export const PLAN_MODE: PermissionModeDefinition = {
  id: "plan",
  name: "Plan",
  description: "Can read everything, write only to plans/, Bash allowed",
  rules: [
    { toolPattern: "^(Read|Glob|Grep|WebFetch|WebSearch)$", decision: "allow" },
    { toolPattern: "^Bash$", decision: "allow" },
    { toolPattern: "^Task$", decision: "allow" },
    { toolPattern: "^(Write|Edit|NotebookEdit)$", pathPattern: "^plans/", decision: "allow" },
    { toolPattern: "^(Write|Edit|NotebookEdit)$", decision: "deny", reason: "Plan mode: writes are restricted to the plans/ directory" },
  ],
  defaultDecision: "deny",
};

export const IMPLEMENT_MODE: PermissionModeDefinition = {
  id: "implement",
  name: "Implement",
  description: "All tools auto-approved",
  rules: [],
  defaultDecision: "allow",
};

export const APPROVE_MODE: PermissionModeDefinition = {
  id: "approve",
  name: "Approve",
  description: "Read/Bash auto-approved, file edits require approval with diff preview",
  rules: [
    { toolPattern: "^(Read|Glob|Grep|WebFetch|WebSearch)$", decision: "allow" },
    { toolPattern: "^Bash$", decision: "allow" },
    { toolPattern: "^Task$", decision: "allow" },
    { toolPattern: "^(Write|Edit|NotebookEdit)$", decision: "ask" },
  ],
  defaultDecision: "ask",
};

export const BUILTIN_MODES: Record<PermissionModeId, PermissionModeDefinition> = {
  plan: PLAN_MODE,
  implement: IMPLEMENT_MODE,
  approve: APPROVE_MODE,
};
```

### Naming note

We use `PermissionModeDefinition` (not `PermissionMode`) because `PermissionMode` already exists in this file as `"ask-always" | "ask-writes" | "allow-all"`. The old type should be deprecated/removed once the new system is fully wired, but during this plan we keep both to avoid breaking existing imports.

## Phase 2: Add event to `core/types/events.ts`

Add to the `EventName` object:

```typescript
PERMISSION_MODE_CHANGED: "permission:mode-changed",
```

Add payload:

```typescript
[EventName.PERMISSION_MODE_CHANGED]: {
  threadId: string;
  modeId: PermissionModeId;
};
```

Add to `EventNameSchema` enum array.

**Import `PermissionModeId` from `@core/types/permissions.js`** at the top of events.ts (this is the first cross-import, but it flows in the correct direction within `core/`).

## Phase 3: Add `permissionMode` to thread metadata

In `core/types/threads.ts`, add to `ThreadMetadataBaseSchema`:

```typescript
permissionMode: z.enum(["plan", "implement", "approve"]).optional().default("plan"),
```

This is optional with a default so existing thread metadata files on disk remain valid.

## Files

| File | Changes |
|------|---------|
| `core/types/permissions.ts` | Add `EvaluatorDecision`, `PermissionRule`, `PermissionModeId`, `PermissionModeDefinition`, `PermissionConfig`, `PERMISSION_MODE_CYCLE`, built-in mode constants |
| `core/types/events.ts` | Add `PERMISSION_MODE_CHANGED` event + payload, add to `EventNameSchema` |
| `core/types/threads.ts` | Add `permissionMode` to `ThreadMetadataBaseSchema` |

## Verification

- `cd agents && pnpm build` passes (no type errors)
- `pnpm test` in root still passes (existing tests don't break)
- The new types are importable from both `agents/src/` and `src/` (type layering: both import from `core/`)
